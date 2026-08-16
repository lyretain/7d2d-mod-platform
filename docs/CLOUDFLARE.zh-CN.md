# Cloudflare CDN 部署

推荐拓扑：玩家下载走 Cloudflare，后台源站只处理管理、签名、诊断和缓存未命中。

```
玩家 / 启动器
    │
    ▼
Cloudflare（HTTPS、WAF、缓存）
    │
    ├─ cdn.example.com  →  R2 自定义域名（可选，CDN_STYLE=r2）
    └─ mods.example.com →  源站 Node API（管理、manifest、诊断）
```

## 域名

| 主机 | 用途 | 代理 |
|---|---|---|
| `mods.example.com` | API、管理页、latest manifest | 橙色云 |
| `admin.example.com` | 可选，仅管理后台。设置 `ADMIN_HOST` | 橙色云 |
| `cdn.example.com` | 不可变 ZIP。R2 自定义域名或回源 `/api/v1/public/artifacts/*` | 橙色云 |

源站环境变量：

```
PUBLIC_BASE_URL=https://mods.example.com
PUBLIC_CDN_URL=https://cdn.example.com
CDN_STYLE=origin
FORCE_HTTPS=true
TRUSTED_PROXY=true
CF_ZONE_ID=...
CF_API_TOKEN=...
```

`TRUSTED_PROXY=true` 后，真实 IP 优先取 `CF-Connecting-IP`。

## 缓存规则

在 Cloudflare Dashboard → Caching → Cache Rules：

1. **Artifacts**：路径 `*/api/v1/public/artifacts/*` 或 `cdn.example.com/objects/*`  
   Eligible for cache，Edge TTL 尊重源站。源站已发送 `Cache-Control` / `CDN-Cache-Control: public, max-age=31536000, immutable`。
2. **Manifest**：`*/api/v1/public/packs/*/latest`  
   Edge TTL 30 秒。吊销或回滚后后台会调用 Purge。
3. **管理与登录**：`/api/v1/auth/*`、`/api/v1/admin/*`、`/`  
   Bypass cache。

SSL/TLS 使用 Full (strict)，源站证书可用 Origin CA。

## Cloudflare R2（推荐中大规模）

1. 创建 bucket，例如 `modplatform-objects`，开启对象版本。
2. 创建 R2 API Token（Object Read & Write）。
3. 为 bucket 绑定自定义域名 `cdn.example.com`。
4. 源站配置：

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

manifest 中的下载地址会变成 `https://cdn.example.com/objects/<sha256>`。哈希封禁和 GC 会请求 Cloudflare 刷新这些 URL。

## WAF 与安全

- 对 `/api/v1/auth/login`、`/api/v1/auth/register`、`/api/v1/diagnostics` 加托管规则 + 速率限制。
- 管理主机 `admin.example.com` 可再加 IP Access 或 Zero Trust。
- 源站只允许 Cloudflare IP，或用 Authenticated Origin Pulls。

## 流量估算要点

首次进服下载整包；之后只拉变更文件。Cloudflare 命中后源站带宽接近于上传和管理流量。详见仓库旁的后台配置估算画布。
