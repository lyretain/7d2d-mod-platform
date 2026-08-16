using System;
using System.IO;
using System.Runtime.ExceptionServices;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Threading;
using System.Threading.Tasks;
using ModPlatform.Shared;

public sealed class ModPlatformClientPlugin : IModApi
{
    private static ClientConfig config;
    private static PlatformClient platform;
    private static readonly string SessionId = Guid.NewGuid().ToString("N");

    public void InitMod(Mod modInstance)
    {
        var directory = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Mods", "ModPlatformClient");
        var configFile = Path.Combine(directory, "client.config.json");
        if (!File.Exists(configFile)) { Log.Warning("[ModPlatform] Client config is missing"); return; }
        using (var stream = File.OpenRead(configFile)) config = (ClientConfig)new DataContractJsonSerializer(typeof(ClientConfig)).ReadObject(stream);
        platform = new PlatformClient(config.BaseUrl);
        if (config.DiagnosticsEnabled)
        {
            AppDomain.CurrentDomain.UnhandledException += OnUnhandledException;
            TaskScheduler.UnobservedTaskException += OnUnobservedTaskException;
            Ignore(SendAsync("plugin_initialized", null));
        }
        Log.Out("[ModPlatform] Client bootstrap initialized");
    }

    private static void OnUnhandledException(object sender, UnhandledExceptionEventArgs args) { Ignore(SendAsync("unhandled_exception", args.ExceptionObject as Exception)); }
    private static void OnUnobservedTaskException(object sender, UnobservedTaskExceptionEventArgs args) { Ignore(SendAsync("unobserved_task", args.Exception)); }

    private static void Ignore(Task task) { }

    private static async Task SendAsync(string stage, Exception error)
    {
        try
        {
            await platform.SendDiagnosticAsync(new DiagnosticEvent {
                SessionId = SessionId, Side = "client", GameVersion = config.GameVersion, Stage = stage,
                ExceptionType = error == null ? "Success" : error.GetType().FullName,
                Message = error == null ? "Client plugin initialized" : error.Message,
                StackTrace = error == null ? null : error.StackTrace, OccurredAt = DateTime.UtcNow.ToString("O")
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
