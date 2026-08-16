using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Threading;
using System.Threading.Tasks;
using ModPlatform.Shared;
using Platform;

public sealed class ModPlatformClientPlugin : IModApi
{
    static ClientConfig config;
    static PlatformClient platform;
    static readonly string SessionId = Guid.NewGuid().ToString("N");
    static string modsDirectory;
    static bool handshakeSent;
    static bool handshakeBusy;
    static string handshakeAddress;
    static DateTime nextHandshakeAttempt;
    static bool reconnectAttempted;

    public void InitMod(Mod modInstance)
    {
        try { modsDirectory = Path.Combine(GameIO.GetUserGameDataDir(), "Mods"); }
        catch { modsDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "7DaysToDie", "Mods"); }
        var directory = PluginPaths.FindDirectory(
            "client.config.json",
            modInstance != null ? modInstance.Path : null,
            Path.Combine(modsDirectory, "ModPlatformClient"),
            Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Mods", "ModPlatformClient"));
        var configFile = Path.Combine(directory ?? modsDirectory, "client.config.json");
        if (!File.Exists(configFile)) { Log.Warning("[ModPlatform] Client config is missing"); return; }
        using (var stream = File.OpenRead(configFile)) config = (ClientConfig)new DataContractJsonSerializer(typeof(ClientConfig)).ReadObject(stream);
        platform = new PlatformClient(config.BaseUrl);
        ModEvents.GameStartDone.RegisterHandler(OnGameStartDone);
        ModEvents.GameUpdate.RegisterHandler(OnGameUpdate);
        if (config.DiagnosticsEnabled)
        {
            AppDomain.CurrentDomain.UnhandledException += OnUnhandledException;
            TaskScheduler.UnobservedTaskException += OnUnobservedTaskException;
            Ignore(SendAsync("plugin_initialized", null));
        }
        Log.Out("[ModPlatform] Client bootstrap initialized v" + PluginIdentity.PluginVersion + " protocol " + PluginIdentity.ProtocolVersion + " target " + PluginIdentity.TargetGameVersion + " / " + PluginIdentity.TargetSteamBuild);
    }

    static void OnGameStartDone(ref ModEvents.SGameStartDoneData data)
    {
        TrySendHandshake();
    }

    static void OnGameUpdate(ref ModEvents.SGameUpdateData data)
    {
        TrySendHandshake();
        TryAutoReconnect();
    }

    static void TrySendHandshake()
    {
        if (platform == null || handshakeBusy || DateTime.UtcNow < nextHandshakeAttempt) return;
        var address = CurrentServerAddress();
        if (string.IsNullOrEmpty(address)) return;
        if (handshakeSent && string.Equals(handshakeAddress, address, StringComparison.OrdinalIgnoreCase)) return;
        var playerIds = CollectLocalPlayerIds();
        if (playerIds.Count == 0) return;
        handshakeBusy = true;
        nextHandshakeAttempt = DateTime.UtcNow.AddSeconds(2);
        Ignore(SendHandshakeAsync(address, playerIds));
    }

    static async Task SendHandshakeAsync(string address, List<string> playerIds)
    {
        try
        {
            var hello = BuildHello();
            await platform.SubmitHandshakeAsync(address, playerIds, hello, CancellationToken.None).ConfigureAwait(false);
            handshakeSent = true;
            handshakeAddress = address;
            Log.Out("[ModPlatform] Handshake sent address=" + address + " pack=" + hello.PackId + " v" + hello.PackVersion);
            Ignore(SendAsync("handshake_sent", null));
        }
        catch (Exception error)
        {
            handshakeSent = false;
            Log.Warning("[ModPlatform] Handshake send failed: " + error.Message);
        }
        finally
        {
            handshakeBusy = false;
        }
    }

    static string CurrentServerAddress()
    {
        try
        {
            var ip = GamePrefs.GetString(EnumGamePrefs.ConnectToServerIP);
            var port = GamePrefs.GetInt(EnumGamePrefs.ConnectToServerPort);
            if (!string.IsNullOrEmpty(ip) && port > 0) return ip.Trim() + ":" + port;
        }
        catch { }
        try
        {
            var info = ConnectionManager.Instance == null ? null : ConnectionManager.Instance.LastGameServerInfo;
            if (info != null)
            {
                var ip = info.GetValue(GameInfoString.IP);
                var port = info.GetValue(GameInfoInt.Port);
                if (!string.IsNullOrEmpty(ip) && port > 0) return ip.Trim() + ":" + port;
            }
        }
        catch { }
        return null;
    }

