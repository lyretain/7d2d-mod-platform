# 部署指南

[English](DEPLOYMENT.md) · [简体中文](DEPLOYMENT.zh-CN.md)

最后更新：2026-08-17。管理后台已拆成 `apps/web` Vue SPA；API 仍是零运行时依赖。

## 一、部署模式

当前版本支持两种模式：

- 单节点：不设 `DATABASE_URL` 时使用 JSON 文件，对象存在 `data/objects/`。
- 生产：设置 `DATABASE_URL`、S3/MinIO 和 `SIGNING_PRIVATE_KEY` 或 `SIGNING_SERVICE_URL`。多实例必须走 PostgreSQL 和共享对象存储。

完整应急步骤见 [RUNBOOK.zh-CN.md](RUNBOOK.zh-CN.md)（[English](RUNBOOK.md)）。Cloudflare CDN / R2 见 [CLOUDFLARE.zh-CN.md](CLOUDFLARE.zh-CN.md)（[English](CLOUDFLARE.md)）。

## 二、后台前端

| 路径 | 行为 |
|---|---|
| `/` 以及 `/setup` `/signin` `/workshop` `/mods` `/packs` `/servers` `/ops` `/account` | 有 `apps/web/dist` 时托管 Vue SPA（含 history fallback） |
| `/assets/*` | SPA 静态资源（带哈希，可长期缓存） |
| `/admin-i18n.js` | 中英文案，不复制进前端仓库 |
| `/legacy` | 始终返回内嵌旧页 `apps/api/src/admin.html` |
| `/guide` | 玩家与服主教程（`?lang=en` 为英文） |

没有 `apps/web/dist/index.html` 时，`GET /` 回退旧页，API 与测试不依赖前端构建。对外生产应先构建前端，不要把回退页当正式后台。

## 三、直接运行（裸机 / 现有 Node 进程）

要求：Node.js 22 或更高版本。

本机一条命令（构建 Vue、启动 API、打开浏览器；不跑 Vite）：

```powershell
cd A:\GameMod\7d2d-mod-platform
npm --prefix apps/web install
$env:ADMIN_TOKEN = "使用密码管理器生成的长随机令牌"
$env:PUBLIC_BASE_URL = "http://localhost:8080"
npm run start:ui
```

生产裸机（不自动开浏览器）：

```powershell
cd A:\GameMod\7d2d-mod-platform
npm --prefix apps/web install
npm run build:web

$env:HOST = "0.0.0.0"
$env:PORT = "8080"
$env:PUBLIC_BASE_URL = "https://mods.aic.la"
$env:ADMIN_TOKEN = "使用密码管理器生成的长随机令牌"
$env:NODE_ENV = "production"
node apps/api/src/server.js
```

开发联调（热更新，不替代生产构建）：

```powershell
# 终端 1
$env:ADMIN_TOKEN = "..."
$env:PUBLIC_BASE_URL = "http://localhost:8080"
npm run dev

# 终端 2
npm run dev:web
```

浏览器打开 Vite 的 `http://localhost:5173`。`/api`、`/status`、`/guide`、`/admin-i18n.js`、`/health` 会代理到 8080。

重要环境变量：

| 变量 | 用途 |
|---|---|
| `HOST` | API 监听地址 |
| `PORT` | API 端口 |
| `PUBLIC_BASE_URL` | manifest 中使用的公网 HTTPS 地址 |
| `ADMIN_TOKEN` | 首次初始化令牌，至少 16 位 |
| `GITHUB_CLIENT_ID` | 社区管理员 GitHub OAuth 应用 ID |
| `GITHUB_CLIENT_SECRET` | 社区管理员 GitHub OAuth 应用密钥 |
| `ALLOW_BOOTSTRAP_ADMIN` | 首个用户注册后是否继续允许 `ADMIN_TOKEN` 登录，默认 `false` |
| `DATA_DIR` | 数据、Mod 文件、运行日志和开发签名密钥目录 |
| `LOG_RETENTION_DAYS` | 运行日志保留天数，一天一个文件，默认且最多 30 天 |
| `AUDIT_RETENTION_DAYS` | 审计保留天数；`0`（默认）永久保留所有写操作 |
| `SIGNING_PRIVATE_KEY` | Base64 PKCS#8 Ed25519 私钥；生产环境必须提供，或改用 `SIGNING_SERVICE_URL` |
| `SIGNING_SERVICE_URL` | 独立签名服务。设置后应用进程不持有私钥 |
| `DATABASE_URL` | PostgreSQL 连接串；为空则继续使用 JSON |
| `PUBLIC_CDN_URL` | 写入 manifest 的对象下载根地址 |
| `FORCE_HTTPS` | 在可信代理后将 HTTP 永久重定向到 HTTPS，并启用 HSTS |
| `TRUSTED_PROXY` | 仅在此时信任 `X-Forwarded-For` / `CF-Connecting-IP` |
| `REQUIRE_REVIEW` | 生产默认开启：未审核且未确认许可证的 Mod 不能发布 |
| `ALERT_WEBHOOK_URL` | 停发、崩溃率熔断等告警 |
| `S3_*` | 可选对象存储。未配置时只写本地 |
| `MAX_ARTIFACT_BYTES` | 单个 Mod ZIP 最大字节数 |
| `MAX_DIAGNOSTIC_BYTES` | 单条诊断请求最大字节数 |

