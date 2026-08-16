using System;
using System.Text;
using ModPlatform.Shared;

public sealed class NetPackageModPlatformHello : NetPackage
{
    public int ProtocolVersion;
    public string PluginVersion;
    public string GameVersion;
    public string SteamBuildId;
    public string PackId;
    public int PackVersion;
    public string KeyId;
    public string ArtifactFingerprint;
    public string SessionId;

    public override NetPackageDirection PackageDirection { get { return NetPackageDirection.ToServer; } }
    public override bool AllowedBeforeAuth { get { return true; } }

    public HandshakeHello ToHello()
    {
        return new HandshakeHello
        {
            ProtocolVersion = ProtocolVersion,
            PluginVersion = PluginVersion,
            GameVersion = GameVersion,
            SteamBuildId = SteamBuildId,
            PackId = PackId,
            PackVersion = PackVersion,
            KeyId = KeyId,
            ArtifactFingerprint = ArtifactFingerprint,
            SessionId = SessionId
        };
    }

    public override void read(PooledBinaryReader reader)
    {
        ProtocolVersion = ReadInt(reader);
        PluginVersion = ReadText(reader);
        GameVersion = ReadText(reader);
        SteamBuildId = ReadText(reader);
        PackId = ReadText(reader);
        PackVersion = ReadInt(reader);
        KeyId = ReadText(reader);
        ArtifactFingerprint = ReadText(reader);
        SessionId = ReadText(reader);
    }

    public override void write(PooledBinaryWriter writer)
    {
        WriteInt(writer, ProtocolVersion);
        WriteText(writer, PluginVersion);
        WriteText(writer, GameVersion);
        WriteText(writer, SteamBuildId);
        WriteText(writer, PackId);
        WriteInt(writer, PackVersion);
        WriteText(writer, KeyId);
        WriteText(writer, ArtifactFingerprint);
        WriteText(writer, SessionId);
    }

    static void WriteInt(PooledBinaryWriter writer, int value)
    {
        var bytes = BitConverter.GetBytes(value);
        writer.Write(bytes, 0, bytes.Length);
    }

    static int ReadInt(PooledBinaryReader reader)
    {
        return BitConverter.ToInt32(reader.ReadBytes(4), 0);
    }

    static void WriteText(PooledBinaryWriter writer, string value)
    {
        var bytes = Encoding.UTF8.GetBytes(value ?? "");
        WriteInt(writer, bytes.Length);
        if (bytes.Length > 0) writer.Write(bytes, 0, bytes.Length);
    }

    static string ReadText(PooledBinaryReader reader)
    {
        var length = ReadInt(reader);
        if (length <= 0) return "";
        return Encoding.UTF8.GetString(reader.ReadBytes(length));
    }

    public override void ProcessPackage(World world, GameManager callbacks)
    {
        ModPlatformServerPlugin.OnHello(Sender, ToHello());
    }

    public override int GetLength()
    {
        return 8 + (PluginVersion ?? "").Length + (GameVersion ?? "").Length + (SteamBuildId ?? "").Length + (PackId ?? "").Length + (KeyId ?? "").Length + (ArtifactFingerprint ?? "").Length + (SessionId ?? "").Length;
    }
}
