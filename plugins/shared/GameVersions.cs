using System;
using System.Text.RegularExpressions;

namespace ModPlatform.Shared
{
    public static class GameVersions
    {
        static readonly Regex Prefix = new Regex(@"^v\s*", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        static readonly Regex BuildSuffix = new Regex(@"\s*[\(\-]?b\d+\)?\s*$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

        public static bool Compatible(string actual, string required)
        {
            if (string.IsNullOrWhiteSpace(actual) || string.IsNullOrWhiteSpace(required)) return true;
            return string.Equals(Normalize(actual), Normalize(required), StringComparison.OrdinalIgnoreCase);
        }

        public static string Normalize(string value)
        {
            if (string.IsNullOrWhiteSpace(value)) return "";
            var text = BuildSuffix.Replace(Prefix.Replace(value.Trim(), ""), "").Trim();
            if (string.Equals(text, "3.10.14", StringComparison.OrdinalIgnoreCase)) return "3.1.0";
            return text;
        }
    }
}