`NODE_ENV=production` 时禁止自动生成开发密钥，且默认关闭引导管理员令牌。JSON 单节点可执行：

```powershell
node deploy/migrate-json-to-pg.js .\data\state\database.json $env:DATABASE_URL
```

完整基础设施可用：

```powershell
docker compose --profile full up --build -d
```

## 四、Docker Compose

镜像构建阶段会执行 `npm --prefix apps/web install` 与 `npm run build:web`，再删掉 `apps/web/node_modules`。运行时容器只启动 `node apps/api/src/server.js`，不需要再装前端依赖。

1. 复制 `.env.example` 为 `.env`。
2. 修改 `ADMIN_TOKEN` 和 `PUBLIC_BASE_URL`。
3. 确保 Docker Desktop 已启动。
4. 执行：

```powershell
cd A:\GameMod\7d2d-mod-platform
docker compose up --build -d
docker compose ps
```

健康检查：

```powershell
Invoke-RestMethod http://localhost:8080/health
Invoke-RestMethod http://localhost:8080/health/ready
```

打开 `http://localhost:8080` 应为 Vue 后台（页面含 `#app`）。应急旧页：`http://localhost:8080/legacy`。

数据保存在 Docker 命名卷 `mod-platform-data`。升级或迁移前必须备份该卷。

## 五、升级现有实例

升级前先备份 `data/`（或 Postgres / 对象存储）和 `.env`。

裸机：

```powershell
git pull
npm --prefix apps/web install
npm run build:web
# 按原方式重启 API 进程，例如：
node apps/api/src/server.js
```

Docker：

```powershell
git pull
docker compose up --build -d
```

验收：

- `GET /health`、`GET /health/ready` 为 200；
- `GET /` 返回新后台（`id="app"`），不要只看到旧网格页；
- `GET /legacy` 仍能打开旧页；
- `GET /admin-i18n.js` 为 JavaScript；
- 登录后工坊、Pack、服务器、运维页可用。

蓝绿切流见 [RUNBOOK.zh-CN.md](RUNBOOK.zh-CN.md)。多实例禁止共享同一份 JSON 文件。

## 六、HTTPS 与反向代理

对外服务必须使用 HTTPS。把**整站**反代到 Node `8080`，由 API 做 SPA fallback，不要只转发 `/api`。

反向代理至少需要：

- 将 `/`、`/assets/*`、`/admin-i18n.js`、`/legacy`、`/guide`、`/status`、`/health` 和 `/api/v1/*` 都转到后台；
- 保留真实请求协议和主机信息（`X-Forwarded-Proto` / `X-Forwarded-Host`）；
- HTML、`/admin-i18n.js`、`/api/v1/auth/*`、`/api/v1/admin/*` 禁止缓存；
- `/assets/*` 可按文件名哈希长期缓存；
- 对诊断接口进行 IP/服务器级限流；
- 为上传接口设置合理的请求体上限和超时；
- 为哈希命名的 Mod 文件启用长期缓存；
- 禁止目录列表；
- 记录管理员接口失败登录。

`PUBLIC_BASE_URL` 必须填写最终公网地址，否则发布的 manifest 会包含无法访问的下载链接。

## 七、后台使用顺序

