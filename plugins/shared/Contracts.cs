using System;
using System.Collections.Generic;
using System.Runtime.Serialization;

namespace ModPlatform.Shared
{
    [DataContract]
    public sealed class ServerResolve
    {
        [DataMember(Name = "serverId")] public string ServerId { get; set; }
        [DataMember(Name = "packId")] public string PackId { get; set; }
        [DataMember(Name = "packVersion")] public int? PackVersion { get; set; }
        [DataMember(Name = "gameVersion")] public string GameVersion { get; set; }
        [DataMember(Name = "handshake")] public HandshakePolicy Handshake { get; set; }
    }

    [DataContract]
    public sealed class ServerAssignment
    {
        [DataMember(Name = "serverId")] public string ServerId { get; set; }
        [DataMember(Name = "packId")] public string PackId { get; set; }
        [DataMember(Name = "manifest")] public PackManifest Manifest { get; set; }
        [DataMember(Name = "handshake")] public HandshakePolicy Handshake { get; set; }
        [DataMember(Name = "acceptingPlayers")] public bool AcceptingPlayers { get; set; }
    }

    [DataContract]
    public sealed class PackManifest
    {
        [DataMember(Name = "schemaVersion")] public int SchemaVersion { get; set; }
        [DataMember(Name = "packId")] public string PackId { get; set; }
        [DataMember(Name = "packVersion")] public int PackVersion { get; set; }
        [DataMember(Name = "gameVersion")] public string GameVersion { get; set; }
        [DataMember(Name = "mods")] public List<ManifestMod> Mods { get; set; }
        [DataMember(Name = "signing")] public ManifestSignature Signing { get; set; }
    }

    [DataContract]
    public sealed class ManifestMod
    {
        [DataMember(Name = "id")] public string Id { get; set; }
        [DataMember(Name = "version")] public string Version { get; set; }
        [DataMember(Name = "sha256")] public string Sha256 { get; set; }
        [DataMember(Name = "size")] public long Size { get; set; }
        [DataMember(Name = "url")] public string Url { get; set; }
        [DataMember(Name = "installRoots")] public List<string> InstallRoots { get; set; }
        [DataMember(Name = "containsDll")] public bool ContainsDll { get; set; }
        [DataMember(Name = "requiresRestart")] public bool RequiresRestart { get; set; }
        [DataMember(Name = "installSide")] public string InstallSide { get; set; }
        [DataMember(Name = "overlays")] public List<ManifestOverlay> Overlays { get; set; }
    }

    [DataContract]
    public sealed class ManifestOverlay
    {
        [DataMember(Name = "id")] public string Id { get; set; }
        [DataMember(Name = "path")] public string Path { get; set; }
        [DataMember(Name = "sha256")] public string Sha256 { get; set; }
        [DataMember(Name = "size")] public long Size { get; set; }
        [DataMember(Name = "url")] public string Url { get; set; }
    }

    [DataContract]
    public sealed class ManifestSignature
    {
        [DataMember(Name = "keyId")] public string KeyId { get; set; }
        [DataMember(Name = "algorithm")] public string Algorithm { get; set; }
        [DataMember(Name = "signature")] public string Signature { get; set; }
    }

    [DataContract]
    public sealed class DiagnosticEvent
    {
        [DataMember(Name = "sessionId")] public string SessionId { get; set; }
        [DataMember(Name = "side")] public string Side { get; set; }
        [DataMember(Name = "gameVersion")] public string GameVersion { get; set; }
        [DataMember(Name = "packId")] public string PackId { get; set; }
        [DataMember(Name = "packVersion")] public int? PackVersion { get; set; }
        [DataMember(Name = "stage")] public string Stage { get; set; }
        [DataMember(Name = "exceptionType")] public string ExceptionType { get; set; }
        [DataMember(Name = "message")] public string Message { get; set; }
        [DataMember(Name = "stackTrace")] public string StackTrace { get; set; }
        [DataMember(Name = "logExcerpt")] public string LogExcerpt { get; set; }
        [DataMember(Name = "occurredAt")] public string OccurredAt { get; set; }
    }
}
