using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Threading;
using System.Threading.Tasks;
using ModPlatform.Shared;

public sealed class ModPlatformServerPlugin : IModApi
{
    static ServerConfig config;
    static PlatformClient platform;
    static CancellationTokenSource lifetime;
    static HandshakePolicy policy;
    static bool acceptingPlayers;
    static readonly Dictionary<int, ClientHandshake> clients = new Dictionary<int, ClientHandshake>();
    static readonly object gate = new object();

    public void InitMod(Mod modInstance)
    {
        var modDirectory = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Mods", "ModPlatformServer");
        var configFile = Path.Combine(modDirectory, "server.config.json");
        if (!File.Exists(configFile)) { Log.Error("[ModPlatform] Missing " + configFile); return; }
        using (var stream = File.OpenRead(configFile)) config = (ServerConfig)new DataContractJsonSerializer(typeof(ServerConfig)).ReadObject(stream);
        platform = new PlatformClient(config.BaseUrl);
        lifetime = new CancellationTokenSource();
        LoadCachedAssignment(modDirectory);
        ModEvents.PlayerLogin.RegisterHandler(OnPlayerLogin);
        ModEvents.PlayerJoinedGame.RegisterHandler(OnPlayerJoined);
        ModEvents.PlayerSpawning.RegisterHandler(OnPlayerSpawning);
        ModEvents.PlayerDisconnected.RegisterHandler(OnPlayerDisconnected);
        ModEvents.GameUpdate.RegisterHandler(OnGameUpdate);
        Task.Run(() => PollAsync(modDirectory, lifetime.Token));
        AppDomain.CurrentDomain.ProcessExit += (_, __) => lifetime.Cancel();
        Log.Out("[ModPlatform] Server bootstrap started v" + PluginIdentity.PluginVersion + " protocol " + PluginIdentity.ProtocolVersion + " target " + PluginIdentity.TargetGameVersion + " / " + PluginIdentity.TargetSteamBuild);
    }

    public static void OnHello(ClientInfo client, HandshakeHello hello)
    {
        if (client == null) return;
        var decision = Evaluate(hello);
        lock (gate)
        {
            clients[Key(client)] = new ClientHandshake { Verified = decision.Ok, Reason = decision.Reason, Message = decision.Message, JoinedAt = DateTime.UtcNow, Client = client };
        }
        Log.Out("[ModPlatform] Handshake from " + client.playerName + " => " + decision.Reason);
        if (!decision.Ok) Kick(client, decision.Reason, decision.Message);
        else Ignore(SendAsync("handshake_ok", client, null, HandshakeReasons.Ok));
    }

    static ModEvents.EModEventResult OnPlayerLogin(ref ModEvents.SPlayerLoginData data)
    {
        if (ConnectionManager.Instance == null || !ConnectionManager.Instance.IsServer) return ModEvents.EModEventResult.Continue;
        if (IsLocalHost(data.ClientInfo)) return ModEvents.EModEventResult.Continue;
        string reason;
        string message;
        lock (gate)
        {
            if (policy != null && policy.DistributionPaused)
            {
                reason = HandshakeReasons.DistributionPaused;
                message = DenyMessage(reason, "Mod distribution is paused.");
            }
            else if (!acceptingPlayers)
            {
                reason = HandshakeReasons.Timeout;
                message = DenyMessage(reason, "Server is still synchronizing mods. Retry in a moment.");
            }
            else if (clients.TryGetValue(Key(data.ClientInfo), out var state) && !state.Verified)
            {
                reason = state.Reason;
                message = state.Message;
            }
            else
            {
                return ModEvents.EModEventResult.Continue;
            }
        }
        data.CustomMessage = message;
        Ignore(SendAsync("handshake_reject", data.ClientInfo, null, reason));
        return ModEvents.EModEventResult.StopHandlersAndVanilla;
    }

    static void OnPlayerJoined(ref ModEvents.SPlayerJoinedGameData data)
    {
        if (data.ClientInfo == null || IsLocalHost(data.ClientInfo)) return;
        lock (gate)
        {
            if (!clients.ContainsKey(Key(data.ClientInfo)))
                clients[Key(data.ClientInfo)] = new ClientHandshake { Verified = false, Reason = HandshakeReasons.MissingPlugin, Message = DenyMessage(HandshakeReasons.MissingPlugin, "Client plugin is missing."), JoinedAt = DateTime.UtcNow, Client = data.ClientInfo };
            else clients[Key(data.ClientInfo)].JoinedAt = DateTime.UtcNow;
        }
    }

