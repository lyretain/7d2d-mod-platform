# 七日杀 Mod 分发与诊断平台

[English](README.md) · 简体中文

这是一个可部署的单节点 MVP，用于管理、签名、分发七日杀 ModPack，并收集客户端和服务端故障信息。

当前插件已针对七日杀 `V 3.10.14`、Steam Build `24436778` 重新编译。真实进服验证仍需在本机启动一次客户端和专用服务器。

## 已实现功能

- 浏览器管理页面
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
apps/api/                 云端 API 与管理页面
apps/updater/             客户端安全更新器
apps/agent/               游戏进程守护与故障上报
plugins/client/           七日杀客户端插件源码
plugins/server/           七日杀服务端插件源码
plugins/shared/           插件共享协议代码
artifacts/plugins/        已编译的客户端和服务端插件包
deploy/                   部署及构建脚本
docs/                     协议、API、安全和中文指南
data/                     单节点元数据、签名密钥和 Mod 文件
```

## 快速启动后台

需要 Node.js 22 或更高版本。

```powershell
cd E:\Project
$env:ADMIN_TOKEN = "替换为至少16位的随机管理令牌"
$env:PUBLIC_BASE_URL = "http://localhost:8080"
node apps/api/src/server.js
```

启动后访问：`http://localhost:8080`

首次部署流程：

1. 在“首次部署”区域输入 `ADMIN_TOKEN`；
2. 创建管理员邀请码；
3. 使用邀请码注册首个账户；
4. 使用用户名和密码登录；
5. 创建其他限次、有有效期的邀请码；
6. 上传 Mod ZIP；
7. 登记 Mod ID、版本和兼容的游戏版本；
8. 创建并发布带 Ed25519 签名的 ModPack。

首个用户注册后，`ADMIN_TOKEN` 默认停止作为后台身份使用。只有设置 `ALLOW_BOOTSTRAP_ADMIN=true` 才能继续使用它，建议仅在账户恢复时临时启用。

详细部署步骤参见 [中文部署指南](docs/DEPLOYMENT.zh-CN.md)。

## 客户端同步

通过 ModPack ID 同步：

```powershell
node apps/updater/src/cli.js `
  --base-url https://mods.example.com `
  --pack-id production-pack `
  --mods-dir "$env:APPDATA\7DaysToDie\Mods"
```

通过已登记的服务器地址同步：

```powershell
node apps/updater/src/cli.js `
  --base-url https://mods.example.com `
  --server-address game.example.com:26900 `
  --mods-dir "$env:APPDATA\7DaysToDie\Mods"
```

玩家启动器（发现游戏目录、展示差异、同步、启动并重连）：

```powershell
npm run launcher -- join --base-url https://mods.example.com --address game.example.com:26900
```

便携包（目录内自带 node.exe，玩家不必先装 Node）：

```powershell
.\deploy\build-launcher.ps1
```

第一次连接时，更新器会保存平台公钥。以后如果公钥发生变化，更新器会停止安装并要求管理员确认。生产环境建议使用 `--public-key` 显式指定可信公钥。

## 插件包

已编译包位于：

```text
artifacts/plugins/ModPlatformClient
artifacts/plugins/ModPlatformServer
```

插件编译和安装参见 [插件构建与安装指南](docs/PLUGIN.zh-CN.md)。

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
cd E:\Project
npm.cmd test
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

- 当前是单节点 MVP，不是多租户公共 Mod 市场。
- 可靠流程是启动器在进入游戏前完成同步。
- 游戏内握手已按 Build `24436778` 编译，仍需真实进服确认踢人和重连。
- 带 DLL/Harmony 的 Mod 通常需要关闭 EAC，并在安装后重启游戏。
- Docker CLI 已安装，但部署前需要确保 Docker Desktop 后台正在运行。
- 对外开放前必须配置 HTTPS、限流、恶意文件扫描和正式密钥管理。

## 进一步阅读

- [生产环境 TODO](docs/PRODUCTION-TODO.zh-CN.md)
- [部署指南](docs/DEPLOYMENT.zh-CN.md)
- [插件构建与安装](docs/PLUGIN.zh-CN.md)
- [中文 API 说明](docs/API.zh-CN.md)
- [中文安全说明](docs/SECURITY.zh-CN.md)
- [英文协议说明](docs/PROTOCOL.md)
