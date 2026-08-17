# Hordepin

[English](README.md) · 简体中文 · [MIT 许可证](LICENSE)

**Hordepin** 是七日杀（7 Days to Die）Mod 的分发与同步平台：服主发布已签名的 ModPack，玩家进服后自动下载并与服务器保持同一套模组。名字取 horde（尸潮）与 pin（钉死）：平台公钥 TOFU 钉死，进服握手再把玩家钉在当前 Pack 上。

插件目录和程序集仍叫 `ModPlatform*`，已安装的服不必改文件夹名。

当前插件已针对七日杀 `V 3.1.0`、Steam Build `24436778` 重新编译，并已通过 Windows 客户端与 Windows 专用服务器真实进服验证。本地主机模式和 Linux 专用服务器仍待验证。权威版本信息见 [`project-versions.json`](project-versions.json)。

## 已实现功能

- 浏览器管理页面（`apps/web` Vue 后台；无构建产物时回退内嵌页，`/legacy` 保留旧页）
- 邀请码注册、账户登录和角色权限
- 一次性/限次邀请码、有效期和管理员吊销
- Mod ZIP 上传和版本登记
- SHA-256 内容寻址与完整性校验
- ModPack 创建、发布和不可变版本管理
- Ed25519 manifest 签名
- 游戏服务器注册和服务器地址解析
- 客户端 Mod 差异检查、下载和安装
- ZIP 路径穿越、解压炸弹、重复路径和符号链接防护
- 暂存安装、受管目录检查、备份和失败回滚
- 客户端与服务端故障收集
- 日志脱敏、故障指纹和重复问题聚合
- 游戏外部守护程序，用于收集插件加载前发生的崩溃
- 七日杀客户端和服务端插件源码及已编译 DLL
- Docker Compose 部署配置

## 项目目录

```text
apps/api/                 云端 API 与旧管理页
apps/web/                 Vue 3 运营后台
apps/updater/             客户端安全更新器
apps/agent/               游戏进程守护与故障上报
plugins/client/           七日杀客户端插件源码
plugins/server/           七日杀服务端插件源码
plugins/shared/           插件共享协议代码
artifacts/plugins/        已编译的客户端和服务端插件包
deploy/                   部署及构建脚本
docs/                     中英双语：协议、API、安全、部署与教程
data/                     单节点元数据、签名密钥和 Mod 文件
```

## 快速启动后台

需要 Node.js 22 或更高版本。不必再单独开 Vite：先装一次前端依赖，然后一条命令构建 Vue、启动 API 并打开浏览器。

```powershell
cd A:\GameMod\7d2d-mod-platform
npm --prefix apps/web install
$env:ADMIN_TOKEN = "替换为至少16位的随机管理令牌"
$env:PUBLIC_BASE_URL = "http://localhost:8080"
npm run start:ui
```

`start:ui` 会执行 `build:web`，API 在 `http://127.0.0.1:8080` 直接托管 `apps/web/dist`。已有 `dist` 时也可只跑 `npm start`，打开同一地址即为 Vue 后台。应急旧页：`/legacy`。

只改前端、需要热更新时才用 Vite（`/api` 代理到 8080）：

```powershell
npm run dev
npm run dev:web
```

完整步骤见 [部署指南](docs/DEPLOYMENT.zh.md)（[English](docs/DEPLOYMENT.md)）。

首次部署流程：

1. 打开首页，在初始化页填写 `ADMIN_TOKEN` 和首位管理员账户；
2. 完成后进入运营后台，引导令牌默认失效；
3. 之后首页变为社区登录与邀请码注册；
4. 邀请其他服主或只读成员；
5. 上传 Mod ZIP；
6. 登记 Mod ID、版本和兼容的游戏版本；
7. 创建并发布带 Ed25519 签名的 ModPack。

首个用户注册后，`ADMIN_TOKEN` 默认停止作为后台身份使用。只有设置 `ALLOW_BOOTSTRAP_ADMIN=true` 才能继续使用它，建议仅在账户恢复时临时启用。

