# Player and host guide

[English](USER.md) · [简体中文](USER.zh.md)

Platform: [https://mods.aic.la](https://mods.aic.la)

Install steps and official plugin / launcher downloads: [https://mods.aic.la/about](https://mods.aic.la/about). Plugin ZIPs are also on [GitHub Releases](https://github.com/lyretain/7d2d-mod-platform/releases/latest).

Current game target: `V 3.1.0` (Steam Build `24436778`). Mods that contain DLLs need EAC off.

Hordepin is a 7 Days to Die mod distribution and sync platform. This guide is for two audiences:

- **Hosts**: register a 7 Days to Die dedicated server so players install the same ModPack from the address they join.
- **Players**: sync Mods from that address, then join.

Anyone can register. Uploading Mods, publishing Packs, and review still need a community admin or developer. The platform-wide emergency pause is on Operations and only superadmins and community admins can use it.

## 1. Register and sign in

1. Open [https://mods.aic.la](https://mods.aic.la).
2. Choose Register. Username is 3–32 characters (letters, digits, `.`, `_`, `-`). Password is at least 10 characters.
3. Leave the invite blank to join as a regular user.
4. Sign in with the same account.

After sign-in you land on the workshop: browse and search registered Mods. Community admins can add a Mod to an existing Pack or create a new one while browsing. Regular users can still read the workshop and published Packs, and register their own dedicated server on the Servers page.

## 2. Hosts: create a server

Registering a server does not install the dedicated server for you. It only tells the platform which published Pack to download when a player connects to `host:port`.

### 1. Confirm a Pack first

1. Open Workshop, search by name, author, or game version, then add Mods to the selection.
2. Create a new Pack, or add the selection to an existing Pack. You can publish a Release in the same step.
3. You can still assemble a Pack on the Packs page with the checkboxes. If no Pack is available, ask a community admin, or become a developer and upload Mods yourself.

### 2. Register it in the console

1. Open Servers.
2. Fill in:
   - **Name**: for you, for example `Weekend PVE`.
   - **Pack**: a published Pack.
   - **Addresses (optional)**: one per line, for example LAN `192.168.3.42:26900` and public `play.example.com:26900`. You can leave this empty. Handshake and Pack resolve use **Server ID**; addresses only help players who join by IP. Dynamic IPs, LAN-only, and split public/private addresses are all fine.
3. Click Register server.
4. The page shows a full `server.config.json` with the same fields as the plugin: `BaseUrl`, `ServerId`, `ServerToken`, `GameVersion`, `RefreshSeconds`, `HandshakeTimeoutSeconds`. The token is shown once. Paste it over the plugin file immediately. If you lose it, open Servers and click **Reset ServerToken**; the old token stops working immediately.

Several servers may share the same address (for example all `192.168.1.100:26900`). Resolve-by-address picks the one that was online most recently; use Server ID when you need an exact match. To change the Pack or addresses later, select the row, edit, then Update binding. You can only edit servers you registered. Once the server plugin is online it merges the addresses it is actually listening on.

### 3. Install the server plugin

Copy the whole `ModPlatformServer` folder into the dedicated server `Mods` directory. Do not copy only the DLL. Example:

```text
<7DTD dedicated server>\Mods\ModPlatformServer\
  ModPlatform.Server.dll
  ModPlatform.Shared.dll
  ModInfo.xml
  server.config.json
```

Overwrite `server.config.json` with the JSON from the console. Keep the field casing. It should look like:

```json
{
  "BaseUrl": "https://mods.aic.la",
  "ServerId": "srv_...",
  "ServerToken": "...",
  "GameVersion": "3.1.0",
  "RefreshSeconds": 60,
  "HandshakeTimeoutSeconds": 180,
  "AutoSync": true,
  "AutoRestart": false
}
```

Do not give `ServerToken` to players or put it in the client plugin.

### 4. Sync Mods and start the server

The server plugin **downloads and installs server and shared mods** from the current Pack into the sibling `Mods` directory (next to `ModPlatformServer`). After you publish a new Release, the dedicated server fetches it on the next refresh (60 seconds by default). Client-only mods are not installed on the dedicated server.

DLL Mods need a dedicated-server restart before they load. Restart when the log shows `restartRequired=True`. To exit after download so an external guardian can start the process again, set `AutoRestart` to `true`.

You can still preinstall with the updater or guardian (`--side server` on a dedicated server):

```powershell
node apps/updater/src/cli.js --base-url https://mods.aic.la --pack-id your-pack --mods-dir "C:\7DTDDedicated\Mods" --side server
```

After start, the dedicated-server log should contain:

```text
[ModPlatform] Server bootstrap started
[ModPlatform] Active pack <packId> v<version>
```

The Servers table should show the row online within about five minutes.

## 3. Players: sync and join

Players do not register a server. After they connect to the host’s game address, the client resolves the Pack by address or Server ID. LAN, public, and dynamic IPs all work; the join address does not have to be the exact string typed in the console.

### 1. Install the client plugin

Copy the whole `ModPlatformClient` folder into the user Mods directory:

```text
%APPDATA%\7DaysToDie\Mods\ModPlatformClient\
```

In game you can also open **Options → Mod platform**, change the platform URL, auto-download, restart-after-DLL, and diagnostics, then Apply. You do not have to edit JSON by hand.

Default `client.config.json`:

```json
{
  "BaseUrl": "https://mods.aic.la",
  "GameVersion": "3.1.0",
  "DiagnosticsEnabled": true,
  "AutoSync": true,
  "AutoRestart": true
}
```

Download the plugin pack from the [About page](https://mods.aic.la/about), or ask the host or a community admin. The repo copy lives in `artifacts/plugins/ModPlatformClient`.

### 2. Auto-sync when you join

Install the client plugin and join. It resolves the Pack, downloads **client and shared** mods into `%APPDATA%\7DaysToDie\Mods`, then handshakes by Server ID. While connected it rechecks about every 60 seconds. DLL Packs show a restart confirm first. The log should contain:

```text
[ModPlatform] Resolving pack for 192.168.3.42:26900
[ModPlatform] Client pack sync ... installed=
[ModPlatform] Handshake sent address=192.168.3.42:26900 pack=... v...
```

The first download can be slow enough that you get kicked once for timeout; the client reconnects after the install finishes.

### 3. One-click launcher (optional)

If you already have the portable launcher:

```text
ModPlatformLauncher.exe join --base-url https://mods.aic.la --address host-address:26900
```

If you have Node.js locally:

```powershell
npm run launcher -- join --base-url https://mods.aic.la --address play.example.com:26900
```

The launcher finds the game and Mods folders, lists installs, updates, and removals, marks DLL Mods, then starts the game and tries to reconnect. The portable folder checks for a launcher self-update before join: it only installs a ZIP that has a platform Ed25519 signature and a matching SHA-256. Running from a source tree only announces a new version and does not overwrite the development tree. You can also run:

```powershell
ModPlatformLauncher.exe update --base-url https://mods.aic.la
```

The first sync pins the platform public key. A later key change is rejected. That is intentional.

### 4. Updater only, start the game yourself

```powershell
node apps/updater/src/cli.js --base-url https://mods.aic.la --server-address play.example.com:26900 --mods-dir "$env:APPDATA\7DaysToDie\Mods"
```

Start 7 Days to Die after sync and join the same address. If the Pack contains DLLs, quit the game before sync, then start it again.

### 5. Messages you may see when joining

- Missing client plugin: install it from the kick reason.
- ModPack mismatch: look for `Client pack sync` on the client; the address must match what the host registered.
- Game version mismatch: you need a build compatible with the Pack.
- Server still syncing / distribution paused: wait for the host.

Handshake uses platform HTTP. The address the player joins must match a public address the host registered. Use client plugin `0.2.3`.

## 4. Common problems

- **Unknown packId when registering**: the dropdown has no published Pack, or it was deleted. Confirm a Release on the Packs page.
- **Address already in use**: pick another public address, or ask the original owner to change the binding.
- **Player resolve fails**: the address must match exactly, including the port.
- **Lost token**: select the server under Servers and click **Reset ServerToken**, then overwrite the dedicated-server plugin `server.config.json`. The old token stops working immediately.
- **No plugin logs**: the whole folder must sit under `Mods`, with `ModInfo.xml`, the main DLL, and `ModPlatform.Shared.dll`. EAC must be off.
- **Want to upload your own Mod**: activate with a developer invite, or register with one. Publishing a Pack still needs a community admin.

Plugin install details: [Plugin guide](PLUGIN.md). Console deploy: [Deployment](DEPLOYMENT.md).
