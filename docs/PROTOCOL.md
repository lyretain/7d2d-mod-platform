# Protocol v1

[English](PROTOCOL.md) · [简体中文](PROTOCOL.zh-CN.md)

## Trust model

The platform signs the canonical JSON representation of each manifest with Ed25519. `signing` is omitted while canonicalizing. Clients pin the SPKI public key on first contact, or administrators provide it explicitly. A changed key is rejected until approved.

Artifacts are immutable and addressed by lowercase SHA-256. A client must verify the manifest signature before using artifact URLs, then verify artifact length, SHA-256 and ZIP CRC before installation.

## Preflight flow

1. A server administrator registers a public `host:port` and binds a ModPack.
2. A launcher calls `GET /api/v1/public/servers/resolve?address=host:port`.
3. The launcher retrieves `GET /api/v1/public/packs/{packId}/latest`.
4. The updater verifies the signature, downloads missing artifacts and installs declared top-level roots. A mod may also list `overlays`: extra ZIPs extracted into a subdirectory of an install root (for example `Z_CustomAvatars/Avatars`). Overlay SHA-256 values are part of the handshake fingerprint.
5. DLL-containing releases set `requiresRestart`; the game must start after installation.

The portable launcher also checks `GET /api/v1/public/launcher/latest?platform=win32` before pack sync. The response is an Ed25519-signed object (`kind: launcher`) with `version`, `sha256`, `size` and an artifact URL. The launcher pins the same platform public key used for ModPacks, verifies the ZIP hash, extracts with the existing ZIP safety rules, then replaces the portable folder. Signature failures fail closed. A missing release or a network error does not block joining a server. Authenticode signing of `ModPlatformLauncher.exe` is separate from this package signature.

The client plugin also resolves the same address, downloads the signed latest pack into the user Mods directory, then sends the handshake. DLL-containing packs require a game restart; the plugin writes a reconnect hint and can quit so the next launch loads the new assemblies. Launcher preflight is still optional for installing files before the first game start.

## Handshake v1

The client plugin posts the hello to `POST /api/v1/public/handshakes` (not a custom 7DTD `NetPackage`, so extra server-only Mods cannot shift package IDs). The payload includes:

- `address`: the same `host:port` registered for the dedicated server
- `playerIds`: Steam / EOS / display-name identifiers known to the local client
- `hello.protocolVersion` (must be `1`)
- `hello.pluginVersion`, `hello.gameVersion`, `hello.steamBuildId`
- `hello.packId`, `hello.packVersion`, `hello.keyId`
- `hello.artifactFingerprint`: sorted lowercase SHA-256 list from `.modplatform/state.json`

The dedicated-server plugin claims that payload with `POST /api/v1/servers/{id}/pending-handshake/claim` using the server token, then compares it to the assignment `handshake` policy. Missing plugin, timeout, paused distribution, revoked release, game-version mismatch, or hash mismatch all disconnect the player with a reason code and launcher URL. Pending hellos expire after two minutes and are consumed on claim.

A custom plugin can still claim matching hashes; the gate exists to stop ordinary unsynced clients, not a dedicated spoofed DLL. The server never accepts arbitrary artifact URLs from the client.

## Server assignment

`GET /api/v1/servers/{serverId}/assignment` uses the one-time server bearer token returned at registration. Only a token hash is stored. The response includes the active signed manifest.

## Diagnostics

`POST /api/v1/diagnostics` accepts a bounded JSON event. The API redacts credentials, IP addresses, user home paths and platform IDs, normalizes the first stack frames and creates a stable SHA-256 fingerprint. Production deployments should add per-IP and per-server rate limiting at the reverse proxy.
