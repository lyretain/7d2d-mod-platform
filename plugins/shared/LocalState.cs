using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace ModPlatform.Shared
{
    public static class LocalState
    {
        public static LocalPackState ReadPackState(string modsDirectory)
        {
            if (string.IsNullOrEmpty(modsDirectory)) return null;
            var file = Path.Combine(modsDirectory, ".modplatform", "state.json");
            if (!File.Exists(file)) return null;
            try
            {
                var text = File.ReadAllText(file);
                var packId = ReadJsonString(text, "packId");
                var packVersion = ReadJsonInt(text, "packVersion");
                var gameVersion = ReadJsonString(text, "gameVersion");
                var shas = new List<string>();
                foreach (var token in new[] { "\"sha256\":\"", "\"sha256\": \"" })
                {
                    var index = 0;
                    while ((index = text.IndexOf(token, index, StringComparison.Ordinal)) >= 0)
                    {
                        index += token.Length;
                        var end = text.IndexOf('"', index);
                        if (end < 0) break;
                        shas.Add(text.Substring(index, end - index).ToLowerInvariant());
                    }
                }
                shas = shas.Distinct().OrderBy(value => value, StringComparer.Ordinal).ToList();
                return new LocalPackState
                {
                    PackId = packId,
                    PackVersion = packVersion,
                    GameVersion = gameVersion,
                    KeyId = ReadJsonString(text, "keyId"),
                    ArtifactFingerprint = string.Join(",", shas)
                };
            }
            catch
            {
                return null;
            }
        }

        public static string ReadReconnectAddress(string modsDirectory)
        {
            var file = Path.Combine(modsDirectory, ".modplatform", "reconnect.json");
            if (!File.Exists(file)) return null;
            try { return ReadJsonString(File.ReadAllText(file), "address"); }
            catch { return null; }
        }

        public static void ClearReconnect(string modsDirectory)
        {
            var file = Path.Combine(modsDirectory, ".modplatform", "reconnect.json");
            try { if (File.Exists(file)) File.Delete(file); } catch { }
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

        static int ReadJsonInt(string json, string key)
        {
            var token = "\"" + key + "\"";
            var index = json.IndexOf(token, StringComparison.Ordinal);
            if (index < 0) return 0;
            var colon = json.IndexOf(':', index + token.Length);
            if (colon < 0) return 0;
            var cursor = colon + 1;
            while (cursor < json.Length && (json[cursor] == ' ' || json[cursor] == '\t')) cursor += 1;
            var end = cursor;
            while (end < json.Length && char.IsDigit(json[end])) end += 1;
            return end > cursor ? int.Parse(json.Substring(cursor, end - cursor)) : 0;
        }
    }
}
