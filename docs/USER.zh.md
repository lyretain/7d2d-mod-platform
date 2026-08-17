# 玩家与服主教程

[English](USER.md) · [简体中文](USER.zh.md)

平台地址：[https://mods.aic.la](https://mods.aic.la)

安装流程和官方插件、启动器下载：[https://mods.aic.la/about](https://mods.aic.la/about)。插件 ZIP 也在 [GitHub Releases](https://github.com/lyretain/7d2d-mod-platform/releases/latest)。

当前适配游戏：`V 3.10.14`（Steam Build `24436778`）。含 DLL 的 Mod 需要关闭 EAC。

Hordepin 是七日杀 Mod 的分发与同步平台。这篇文档面向两类人：

- **服主**：在平台登记自己的七日杀服务器，让玩家按地址自动安装同一套 ModPack。
- **玩家**：按服务器地址同步 Mod，再进游戏。

普通用户开放注册，不必等邀请。上传 Mod、发布 Pack、审核仍由社区管理员或开发者处理。全平台紧急停发只在运维管理，且仅超级管理员和社区管理员可操作。

## 一、注册和登录

1. 打开 [https://mods.aic.la](https://mods.aic.la)。
2. 点「注册」，用户名 3–32 位（字母数字、点、下划线、横线），密码至少 10 位。
3. 邀请码可留空，注册后角色是「普通用户」。
4. 用同一组账号登录。

登录后默认进入「工坊」：像创意工坊一样浏览、搜索已登记的 Mod。社区管理员可以在浏览时把 Mod 加入已有 Pack，或直接创建新 Pack。普通用户也能看工坊和已发布 Pack，并在「服务器」页登记自己的专用服。

## 二、服主：创建服务器

登记服务器不会替你安装七日杀专用服。它只是告诉平台：玩家连 `地址:端口` 时，应该下载哪一个已发布的 Pack。

### 1. 先确认 Pack

1. 登录后打开「工坊」，按名称、作者或游戏版本查找 Mod，点「加入挑选」。
2. 挑好后点「创建新 Pack」，或「加入已有 Pack」。创建时可勾选同时发布 Release。
3. 也可以仍在「Pack」页用多选框组装。没有可用 Pack 时，请联系社区管理员，或自己成为开发者后再上传 Mod。

### 2. 在网页上登记

1. 打开「服务器」。
2. 填写：
   - **名称**：给你自己看的名字，例如 `周末 PVE`。
   - **Pack**：下拉选择已发布的 Pack。
   - **地址（可选）**：每行一条，例如局域网 `192.168.3.42:26900` 和公网 `play.example.com:26900`。可以留空。握手和 Pack 解析以 **Server ID** 为准；地址只是方便玩家按 IP 进服时自动找到这台服。动态 IP、只开局域网、公网和内网同时存在都可以。
3. 点「登记服务器」。
4. 页面会给出完整的 `server.config.json`，字段与插件一致：`BaseUrl`、`ServerId`、`ServerToken`、`GameVersion`、`RefreshSeconds`、`HandshakeTimeoutSeconds`。令牌只显示这一次，立刻复制覆盖到插件目录。丢了可在「服务器」页点「重置 ServerToken」，旧令牌立即失效。

同一地址可以被多台服使用（例如都是 `192.168.1.100:26900`）。按地址解析时，平台会选最近在线的那一台；要精确指定请用 Server ID。以后要换 Pack 或改地址：点表格里的那一行，改完后点「更新绑定」。你只能改自己登记的服务器。服务端插件在线后会自动把本机监听地址补进列表。

### 3. 安装服务端插件

把整个 `ModPlatformServer` 文件夹复制到专用服的 `Mods` 目录，不要只拷一个 DLL。例如：

```text
<七日杀专用服务器>\Mods\ModPlatformServer\
  ModPlatform.Server.dll
  ModPlatform.Shared.dll
  ModInfo.xml
  server.config.json
```

把后台生成的整段 JSON 覆盖到 `server.config.json`，不要改字段名大小写。内容应类似：

```json
{
  "BaseUrl": "https://mods.aic.la",
  "ServerId": "srv_...",
  "ServerToken": "...",
  "GameVersion": "3.10.14",
  "RefreshSeconds": 60,
  "HandshakeTimeoutSeconds": 180,
  "AutoSync": true,
  "AutoRestart": false
}
```

`ServerToken` 不要发给玩家，也不要放进客户端插件。

### 4. 同步 Mod 并开服

服务端插件会按当前 Pack **自动下载并安装服务端与两端 Mod** 到同级 `Mods` 目录（与 `ModPlatformServer` 并列）。后台发布新 Release 后，专用服会在下一次刷新（默认 60 秒）再下一遍。仅客户端的 Mod 不会装到专用服。

含 DLL 的 Mod 必须重启专用服才会加载。日志出现 `restartRequired=True` 时重启一次。若希望下完自动退出以便外部守护进程拉起，把 `server.config.json` 里的 `AutoRestart` 设为 `true`。

也可以继续用更新器或 guardian 预装（专用服用 `--side server`）：

```powershell
node apps/updater/src/cli.js --base-url https://mods.aic.la --pack-id your-pack --mods-dir "C:\7DTDDedicated\Mods" --side server
```

启动后在服务端日志里应看到：

```text
[ModPlatform] Server bootstrap started
[ModPlatform] Active pack <packId> v<version>
```

平台「服务器」列表里，该行会在约 5 分钟内心跳显示为在线。

## 三、玩家：同步并进服

玩家不必登记服务器。连上服主的游戏地址后，客户端会按地址或 Server ID 解析 Pack。局域网、公网或动态 IP 都可以，不必和网页上填的那一条完全一致。

### 1. 安装客户端插件

把整个 `ModPlatformClient` 文件夹复制到用户 Mods 目录：

```text
%APPDATA%\7DaysToDie\Mods\ModPlatformClient\
```

也可以进游戏后打开 **选项 → 模组平台**，改平台地址、自动下载、装完 DLL 后重启、诊断上报，点「应用」即可，不必手改 JSON。

默认 `client.config.json`：

```json
{
  "BaseUrl": "https://mods.aic.la",
  "GameVersion": "3.10.14",
  "DiagnosticsEnabled": true,
  "AutoSync": true,
  "AutoRestart": true
}
```

插件包可从 [关于页](https://mods.aic.la/about) 下载，也可向服主或社区管理员索取。仓库里的现成目录是 `artifacts/plugins/ModPlatformClient`。

### 2. 进服时自动同步

装好客户端插件后直接进服即可。插件会解析 Pack、只下载**客户端与两端**模组到 `%APPDATA%\7DaysToDie\Mods`，再按 Server ID 握手。连上后大约每 60 秒再检查一次更新。含 DLL 的 Pack 会先弹出重启确认。日志里应有：

```text
[ModPlatform] Resolving pack for 192.168.3.42:26900
[ModPlatform] Client pack sync ... installed=
[ModPlatform] Handshake sent address=192.168.3.42:26900 pack=... v...
```

第一次下载较慢时，可能先被超时踢一次，下完会自动重连。

### 3. 用启动器一键同步（可选）

已有便携启动器时：

```text
ModPlatformLauncher.exe join --base-url https://mods.aic.la --address 服主给你的地址:26900
```

本机有 Node.js 时：

```powershell
npm run launcher -- join --base-url https://mods.aic.la --address play.example.com:26900
```

启动器会发现游戏和 Mods 目录，列出要安装、更新或删除的内容，标出含 DLL 的 Mod，同步完成后启动游戏并尝试重连。便携目录会在进服前检查启动器自身更新：只安装带平台 Ed25519 签名且 SHA-256 相符的 ZIP。从源码目录运行时只提示有新版本，不会覆盖开发树。也可单独执行：

```powershell
ModPlatformLauncher.exe update --base-url https://mods.aic.la
```

第一次同步会钉住平台公钥。以后公钥变了会拒绝安装，这是正常保护。

### 4. 只用更新器、自己开游戏

```powershell
node apps/updater/src/cli.js --base-url https://mods.aic.la --server-address play.example.com:26900 --mods-dir "$env:APPDATA\7DaysToDie\Mods"
```

同步完成后再启动七日杀，连同一地址。若 Pack 含 DLL，必须先关游戏再同步，装完再开。

### 5. 进服时可能看到的提示

- 未装客户端插件：按踢出说明安装插件。
- ModPack 不一致：看客户端是否出现 `Client pack sync`；地址必须和服主登记的一致。
- 游戏版本不符：需要与 Pack 要求的版本兼容。
- 服务器还在同步 / 分发暂停：等服主处理后再进。

握手走平台 HTTP。玩家连的地址必须和服主登记的公开地址一致。客户端插件换成 `0.2.3`。

## 四、常见问题

- **登记时提示 Unknown packId**：下拉列表里没有可用 Pack，或该 Pack 已被删除。到「Pack」页确认已发布。
- **登记时提示地址已被占用**：换一个公开地址，或让原登记人改绑定。
- **玩家 resolve 失败**：地址必须和登记时完全一致（端口也要有）。
- **令牌丢了**：在「服务器」里选中该服，点「重置 ServerToken」，把新的 `server.config.json` 覆盖到专用服插件目录。旧令牌立即失效。
- **插件没有日志**：确认整个文件夹在 `Mods` 下，且 `ModInfo.xml`、主 DLL、`ModPlatform.Shared.dll` 都在；EAC 已关。
- **想上传自己的 Mod**：先用开发者邀请码激活，或注册时带上开发者邀请码。发布 Pack 需要社区管理员。

更细的插件安装见 [插件指南](PLUGIN.zh.md)（[English](PLUGIN.md)）。后台部署见 [部署指南](DEPLOYMENT.zh.md)（[English](DEPLOYMENT.md)）。
