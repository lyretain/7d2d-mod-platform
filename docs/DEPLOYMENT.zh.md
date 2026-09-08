# 部署指南

[English](DEPLOYMENT.md) · [简体中文](DEPLOYMENT.zh.md)

最后更新：2026-09-08。

| 场景 | 去哪 |
|---|---|
| **Linux / 宝塔上线** | [LINUX.zh.md](LINUX.zh.md) |
| Windows 本机开发 | 下面第一节 |
| Docker | 第二节 |
| 自动发 GitHub Release | 第四节 |

应急：[RUNBOOK.zh.md](RUNBOOK.zh.md)。CDN：[CLOUDFLARE.zh.md](CLOUDFLARE.zh.md)。

单机可不设 `DATABASE_URL`（JSON + `data/objects/`）。生产建议本机 PostgreSQL + 本地文件，`S3_*` 留空。多实例才需要共享库和 S3。

## 一、本机（Windows）

需要 Node.js 22。

```powershell
cd A:\GameMod\7d2d-mod-platform
npm --prefix apps/web install
$env:ADMIN_TOKEN = "至少16位随机令牌"
$env:PUBLIC_BASE_URL = "http://localhost:8080"
npm run start:ui
```

打开 `http://127.0.0.1:8080`。没有 `apps/web/dist` 时首页会回退旧页，生产必须先 `npm run build:web`。

热更新（不替代生产构建）：一个终端 `npm run dev`，另一个 `npm run dev:web`，浏览器开 Vite `http://localhost:5173`。

生产不要用 `start:ui`。Linux 上用宝塔 / systemd 注入变量，不要只放一个没人读的 `.env`。

## 二、Docker

```powershell
copy .env.example .env
# 改 ADMIN_TOKEN、PUBLIC_BASE_URL
docker compose up --build -d
```

数据在卷 `mod-platform-data`。完整栈（Postgres + MinIO）：`docker compose --profile full up --build -d`。

## 三、环境变量（常用）

| 变量 | 说明 |
|---|---|
| `HOST` / `PORT` | 生产用 `127.0.0.1` / `8080` |
| `PUBLIC_BASE_URL` | 最终 HTTPS 域名，和 `PUBLIC_LAUNCHER_URL`、`PUBLIC_CDN_URL` 一致 |
| `ADMIN_TOKEN` | 首次 `/setup`，≥16 位 |
| `ALLOW_BOOTSTRAP_ADMIN` | 保持 `false` |
| `DATA_DIR` | 数据和 Mod 文件 |
| `DATABASE_URL` | PostgreSQL；空则 JSON |
| `SIGNING_PRIVATE_KEY` | 生产必填 |
| `FORCE_HTTPS` / `TRUSTED_PROXY` | Nginx 终止 HTTPS 时都为 `true` |
| `S3_*` | 单机留空 |

整站反代到 `8080`，不要只反代 `/api`。

打开域名 → `/setup` → 建管理员 → 工坊上传 Mod → 发布 Pack → `/servers` 登记专用服。

## 四、GitHub Actions

`main` 上 **插件版本号变化**（`project-versions.json` 的 `pluginVersion` 或 `plugins/*/ModInfo.xml`），或手动 `workflow_dispatch`，才会编译并建 GitHub Release（只含插件 ZIP）。

只要出 Release：仓库 Actions 权限设为可写，bump 版本后推 `main`。`GITHUB_TOKEN` 不用自建。

还要传到管理平台时，在仓库 Secrets 加：

- `PLATFORM_BASE_URL`（公网域名，不要填 IP）
- `PLATFORM_USERNAME` + `PLATFORM_PASSWORD`（超级管理员，**不要开 TOTP**），或 `PLATFORM_TOKEN`

可选 Variables：`PLATFORM_PACK_ID`、`PLATFORM_ORIGIN_IP`（绕过 Cloudflare）。SteamCMD 拉游戏引用失败时再加 Secret `GAME_MANAGED_URL`。
