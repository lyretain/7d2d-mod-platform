# Plugin build and install

[English](PLUGIN.md) · [简体中文](PLUGIN.zh-CN.md)

## 1. Current verified environment

- 7 Days to Die: `V 3.10.14`
- Steam Build: `24436778`
- Game directory: `G:\SteamLibrary\steamapps\common\7 Days To Die`
- Unity: `2022.3.62f2`
- Plugin target: `netstandard2.1`
- Handshake protocol: `1`
- Plugin version: `0.2.12`

## 2. Use a prebuilt pack

Client plugin:

```text
E:\Project\artifacts\plugins\ModPlatformClient
```

Server plugin:

```text
E:\Project\artifacts\plugins\ModPlatformServer
```

Each folder contains:

- the plugin DLL
- `ModPlatform.Shared.dll`
- `ModInfo.xml`
- the matching config file

`ModInfo.xml` must be official 7DTD V2 (fields directly under `<xml>`, not wrapped in `<ModInfo>`). V 3.x rejects the old format and ignores the whole plugin.

Copy the entire folder into the 7DTD `Mods` directory. Do not copy only the DLL. If the dedicated server sets `UserDataFolder`, put it under that folder’s `Mods`, for example `E:\GamerServer\SAVEDATA\7daystodiedev\Mods\ModPlatformServer`.

Client example:

```text
%APPDATA%\7DaysToDie\Mods\ModPlatformClient
```

Server example:

```text
<7DTD dedicated server>\Mods\ModPlatformServer
```

After install, edit the platform URL, game version, server id, and server token in the config file.

## 3. Rebuild

The build script prefers a modern .NET SDK. If none is installed it uses the Windows C# compiler.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\deploy\build-plugins.ps1 `
  -GameManagedDir "G:\SteamLibrary\steamapps\common\7 Days To Die\7DaysToDie_Data\Managed" `
  -GameVersion "3.10.14"
```

Output:

```text
E:\Project\artifacts\plugins
```

After every 7 Days to Die update, rebuild against the new `Assembly-CSharp.dll` and test again.

GitHub Actions on `main` does this rebuild, zips the plugin folders, and can upload them to the management platform as `mod-platform-client` / `mod-platform-server`. See [Deployment](DEPLOYMENT.md#10-github-actions).

## 4. Server config

Example `server.config.json`:

```json
{
  "BaseUrl": "https://mods.aic.la",
  "ServerId": "srv_replace",
  "ServerToken": "replace",
  "GameVersion": "3.0.1-b4",
  "RefreshSeconds": 60,
  "HandshakeTimeoutSeconds": 180,
  "AutoSync": true,
  "AutoRestart": false
}
```

The server token is returned once by the registration API. Do not commit it, and do not copy it to the client.

The plugin looks for config in this order: the current Mod directory (`Mod.Path`), `UserDataFolder/Mods`, then the game install `Mods`. If the dedicated server keeps the plugin under save-data Mods, put `server.config.json` in the same folder.

The server plugin periodically:

- fetches the current ModPack from the platform
- downloads, SHA-256-checks, and installs **server and shared** mods into sibling `Mods` (`AutoSync` is on by default); existing same-name folders are claimed and updated, and no longer fail as “unmanaged”
- incrementally updates on the next refresh after a new Pack Release
- writes local `current-assignment.json` and reports `sync-status`
- requires a restart after DLL or first-time installs; content-only overlay updates can go live without kicking players. With `AutoRestart=true` the process exits after a restart-required download
- reports diagnostics when a refresh fails

## 5. Client config

Example `client.config.json`:

```json
{
  "BaseUrl": "https://mods.aic.la",
  "GameVersion": "3.0.1-b4",
  "DiagnosticsEnabled": true,
  "AutoSync": true,
  "AutoRestart": true
}
```

With `DiagnosticsEnabled` off, the in-game client plugin does not send crash events. The external guardian has its own switch.

`AutoSync` is on by default: the client resolves the Pack for the `host:port` it is about to join, installs **client and shared** mods into `%APPDATA%\7DaysToDie\Mods`, then sends the handshake. DLL Packs quit and reconnect after install (`AutoRestart`, on by default). While connected, it silently rechecks about every 60 seconds; overlay-only updates can apply without a download window.

You can also change these in game: main menu or ESC → **Options** → **Mod platform**. Apply writes the same `client.config.json` and takes effect immediately.

## 6. EAC and restart

The plugins themselves and Harmony/DLL Mods usually need EAC off. DLL Mods must be installed before the game starts. After a DLL download while the game is running, quit and start again.

## 7. Confirm the plugin loaded

After starting the game or dedicated server, look for:

```text
[ModPlatform] Client bootstrap initialized
[ModPlatform] Server bootstrap started
```

After a successful assignment the server also logs:

```text
[ModPlatform] Active pack <packId> v<version>
```

If those lines are missing, check:

- the folder sits directly under `Mods`
- `ModInfo.xml` exists
- the main plugin DLL and `ModPlatform.Shared.dll` are both present
- the DLLs were built for this game version
- EAC is off
- the config file name is correct

## 8. Current limits

The plugins already do:

- assignment polling and diagnostic upload
- handshake v1: the client posts Pack, version, signing key, and installed-file fingerprints over platform HTTP, not a custom NetPackage (so extra server-only Mods cannot shift package IDs)
- the client downloads and installs **client and shared** mods from the server address, then sends the handshake; while connected it rechecks about every 60 seconds (content overlays can go live without a restart)
- the dedicated server polls assignment every 60 seconds and installs **server and shared** mods; content overlays can go live without kicking players
- a registered mod may set `installSide` to `both` (default), `server`, or `client`. Handshake fingerprints only include `both`
- the server claims that handshake by Steam/EOS/name and rejects unsynced, version-mismatched, or timed-out players on `PlayerLogin` / `PlayerSpawning`, with a kick reason that includes the launcher URL. Handshake wait is at least 120s (180s while a `syncing` hello is in flight) so a large content overlay cannot lose the race to the old 15s default
- sync claims same-name folders the Pack already declared; the server cache lives in `ModPlatformServer/.modplatform`

Upgrade client and server plugins together to `0.2.12`. Side-aware auto-update only installs server or client mods on the matching side; older plugins still install everything. Handshake fingerprints ignore server-only and client-only artifacts, so mixed packs need this plugin version. Official `mod-platform-client` / `mod-platform-server` entries in a Pack can update the matching plugin folders.

```powershell
npm run launcher -- join --base-url http://localhost:8080 --address game.example.com:26900
```
