using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net.Http;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace ModPlatform.Shared
{
    public sealed class PackSyncResult
    {
        public bool Changed;
        public bool RequiresRestart;
        public string Message;
        public int Installed;
        public int Updated;
        public int Unchanged;
    }

    public static class PackSync
    {
        static readonly Regex SafeRoot = new Regex(@"^[^\\/:*?""<>|.][^\\/:*?""<>|]{0,127}$", RegexOptions.CultureInvariant);
        static readonly HttpClient http = new HttpClient { Timeout = TimeSpan.FromMinutes(30) };
        static readonly DataContractJsonSerializerSettings jsonSettings = new DataContractJsonSerializerSettings { UseSimpleDictionaryFormat = true };

        public static string ModsDirectory(string pluginDirectory, string configured)
        {
            if (!string.IsNullOrWhiteSpace(configured)) return Path.GetFullPath(configured.Trim());
            if (string.IsNullOrEmpty(pluginDirectory)) return null;
            var parent = Directory.GetParent(pluginDirectory);
            return parent == null ? pluginDirectory : parent.FullName;
        }

        public static void ApplyPending(string modsDir)
        {
            if (string.IsNullOrEmpty(modsDir)) return;
            var pending = Path.Combine(modsDir, ".modplatform", "pending");
            if (!Directory.Exists(pending)) return;
            foreach (var staged in Directory.GetDirectories(pending))
            {
                var root = Path.GetFileName(staged);
                if (IsProtected(root)) continue;
                var target = Path.Combine(modsDir, root);
                var backup = Path.Combine(modsDir, ".modplatform", "backups", "boot-" + DateTime.UtcNow.ToString("yyyyMMddHHmmss"), root);
                try
                {
                    if (Directory.Exists(target))
                    {
                        Directory.CreateDirectory(Path.GetDirectoryName(backup));
                        if (Directory.Exists(backup)) Directory.Delete(backup, true);
                        Directory.Move(target, backup);
                    }
                    Directory.Move(staged, target);
                }
                catch
                {
                    // Loaded DLLs can lock the live folder; the next dedicated-server start retries.
                }
            }
        }

        public static async Task<PackSyncResult> SyncAsync(string modsDir, string baseUrl, PackManifest manifest, CancellationToken token)
        {
            if (string.IsNullOrEmpty(modsDir)) throw new InvalidOperationException("Mods directory is not configured.");
            if (manifest == null || manifest.Mods == null) throw new InvalidOperationException("Assignment is missing a signed manifest.");
            Directory.CreateDirectory(modsDir);
            ApplyPending(modsDir);
            var controlDir = Path.Combine(modsDir, ".modplatform");
            var cacheDir = Path.Combine(controlDir, "cache");
            var pendingDir = Path.Combine(controlDir, "pending");
            Directory.CreateDirectory(cacheDir);
            var stateFile = Path.Combine(controlDir, "state.json");
            var state = ReadState(stateFile) ?? new PackSyncState { SchemaVersion = 1, ManagedRoots = new Dictionary<string, ManagedRoot>() };
            if (state.ManagedRoots == null) state.ManagedRoots = new Dictionary<string, ManagedRoot>();

            var result = new PackSyncResult();
            var desired = new Dictionary<string, ManagedRoot>(StringComparer.OrdinalIgnoreCase);
            foreach (var mod in manifest.Mods)
            {
                if (mod == null || string.IsNullOrEmpty(mod.Sha256) || !Regex.IsMatch(mod.Sha256, "^[a-fA-F0-9]{64}$"))
                    throw new InvalidOperationException("Manifest contains an invalid artifact: " + (mod == null ? "?" : mod.Id));
                var roots = (mod.InstallRoots == null || mod.InstallRoots.Count == 0) ? new List<string> { mod.Id } : mod.InstallRoots;
                foreach (var root in roots)
                {
                    if (!SafeRoot.IsMatch(root) || IsProtected(root)) throw new InvalidOperationException("Refusing to install into protected or unsafe root: " + root);
                    if (desired.ContainsKey(root)) throw new InvalidOperationException("Multiple artifacts own the same install root: " + root);
                    desired[root] = new ManagedRoot { ModId = mod.Id, Version = mod.Version, Sha256 = mod.Sha256.ToLowerInvariant() };
                }
            }

            foreach (var mod in manifest.Mods)
            {
                var roots = (mod.InstallRoots == null || mod.InstallRoots.Count == 0) ? new List<string> { mod.Id } : mod.InstallRoots;
                var unchanged = roots.All(root =>
                    state.ManagedRoots.TryGetValue(root, out var current)
                    && string.Equals(current.Sha256, mod.Sha256, StringComparison.OrdinalIgnoreCase)
                    && Directory.Exists(Path.Combine(modsDir, root)));
                if (unchanged)
                {
                    result.Unchanged += 1;
                    continue;
                }
                var cacheFile = Path.Combine(cacheDir, mod.Sha256.ToLowerInvariant() + ".zip");
                if (!File.Exists(cacheFile) || (mod.Size > 0 && new FileInfo(cacheFile).Length != mod.Size) || Sha256File(cacheFile) != mod.Sha256.ToLowerInvariant())
                {
                    var url = string.IsNullOrEmpty(mod.Url)
                        ? (baseUrl ?? "").TrimEnd('/') + "/api/v1/public/artifacts/" + mod.Sha256.ToLowerInvariant()
                        : mod.Url;
                    await DownloadAsync(url, cacheFile, mod.Sha256, mod.Size, token).ConfigureAwait(false);
                }
                var stageDir = Path.Combine(controlDir, "stage-" + Guid.NewGuid().ToString("N"));
                try
                {
                    ExtractZip(cacheFile, stageDir);
                    foreach (var root in roots)
                    {
                        var staged = Path.Combine(stageDir, root);
                        if (!Directory.Exists(staged)) throw new InvalidOperationException("Staged install root is missing: " + root + " (" + mod.Id + ")");
                        var target = Path.Combine(modsDir, root);
                        var hadTarget = Directory.Exists(target);
                        if (hadTarget && !state.ManagedRoots.ContainsKey(root))
                            throw new InvalidOperationException("Refusing to replace unmanaged Mod directory: " + root);
                        if (hadTarget && state.ManagedRoots.TryGetValue(root, out var previous) && string.Equals(previous.Sha256, mod.Sha256, StringComparison.OrdinalIgnoreCase))
                            continue;
                        if (InstallRoot(staged, target, Path.Combine(pendingDir, root)))
                        {
                            if (hadTarget) result.Updated += 1;
                            else result.Installed += 1;
                            result.Changed = true;
                            if (mod.RequiresRestart || mod.ContainsDll) result.RequiresRestart = true;
                        }
                        else
                        {
                            result.Changed = true;
                            result.RequiresRestart = true;
                        }
                        state.ManagedRoots[root] = desired[root];
                    }
                }
                finally
                {
                    try { if (Directory.Exists(stageDir)) Directory.Delete(stageDir, true); } catch { }
                }
            }

            foreach (var root in state.ManagedRoots.Keys.ToList())
            {
                if (desired.ContainsKey(root) || IsProtected(root)) continue;
                var target = Path.Combine(modsDir, root);
                try { if (Directory.Exists(target)) Directory.Delete(target, true); } catch { result.RequiresRestart = true; }
                state.ManagedRoots.Remove(root);
                result.Changed = true;
            }

            state.SchemaVersion = 1;
            state.PackId = manifest.PackId;
            state.PackVersion = manifest.PackVersion;
            state.GameVersion = manifest.GameVersion;
            state.KeyId = manifest.Signing == null ? null : manifest.Signing.KeyId;
            state.RequiresRestart = result.RequiresRestart || manifest.Mods.Any(item => item != null && item.RequiresRestart);
            state.UpdatedAt = DateTime.UtcNow.ToString("o");
            WriteState(stateFile, state);
            if (result.RequiresRestart) result.Message = "Pack files updated; restart the dedicated server to load them.";
            else if (result.Changed) result.Message = "Pack files updated.";
            else result.Message = "Pack already installed.";
            return result;
        }

        static bool InstallRoot(string staged, string target, string pending)
        {
            try
            {
                if (Directory.Exists(target)) Directory.Delete(target, true);
                Directory.CreateDirectory(Path.GetDirectoryName(target));
                Directory.Move(staged, target);
                return true;
            }
            catch
            {
                if (Directory.Exists(pending)) Directory.Delete(pending, true);
                Directory.CreateDirectory(Path.GetDirectoryName(pending));
                Directory.Move(staged, pending);
                return false;
            }
        }

        static async Task DownloadAsync(string url, string target, string expectedSha, long expectedSize, CancellationToken token)
        {
            var partial = target + ".partial";
            Directory.CreateDirectory(Path.GetDirectoryName(target));
            using (var response = await http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, token).ConfigureAwait(false))
            {
                if (!response.IsSuccessStatusCode) throw new InvalidOperationException("Download failed (" + (int)response.StatusCode + "): " + url);
                using (var input = await response.Content.ReadAsStreamAsync().ConfigureAwait(false))
                using (var output = File.Create(partial))
                    await input.CopyToAsync(output, 81920, token).ConfigureAwait(false);
            }
            var actual = Sha256File(partial);
            var size = new FileInfo(partial).Length;
            if (!string.Equals(actual, expectedSha, StringComparison.OrdinalIgnoreCase) || (expectedSize > 0 && size != expectedSize))
            {
                File.Delete(partial);
                throw new InvalidOperationException("Downloaded artifact failed integrity validation: " + expectedSha);
            }
            if (File.Exists(target)) File.Delete(target);
            File.Move(partial, target);
        }

        static void ExtractZip(string zipPath, string destDir)
        {
            Directory.CreateDirectory(destDir);
            var root = Path.GetFullPath(destDir).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            using (var zip = ZipFile.OpenRead(zipPath))
            {
                foreach (var entry in zip.Entries)
                {
                    var relative = (entry.FullName ?? "").Replace('\\', '/');
                    if (string.IsNullOrEmpty(relative) || relative.Contains("..")) throw new InvalidOperationException("Unsafe zip entry: " + entry.FullName);
                    var target = Path.GetFullPath(Path.Combine(destDir, relative.Replace('/', Path.DirectorySeparatorChar)));
                    if (!target.StartsWith(root, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("Zip entry escaped destination: " + entry.FullName);
                    if (string.IsNullOrEmpty(entry.Name))
                    {
                        Directory.CreateDirectory(target);
                        continue;
                    }
                    Directory.CreateDirectory(Path.GetDirectoryName(target));
                    entry.ExtractToFile(target, true);
                }
            }
        }

        static string Sha256File(string path)
        {
            using (var sha = SHA256.Create())
            using (var stream = File.OpenRead(path))
                return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
        }

        static bool IsProtected(string root)
        {
            if (string.IsNullOrEmpty(root)) return true;
            if (root.Equals("ModPlatformServer", StringComparison.OrdinalIgnoreCase)) return true;
            if (root.Equals("ModPlatformClient", StringComparison.OrdinalIgnoreCase)) return true;
            if (root.Equals(".modplatform", StringComparison.OrdinalIgnoreCase)) return true;
            if (root.StartsWith("0_TFP_", StringComparison.OrdinalIgnoreCase)) return true;
            if (root.StartsWith("TFP_", StringComparison.OrdinalIgnoreCase)) return true;
            return false;
        }

        static PackSyncState ReadState(string file)
        {
            if (!File.Exists(file)) return null;
            try
            {
                using (var stream = File.OpenRead(file))
                    return (PackSyncState)new DataContractJsonSerializer(typeof(PackSyncState), jsonSettings).ReadObject(stream);
            }
            catch
            {
                return null;
            }
        }

        static void WriteState(string file, PackSyncState state)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(file));
            var temporary = file + ".tmp";
            using (var stream = File.Create(temporary))
                new DataContractJsonSerializer(typeof(PackSyncState), jsonSettings).WriteObject(stream, state);
            if (File.Exists(file)) File.Delete(file);
            File.Move(temporary, file);
        }
    }

    [DataContract]
    public sealed class PackSyncState
    {
        [DataMember(Name = "schemaVersion")] public int SchemaVersion { get; set; }
        [DataMember(Name = "packId")] public string PackId { get; set; }
        [DataMember(Name = "packVersion")] public int PackVersion { get; set; }
        [DataMember(Name = "gameVersion")] public string GameVersion { get; set; }
        [DataMember(Name = "keyId")] public string KeyId { get; set; }
        [DataMember(Name = "requiresRestart")] public bool RequiresRestart { get; set; }
        [DataMember(Name = "updatedAt")] public string UpdatedAt { get; set; }
        [DataMember(Name = "managedRoots")] public Dictionary<string, ManagedRoot> ManagedRoots { get; set; }
    }
}
