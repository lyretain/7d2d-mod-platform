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
    static bool pendingRestart;
    static string modsDirectory;
    static readonly Dictionary<int, ClientHandshake> clients = new Dictionary<int, ClientHandshake>();
    static readonly HashSet<int> claiming = new HashSet<int>();
    static readonly object gate = new object();

    static ModPlatformServerPlugin()
    {
        try
        {
            var mods = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Mods");
            PackSync.ApplyPending(mods);
            try { PackSync.ApplyPending(Path.Combine(GameIO.GetUserGameDataDir(), "Mods")); } catch { }
        }
        catch { }
    }

    public void InitMod(Mod modInstance)
    {
        string userMods = null;
        try { userMods = Path.Combine(GameIO.GetUserGameDataDir(), "Mods", "ModPlatformServer"); } catch { /* dedicated servers without GameIO still work */ }
        var installMods = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Mods", "ModPlatformServer");
        var modDirectory = PluginPaths.FindDirectory("server.config.json", modInstance != null ? modInstance.Path : null, userMods, installMods);
        var configFile = Path.Combine(modDirectory ?? installMods, "server.config.json");
        if (!File.Exists(configFile))
        {
            Log.Error("[ModPlatform] Missing server.config.json. Looked in: " + string.Join(" | ", PluginPaths.Tried("server.config.json", modInstance != null ? modInstance.Path : null, userMods, installMods)));
            return;
        }
        using (var stream = File.OpenRead(configFile)) config = (ServerConfig)new DataContractJsonSerializer(typeof(ServerConfig)).ReadObject(stream);
        modsDirectory = PackSync.ModsDirectory(modDirectory, config.ModsDir);
        PackSync.ApplyPending(modsDirectory);
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
        Log.Out("[ModPlatform] Handshake from " + client.playerName + " => " + decision.Reason + " client=" + (hello == null ? "" : hello.GameVersion) + " pack=" + (policy == null ? "" : policy.GameVersion) + " server=" + DetectGameVersion());
        if (!decision.Ok) Kick(client, decision.Reason, decision.Message);
        else Ignore(SendAsync("handshake_ok", client, null, HandshakeReasons.Ok));
    }

    static ModEvents.EModEventResult OnPlayerLogin(ref ModEvents.SPlayerLoginData data)
    {
        if (ConnectionManager.Instance == null || !ConnectionManager.Instance.IsServer) return ModEvents.EModEventResult.Continue;
        if (IsLocalHost(data.ClientInfo)) return ModEvents.EModEventResult.Continue;
        TryClaim(data.ClientInfo);
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
        TryClaim(data.ClientInfo);
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
        if (expired != null)
        {
            foreach (var item in expired) Kick(item.Client, HandshakeReasons.Timeout, DenyMessage(HandshakeReasons.Timeout, "Handshake timed out. Install the launcher and client plugin."));
        }
        List<ClientInfo> retry = null;
        lock (gate)
        {
            foreach (var item in clients.Values)
            {
                if (item.Verified || item.Client == null) continue;
                if (item.NextClaimAt > DateTime.UtcNow) continue;
                item.NextClaimAt = DateTime.UtcNow.AddSeconds(1);
                if (retry == null) retry = new List<ClientInfo>();
                retry.Add(item.Client);
            }
        }
        if (retry != null)
        {
            foreach (var client in retry) TryClaim(client);
        }
    }

    static void TryClaim(ClientInfo client)
    {
        if (client == null || platform == null || config == null) return;
        var key = Key(client);
        lock (gate)
        {
            if (clients.TryGetValue(key, out var state) && state.Verified) return;
            if (!claiming.Add(key)) return;
        }
        Ignore(ClaimAsync(client));
    }

    static async Task ClaimAsync(ClientInfo client)
    {
        try
        {
            var ids = CollectPlayerIds(client);
            if (ids.Count == 0) return;
            var hello = await platform.ClaimHandshakeAsync(config.ServerId, config.ServerToken, ids, CancellationToken.None).ConfigureAwait(false);
            if (hello != null) OnHello(client, hello);
        }
        catch (Exception error)
        {
            Log.Warning("[ModPlatform] Handshake claim failed: " + error.Message);
        }
        finally
        {
            lock (gate) claiming.Remove(Key(client));
        }
    }

    static List<string> CollectPlayerIds(ClientInfo client)
    {
        var ids = new List<string>();
        if (client == null) return ids;
        try { AddPlatformId(ids, client.PlatformId); } catch { }
        try { AddPlatformId(ids, client.CrossplatformId); } catch { }
        try { AddPlatformId(ids, client.InternalId); } catch { }
        try { AddId(ids, client.playerName); } catch { }
        return ids;
    }

    static void AddPlatformId(List<string> ids, PlatformUserIdentifierAbs value)
    {
        if (value == null) return;
        try { AddId(ids, value.CombinedString); } catch { }
        try { AddId(ids, value.ToString()); } catch { }
    }

    static void AddId(List<string> ids, string value)
    {
        if (string.IsNullOrWhiteSpace(value)) return;
        var trimmed = value.Trim();
        if (!ids.Exists(item => string.Equals(item, trimmed, StringComparison.OrdinalIgnoreCase))) ids.Add(trimmed);
    }

    static Decision Evaluate(HandshakeHello hello)
    {
        HandshakePolicy current;
        lock (gate) current = policy;
        if (current == null) return Deny(HandshakeReasons.Revoked, "No active signed ModPack is assigned.");
        if (current.DistributionPaused) return Deny(HandshakeReasons.DistributionPaused, "Mod distribution is paused.");
        if (hello == null || hello.ProtocolVersion != PluginIdentity.ProtocolVersion) return Deny(HandshakeReasons.InvalidHello, "Unsupported handshake protocol.");
        if (string.IsNullOrEmpty(current.PackId) || current.PackVersion == null || string.IsNullOrEmpty(current.ArtifactFingerprint)) return Deny(HandshakeReasons.Revoked, "The assigned release is missing or revoked.");
        var liveVersion = DetectGameVersion();
        if (!string.IsNullOrEmpty(hello.GameVersion) && !GameVersions.Compatible(hello.GameVersion, liveVersion) && !GameVersions.Compatible(hello.GameVersion, current.GameVersion))
            return Deny(HandshakeReasons.GameVersion, "Game version " + hello.GameVersion + " does not match server " + liveVersion + " or pack " + current.GameVersion + ".");
        if (hello.PackId != current.PackId || hello.PackVersion != current.PackVersion.Value)
            return Deny(HandshakeReasons.PackMismatch, "Client ModPack " + hello.PackId + " v" + hello.PackVersion + " does not match required " + current.PackId + " v" + current.PackVersion + ".");
        if (!string.IsNullOrEmpty(hello.KeyId) && !string.IsNullOrEmpty(current.KeyId) && hello.KeyId != current.KeyId)
            return Deny(HandshakeReasons.PackMismatch, "Signing key does not match the assigned release.");
        if (hello.ArtifactFingerprint != current.ArtifactFingerprint)
            return Deny(HandshakeReasons.PackMismatch, "Installed Mod hashes do not match the signed manifest.");
        return new Decision { Ok = true, Reason = HandshakeReasons.Ok, Message = HandshakeReasons.Ok };
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
                if (config.ShouldSync && assignment != null && assignment.Manifest != null)
                    await SyncPackAsync(assignment, token).ConfigureAwait(false);
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

    static async Task SyncPackAsync(ServerAssignment assignment, CancellationToken token)
    {
        var status = new ServerSyncStatus { Stage = "sync_start", Ok = true, PackId = assignment.PackId, PackVersion = assignment.Manifest == null ? (int?)null : assignment.Manifest.PackVersion };
        try { await platform.SendSyncStatusAsync(config.ServerId, config.ServerToken, status, token).ConfigureAwait(false); } catch { }
        try
        {
            var result = await PackSync.SyncAsync(modsDirectory, config.BaseUrl, assignment.Manifest, token).ConfigureAwait(false);
            if (result.Changed) Log.Out("[ModPlatform] Pack sync " + assignment.PackId + " v" + assignment.Manifest.PackVersion + " installed=" + result.Installed + " updated=" + result.Updated + " unchanged=" + result.Unchanged);
            else Log.Out("[ModPlatform] Pack sync already current " + assignment.PackId + " v" + assignment.Manifest.PackVersion);
            if (result.RequiresRestart || result.Changed)
            {
                pendingRestart = true;
                Log.Warning("[ModPlatform] " + (result.Message ?? "Restart the dedicated server to load the new pack."));
            }
            status = new ServerSyncStatus { Stage = "sync_ok", Ok = true, PackId = assignment.PackId, PackVersion = assignment.Manifest.PackVersion, RequiresRestart = pendingRestart, Message = result.Message };
            try { await platform.SendSyncStatusAsync(config.ServerId, config.ServerToken, status, token).ConfigureAwait(false); } catch { }
            if (config.ShouldRestart && pendingRestart) RequestRestart();
        }
        catch (Exception error)
        {
            Log.Warning("[ModPlatform] Pack sync failed: " + error.Message);
            status = new ServerSyncStatus { Stage = "sync_failed", Ok = false, PackId = assignment.PackId, PackVersion = assignment.Manifest == null ? (int?)null : assignment.Manifest.PackVersion, Message = error.Message, RequiresRestart = pendingRestart };
            try { await platform.SendSyncStatusAsync(config.ServerId, config.ServerToken, status, token).ConfigureAwait(false); } catch { }
            throw;
        }
    }

    static void RequestRestart()
    {
        Log.Warning("[ModPlatform] AutoRestart is enabled; dedicated server will exit so the new pack can load.");
        try { UnityEngine.Application.Quit(); }
        catch
        {
            try { Environment.Exit(0); } catch { }
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
            acceptingPlayers = assignment.AcceptingPlayers && !pendingRestart && policy != null && !policy.DistributionPaused && policy.PackVersion != null;
        }
        Log.Out("[ModPlatform] Active pack " + assignment.PackId + " v" + (assignment.Manifest == null ? 0 : assignment.Manifest.PackVersion) + " accepting=" + acceptingPlayers + (pendingRestart ? " restartRequired=True" : ""));
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
                    acceptingPlayers = assignment.AcceptingPlayers && !pendingRestart && policy != null && !policy.DistributionPaused && policy.PackVersion != null;
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
        public DateTime NextClaimAt;
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
    [DataMember] public bool? AutoSync { get; set; }
    [DataMember] public bool? AutoRestart { get; set; }
    [DataMember] public string ModsDir { get; set; }

    public bool ShouldSync { get { return AutoSync != false; } }
    public bool ShouldRestart { get { return AutoRestart == true; } }

    public ServerConfig()
    {
        RefreshSeconds = 60;
        HandshakeTimeoutSeconds = 15;
    }
}