    static List<string> CollectLocalPlayerIds()
    {
        var ids = new List<string>();
        try { AddPlatformId(ids, PlatformManager.NativePlatform.User.PlatformUserId); } catch { }
        try { AddPlatformId(ids, PlatformManager.CrossplatformPlatform.User.PlatformUserId); } catch { }
        try { AddId(ids, GamePrefs.GetString(EnumGamePrefs.PlayerName)); } catch { }
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

    static HandshakeHello BuildHello()
    {
        var state = LocalState.ReadPackState(modsDirectory);
        return new HandshakeHello
        {
            ProtocolVersion = PluginIdentity.ProtocolVersion,
            PluginVersion = PluginIdentity.PluginVersion,
            GameVersion = DetectGameVersion(),
            SteamBuildId = PluginIdentity.TargetSteamBuild,
            PackId = state == null ? "" : state.PackId,
            PackVersion = state == null ? 0 : state.PackVersion,
            KeyId = state == null ? "" : state.KeyId,
            ArtifactFingerprint = state == null ? "" : state.ArtifactFingerprint,
            SessionId = SessionId
        };
    }

    static string DetectGameVersion()
    {
        try { return string.Format("{0} {1}.{2}.{3}", Constants.cReleaseType, Constants.cVersionMajor, Constants.cVersionMinor, Constants.cVersionBuild).Trim(); }
        catch { return config != null && !string.IsNullOrEmpty(config.GameVersion) ? config.GameVersion : PluginIdentity.TargetGameVersion; }
    }

    static void TryAutoReconnect()
    {
        if (reconnectAttempted || ConnectionManager.Instance == null || ConnectionManager.Instance.IsClient || ConnectionManager.Instance.IsServer) return;
        var address = LocalState.ReadReconnectAddress(modsDirectory);
        if (string.IsNullOrEmpty(address) || address.IndexOf(':') < 0) return;
        reconnectAttempted = true;
        try
        {
            var parts = address.Split(':');
            int port;
            if (!int.TryParse(parts[parts.Length - 1], out port)) return;
            var host = string.Join(":", parts, 0, parts.Length - 1);
            var info = new GameServerInfo();
            info.SetValue(GameInfoString.IP, host);
            info.SetValue(GameInfoInt.Port, port);
            ConnectionManager.Instance.Connect(info);
            LocalState.ClearReconnect(modsDirectory);
            Log.Out("[ModPlatform] Auto-reconnect " + address);
        }
        catch (Exception error)
        {
            Log.Warning("[ModPlatform] Auto-reconnect failed: " + error.Message);
        }
    }

    static void OnUnhandledException(object sender, UnhandledExceptionEventArgs args) { Ignore(SendAsync("unhandled_exception", args.ExceptionObject as Exception)); }
    static void OnUnobservedTaskException(object sender, UnobservedTaskExceptionEventArgs args) { Ignore(SendAsync("unobserved_task", args.Exception)); }
    static void Ignore(Task task) { }

    static async Task SendAsync(string stage, Exception error)
    {
        if (config == null || !config.DiagnosticsEnabled || platform == null) return;
        try
        {
            await platform.SendDiagnosticAsync(new DiagnosticEvent
            {
                SessionId = SessionId,
                Side = "client",
                GameVersion = DetectGameVersion(),
                PackId = LocalState.ReadPackState(modsDirectory)?.PackId,
                PackVersion = LocalState.ReadPackState(modsDirectory)?.PackVersion,
                Stage = stage,
                ExceptionType = error == null ? "Success" : error.GetType().FullName,
                Message = error == null ? "Client plugin " + stage : error.Message,
                StackTrace = error == null ? null : error.StackTrace,
                OccurredAt = DateTime.UtcNow.ToString("O")
            }, CancellationToken.None).ConfigureAwait(false);
        }
        catch { }
    }
}

[DataContract]
public sealed class ClientConfig
{
    [DataMember] public string BaseUrl { get; set; }
    [DataMember] public string GameVersion { get; set; }
    [DataMember] public bool DiagnosticsEnabled { get; set; }

    public ClientConfig() { DiagnosticsEnabled = true; }
}
