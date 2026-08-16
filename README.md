# 7DTD Mod Platform MVP

[简体中文文档](README.zh-CN.md) · English

A deployable, dependency-light MVP for managing, signing, distributing and diagnosing 7 Days to Die ModPacks.

## Included

- Browser-based administration page.
- Invitation-only registration, password login, roles and revocable sessions.
- Immutable artifact upload and SHA-256 addressing.
- Mod and ModPack metadata management.
- Ed25519 signed release manifests.
- Game-server registration and public server-to-pack resolution.
- Secure client updater with pinned keys, ZIP validation, staging, backups and rollback.
- Client/server diagnostic ingestion, redaction and fingerprint aggregation.
- External process guardian for crashes that happen before a game plugin loads.
- 7DTD client and server bootstrap plugin source.
- Docker deployment and automated tests.

## Quick start

Requirements: Node.js 22+ or Docker.

### Run locally

PowerShell:

```powershell
$env:ADMIN_TOKEN = "replace-with-at-least-16-random-characters"
$env:PUBLIC_BASE_URL = "http://localhost:8080"
node apps/api/src/server.js
```

Open `http://localhost:8080`, enter the administrator token, then upload a ZIP, register its metadata and publish a pack.

### Run with Docker

Copy `.env.example` to `.env`, change `ADMIN_TOKEN` and `PUBLIC_BASE_URL`, then:

```powershell
docker compose up --build -d
```

The named Docker volume stores metadata, artifacts and the development signing key. Back it up before upgrades.

## Client synchronization

By pack ID:

```powershell
node apps/updater/src/cli.js --base-url https://mods.example.com --pack-id production-pack --mods-dir "$env:APPDATA\7DaysToDie\Mods"
```

By registered game-server address:

```powershell
node apps/updater/src/cli.js --base-url https://mods.example.com --server-address game.example.com:26900 --mods-dir "$env:APPDATA\7DaysToDie\Mods"
```

On first use the updater pins the platform public key. A later key change fails closed. For managed deployments, pass the expected base64 SPKI key using `--public-key`.

## Crash guardian

Copy `deploy/guardian.config.example.json`, adjust the game command and log path, then:

```powershell
node apps/agent/src/guardian.js --config deploy/guardian.config.json
```

The guardian reports normal sessions and abnormal exits. It only includes a bounded tail of the configured log; the API applies another redaction pass.

## 7DTD plugins

The plugin projects require the exact target game's managed assemblies. The build script uses a modern .NET SDK when available and falls back to the Windows C# compiler:

```powershell
.\deploy\build-plugins.ps1 -GameManagedDir "C:\7DTD\7DaysToDie_Data\Managed"
```

On the development machine, both plugins were successfully compiled against 7DTD `V 3.0.1 (b4)` / Steam build `24117861` using:

```powershell
.\deploy\build-plugins.ps1 -GameManagedDir "G:\SteamLibrary\steamapps\common\7 Days To Die\7DaysToDie_Data\Managed"
```

Copy each built DLL, its `ModInfo.xml`, `ModPlatform.Shared.dll`, and the renamed example configuration into the matching `Mods/ModPlatformServer` or `Mods/ModPlatformClient` directory.

The current adapter implements cloud assignment polling and in-process diagnostics. The reliable MVP connection flow is launcher preflight using the public server-address resolver. A native 7DTD connection interception adapter must be compiled and tested against the exact game build before it can safely block world entry; the protocol boundary is documented in `docs/PROTOCOL.md`.

## Test

```powershell
node --test apps/api/test/*.test.js apps/updater/test/*.test.js
```

The tests cover signed release publication, tamper rejection, diagnostic redaction and aggregation, full updater installation, ZIP integrity checks, traversal rejection and case-insensitive duplicate rejection.

## Production status

This is a working single-node MVP, not yet a public multi-tenant Mod marketplace. Before public deployment, complete the production checklist in `docs/SECURITY.md`, especially HTTPS, KMS-backed signing, rate limiting, malware scanning, signed updater packaging and a target-game integration test.
