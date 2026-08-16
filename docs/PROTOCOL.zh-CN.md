# 协议 v1

[English](PROTOCOL.md) · [简体中文](PROTOCOL.zh-CN.md)

## 信任模型

平台对每份 manifest 的规范 JSON 做 Ed25519 签名。规范化时省略 `signing`。客户端第一次接触时钉死 SPKI 公钥，或由管理员显式提供。公钥变化会被拒绝，直到批准。

制品不可变，用小写 SHA-256 寻址。客户端必须先验证 manifest 签名，才能使用其中的下载地址，然后再校验文件长度、SHA-256 和 ZIP CRC，最后才安装。

## 预检流程

1. 服主登记公开 `host:port` 并绑定 ModPack。
2. 启动器调用 `GET /api/v1/public/servers/resolve?address=host:port`。
3. 启动器再取 `GET /api/v1/public/packs/{packId}/latest`。
4. 更新器验签，下载缺失制品，并安装已声明的顶层目录。Mod 还可以带 `overlays`：额外 ZIP 解压到安装目录的子文件夹（例如 `Z_CustomAvatars/Avatars`）。overlay 的 SHA-256 会计入手指纹。
5. 含 DLL 的 Release 会设 `requiresRestart`，必须装完再开游戏。

便携启动器在同步 Pack 前还会检查 `GET /api/v1/public/launcher/latest?platform=win32`。响应是一份 Ed25519 签名对象（`kind: launcher`），含 `version`、`sha256`、`size` 和制品 URL。启动器钉死与 ModPack 相同的平台公钥，校验 ZIP 哈希，按现有 ZIP 安全规则解压，再替换便携目录。验签失败即失败关闭。缺少 Release 或网络错误不阻止进服。`ModPlatformLauncher.exe` 的 Authenticode 签名与这份包签名是两件事。

客户端插件也会解析同一地址，把已签名的 latest Pack 下到用户 Mods 目录，再发送握手。含 DLL 的 Pack 需要重启游戏；插件会写重连提示，并可退出以便下次启动加载新程序集。启动器预检仍然可选，用于第一次开游戏前先装好文件。

## 握手 v1

客户端插件把 hello 发到 `POST /api/v1/public/handshakes`（不是自定义七日杀 `NetPackage`，避免服务端多装其它 Mod 后包 ID 错位）。载荷包括：

- `address`：与专用服登记的同一 `host:port`
- `playerIds`：本机客户端已知的 Steam / EOS / 显示名
- `hello.protocolVersion`（必须是 `1`）
- `hello.pluginVersion`、`hello.gameVersion`、`hello.steamBuildId`
- `hello.packId`、`hello.packVersion`、`hello.keyId`
- `hello.artifactFingerprint`：来自 `.modplatform/state.json` 的已排序小写 SHA-256 列表

专用服插件用服务端令牌调用 `POST /api/v1/servers/{id}/pending-handshake/claim` 认领该载荷，再与分配里的 `handshake` 策略比较。缺少插件、超时、分发暂停、Release 已吊销、游戏版本不符或哈希不符，都会以原因码和启动器地址踢人。待处理 hello 两分钟过期，认领后即消费。

自制插件仍可谎报匹配哈希；这道门用来挡住普通未同步客户端，不是挡专门伪造的 DLL。服务端从不接受客户端随便给的制品 URL。

## 服务器分配

`GET /api/v1/servers/{serverId}/assignment` 使用登记时一次性返回的服务端 Bearer 令牌。后台只保存令牌哈希。响应包含当前已签名 manifest。

## 诊断

`POST /api/v1/diagnostics` 接受有大小上限的 JSON 事件。API 会脱敏凭据、IP、用户主目录和平台 ID，规范化靠前的堆栈帧，并生成稳定的 SHA-256 指纹。生产部署应在反向代理上按 IP 和服务器限流。