    static void OnPlayerSpawning(ref ModEvents.SPlayerSpawningData data)
    {
        if (data.ClientInfo == null || IsLocalHost(data.ClientInfo)) return;
        ClientHandshake state;
        lock (gate) clients.TryGetValue(Key(data.ClientInfo), out state);
        if (state == null || !state.Verified)
        {
            var reason = state == null ? HandshakeReasons.MissingPlugin : state.Reason;
            Kick(data.ClientInfo, reason, state == null ? DenyMessage(reason, "Client plugin is missing.") : state.Message);
        }
    }

    static void OnPlayerDisconnected(ref ModEvents.SPlayerDisconnectedData data)
    {
        if (data.ClientInfo == null) return;
        lock (gate) clients.Remove(Key(data.ClientInfo));
    }

    static void OnGameUpdate(ref ModEvents.SGameUpdateData data)
    {
        var timeout = TimeSpan.FromSeconds(Math.Max(8, config == null ? 15 : config.HandshakeTimeoutSeconds));
        List<ClientHandshake> expired = null;
        lock (gate)
        {
            foreach (var item in clients.Values)
            {
                if (item.Verified || item.Client == null) continue;
                if (DateTime.UtcNow - item.JoinedAt < timeout) continue;
                if (expired == null) expired = new List<ClientHandshake>();
                expired.Add(item);
            }
        }
        if (expired == null) return;
        foreach (var item in expired) Kick(item.Client, HandshakeReasons.Timeout, DenyMessage(HandshakeReasons.Timeout, "Handshake timed out. Install the launcher and client plugin."));
    }

    static Decision Evaluate(HandshakeHello hello)
    {
        HandshakePolicy current;
        lock (gate) current = policy;
        if (current == null) return Deny(HandshakeReasons.Revoked, "No active signed ModPack is assigned.");
        if (current.DistributionPaused) return Deny(HandshakeReasons.DistributionPaused, "Mod distribution is paused.");
        if (hello == null || hello.ProtocolVersion != PluginIdentity.ProtocolVersion) return Deny(HandshakeReasons.InvalidHello, "Unsupported handshake protocol.");
        if (string.IsNullOrEmpty(current.PackId) || current.PackVersion == null || string.IsNullOrEmpty(current.ArtifactFingerprint)) return Deny(HandshakeReasons.Revoked, "The assigned release is missing or revoked.");
        if (!string.IsNullOrEmpty(hello.GameVersion) && !string.IsNullOrEmpty(current.GameVersion) && !VersionsCompatible(hello.GameVersion, current.GameVersion))
            return Deny(HandshakeReasons.GameVersion, "Game version " + hello.GameVersion + " does not match required " + current.GameVersion + ".");
        if (hello.PackId != current.PackId || hello.PackVersion != current.PackVersion.Value)
            return Deny(HandshakeReasons.PackMismatch, "Client ModPack " + hello.PackId + " v" + hello.PackVersion + " does not match required " + current.PackId + " v" + current.PackVersion + ".");
        if (!string.IsNullOrEmpty(hello.KeyId) && !string.IsNullOrEmpty(current.KeyId) && hello.KeyId != current.KeyId)
            return Deny(HandshakeReasons.PackMismatch, "Signing key does not match the assigned release.");
        if (hello.ArtifactFingerprint != current.ArtifactFingerprint)
            return Deny(HandshakeReasons.PackMismatch, "Installed Mod hashes do not match the signed manifest.");
        return new Decision { Ok = true, Reason = HandshakeReasons.Ok, Message = HandshakeReasons.Ok };
    }

    static bool VersionsCompatible(string actual, string required)
    {
        if (string.Equals(actual, required, StringComparison.OrdinalIgnoreCase)) return true;
        return actual.Replace("V ", "").Replace("v ", "") == required.Replace("V ", "").Replace("v ", "");
    }

    static Decision Deny(string reason, string detail) { return new Decision { Ok = false, Reason = reason, Message = DenyMessage(reason, detail) }; }

    static string DenyMessage(string reason, string detail)
    {
        var launcher = policy != null && !string.IsNullOrEmpty(policy.LauncherUrl) ? policy.LauncherUrl : (config != null ? config.BaseUrl : "");
        return "[ModPlatform] " + reason + ": " + detail + " Download/sync from " + launcher + " then reconnect.";
    }

    static void Kick(ClientInfo client, string reason, string message)
    {
        if (client == null) return;
        Log.Warning("[ModPlatform] Reject " + client.playerName + " " + reason);
        Ignore(SendAsync("handshake_kick", client, null, reason));
        try { ConnectionManager.Instance.DisconnectClient(client, false, false); }
        catch (Exception error) { Log.Warning("[ModPlatform] Disconnect failed: " + error.Message); }
    }

