# Protocol v1

## Trust model

The platform signs the canonical JSON representation of each manifest with Ed25519. `signing` is omitted while canonicalizing. Clients pin the SPKI public key on first contact, or administrators provide it explicitly. A changed key is rejected until approved.

Artifacts are immutable and addressed by lowercase SHA-256. A client must verify the manifest signature before using artifact URLs, then verify artifact length, SHA-256 and ZIP CRC before installation.

## Preflight flow

1. A server administrator registers a public `host:port` and binds a ModPack.
2. A launcher calls `GET /api/v1/public/servers/resolve?address=host:port`.
3. The launcher retrieves `GET /api/v1/public/packs/{packId}/latest`.
4. The updater verifies the signature, downloads missing artifacts and installs declared top-level roots.
5. DLL-containing releases set `requiresRestart`; the game must start after installation.

Launcher preflight remains the supported way to install files before the game loads client DLLs. After that, the in-game handshake (protocol version 1) is required to enter a world.

## Handshake v1

The client plugin sends `NetPackageModPlatformHello` (`AllowedBeforeAuth = true`) with:

- `protocolVersion` (must be `1`)
- `pluginVersion`, `gameVersion`, `steamBuildId`
- `packId`, `packVersion`, `keyId`
- `artifactFingerprint`: sorted lowercase SHA-256 list from `.modplatform/state.json`

The server plugin compares that payload to the assignment `handshake` policy. Missing plugin, timeout, paused distribution, revoked release, game-version mismatch, or hash mismatch all disconnect the player with a reason code and launcher URL.

A custom plugin can still claim matching hashes; the gate exists to stop ordinary unsynced clients, not a dedicated spoofed DLL. The server never accepts arbitrary artifact URLs from the client.

## Server assignment

`GET /api/v1/servers/{serverId}/assignment` uses the one-time server bearer token returned at registration. Only a token hash is stored. The response includes the active signed manifest.

## Diagnostics

`POST /api/v1/diagnostics` accepts a bounded JSON event. The API redacts credentials, IP addresses, user home paths and platform IDs, normalizes the first stack frames and creates a stable SHA-256 fingerprint. Production deployments should add per-IP and per-server rate limiting at the reverse proxy.
