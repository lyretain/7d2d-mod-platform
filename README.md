# Hordepin

[简体中文文档](README.zh-CN.md) · English · [MIT License](LICENSE)

**Hordepin** (Chinese: **潮印**) is a deployable, dependency-light platform for signing, distributing, and diagnosing 7 Days to Die ModPacks on private servers. The name is *horde* (the game’s signature night) plus *pin* (pinned platform keys and a join handshake that locks clients to the server’s pack).

Plugin folders and assemblies stay `ModPlatform*` so existing installs keep working.

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

Player and host tutorial: [docs/USER.md](docs/USER.md) / [中文](docs/USER.zh-CN.md), or `/guide` and `/guide?lang=en` on a running instance.

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

## Credits

This repository is original application code. It depends on or was visually informed by the following projects. Game assemblies are referenced at compile time only and are not redistributed.

| Project | Role | License |
|---|---|---|
| [7 Days to Die](https://7daystodie.com/) (The Fun Pimps) | Target game; plugin compile references | Proprietary. Not included in this repo. |
| [Unity](https://unity.com/) | Game engine assemblies used to compile plugins | Proprietary. `Private=false`; not copied into git. |
| [Node.js](https://nodejs.org/) | API, updater, launcher, guardian runtime | MIT |
| [Vue 3](https://vuejs.org/) / [Vue Router](https://router.vuejs.org/) | Admin SPA | MIT |
| [Vite](https://vite.dev/) | Frontend build | MIT |
| [Tailwind CSS](https://tailwindcss.com/) | Admin styles | MIT |
| [lucide-vue-next](https://lucide.dev/) | Sidebar icons | ISC |
| [TailAdmin Vue](https://github.com/TailAdmin/vue-tailwind-admin-dashboard) (community) | Layout and visual cues only; no Pro pages or chart libraries | MIT (community edition) |
| [Docker](https://www.docker.com/) / Compose | Optional deploy | Apache-2.0 (Engine) |
| [PostgreSQL](https://www.postgresql.org/) / [MinIO](https://min.io/) | Optional production store | PostgreSQL / AGPL-3.0 (MinIO server) |
| [Cloudflare](https://www.cloudflare.com/) | Optional CDN / R2 | Service terms |
| [GitHub](https://github.com/) | Optional OAuth for community admins | Service terms |

MinIO is only pulled if you start the `full` Compose profile. This repo does not vendor the MinIO server.

## License and commercial use

This software is released under the [MIT License](LICENSE). For **this repository’s own source code**, that means you may use, modify, host, and sell copies, including closed-source forks, as long as you keep the copyright and permission notice.

That does **not** automatically make a 7DTD-related business legal. Separate rules still apply:

1. **This codebase (MIT)** — hosting the API, selling support, or charging for your own deployment of this software is allowed by the license.
2. **7 Days to Die** — the game, its DLLs, art, and trademarks belong to The Fun Pimps. Do not ship `Assembly-CSharp.dll` or other game files. Read their EULA and allocation terms before charging for anything that depends on the game (paid mods, paid servers, or a public marketplace).
3. **Third-party Mods** — each ZIP needs a redistribution right from its author. The admin “license confirmed” checkbox is an operational control, not a substitute for those rights. Selling other people’s Mods usually requires an explicit commercial grant.
4. **Dependencies above** — Vue, Vite, Tailwind, Lucide, and TailAdmin community are permissive. Do not copy TailAdmin Pro assets. If you run MinIO, follow MinIO’s own license.

This is not legal advice. If you plan to charge players or redistribute Mods at scale, get a lawyer to review the Fun Pimps terms and your Mod author contracts.

## Further reading

Index: [docs/README.md](docs/README.md)

- [Player and host guide](docs/USER.md) · [中文](docs/USER.zh-CN.md)
- [Deployment](docs/DEPLOYMENT.md) · [中文](docs/DEPLOYMENT.zh-CN.md)
- [Plugin build and install](docs/PLUGIN.md) · [中文](docs/PLUGIN.zh-CN.md)
- [Production runbook](docs/RUNBOOK.md) · [中文](docs/RUNBOOK.zh-CN.md)
- [Cloudflare CDN](docs/CLOUDFLARE.md) · [中文](docs/CLOUDFLARE.zh-CN.md)
- [Production TODO](docs/PRODUCTION-TODO.md) · [中文](docs/PRODUCTION-TODO.zh-CN.md)
- [HTTP API](docs/API.md) · [中文](docs/API.zh-CN.md)
- [Security](docs/SECURITY.md) · [中文](docs/SECURITY.zh-CN.md)
- [Protocol v1](docs/PROTOCOL.md) · [中文](docs/PROTOCOL.zh-CN.md)