    static async Task PollAsync(string directory, CancellationToken token)
    {
        while (!token.IsCancellationRequested)
        {
            Exception failure = null;
            try
            {
                var assignment = await platform.GetAssignmentAsync(config.ServerId, config.ServerToken, token).ConfigureAwait(false);
                ApplyAssignment(assignment, directory);
            }
            catch (Exception error)
            {
                Log.Warning("[ModPlatform] Assignment refresh failed: " + error.Message);
                failure = error;
            }
            if (failure != null)
            {
                try { await platform.SendDiagnosticAsync(CreateDiagnostic("assignment_refresh", failure), token).ConfigureAwait(false); } catch { }
            }
            try { await Task.Delay(TimeSpan.FromSeconds(Math.Max(15, config.RefreshSeconds)), token).ConfigureAwait(false); } catch (OperationCanceledException) { }
        }
    }

    static void ApplyAssignment(ServerAssignment assignment, string directory)
    {
        if (assignment == null) return;
        var target = Path.Combine(directory, "current-assignment.json");
        var temporary = target + ".tmp";
        File.WriteAllText(temporary, PlatformClient.Serialize(assignment));
        if (File.Exists(target)) File.Delete(target);
        File.Move(temporary, target);
        lock (gate)
        {
            policy = assignment.Handshake;
            acceptingPlayers = assignment.AcceptingPlayers && policy != null && !policy.DistributionPaused && policy.PackVersion != null;
        }
        Log.Out("[ModPlatform] Active pack " + assignment.PackId + " v" + (assignment.Manifest == null ? 0 : assignment.Manifest.PackVersion) + " accepting=" + acceptingPlayers);
    }

    static void LoadCachedAssignment(string directory)
    {
        var file = Path.Combine(directory, "current-assignment.json");
        if (!File.Exists(file)) return;
        try
        {
            using (var stream = File.OpenRead(file))
            {
                var assignment = PlatformClient.Deserialize<ServerAssignment>(stream);
                lock (gate)
                {
                    policy = assignment.Handshake;
                    acceptingPlayers = assignment.AcceptingPlayers && policy != null && !policy.DistributionPaused && policy.PackVersion != null;
                }
                Log.Out("[ModPlatform] Loaded cached assignment " + assignment.PackId);
            }
        }
        catch (Exception error)
        {
            Log.Warning("[ModPlatform] Cached assignment unreadable: " + error.Message);
        }
    }

    static bool IsLocalHost(ClientInfo client)
    {
        return client == null || ConnectionManager.Instance != null && ConnectionManager.Instance.IsSinglePlayer;
    }

    static int Key(ClientInfo client) { return client.ClientNumber; }

    static DiagnosticEvent CreateDiagnostic(string stage, Exception error)
    {
        return new DiagnosticEvent
        {
            SessionId = Guid.NewGuid().ToString("N"),
            Side = "server",
            GameVersion = DetectGameVersion(),
            PackId = policy == null ? config.GameVersion : policy.PackId,
            PackVersion = policy == null ? (int?)null : policy.PackVersion,
            Stage = stage,
            ExceptionType = error == null ? "Success" : error.GetType().FullName,
            Message = error == null ? stage : error.Message,
            StackTrace = error == null ? null : error.StackTrace,
            OccurredAt = DateTime.UtcNow.ToString("O")
        };
    }

    static async Task SendAsync(string stage, ClientInfo client, Exception error, string reason)
    {
        if (platform == null) return;
        try
        {
            var ev = CreateDiagnostic(stage, error);
            ev.Message = (reason ?? stage) + (client == null ? "" : " player=" + client.playerName);
            await platform.SendDiagnosticAsync(ev, CancellationToken.None).ConfigureAwait(false);
        }
        catch { }
    }

    static string DetectGameVersion()
    {
        try { return string.Format("{0} {1}.{2}.{3}", Constants.cReleaseType, Constants.cVersionMajor, Constants.cVersionMinor, Constants.cVersionBuild).Trim(); }
        catch { return config != null && !string.IsNullOrEmpty(config.GameVersion) ? config.GameVersion : PluginIdentity.TargetGameVersion; }
    }

    static void Ignore(Task task) { }

    sealed class ClientHandshake
    {
        public bool Verified;
        public string Reason;
        public string Message;
        public DateTime JoinedAt;
        public ClientInfo Client;
    }

    sealed class Decision
    {
        public bool Ok;
        public string Reason;
        public string Message;
    }
}

[DataContract]
public sealed class ServerConfig
{
    [DataMember] public string BaseUrl { get; set; }
    [DataMember] public string ServerId { get; set; }
    [DataMember] public string ServerToken { get; set; }
    [DataMember] public string GameVersion { get; set; }
    [DataMember] public int RefreshSeconds { get; set; }
    [DataMember] public int HandshakeTimeoutSeconds { get; set; }

    public ServerConfig()
    {
        RefreshSeconds = 60;
        HandshakeTimeoutSeconds = 15;
    }
}
