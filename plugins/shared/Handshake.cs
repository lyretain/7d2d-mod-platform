using System.Collections.Generic;
using System.Runtime.Serialization;

namespace ModPlatform.Shared
{
    public static class HandshakeReasons
    {
        public const string Ok = "OK";
        public const string MissingPlugin = "MISSING_PLUGIN";
        public const string GameVersion = "GAME_VERSION";
        public const string PackMismatch = "PACK_MISMATCH";
        public const string Revoked = "RELEASE_REVOKED";
        public const string DistributionPaused = "DISTRIBUTION_PAUSED";
        public const string Timeout = "HANDSHAKE_TIMEOUT";
        public const string InvalidHello = "INVALID_HELLO";
    }

    [DataContract]
    public sealed class HandshakePolicy
    {
        [DataMember(Name = "protocolVersion")] public int ProtocolVersion { get; set; }
        [DataMember(Name = "pluginRequired")] public bool PluginRequired { get; set; }
        [DataMember(Name = "distributionPaused")] public bool DistributionPaused { get; set; }
        [DataMember(Name = "launcherUrl")] public string LauncherUrl { get; set; }
        [DataMember(Name = "packId")] public string PackId { get; set; }
        [DataMember(Name = "packVersion")] public int? PackVersion { get; set; }
        [DataMember(Name = "gameVersion")] public string GameVersion { get; set; }
        [DataMember(Name = "keyId")] public string KeyId { get; set; }
        [DataMember(Name = "artifactFingerprint")] public string ArtifactFingerprint { get; set; }
        [DataMember(Name = "releaseId")] public string ReleaseId { get; set; }
    }

    [DataContract]
    public sealed class HandshakeHello
    {
        [DataMember(Name = "protocolVersion")] public int ProtocolVersion { get; set; }
        [DataMember(Name = "pluginVersion")] public string PluginVersion { get; set; }
        [DataMember(Name = "gameVersion")] public string GameVersion { get; set; }
        [DataMember(Name = "steamBuildId")] public string SteamBuildId { get; set; }
        [DataMember(Name = "packId")] public string PackId { get; set; }
        [DataMember(Name = "packVersion")] public int PackVersion { get; set; }
        [DataMember(Name = "keyId")] public string KeyId { get; set; }
        [DataMember(Name = "artifactFingerprint")] public string ArtifactFingerprint { get; set; }
        [DataMember(Name = "sessionId")] public string SessionId { get; set; }
    }

    [DataContract]
    public sealed class LocalPackState
    {
        [DataMember(Name = "packId")] public string PackId { get; set; }
        [DataMember(Name = "packVersion")] public int PackVersion { get; set; }
        [DataMember(Name = "gameVersion")] public string GameVersion { get; set; }
        [DataMember(Name = "keyId")] public string KeyId { get; set; }
        [DataMember(Name = "artifactFingerprint")] public string ArtifactFingerprint { get; set; }
        [DataMember(Name = "managedRoots")] public Dictionary<string, ManagedRoot> ManagedRoots { get; set; }
    }

    [DataContract]
    public sealed class ManagedRoot
    {
        [DataMember(Name = "modId")] public string ModId { get; set; }
        [DataMember(Name = "version")] public string Version { get; set; }
        [DataMember(Name = "sha256")] public string Sha256 { get; set; }
        [DataMember(Name = "overlays")] public List<ManifestOverlay> Overlays { get; set; }
    }

    [DataContract]
    public sealed class HandshakeSubmit
    {
        [DataMember(Name = "serverId")] public string ServerId { get; set; }
        [DataMember(Name = "address")] public string Address { get; set; }
        [DataMember(Name = "playerIds")] public List<string> PlayerIds { get; set; }
        [DataMember(Name = "hello")] public HandshakeHello Hello { get; set; }
    }

    [DataContract]
    public sealed class HandshakeClaimRequest
    {
        [DataMember(Name = "playerIds")] public List<string> PlayerIds { get; set; }
    }

    [DataContract]
    public sealed class HandshakeClaimResult
    {
        [DataMember(Name = "hello")] public HandshakeHello Hello { get; set; }
    }

    [DataContract]
    public sealed class ServerSyncStatus
    {
        [DataMember(Name = "stage")] public string Stage { get; set; }
        [DataMember(Name = "ok")] public bool Ok { get; set; }
        [DataMember(Name = "packId")] public string PackId { get; set; }
        [DataMember(Name = "packVersion")] public int? PackVersion { get; set; }
        [DataMember(Name = "message")] public string Message { get; set; }
        [DataMember(Name = "requiresRestart")] public bool RequiresRestart { get; set; }
        [DataMember(Name = "publicAddresses")] public List<string> PublicAddresses { get; set; }
    }

    [DataContract]
    public sealed class AddressReport
    {
        [DataMember(Name = "publicAddresses")] public List<string> PublicAddresses { get; set; }
    }
}
