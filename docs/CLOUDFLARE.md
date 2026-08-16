# Cloudflare CDN

[English](CLOUDFLARE.md) · [简体中文](CLOUDFLARE.zh-CN.md)

Recommended topology: player downloads go through Cloudflare. The origin only handles admin, signing, diagnostics, and cache misses.

```
Players / launcher
    │
    ▼
Cloudflare (HTTPS, WAF, cache)
    │
    ├─ cdn.example.com  →  R2 custom domain (optional, CDN_STYLE=r2)
    └─ mods.aic.la →  origin Node API (admin, manifests, diagnostics)
```

## Hosts

| Host | Purpose | Proxy |
|---|---|---|
| `mods.aic.la` | API, admin, latest manifest | orange cloud |
| `admin.example.com` | Optional admin-only host. Set `ADMIN_HOST` | orange cloud |
| `cdn.example.com` | Immutable ZIPs. R2 custom domain or origin `/api/v1/public/artifacts/*` | orange cloud |

Origin environment:

```
PUBLIC_BASE_URL=https://mods.aic.la
PUBLIC_CDN_URL=https://cdn.example.com
CDN_STYLE=origin
FORCE_HTTPS=true
TRUSTED_PROXY=true
CF_ZONE_ID=...
CF_API_TOKEN=...
```

With `TRUSTED_PROXY=true`, the real IP prefers `CF-Connecting-IP`.

## Cache rules

In Cloudflare Dashboard → Caching → Cache Rules:

1. **Artifacts**: path `*/api/v1/public/artifacts/*` or `cdn.example.com/objects/*`  
   Eligible for cache. Edge TTL respects origin. Origin already sends `Cache-Control` / `CDN-Cache-Control: public, max-age=31536000, immutable`.
2. **Manifest**: `*/api/v1/public/packs/*/latest`  
   Edge TTL 30 seconds. The API purges after revoke or rollback.
3. **Admin and auth**: `/api/v1/auth/*`, `/api/v1/admin/*`, `/`, `/setup`, `/signin`, `/workshop`, `/mods`, `/packs`, `/servers`, `/ops`, `/account`, `/legacy`, `/admin-i18n.js`  
   Bypass cache.
4. **Console assets**: `/assets/*`  
   Eligible for cache. Long Edge TTL is fine (content-hashed names).

SSL/TLS: Full (strict). Origin can use an Origin CA certificate.

## Cloudflare R2 (recommended at medium scale)

1. Create a bucket, for example `modplatform-objects`, with object versioning.
2. Create an R2 API token (Object Read & Write).
3. Bind custom domain `cdn.example.com` to the bucket.
4. Origin config:

```
S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=modplatform-objects
S3_ACCESS_KEY=...
S3_SECRET_KEY=...
S3_PREFIX=objects/
CDN_STYLE=r2
PUBLIC_CDN_URL=https://cdn.example.com
```

Manifest download URLs become `https://cdn.example.com/objects/<sha256>`. Hash bans and GC ask Cloudflare to purge those URLs.

## WAF and security

- Managed rules plus rate limits on `/api/v1/auth/login`, `/api/v1/auth/register`, `/api/v1/diagnostics`.
- Admin host `admin.example.com` can add IP Access or Zero Trust.
- Allow only Cloudflare IPs to the origin, or use Authenticated Origin Pulls.
- Free/Pro plans cap a single upload at 100 MB. The admin UI chunks ZIP files larger than 8 MiB (8 MiB each). Player downloads are not affected.

## Traffic notes

The first join downloads the full pack; later joins only fetch changed files. After Cloudflare hits, origin bandwidth is mostly uploads and admin traffic.
