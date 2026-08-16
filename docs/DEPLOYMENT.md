# Deployment

[English](DEPLOYMENT.md) · [简体中文](DEPLOYMENT.zh-CN.md)

Last updated: 2026-08-16. The admin console is the `apps/web` Vue SPA. The API still has zero npm runtime dependencies.

## 1. Modes

This release supports two modes:

- Single node: with no `DATABASE_URL`, metadata is a JSON file and objects live in `data/objects/`.
- Production: set `DATABASE_URL`, S3/MinIO, and `SIGNING_PRIVATE_KEY` or `SIGNING_SERVICE_URL`. Multiple instances must use PostgreSQL and shared object storage.

Incidents: [Runbook](RUNBOOK.md). Cloudflare CDN / R2: [Cloudflare](CLOUDFLARE.md).

## 2. Admin frontend

| Path | Behavior |
|---|---|
| `/` plus `/setup` `/signin` `/workshop` `/mods` `/packs` `/servers` `/ops` `/account` | Vue SPA when `apps/web/dist` exists (history fallback included) |
| `/assets/*` | Hashed SPA assets, safe to cache for a long time |
| `/admin-i18n.js` | Chinese and English copy; not copied into the frontend tree |
| `/legacy` | Always the embedded page `apps/api/src/admin.html` |
| `/guide` | Player and host guide (`?lang=en` for English) |

If `apps/web/dist/index.html` is missing, `GET /` falls back to the embedded page. The API and tests do not require a frontend build. Public production should build the SPA first and not treat the fallback as the real console.

## 3. Bare metal / existing Node process

Requires Node.js 22 or newer.

One local command (build Vue, start the API, open a browser; no Vite):

```powershell
cd A:\GameMod\7d2d-mod-platform
npm --prefix apps/web install
$env:ADMIN_TOKEN = "long-random-token-from-a-password-manager"
$env:PUBLIC_BASE_URL = "http://localhost:8080"
npm run start:ui
```

Production bare metal (does not open a browser):

```powershell
cd A:\GameMod\7d2d-mod-platform
npm --prefix apps/web install
npm run build:web

$env:HOST = "0.0.0.0"
$env:PORT = "8080"
$env:PUBLIC_BASE_URL = "https://mods.aic.la"
$env:ADMIN_TOKEN = "long-random-token-from-a-password-manager"
$env:NODE_ENV = "production"
node apps/api/src/server.js
```

Local development (hot reload; not a production substitute):

```powershell
# terminal 1
$env:ADMIN_TOKEN = "..."
$env:PUBLIC_BASE_URL = "http://localhost:8080"
npm run dev

# terminal 2
npm run dev:web
```

Open Vite at `http://localhost:5173`. `/api`, `/status`, `/guide`, `/admin-i18n.js`, and `/health` proxy to 8080.

Important environment variables:

| Variable | Purpose |
|---|---|
| `HOST` | API bind address |
| `PORT` | API port |
| `PUBLIC_BASE_URL` | Public HTTPS origin written into manifests |
| `ADMIN_TOKEN` | First-time setup token, at least 16 characters |
| `GITHUB_CLIENT_ID` | GitHub OAuth app id for community admins |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth app secret |
| `ALLOW_BOOTSTRAP_ADMIN` | Whether `ADMIN_TOKEN` still logs in after the first user; default `false` |
| `DATA_DIR` | Data, Mod files, runtime logs, and the development signing key |
| `LOG_RETENTION_DAYS` | Runtime log retention, one file per day; default and maximum 30 |
| `SIGNING_PRIVATE_KEY` | Base64 PKCS#8 Ed25519 private key; required in production unless you use `SIGNING_SERVICE_URL` |
| `SIGNING_SERVICE_URL` | External signing service. The app process then does not hold the private key |
| `DATABASE_URL` | PostgreSQL URL; empty keeps JSON |
| `PUBLIC_CDN_URL` | Object download root written into manifests |
| `FORCE_HTTPS` | Permanent HTTP→HTTPS redirect behind a trusted proxy, plus HSTS |
| `TRUSTED_PROXY` | Trust `X-Forwarded-For` / `CF-Connecting-IP` only when set |
| `REQUIRE_REVIEW` | On by default in production: unreviewed or unlicensed Mods cannot publish |
| `ALERT_WEBHOOK_URL` | Alerts for pause, crash-rate circuit breaker, and similar events |
| `S3_*` | Optional object store. Unset writes locally only |
| `MAX_ARTIFACT_BYTES` | Maximum Mod ZIP size |
| `MAX_DIAGNOSTIC_BYTES` | Maximum diagnostic request size |

`NODE_ENV=production` forbids auto-generated development keys and disables the bootstrap admin token by default. A JSON single node can migrate with:

```powershell
node deploy/migrate-json-to-pg.js .\data\state\database.json $env:DATABASE_URL
```

Full infrastructure:

