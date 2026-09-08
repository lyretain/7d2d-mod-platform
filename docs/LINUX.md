# Linux go-live (aaPanel)

[English](LINUX.md) · [简体中文](LINUX.zh.md)

Last updated: 2026-09-08. Ubuntu 22.04 / 24.04 or Rocky / Alma / Stream 8–9. Not CentOS 7. Bare metal is at the end.

**Three rules:** PostgreSQL only (not MySQL). Leave `S3_*` empty on one disk. Put env vars in the aaPanel project — a repo `.env` is not read.

Need Node.js **22** and PostgreSQL **14+**. This is not a Python app. Distro Python 3.9+ is enough for certificates.

## 1. Packages and database

Install **Nginx, Node.js 22, PostgreSQL**. Create user and database `modplatform`.

```bash
mkdir -p /www/mod-platform-data
chown -R www:www /www/mod-platform-data
```

Put the repo at `/www/wwwroot/hordepin` (or your site path), then:

```bash
cd /www/wwwroot/hordepin
npm --prefix apps/web install
npm run build:web
```

aaPanel `psql` is often `/www/server/pgsql/bin/psql`:

```bash
/www/server/pgsql/bin/psql "postgres://modplatform:password@127.0.0.1:5432/modplatform" -c 'SELECT 1'
```

## 2. Signing key (required; missing looks “running” but port 8080 is dead)

```bash
openssl genpkey -algorithm ED25519 -out /www/mod-platform-data/signing.pk8
chmod 600 /www/mod-platform-data/signing.pk8
chown www:www /www/mod-platform-data/signing.pk8
openssl pkey -in /www/mod-platform-data/signing.pk8 -outform DER | base64 -w 0
```

Paste the output into `SIGNING_PRIVATE_KEY` and back it up. A new key rejects old manifests.

## 3. aaPanel Node project

Do not click “install all modules”. The API has **zero** runtime npm deps. An empty module list is normal.

| Field | Value |
|---|---|
| Node | v22 |
| Startup file | `/www/wwwroot/hordepin/apps/api/src/server.js` |
| Working directory | `/www/wwwroot/hordepin` (repo root, not `apps/api/src`) |
| Instances | **1** (no cluster) |
| Port | 8080 |
| User | www |
| Environment | next section, in this form |

Use the Node manager / PM2. Do not leave a raw `node` in SSH.

## 4. Environment

Template: [`.env.baota.example`](../.env.baota.example).

```env
HOST=127.0.0.1
PORT=8080
NODE_ENV=production
PUBLIC_BASE_URL=https://your.domain
PUBLIC_LAUNCHER_URL=https://your.domain
PUBLIC_CDN_URL=https://your.domain
CDN_STYLE=origin
DATA_DIR=/www/mod-platform-data
DATABASE_URL=postgres://modplatform:password@127.0.0.1:5432/modplatform
ADMIN_TOKEN=at-least-16-random-characters
ALLOW_BOOTSTRAP_ADMIN=false
FORCE_HTTPS=true
TRUSTED_PROXY=true
SIGNING_PRIVATE_KEY=base64-from-section-2
```

Leave `S3_*` empty. Keep `ALLOW_BOOTSTRAP_ADMIN=false`; `/setup` still accepts `ADMIN_TOKEN`. Use `HOST=127.0.0.1`, not `0.0.0.0`. URL-encode `@` `#` `%` `/` in the password.

## 5. Reverse proxy

Site root = repo root, not `apps/api/src`. Enable SSL. Proxy the **whole site** to `http://127.0.0.1:8080`.

Do not proxy to `https://your.domain` (Cloudflare loop → 502). Open 80/443 only. Cloudflare SSL: Full or Full (strict).

## 6. Check

```bash
ss -lntp | grep 8080
curl -sS http://127.0.0.1:8080/health
curl -sS http://127.0.0.1:8080/health/ready
```

You should see `127.0.0.1:8080` and JSON. Open the hostname, complete `/setup`, then sign in with the account.

## 7. If it fails

| Symptom | Cause |
|---|---|
| Starts then stops | Env not in the project; missing `ADMIN_TOKEN` |
| Panel says running, 502 / connection refused | Missing `SIGNING_PRIVATE_KEY` or stuck on Postgres; nothing on 8080 |
| `ss` shows no 8080 | `tr '\0' '\n' < /proc/PID/environ \| grep SIGNING_` |
| Empty module list | Normal |
| Upload 413 | Nginx `client_max_body_size 2048m` |

## 8. Upgrade and backup

```bash
cd /www/wwwroot/hordepin
git pull
npm --prefix apps/web install
npm run build:web
# Restart the Node project in aaPanel

/www/server/pgsql/bin/pg_dump -Fc modplatform > /root/modplatform.dump
tar -czf /root/data.tgz -C /www mod-platform-data
```

Back up the database, `objects/`, and the signing key together.

## Bare metal

Paths: `/opt/mod-platform`, `/var/lib/mod-platform`, `/etc/mod-platform/env` (systemd `EnvironmentFile`). Templates: `deploy/linux/`.

Install Node 22, PostgreSQL, Nginx. Open 80/443 only. On CentOS: `setsebool -P httpd_can_network_connect 1`.

Local / Docker / CI: [DEPLOYMENT.md](DEPLOYMENT.md).
