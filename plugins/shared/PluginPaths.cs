using System.Collections.Generic;
using System.IO;

namespace ModPlatform.Shared
{
    public static class PluginPaths
    {
        public static string FindDirectory(string configName, params string[] candidates)
        {
            string fallback = null;
            foreach (var candidate in candidates)
            {
                if (string.IsNullOrEmpty(candidate)) continue;
                if (fallback == null) fallback = candidate;
                if (File.Exists(Path.Combine(candidate, configName))) return candidate;
            }
            return fallback;
        }

        public static IEnumerable<string> Tried(string configName, params string[] candidates)
        {
            foreach (var candidate in candidates)
            {
                if (string.IsNullOrEmpty(candidate)) continue;
                yield return Path.Combine(candidate, configName);
            }
        }
    }
}
