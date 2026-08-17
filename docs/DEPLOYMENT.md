# Deployment

[English](DEPLOYMENT.md) · [简体中文](DEPLOYMENT.zh.md)

Last updated: 2026-08-17. The admin console is the `apps/web` Vue SPA. The API still has zero npm runtime dependencies.

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
| `AUDIT_RETENTION_DAYS` | Audit log retention in days; `0` (default) keeps every mutating operation forever |
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
10. Operations on `/ops` cover stats, review, audit, and launcher self-update packages. Superadmins and community admins can also pause the whole platform there.

The sidebar hides by `permissions`: no `catalog.write` hides Mods, no `ops.read` hides Operations. The platform-wide emergency pause lives on Operations and is only shown to superadmins and community admins.

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
- GitHub Actions secrets for platform publish are set if you want CI to upload plugin ZIPs

## 10. GitHub Actions

`.github/workflows/ci.yml` runs `npm test` on every push and pull request. The Windows plugin compile, GitHub Release, and platform upload run only when the plugin version changes on `main` (`deploy/build-plugins.ps1` `pluginVersion` or `plugins/*/ModInfo.xml`), or on manual `workflow_dispatch`. That job then:

1. Caches the 7DTD reference assemblies (SteamCMD dedicated server on a cache miss)
2. Builds client/server plugins and the portable launcher
3. Zips `ModPlatformClient` / `ModPlatformServer`, stores GitHub Actions artifacts, and on `main` publishes a GitHub Release with those plugin ZIPs only (no launcher)
4. If repository secrets are present, uploads those ZIPs to the management platform, auto-approves the first-party review, registers `mod-platform-client` / `mod-platform-server`, publishes the launcher self-update, and optionally adds them to a Pack Release

Repository **secrets**:

| Secret | Purpose |
|---|---|
| `PLATFORM_BASE_URL` | Public API host; defaults to `https://mods.aic.la`. Do not put the origin IP here |
| `PLATFORM_TOKEN` | Session bearer for a superadmin (optional if username/password are set) |
| `PLATFORM_USERNAME` | Superadmin login; the account must not use TOTP |
| `PLATFORM_PASSWORD` | Superadmin password |
| `GAME_MANAGED_URL` | Optional. Direct URL to a ZIP that contains `Assembly-CSharp.dll`, `LogLibrary.dll`, and `UnityEngine.CoreModule.dll`. Used if SteamCMD cannot anonymously install the dedicated server |
| `PLATFORM_CF_SKIP_TOKEN` | Optional. Same value as the Cloudflare WAF skip for header `x-hordepin-ci`; avoids the “Just a moment…” challenge |

Repository **variables** (optional):

| Variable | Purpose |
|---|---|
| `PLATFORM_PACK_ID` | If set, CI updates this Pack and publishes a Release |
| `PLATFORM_PACK_NAME` | Name used when creating that Pack |
| `PLATFORM_GAME_VERSION` | Default `3.10.14` |
| `PLATFORM_PUBLISH_LAUNCHER` | Set `false` to skip launcher self-update |
| `STEAM_BUILD_ID` | Cache key; default `24436778` |
| `PLATFORM_ORIGIN_IP` | Origin public IP, optionally with a port such as `203.0.113.10:8080`. CI connects here and still sends `Host: mods.aic.la`, skipping Cloudflare challenges |
| `PLATFORM_ORIGIN_SCHEME` | Optional `http` / `https`. Defaults to http when the port is `80` or `8080`. Use `https` if the origin redirects HTTP back to the public hostname |
| `PLATFORM_ORIGIN_PORT` | Optional when the port is not part of the IP value |
| `PLATFORM_PUBLIC_HOST` | Optional. Defaults to the host in `PLATFORM_BASE_URL` |
| `PLATFORM_ORIGIN_INSECURE` | Optional. `true` skips origin HTTPS certificate checks (self-signed only) |

The CI user must be a superadmin (`platform.manage`). Local equivalent:

```powershell
npm run publish-platform -- --pack-only
$env:PLATFORM_BASE_URL = "https://mods.aic.la"
$env:PLATFORM_ORIGIN_IP = "203.0.113.10:8080"
$env:PLATFORM_USERNAME = "ci-bot"
$env:PLATFORM_PASSWORD = "..."
npm run publish-platform
```