```powershell
docker compose --profile full up --build -d
```

## 4. Docker Compose

The image build runs `npm --prefix apps/web install` and `npm run build:web`, then deletes `apps/web/node_modules`. The running container only starts `node apps/api/src/server.js`.

1. Copy `.env.example` to `.env`.
2. Change `ADMIN_TOKEN` and `PUBLIC_BASE_URL`.
3. Make sure Docker Desktop is running.
4. Run:

```powershell
cd A:\GameMod\7d2d-mod-platform
docker compose up --build -d
docker compose ps
```

Health checks:

```powershell
Invoke-RestMethod http://localhost:8080/health
Invoke-RestMethod http://localhost:8080/health/ready
```

`http://localhost:8080` should be the Vue console (the page contains `#app`). Emergency page: `http://localhost:8080/legacy`.

Data lives in the Docker named volume `mod-platform-data`. Back it up before upgrades or migrations.

## 5. Upgrade an existing instance

Back up `data/` (or Postgres / object storage) and `.env` first.

Bare metal:

```powershell
git pull
npm --prefix apps/web install
npm run build:web
# restart the API the same way you started it, for example:
node apps/api/src/server.js
```

Docker:

```powershell
git pull
docker compose up --build -d
```

Accept:

- `GET /health` and `GET /health/ready` return 200
- `GET /` is the new console (`id="app"`), not only the old grid page
- `GET /legacy` still opens the embedded page
- `GET /admin-i18n.js` is JavaScript
- After sign-in, workshop, Packs, servers, and operations work

Blue/green cutover: [Runbook](RUNBOOK.md). Multiple instances must not share one JSON file.

## 6. HTTPS and reverse proxy

Public service must use HTTPS. Reverse-proxy the **whole site** to Node `8080` and let the API do SPA fallback. Do not forward only `/api`.

The proxy needs at least:

- `/`, `/assets/*`, `/admin-i18n.js`, `/legacy`, `/guide`, `/status`, `/health`, and `/api/v1/*` all go to the API
- Real scheme and host (`X-Forwarded-Proto` / `X-Forwarded-Host`)
- No cache for HTML, `/admin-i18n.js`, `/api/v1/auth/*`, `/api/v1/admin/*`
- Long cache for `/assets/*` (content-hashed names)
- Per-IP / per-server rate limits on diagnostics
- Sensible body size and timeouts on uploads
- Long cache for hash-named Mod files
- Directory listing off
- Failed admin logins recorded

`PUBLIC_BASE_URL` must be the final public origin, or published manifests will contain unreachable download URLs.

## 7. Console walkthrough

1. Uninitialized `/` sends you to `/setup`. Enter `ADMIN_TOKEN` and the first admin account.
2. You then land on `/workshop`. The bootstrap token is disabled by default.
3. Later visitors see `/signin` (sign-in / invite register). `ADMIN_TOKEN` is no longer shown.
4. A signed-in superadmin invites community admins on `/account`. Community admins invite developers after binding GitHub. Regular users can register openly.
5. Roles with `catalog.write` upload a ZIP on `/mods` and get a SHA-256.
6. Register the Mod version with a game version (for example `3.1.0`) and the ZIP top-level directories.
7. Mark DLL / restart, and confirm redistribution rights.
8. Pick Mods in the workshop or build a Pack on `/packs`, then publish an immutable Release.
9. Register a dedicated server on `/servers` and bind a published Pack. The token in `server.config.json` is shown once.
10. Operations on `/ops` cover stats, review, audit, and launcher self-update packages.

The sidebar hides by `permissions`: no `catalog.write` hides Mods, no `ops.read` hides Operations, no `server.manage` hides the emergency pause.

## 8. Backup and restore

Back up at least:

- `data/state/database.json`
- `data/state/dev-signing-key.pk8` if you still use the development key
- every Mod file in `data/objects/`
- daily runtime logs in `data/logs/` (kept at most 30 days; not a substitute for audit logs)
- reverse-proxy and environment configuration
- if you use Docker: named volume `mod-platform-data` (plus Postgres / MinIO volumes on the `full` profile)

`apps/web/dist` can be rebuilt from source. Restore must bring back the database, object files, and the original signing private key together. Restoring the database with a new private key makes clients reject previously signed manifests.

## 9. Go-live checklist

- Valid HTTPS certificate
- Public origin matches `PUBLIC_BASE_URL`
- `npm run build:web` has run, or the Docker image built and `GET /` is the Vue console
- `/legacy` is emergency-only, not the public entry
- Admin token is long and not in git
- A real admin account exists and `ALLOW_BOOTSTRAP_ADMIN=false`
- Signing private key is backed up or in KMS
- Uploaded DLLs were scanned and reviewed
- Rate limits on download, diagnostics, and login
- Redistribution rights for every hosted Mod
- Client updater uses a pinned public key
- Restore drill completed
- Client and server plugins tested on the target 7 Days to Die version
