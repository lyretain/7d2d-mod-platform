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

The current MVP uses launcher preflight because it is reliable before 7DTD loads client DLLs. The game-specific network adapter should later send the same `packId`, `packVersion`, `gameVersion` and `keyId` during the connection handshake. It must not send arbitrary artifact URLs.

## Server assignment

`GET /api/v1/servers/{serverId}/assignment` uses the one-time server bearer token returned at registration. Only a token hash is stored. The response includes the active signed manifest.

## Diagnostics

`POST /api/v1/diagnostics` accepts a bounded JSON event. The API redacts credentials, IP addresses, user home paths and platform IDs, normalizes the first stack frames and creates a stable SHA-256 fingerprint. Production deployments should add per-IP and per-server rate limiting at the reverse proxy.
