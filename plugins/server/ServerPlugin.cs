using System;
using System.IO;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Threading;
using System.Threading.Tasks;
using ModPlatform.Shared;

public sealed class ModPlatformServerPlugin : IModApi
{
    private static CancellationTokenSource lifetime;

    public void InitMod(Mod modInstance)
    {
        var modDirectory = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Mods", "ModPlatformServer");
        var configFile = Path.Combine(modDirectory, "server.config.json");
        if (!File.Exists(configFile)) { Log.Error("[ModPlatform] Missing " + configFile); return; }
        ServerConfig config;
        using (var stream = File.OpenRead(configFile)) config = (ServerConfig)new DataContractJsonSerializer(typeof(ServerConfig)).ReadObject(stream);
        lifetime = new CancellationTokenSource();
        Task.Run(() => PollAsync(config, modDirectory, lifetime.Token));
        AppDomain.CurrentDomain.ProcessExit += (_, __) => lifetime.Cancel();
        Log.Out("[ModPlatform] Server bootstrap started");
    }

    private static async Task PollAsync(ServerConfig config, string directory, CancellationToken token)
    {
        using (var client = new PlatformClient(config.BaseUrl))
        {
            while (!token.IsCancellationRequested)
            {
                Exception failure = null;
                try
                {
                    var assignment = await client.GetAssignmentAsync(config.ServerId, config.ServerToken, token).ConfigureAwait(false);
                    var target = Path.Combine(directory, "current-assignment.json");
                    var temporary = target + ".tmp";
                    File.WriteAllText(temporary, PlatformClient.Serialize(assignment));
                    if (File.Exists(target)) File.Delete(target);
                    File.Move(temporary, target);
                    Log.Out("[ModPlatform] Active pack " + assignment.PackId + " v" + (assignment.Manifest == null ? 0 : assignment.Manifest.PackVersion));
                }
                catch (Exception error)
                {
                    Log.Warning("[ModPlatform] Assignment refresh failed: " + error.Message);
                    failure = error;
                }
                if (failure != null)
                {
                    try { await client.SendDiagnosticAsync(CreateDiagnostic(config, failure), token).ConfigureAwait(false); } catch { }
                }
                try { await Task.Delay(TimeSpan.FromSeconds(Math.Max(15, config.RefreshSeconds)), token).ConfigureAwait(false); } catch (OperationCanceledException) { }
            }
        }
    }

    private static DiagnosticEvent CreateDiagnostic(ServerConfig config, Exception error)
    {
        return new DiagnosticEvent { SessionId = Guid.NewGuid().ToString("N"), Side = "server", GameVersion = config.GameVersion, Stage = "assignment_refresh", ExceptionType = error.GetType().FullName, Message = error.Message, StackTrace = error.StackTrace, OccurredAt = DateTime.UtcNow.ToString("O") };
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

    public ServerConfig() { RefreshSeconds = 60; }
}
