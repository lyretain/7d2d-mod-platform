# 7DTD Mod Platform MVP

[简体中文文档](README.zh-CN.md) · English

A deployable, dependency-light MVP for managing, signing, distributing and diagnosing 7 Days to Die ModPacks.

## Included

- Browser-based administration page (`apps/web` Vue SPA, with `/legacy` fallback).
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
npm --prefix apps/web install
$env:ADMIN_TOKEN = "replace-with-at-least-16-random-characters"
$env:PUBLIC_BASE_URL = "http://localhost:8080"
npm run start:ui
```

`start:ui` builds the Vue app, starts the API, and opens `http://127.0.0.1:8080`. The API serves `apps/web/dist` itself, so a separate Vite process is not required. `npm start` does the same once `dist` already exists. `/legacy` keeps the embedded page.

Frontend-only development (Vite proxies `/api` to port 8080):

```powershell
npm run dev
npm run dev:web
```

Player and server-owner tutorial: [docs/USER.zh-CN.md](docs/USER.zh-CN.md) or `/guide` on a running instance.

### Run with Docker

Copy `.env.example` to `.env`, change `ADMIN_TOKEN` and `PUBLIC_BASE_URL`, then:

```powershell
docker compose up --build -d
```

The named Docker volume stores metadata, artifacts and the development signing key. Back it up before upgrades.

## Client synchronization

By pack ID:

```powershell
node apps/updater/src/cli.js --base-url https://mods.aic.la --pack-id production-pack --mods-dir "$env:APPDATA\7DaysToDie\Mods"
```

By registered game-server address:

```powershell
node apps/updater/src/cli.js --base-url https://mods.aic.la --server-address game.example.com:26900 --mods-dir "$env:APPDATA\7DaysToDie\Mods"
```

On first use the updater pins the platform public key. A later key change fails closed. For managed deployments, pass the expected base64 SPKI key using `--public-key`.

Player launcher (discover install, show the plan, sync, start, reconnect):

```powershell
npm run launcher -- join --base-url https://mods.aic.la --address game.example.com:26900
```

Build a portable folder that includes `node.exe` and `ModPlatformLauncher.exe`. The script also writes a SHA-256 ZIP for signed self-update:

```powershell
.\deploy\build-launcher.ps1
```

Publish that ZIP from the admin Ops page. The portable launcher checks `GET /api/v1/public/launcher/latest` before pack sync and only replaces itself after Ed25519 and SHA-256 verification.

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

Plugins are compiled against 7DTD `V 3.10.14` / Steam build `24436778`. They poll assignments, send diagnostics, and run handshake protocol v1 over the platform HTTP API so unsynced clients are rejected before world entry without registering a custom NetPackage. Launcher preflight is still required to install files before the game loads DLLs. Live join tests on this machine are still outstanding.

## Test

```powershell
node --test apps/api/test/*.test.js apps/updater/test/*.test.js
```

The tests cover signed release publication, tamper rejection, diagnostic redaction and aggregation, full updater installation, ZIP integrity checks, traversal rejection and case-insensitive duplicate rejection.

## Production status

This is a working single-node MVP, not yet a public multi-tenant Mod marketplace. Before public deployment, complete the production checklist in `docs/SECURITY.md`, especially HTTPS, KMS-backed signing, rate limiting, malware scanning, signed updater packaging and a target-game integration test.
