using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.Serialization.Json;

namespace ModPlatform.Shared
{
    public static class LocalState
    {
        static readonly DataContractJsonSerializerSettings JsonSettings = new DataContractJsonSerializerSettings { UseSimpleDictionaryFormat = true };

        public static LocalPackState ReadPackState(string modsDirectory)
        {
            if (string.IsNullOrEmpty(modsDirectory)) return null;
            var file = StateFile(modsDirectory);
            if (string.IsNullOrEmpty(file) || !File.Exists(file)) return null;
            try
            {
                PackSyncState state;
                using (var stream = File.OpenRead(file))
                    state = (PackSyncState)new DataContractJsonSerializer(typeof(PackSyncState), JsonSettings).ReadObject(stream);
                if (state == null) return null;
                return new LocalPackState
                {
                    PackId = state.PackId,
                    PackVersion = state.PackVersion,
                    GameVersion = state.GameVersion,
                    KeyId = state.KeyId,
                    ManagedRoots = state.ManagedRoots,
                    ArtifactFingerprint = ArtifactFingerprint(state.ManagedRoots)
                };
            }
            catch
            {
                return null;
            }
        }

        public static string ArtifactFingerprint(IDictionary<string, ManagedRoot> roots)
        {
            var shas = new List<string>();
            if (roots == null) return "";
            foreach (var root in roots.Values)
            {
                if (root == null) continue;
                var side = string.IsNullOrWhiteSpace(root.InstallSide) ? "both" : root.InstallSide.Trim().ToLowerInvariant();
                if (side != "both") continue;
                if (!string.IsNullOrEmpty(root.Sha256)) shas.Add(root.Sha256.Trim().ToLowerInvariant());
                if (root.Overlays == null) continue;
                foreach (var overlay in root.Overlays)
                {
                    if (overlay == null || string.IsNullOrEmpty(overlay.Sha256)) continue;
                    shas.Add(overlay.Sha256.Trim().ToLowerInvariant());
                }
            }
            return string.Join(",", shas.Where(value => !string.IsNullOrEmpty(value)).Distinct().OrderBy(value => value, StringComparer.Ordinal));
        }

        public static string ReadReconnectAddress(string modsDirectory)
        {
            var file = ReconnectFile(modsDirectory);
            if (string.IsNullOrEmpty(file) || !File.Exists(file)) return null;
            try { return ReadJsonString(File.ReadAllText(file), "address"); }
            catch { return null; }
        }

        public static void WriteReconnect(string modsDirectory, string address)
        {
            var file = ReconnectFile(modsDirectory);
            if (string.IsNullOrEmpty(file) || string.IsNullOrEmpty(address)) return;
            Directory.CreateDirectory(Path.GetDirectoryName(file));
            File.WriteAllText(file, "{\"address\":\"" + address.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"}");
        }

        public static void ClearReconnect(string modsDirectory)
        {
            var file = ReconnectFile(modsDirectory);
            try { if (!string.IsNullOrEmpty(file) && File.Exists(file)) File.Delete(file); } catch { }
        }

        static string StateFile(string modsDirectory)
        {
            var control = PackSync.ControlDirectory(modsDirectory);
            var nested = string.IsNullOrEmpty(control) ? null : Path.Combine(control, "state.json");
            if (!string.IsNullOrEmpty(nested) && File.Exists(nested)) return nested;
            var legacy = Path.Combine(modsDirectory, ".modplatform", "state.json");
            return File.Exists(legacy) ? legacy : nested;
        }

        static string ReconnectFile(string modsDirectory)
        {
            var control = PackSync.ControlDirectory(modsDirectory);
            if (!string.IsNullOrEmpty(control)) return Path.Combine(control, "reconnect.json");
            return Path.Combine(modsDirectory, ".modplatform", "reconnect.json");
        }

        static string ReadJsonString(string json, string key)
        {
            var token = "\"" + key + "\"";
            var index = json.IndexOf(token, StringComparison.Ordinal);
            if (index < 0) return null;
            var colon = json.IndexOf(':', index + token.Length);
            if (colon < 0) return null;
            var start = json.IndexOf('"', colon + 1);
            if (start < 0) return null;
            var end = json.IndexOf('"', start + 1);
            if (end < 0) return null;
            return json.Substring(start + 1, end - start - 1);
        }
    }
}
