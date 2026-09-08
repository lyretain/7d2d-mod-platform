# Deployment

[English](DEPLOYMENT.md) · [简体中文](DEPLOYMENT.zh.md)

Last updated: 2026-09-08.

| Goal | Page |
|---|---|
| **Linux / aaPanel** | [LINUX.md](LINUX.md) |
| Windows local | Section 1 |
| Docker | Section 2 |
| GitHub Release CI | Section 4 |

Incidents: [RUNBOOK.md](RUNBOOK.md). CDN: [CLOUDFLARE.md](CLOUDFLARE.md).

No `DATABASE_URL` → JSON + `data/objects/`. Production on one host: local Postgres + local files, empty `S3_*`. Multiple instances need shared Postgres and S3.

## 1. Windows local

Needs Node.js 22.

```powershell
cd A:\GameMod\7d2d-mod-platform
npm --prefix apps/web install
$env:ADMIN_TOKEN = "at-least-16-random-characters"
$env:PUBLIC_BASE_URL = "http://localhost:8080"
npm run start:ui
```

Open `http://127.0.0.1:8080`. Without `apps/web/dist`, `/` falls back to the embedded page. Production must run `npm run build:web`.

Hot reload: `npm run dev` and `npm run dev:web`, then Vite at `http://localhost:5173`.

Do not use `start:ui` in production. On Linux, inject env via aaPanel or systemd; a repo `.env` is not read.

## 2. Docker

```powershell
copy .env.example .env
# set ADMIN_TOKEN and PUBLIC_BASE_URL
docker compose up --build -d
```

Data lives in volume `mod-platform-data`. Full stack: `docker compose --profile full up --build -d`.

## 3. Environment (common)

| Variable | Meaning |
|---|---|
| `HOST` / `PORT` | Production: `127.0.0.1` / `8080` |
| `PUBLIC_BASE_URL` | Final HTTPS origin; same as launcher and CDN URLs |
| `ADMIN_TOKEN` | First `/setup`, ≥16 characters |
| `ALLOW_BOOTSTRAP_ADMIN` | Keep `false` |
| `DATA_DIR` | Data and Mod files |
| `DATABASE_URL` | PostgreSQL; empty = JSON |
| `SIGNING_PRIVATE_KEY` | Required in production |
| `FORCE_HTTPS` / `TRUSTED_PROXY` | Both `true` when Nginx terminates TLS |
| `S3_*` | Empty on one disk |

Proxy the whole site to `8080`, not only `/api`.

Browser: `/setup` → admin account → upload Mods → publish a Pack → register a server on `/servers`.

## 4. GitHub Actions

A GitHub Release (plugin ZIPs only) is created when the plugin version changes on `main` (`project-versions.json` `pluginVersion` or `plugins/*/ModInfo.xml`), or on `workflow_dispatch`.

For Releases only: give Actions write permission and bump the version. `GITHUB_TOKEN` is built in.

To also upload to the platform, add Secrets:

- `PLATFORM_BASE_URL` (public hostname, not the origin IP)
- `PLATFORM_USERNAME` + `PLATFORM_PASSWORD` (superadmin, **no TOTP**), or `PLATFORM_TOKEN`

Optional Variables: `PLATFORM_PACK_ID`, `PLATFORM_ORIGIN_IP` (bypass Cloudflare). Add `GAME_MANAGED_URL` if SteamCMD cannot fetch game DLLs.