1. 未初始化时打开 `/` 会进入 `/setup`。填写 `ADMIN_TOKEN` 和首位管理员账户。
2. 完成后进入 `/workshop`，引导令牌默认失效。
3. 之后未登录访客看到 `/signin`（登录 / 邀请码注册），不再露出 `ADMIN_TOKEN`。
4. 已登录超级管理员可在 `/account` 邀请社区管理员；社区管理员绑定 GitHub 后可邀请开发者。普通用户开放注册。
5. 有 `catalog.write` 的角色到 `/mods` 上传 ZIP，获得 SHA-256。
6. 登记 Mod 版本，填写游戏版本（例如 `3.1.0`）和 ZIP 顶层目录。
7. 标记是否包含 DLL、是否需要重启，并确认再分发许可。
8. 在工坊挑选或到 `/packs` 创建 Pack，并发布不可变 Release。
9. 在 `/servers` 登记专用服并绑定已发布 Pack；`server.config.json` 里的令牌只显示一次。
10. 运维在 `/ops` 看统计、审核、审计，发布启动器自更新包；超级管理员和社区管理员可在此页做全平台紧急停发。

侧栏按 `permissions` 隐藏：无 `catalog.write` 看不到 Mod 页，无 `ops.read` 看不到运维。全平台紧急停发只在运维页，且仅超级管理员和社区管理员可见。

## 八、备份和恢复

至少备份：

- `data/state/database.json`
- `data/state/dev-signing-key.pk8`，如果仍在使用开发密钥
- `data/objects/` 中的所有 Mod 文件
- `data/logs/` 中的按日运行日志（最多保留 30 天，不替代审计日志）
- 反向代理和环境变量配置
- 若用 Docker：命名卷 `mod-platform-data`（以及 full profile 下的 Postgres / MinIO 卷）

`apps/web/dist` 可由源码重新构建，不必单独备份。恢复时必须同时恢复数据库、对象文件和原签名私钥。只恢复数据库但更换私钥，会导致客户端拒绝以前签名的 manifest。

## 九、上线检查

- HTTPS 证书有效；
- 公网地址与 `PUBLIC_BASE_URL` 一致；
- 已执行 `npm run build:web`，或 Docker 镜像构建成功且 `GET /` 为 Vue 后台；
- `/legacy` 可作应急，但不要作为对外入口；
- 管理令牌足够长且未写入代码仓库；
- 已注册正式管理员账户，且 `ALLOW_BOOTSTRAP_ADMIN=false`；
- 签名私钥已备份或托管到 KMS；
- 上传 DLL 已进行恶意文件扫描和人工审核；
- 已配置下载、诊断和登录限流；
- 已取得所有托管 Mod 的再分发许可；
- 客户端更新器使用固定公钥；
- 已进行恢复演练；
- 已在目标七日杀版本上测试客户端和服务端插件；
- 若希望 CI 自动上传插件 ZIP，已配置 GitHub Actions 密钥。

## 十、GitHub Actions

`.github/workflows/ci.yml` 在每次 push 和 pull request 上跑 `npm test`。`main`（以及手动 `workflow_dispatch`）还会在 Windows 任务里：

1. 缓存 7DTD 引用程序集（缓存未命中时用 SteamCMD 拉专用服）
2. 编译客户端/服务端插件和便携启动器
3. 打包 `ModPlatformClient` / `ModPlatformServer`，并上传为 GitHub Actions artifacts
4. 若配置了仓库密钥，则把 ZIP 上传到管理平台、自动通过平台插件审核、登记 `mod-platform-client` / `mod-platform-server`、发布启动器自更新，并可选写入 Pack Release

仓库 **secrets**：

| 密钥 | 用途 |
|---|---|
| `PLATFORM_BASE_URL` | API 地址，默认 `https://mods.aic.la` |
| `PLATFORM_TOKEN` | 超级管理员会话令牌（也可用用户名密码） |
| `PLATFORM_USERNAME` | 超级管理员登录名；该账户不能开 TOTP |
| `PLATFORM_PASSWORD` | 超级管理员密码 |

仓库 **variables**（可选）：

| 变量 | 用途 |
|---|---|
| `PLATFORM_PACK_ID` | 若填写，CI 会更新该 Pack 并发布 Release |
| `PLATFORM_PACK_NAME` | 新建该 Pack 时用的名称 |
| `PLATFORM_GAME_VERSION` | 默认 `3.10.14` |
| `PLATFORM_PUBLISH_LAUNCHER` | 设为 `false` 则不发布启动器自更新 |
| `STEAM_BUILD_ID` | 缓存键，默认 `24436778` |

CI 账户必须是超级管理员（`platform.manage`）。本地等价命令：

```powershell
npm run publish-platform -- --pack-only
$env:PLATFORM_BASE_URL = "https://mods.aic.la"
$env:PLATFORM_USERNAME = "ci-bot"
$env:PLATFORM_PASSWORD = "..."
npm run publish-platform
```
