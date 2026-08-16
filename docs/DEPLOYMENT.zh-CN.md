# 中文部署指南

## 一、部署模式

当前版本支持两种模式：

- 单节点：不设 `DATABASE_URL` 时使用 JSON 文件，对象存在 `data/objects/`。
- 生产：设置 `DATABASE_URL`、S3/MinIO 和 `SIGNING_PRIVATE_KEY` 或 `SIGNING_SERVICE_URL`。多实例必须走 PostgreSQL 和共享对象存储。

完整应急步骤见 `docs/RUNBOOK.zh-CN.md`。Cloudflare CDN / R2 见 `docs/CLOUDFLARE.zh-CN.md`。

## 二、直接运行

要求：Node.js 22 或更高版本。

```powershell
cd E:\Project
$env:HOST = "0.0.0.0"
$env:PORT = "8080"
$env:PUBLIC_BASE_URL = "https://mods.example.com"
$env:ADMIN_TOKEN = "使用密码管理器生成的长随机令牌"
node apps/api/src/server.js
```

重要环境变量：

| 变量 | 用途 |
|---|---|
| `HOST` | API 监听地址 |
| `PORT` | API 端口 |
| `PUBLIC_BASE_URL` | manifest 中使用的公网 HTTPS 地址 |
| `ADMIN_TOKEN` | 后台管理员令牌，至少 16 位 |
| `GITHUB_CLIENT_ID` | 社区管理员 GitHub OAuth 应用 ID |
| `GITHUB_CLIENT_SECRET` | 社区管理员 GitHub OAuth 应用密钥 |
| `ALLOW_BOOTSTRAP_ADMIN` | 首个用户注册后是否继续允许 `ADMIN_TOKEN` 登录，默认 `false` |
| `DATA_DIR` | 数据、Mod 文件、运行日志和开发签名密钥目录 |
| `LOG_RETENTION_DAYS` | 运行日志保留天数，一天一个文件，默认且最多 30 天 |
| `SIGNING_PRIVATE_KEY` | Base64 PKCS#8 Ed25519 私钥；生产环境必须提供，或改用 `SIGNING_SERVICE_URL` |
| `SIGNING_SERVICE_URL` | 独立签名服务。设置后应用进程不持有私钥 |
| `DATABASE_URL` | PostgreSQL 连接串；为空则继续使用 JSON |
| `PUBLIC_CDN_URL` | 写入 manifest 的对象下载根地址 |
| `FORCE_HTTPS` | 在可信代理后将 HTTP 永久重定向到 HTTPS，并启用 HSTS |
| `TRUSTED_PROXY` | 仅在此时信任 `X-Forwarded-For` |
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

## 三、Docker Compose

1. 复制 `.env.example` 为 `.env`。
2. 修改 `ADMIN_TOKEN` 和 `PUBLIC_BASE_URL`。
3. 确保 Docker Desktop 已启动。
4. 执行：

```powershell
cd E:\Project
docker compose up --build -d
docker compose ps
```

健康检查：

```powershell
Invoke-RestMethod http://localhost:8080/health
```

数据保存在 Docker 命名卷 `mod-platform-data`。升级或迁移前必须备份该卷。

## 四、HTTPS 与反向代理

对外服务必须使用 HTTPS。反向代理至少需要：

- 将请求转发到后台 `8080` 端口；
- 保留真实请求协议和主机信息；
- 对诊断接口进行 IP/服务器级限流；
- 为上传接口设置合理的请求体上限和超时；
- 为哈希命名的 Mod 文件启用长期缓存；
- 禁止目录列表；
- 记录管理员接口失败登录。

`PUBLIC_BASE_URL` 必须填写最终公网地址，否则发布的 manifest 会包含无法访问的下载链接。

## 五、后台使用顺序

1. 未初始化时首页只显示初始化页。填写 `ADMIN_TOKEN` 和首位管理员账户。
2. 完成后自动登录运营后台，引导令牌默认失效。
3. 之后访客看到的是社区登录/邀请码注册页，不再露出 `ADMIN_TOKEN`。
4. 已登录超级管理员可邀请社区管理员；社区管理员绑定 GitHub 后可邀请开发者。普通用户开放注册。
5. 上传 ZIP，获得 SHA-256。
6. 注册 Mod 版本。
7. 填写支持的游戏版本，例如 `3.0.1-b4`。
8. 填写 ZIP 顶层安装目录，例如 `ExampleVehicles`。
9. 标记是否包含 DLL、是否需要重启。
10. 创建 ModPack 草稿并发布不可变 release。
11. 通过 API 注册游戏服务器并绑定 ModPack。
12. 保存服务器注册接口只返回一次的令牌。

管理员可以创建 `admin` 或 `viewer` 邀请码，并设置 1–100 次使用次数及最长一年的有效期。邀请码原文只在创建时返回一次，后台只保存其 SHA-256。

## 六、备份和恢复

至少备份：

- `data/state/database.json`
- `data/state/dev-signing-key.pk8`，如果仍在使用开发密钥
- `data/objects/` 中的所有 Mod 文件
- `data/logs/` 中的按日运行日志（最多保留 30 天，不替代审计日志）
- 反向代理和环境变量配置

恢复时必须同时恢复数据库、对象文件和原签名私钥。只恢复数据库但更换私钥，会导致客户端拒绝以前签名的 manifest。

## 七、上线检查

- HTTPS 证书有效；
- 公网地址与 `PUBLIC_BASE_URL` 一致；
- 管理令牌足够长且未写入代码仓库；
- 已注册正式管理员账户，且 `ALLOW_BOOTSTRAP_ADMIN=false`；
- 签名私钥已备份或托管到 KMS；
- 上传 DLL 已进行恶意文件扫描和人工审核；
- 已配置下载、诊断和登录限流；
- 已取得所有托管 Mod 的再分发许可；
- 客户端更新器使用固定公钥；
- 已进行恢复演练；
- 已在目标七日杀版本上测试客户端和服务端插件。
