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
    static string configFile;
    static bool diagnosticsHooked;
    static bool handshakeSent;
    static bool handshakeBusy;
    static string handshakeAddress;
    static string handshakeServerId;
    static string resolvedServerId;
    static DateTime nextHandshakeAttempt;
    static DateTime nextHandshakeSkipLog;
    static bool reconnectAttempted;
    static bool wasClient;
    static bool syncBusy;
    static bool syncReady;
    static string syncedAddress;
    static DateTime nextSyncAttempt;
    static DateTime nextRefresh;
    static bool silentRefresh;
    static bool restartPromptPending;
    static bool restartPromptShown;
    static string syncProgressText;
    static PackSyncProgress syncProgress;

    static ModPlatformClientPlugin()
    {
        try { PackSync.ApplyPending(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "7DaysToDie", "Mods")); } catch { }
    }

    public void InitMod(Mod modInstance)
    {
        try { modsDirectory = Path.Combine(GameIO.GetUserGameDataDir(), "Mods"); }
        catch { modsDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "7DaysToDie", "Mods"); }
        PackSync.ApplyPending(modsDirectory);
        var directory = PluginPaths.FindDirectory(
            "client.config.json",
            modInstance != null ? modInstance.Path : null,
            Path.Combine(modsDirectory, "ModPlatformClient"),
            Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Mods", "ModPlatformClient"));
        configFile = Path.Combine(directory ?? modsDirectory, "client.config.json");
        config = LoadOrCreateConfig(configFile);
        ApplyRuntime(false);
        ModEvents.GameStartDone.RegisterHandler(OnGameStartDone);
        ModEvents.GameUpdate.RegisterHandler(OnGameUpdate);
        if (config.DiagnosticsEnabled) Ignore(SendAsync("plugin_initialized", null));
        Log.Out("[ModPlatform] Client bootstrap initialized v" + PluginIdentity.PluginVersion + " protocol " + PluginIdentity.ProtocolVersion + " target " + PluginIdentity.TargetGameVersion + " / " + PluginIdentity.TargetSteamBuild);
    }

    internal static ClientConfig CurrentConfig()
    {
        return config == null ? new ClientConfig() : config.Clone();
    }

    internal static string PackStatusText()
    {
        if (syncProgress != null) return SyncUiStatus();
        if (!string.IsNullOrEmpty(syncProgressText)) return syncProgressText;
        var state = LocalState.ReadPackState(modsDirectory);
        if (state == null || string.IsNullOrEmpty(state.PackId)) return Loc("xuiModPlatformPackNone");
        return Loc("xuiModPlatformPackReady", state.PackId, state.PackVersion);
    }

    internal static string SyncUiTitle()
    {
        return Loc("xuiModPlatformDownloading");
    }

    internal static string SyncUiSubtitle()
    {
        return Loc("xuiModPlatformDownloadWait");
    }

    internal static string SyncUiStatus()
    {
        var progress = syncProgress;
        if (progress == null) return syncProgressText ?? Loc("xuiModPlatformDownloadWait");
        if (progress.Phase == "start")
            return Loc("xuiModPlatformDownloadStart", progress.PackFiles, progress.Total, PackSyncProgress.FormatBytes(progress.BytesTotal));
        if (progress.Phase == "complete")
            return Loc("xuiModPlatformDownloadDoneFile", progress.Index, progress.Total, progress.Name ?? "");
        return Loc("xuiModPlatformDownloadFile", Math.Max(1, progress.Index), Math.Max(1, progress.Total), progress.Name ?? "");
    }

    internal static string SyncUiBytes()
    {
        var progress = syncProgress;
        if (progress == null || progress.Phase == "start") return "";
        var percent = progress.BytesTotal > 0 ? (int)(progress.BytesReceived * 100 / progress.BytesTotal) : 0;
        return Loc("xuiModPlatformDownloadBytes", PackSyncProgress.FormatBytes(progress.BytesReceived), PackSyncProgress.FormatBytes(progress.BytesTotal), percent);
    }

    internal static string SyncUiProgressFill()
    {
        var progress = syncProgress;
        if (progress == null || progress.BytesTotal <= 0) return progress != null && progress.Phase == "complete" ? "1" : "0";
        var fill = progress.BytesReceived / (double)progress.BytesTotal;
        if (fill < 0) fill = 0;
        if (fill > 1) fill = 1;
        return fill.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture);
    }

    static string Loc(string key, params object[] args)
    {
        var text = key;
        try { text = Localization.Get(key); } catch { }
        if (string.IsNullOrEmpty(text) || text == key)
        {
            if (key == "xuiModPlatformDownloading") text = "Downloading mods";
            else if (key == "xuiModPlatformDownloadWait") text = "Please wait while the server ModPack is installed.";
            else if (key == "xuiModPlatformDownloadStart") text = "{0} files in pack, downloading {1} ({2})";
            else if (key == "xuiModPlatformDownloadFile") text = "Downloading {0}/{1}: {2}";
            else if (key == "xuiModPlatformDownloadBytes") text = "{0} / {1} ({2}%)";
            else if (key == "xuiModPlatformDownloadDoneFile") text = "Finished {0}/{1}: {2}";
            else if (key == "xuiModPlatformPackNone") text = "No ModPack installed";
            else if (key == "xuiModPlatformPackReady") text = "Installed pack {0} v{1}";
        }
        if (args == null || args.Length == 0) return text;
        try { return string.Format(text, args); }
        catch { return text; }
    }

    internal static void ApplyFromUi(string baseUrl, bool autoSync, bool autoRestart, bool diagnostics)
    {
        if (config == null) config = new ClientConfig();
        config.BaseUrl = string.IsNullOrWhiteSpace(baseUrl) ? "https://mods.aic.la" : baseUrl.Trim().TrimEnd('/');
        config.AutoSync = autoSync;
        config.AutoRestart = autoRestart;
        config.DiagnosticsEnabled = diagnostics;
        if (string.IsNullOrEmpty(config.GameVersion)) config.GameVersion = PluginIdentity.TargetGameVersion;
        SaveConfig();
        ApplyRuntime(true);
        Log.Out("[ModPlatform] Client settings saved BaseUrl=" + config.BaseUrl + " AutoSync=" + config.ShouldSync + " AutoRestart=" + config.ShouldRestart + " Diagnostics=" + config.DiagnosticsEnabled);
    }

    static ClientConfig LoadOrCreateConfig(string file)
    {
        if (File.Exists(file))
        {
            using (var stream = File.OpenRead(file))
                return (ClientConfig)new DataContractJsonSerializer(typeof(ClientConfig)).ReadObject(stream);
        }
        var created = new ClientConfig();
        Log.Warning("[ModPlatform] Client config is missing; writing defaults to " + file);
        try { SaveConfigTo(file, created); } catch (Exception error) { Log.Warning("[ModPlatform] Could not write default client config: " + error.Message); }
        return created;
    }

    static void SaveConfig()
    {
        if (string.IsNullOrEmpty(configFile) || config == null) return;
        SaveConfigTo(configFile, config);
    }

    static void SaveConfigTo(string file, ClientConfig value)
    {
        var directory = Path.GetDirectoryName(file);
        if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);
        using (var stream = File.Create(file))
            new DataContractJsonSerializer(typeof(ClientConfig)).WriteObject(stream, value);
    }

    static void ApplyRuntime(bool fromUi)
    {
        if (config == null) config = new ClientConfig();
        if (string.IsNullOrEmpty(config.BaseUrl)) config.BaseUrl = "https://mods.aic.la";
        if (platform == null || fromUi)
        {
            try { if (platform != null) platform.Dispose(); } catch { }
            platform = new PlatformClient(config.BaseUrl);
        }
        SetDiagnosticsHooked(config.DiagnosticsEnabled);
        if (fromUi)
        {
            syncReady = false;
            syncedAddress = null;
            handshakeSent = false;
        }
    }

    static void SetDiagnosticsHooked(bool enabled)
    {
        if (enabled == diagnosticsHooked) return;
        if (enabled)
        {
            AppDomain.CurrentDomain.UnhandledException += OnUnhandledException;
            TaskScheduler.UnobservedTaskException += OnUnobservedTaskException;
        }
        else
        {
            AppDomain.CurrentDomain.UnhandledException -= OnUnhandledException;
            TaskScheduler.UnobservedTaskException -= OnUnobservedTaskException;
        }
        diagnosticsHooked = enabled;
    }

    static void OnGameStartDone(ref ModEvents.SGameStartDoneData data)
    {
        TrySyncPack();
        TrySendHandshake();
    }

    static void OnGameUpdate(ref ModEvents.SGameUpdateData data)
    {
        try { if (ConnectionManager.Instance != null && ConnectionManager.Instance.IsClient) wasClient = true; } catch { }
        TryAutoReconnect();
        TrySyncPack();
        TrySendHandshake();
        TryShowRestartPrompt();
        TryUpdateSyncUi();
    }

    static void TrySyncPack()
    {
        if (platform == null || config == null || !config.ShouldSync || syncBusy) return;
        var address = CurrentServerAddress();
        if (string.IsNullOrEmpty(address)) return;
        var sameServer = syncReady && string.Equals(syncedAddress, address, StringComparison.OrdinalIgnoreCase);
        if (sameServer && DateTime.UtcNow < nextRefresh) return;
        if (DateTime.UtcNow < nextSyncAttempt) return;
        silentRefresh = sameServer;
        syncBusy = true;
        nextSyncAttempt = DateTime.UtcNow.AddSeconds(8);
        Ignore(SyncPackAsync(address));
    }

    static async Task SyncPackAsync(string address)
    {
        try
        {
            Log.Out("[ModPlatform] Resolving pack for " + address);
            var resolved = await platform.ResolveServerAsync(address, string.IsNullOrEmpty(address) ? resolvedServerId : null, CancellationToken.None).ConfigureAwait(false);
            if (resolved == null || string.IsNullOrEmpty(resolved.PackId)) throw new InvalidOperationException("Resolve did not return a pack.");
            if (!string.IsNullOrEmpty(resolved.ServerId)) resolvedServerId = resolved.ServerId;
            if (resolved.Handshake != null && resolved.Handshake.DistributionPaused)
                throw new InvalidOperationException("Mod distribution is paused.");
            var manifest = await platform.GetLatestPackAsync(resolved.PackId, CancellationToken.None).ConfigureAwait(false);
            if (!silentRefresh)
            {
                syncProgress = new PackSyncProgress { Phase = "start", PackFiles = manifest == null || manifest.Mods == null ? 0 : manifest.Mods.Count };
                syncProgressText = Loc("xuiModPlatformDownloading");
            }
            var result = await PackSync.SyncAsync(modsDirectory, config.BaseUrl, manifest, CancellationToken.None, silentRefresh ? (Action<PackSyncProgress>)null : OnPackSyncProgress, "client").ConfigureAwait(false);
            if (result.Changed) Log.Out("[ModPlatform] Client pack sync " + manifest.PackId + " v" + manifest.PackVersion + " installed=" + result.Installed + " updated=" + result.Updated + " unchanged=" + result.Unchanged);
            else Log.Out("[ModPlatform] Client pack already current " + manifest.PackId + " v" + manifest.PackVersion);
            syncedAddress = address;
            syncReady = true;
            nextRefresh = DateTime.UtcNow.AddSeconds(60);
            if (!silentRefresh) handshakeSent = false;
            if (result.RequiresRestart)
            {
                LocalState.WriteReconnect(modsDirectory, address);
                Log.Warning("[ModPlatform] " + (result.Message ?? "Restart the game to load the new pack."));
                if (config.ShouldRestart) QueueRestartPrompt();
                else syncReady = false;
            }
            else if (!silentRefresh || result.Changed)
            {
                TrySendHandshake();
            }
            Ignore(SendAsync(result.Changed ? "pack_sync_ok" : "pack_sync_current", null));
        }
        catch (Exception error)
        {
            if (!silentRefresh) syncReady = false;
            syncProgressText = null;
            syncProgress = null;
            Log.Warning("[ModPlatform] Client pack sync failed: " + error.Message);
            Ignore(SendAsync("pack_sync_failed", error));
        }
        finally
        {
            syncProgressText = null;
            syncProgress = null;
            syncBusy = false;
        }
    }

    static void OnPackSyncProgress(PackSyncProgress progress)
    {
        if (progress == null) return;
        syncProgress = progress;
        var line = progress.ToLogLine();
        syncProgressText = line;
        Log.Out("[ModPlatform] " + line);
    }

    static void TryUpdateSyncUi()
    {
        var xui = FindXui();
        if (xui == null || xui.playerUI == null || xui.playerUI.windowManager == null) return;
        var windows = xui.playerUI.windowManager;
        var shouldOpen = syncBusy && !silentRefresh;
        try
        {
            var open = windows.IsWindowOpen("modPlatformSync");
            if (shouldOpen && !open) windows.Open("modPlatformSync", false);
            else if (!shouldOpen && open) windows.Close("modPlatformSync");
        }
        catch (Exception error)
        {
            Log.Warning("[ModPlatform] Sync UI update failed: " + error.Message);
        }
    }

    static void QueueRestartPrompt()
    {
        restartPromptPending = true;
        restartPromptShown = false;
        if (ThreadManager.IsMainThread()) TryShowRestartPrompt();
        else ThreadManager.AddSingleTaskMainThread("ModPlatformRestartPrompt", new Action(TryShowRestartPrompt));
    }

    static void TryShowRestartPrompt()
    {
        if (!restartPromptPending || restartPromptShown) return;
        var xui = FindXui();
        if (xui == null) return;
        restartPromptShown = true;
        Log.Warning("[ModPlatform] Pack contains files that need a restart; waiting for confirmation.");
        try
        {
            XUiC_MessageBoxWindowGroup.ShowOkCancel(
                xui,
                Localization.Get("xuiModPlatformRestartTitle"),
                Localization.Get("xuiModPlatformRestartText"),
                "",
                new Action(ConfirmRestart),
                new Action(CancelRestart),
                false);
        }
        catch (Exception error)
        {
            restartPromptShown = false;
            Log.Warning("[ModPlatform] Restart prompt failed: " + error.Message);
        }
    }

    static XUi FindXui()
    {
        try
        {
            var ui = LocalPlayerUI.primaryUI;
            if (ui != null && ui.xui != null) return ui.xui;
        }
        catch { }
        try
        {
            var ui = LocalPlayerUI.GetUIForPrimaryPlayer();
            if (ui != null && ui.xui != null) return ui.xui;
        }
        catch { }
        return null;
    }

    static void ConfirmRestart()
    {
        restartPromptPending = false;
        Log.Warning("[ModPlatform] Restart confirmed; the game will exit and reconnect next launch.");
        try { UnityEngine.Application.Quit(); }
        catch
        {
            try { Environment.Exit(0); } catch { }
        }
    }

    static void CancelRestart()
    {
        restartPromptPending = false;
        restartPromptShown = false;
        syncReady = false;
        Log.Warning("[ModPlatform] Restart cancelled; exit the game later so the new pack can load.");
    }

    static void TrySendHandshake()
    {
        if (platform == null || handshakeBusy || DateTime.UtcNow < nextHandshakeAttempt) return;
        if (ConnectionManager.Instance == null || !ConnectionManager.Instance.IsClient)
        {
            LogHandshakeSkip("not a client yet");
            return;
        }
        var address = CurrentServerAddress();
        if (string.IsNullOrEmpty(resolvedServerId) && string.IsNullOrEmpty(address))
        {
            LogHandshakeSkip("no server id or address");
            return;
        }
        if (config != null && config.ShouldSync && !syncReady)
        {
            LogHandshakeSkip("waiting for pack sync");
            return;
        }
        if (handshakeSent && (string.Equals(handshakeServerId, resolvedServerId, StringComparison.OrdinalIgnoreCase) || string.Equals(handshakeAddress, address, StringComparison.OrdinalIgnoreCase))) return;
        var playerIds = CollectLocalPlayerIds();
        if (playerIds.Count == 0)
        {
            LogHandshakeSkip("no local player ids");
            return;
        }
        handshakeBusy = true;
        nextHandshakeAttempt = DateTime.UtcNow.AddSeconds(2);
        Ignore(SendHandshakeAsync(address, playerIds));
    }

    static void LogHandshakeSkip(string reason)
    {
        if (DateTime.UtcNow < nextHandshakeSkipLog) return;
        nextHandshakeSkipLog = DateTime.UtcNow.AddSeconds(5);
        Log.Out("[ModPlatform] Handshake deferred: " + reason);
    }

    static async Task SendHandshakeAsync(string address, List<string> playerIds)
    {
        try
        {
            var hello = BuildHello();
            await platform.SubmitHandshakeAsync(resolvedServerId, address, playerIds, hello, CancellationToken.None).ConfigureAwait(false);
            handshakeSent = true;
            handshakeAddress = address;
            handshakeServerId = resolvedServerId;
            Log.Out("[ModPlatform] Handshake sent server=" + resolvedServerId + " address=" + address + " pack=" + hello.PackId + " v" + hello.PackVersion + " fingerprint=" + (hello.ArtifactFingerprint == null ? "0" : hello.ArtifactFingerprint.Split(',').Length.ToString()) + " hashes");
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
        try { if (PlatformManager.CrossplatformPlatform != null) AddPlatformId(ids, PlatformManager.CrossplatformPlatform.User.PlatformUserId); } catch { }
        try { AddId(ids, GamePrefs.GetString(EnumGamePrefs.PlayerName)); } catch { }
        try
        {
            var clients = ConnectionManager.Instance == null ? null : ConnectionManager.Instance.Clients;
            if (clients != null)
            {
                foreach (var client in clients.List)
                {
                    if (client == null || !client.loginDone) continue;
                    AddPlatformId(ids, client.PlatformId);
                    AddPlatformId(ids, client.CrossplatformId);
                    AddId(ids, client.playerName);
                }
            }
        }
        catch { }
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

    static void TryReconnectNow(string address)
    {
        if (string.IsNullOrEmpty(address)) return;
        try
        {
            if (ConnectionManager.Instance != null && ConnectionManager.Instance.IsClient) return;
        }
        catch { return; }
        LocalState.WriteReconnect(modsDirectory, address);
        reconnectAttempted = false;
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
    [DataMember] public bool? AutoSync { get; set; }
    [DataMember] public bool? AutoRestart { get; set; }

    public bool ShouldSync { get { return AutoSync != false; } }
    public bool ShouldRestart { get { return AutoRestart != false; } }

    public ClientConfig()
    {
        BaseUrl = "https://mods.aic.la";
        GameVersion = PluginIdentity.TargetGameVersion;
        DiagnosticsEnabled = true;
        AutoSync = true;
        AutoRestart = true;
    }

    public ClientConfig Clone()
    {
        return new ClientConfig
        {
            BaseUrl = BaseUrl,
            GameVersion = GameVersion,
            DiagnosticsEnabled = DiagnosticsEnabled,
            AutoSync = AutoSync,
            AutoRestart = AutoRestart
        };
    }
}