玩家进服与服主登记服务器，参见 [玩家与服主教程](docs/USER.zh.md)（[English](docs/USER.md)）。线上也可打开 `https://mods.aic.la/guide` 或 `https://mods.aic.la/guide?lang=en`，安装与官方下载见 `https://mods.aic.la/about`，CI 编译的客户端/服务端插件见 [GitHub Releases](https://github.com/lyretain/7d2d-mod-platform/releases)。

## 客户端同步

通过 ModPack ID 同步：

```powershell
node apps/updater/src/cli.js `
  --base-url https://mods.aic.la `
  --pack-id production-pack `
  --mods-dir "$env:APPDATA\7DaysToDie\Mods"
```

通过已登记的服务器地址同步：

```powershell
node apps/updater/src/cli.js `
  --base-url https://mods.aic.la `
  --server-address game.example.com:26900 `
  --mods-dir "$env:APPDATA\7DaysToDie\Mods"
```

玩家启动器（发现游戏目录、展示差异、同步、启动并重连）：

```powershell
npm run launcher -- join --base-url https://mods.aic.la --address game.example.com:26900
```

便携包（目录内自带 node.exe，玩家不必先装 Node）。脚本会额外打出带 SHA-256 的 ZIP，供后台发布启动器自更新：

```powershell
.\deploy\build-launcher.ps1
```

便携启动器在同步 Pack 前会检查 `GET /api/v1/public/launcher/latest`，只在 Ed25519 签名和文件哈希都通过后替换自身。

第一次连接时，更新器会保存平台公钥。以后如果公钥发生变化，更新器会停止安装并要求管理员确认。生产环境建议使用 `--public-key` 显式指定可信公钥。

## 插件包

已编译包位于：

```text
artifacts/plugins/ModPlatformClient
artifacts/plugins/ModPlatformServer
```

插件编译和安装参见 [插件构建与安装指南](docs/PLUGIN.zh.md)（[English](docs/PLUGIN.md)）。在 `main` 上更新插件版本号后，`.github/workflows/ci.yml` 才会重新编译并上传到管理平台；密钥见 [部署](docs/DEPLOYMENT.zh.md#10-github-actions)。

## 故障守护程序

复制并修改配置：

```text
deploy/guardian.config.example.json
```

然后运行：

```powershell
node apps/agent/src/guardian.js --config deploy/guardian.config.json
```

守护程序会启动游戏或专用服务器，记录运行会话，并在异常退出时上传退出码和经过限制的日志尾部。后台还会再次执行日志脱敏。

## 测试

```powershell
cd 7d2d-mod-platform
npm --prefix apps/web ci
npm run check
npm run build:web
```

当前测试覆盖：

- manifest 签名和篡改拒绝
- ModPack 发布
- 客户端完整下载和安装
- SHA-256 与 ZIP CRC 校验
- ZIP 路径穿越防护
- Windows 大小写重复路径防护
- 故障日志脱敏与聚合
- Release 吊销、回滚、紧急停发和握手策略

## 当前边界

- 当前定位是社区自托管平台，不是多租户公共 Mod 市场；多实例部署必须使用 PostgreSQL 和共享对象存储。
- 可靠流程是启动器在进入游戏前完成同步。
- 游戏内握手已在 Windows 客户端与专用服务器通过真实进服验证；本地主机模式和 Linux 专用服务器仍待验证。
- 带 DLL/Harmony 的 Mod 通常需要关闭 EAC，并在安装后重启游戏。
- Docker CLI 已安装，但部署前需要确保 Docker Desktop 后台正在运行。
- 对外开放前必须实际启用并验收 HTTPS、限流、恶意文件扫描、正式密钥管理和备份恢复流程。

## 引用与致谢

本仓库是原创业务代码。下列项目被依赖、编译引用或仅借鉴布局。游戏程序集只在本机编译插件时引用，不会打进 git。

| 项目 | 用途 | 许可 |
|---|---|---|
| [七日杀](https://7daystodie.com/)（The Fun Pimps） | 目标游戏；插件编译引用 | 专有，不包含在本仓库 |
| [Unity](https://unity.com/) | 编译插件所需的引擎程序集 | 专有；`Private=false`，不拷贝进仓库 |
| [Node.js](https://nodejs.org/) | API、更新器、启动器、守护进程运行时 | MIT |
| [Vue 3](https://vuejs.org/) / [Vue Router](https://router.vuejs.org/) | 管理后台 SPA | MIT |
| [Vite](https://vite.dev/) | 前端构建 | MIT |
| [Tailwind CSS](https://tailwindcss.com/) | 后台样式 | MIT |
| [lucide-vue-next](https://lucide.dev/) | 侧栏图标 | ISC |
| [TailAdmin Vue](https://github.com/TailAdmin/vue-tailwind-admin-dashboard)（社区版） | 只借鉴侧栏/顶栏/卡片布局，未拷贝 Pro 演示页和图表库 | 社区版 MIT |
| [Docker](https://www.docker.com/) / Compose | 可选部署 | Engine 为 Apache-2.0 |
| [PostgreSQL](https://www.postgresql.org/) / [MinIO](https://min.io/) | 可选生产存储 | PostgreSQL / MinIO 服务端 AGPL-3.0 |
| [Cloudflare](https://www.cloudflare.com/) | 可选 CDN / R2 | 服务条款 |
| [GitHub](https://github.com/) | 可选社区管理员 OAuth | 服务条款 |

只有使用 Compose 的 `full` profile 才会拉取 MinIO 镜像。本仓库不内嵌 MinIO 源码。

## 开源协议与商业化

版权 © 2026 Lyretain。赞助：[AICOCLOUD](https://aicocloud.com/)。

本软件以 [MIT License](LICENSE) 发布。**就本仓库自己的源码而言**，你可以自由使用、修改、托管和出售副本（包括闭源二次开发），只需保留版权与许可声明。

这**不等于**「围绕七日杀做生意一定合法」。还要单独看这些边界：

1. **本仓库代码（MIT）** — 自己部署、卖技术支持、卖托管、甚至把这份代码闭源改装后再卖，许可证都允许。
2. **七日杀本体** — 游戏、DLL、美术和商标归 The Fun Pimps。不要分发 `Assembly-CSharp.dll` 等游戏文件。若要收费（卖 Mod、卖服、做公共市场），先读他们的 EULA / Allocation 条款。
3. **他人制作的 Mod** — 每个 ZIP 都需要作者的再分发授权。后台「确认许可证」只是运营开关，不能代替授权。转售别人的 Mod 通常要有明确的商业授权。
4. **上表依赖** — Vue、Vite、Tailwind、Lucide、TailAdmin 社区版都是宽松许可。不要拷贝 TailAdmin Pro 资源。若自建 MinIO，遵守 MinIO 自己的协议。

以上不是法律意见。若计划向玩家收费或大规模分发第三方 Mod，应请律师核对 Fun Pimps 条款和与 Mod 作者的合同。

## 进一步阅读

索引：[docs/README.zh.md](docs/README.zh.md)

- [玩家与服主教程](docs/USER.zh.md) · [English](docs/USER.md)
- [部署指南](docs/DEPLOYMENT.zh.md) · [English](docs/DEPLOYMENT.md)
- [插件构建与安装](docs/PLUGIN.zh.md) · [English](docs/PLUGIN.md)
- [生产运维 Runbook](docs/RUNBOOK.zh.md) · [English](docs/RUNBOOK.md)
- [Cloudflare CDN](docs/CLOUDFLARE.zh.md) · [English](docs/CLOUDFLARE.md)
- [生产环境 TODO](docs/PRODUCTION-TODO.zh.md) · [English](docs/PRODUCTION-TODO.md)
- [API 说明](docs/API.zh.md) · [English](docs/API.md)
- [安全说明](docs/SECURITY.zh.md) · [English](docs/SECURITY.md)
- [协议 v1](docs/PROTOCOL.zh.md) · [English](docs/PROTOCOL.md)

## 参与社区

- [贡献指南](CONTRIBUTING.md)
- [行为准则](CODE_OF_CONDUCT.md)
- [支持说明](SUPPORT.md)
- [安全漏洞报告](SECURITY.md)
- [项目治理](GOVERNANCE.md)
