# 玩家与服主教程

平台地址：[https://mods.aic.la](https://mods.aic.la)

当前适配游戏：`V 3.10.14`（Steam Build `24436778`）。含 DLL 的 Mod 需要关闭 EAC。

这篇文档面向两类人：

- **服主**：在平台登记自己的七日杀服务器，让玩家按地址自动安装同一套 ModPack。
- **玩家**：按服务器地址同步 Mod，再进游戏。

普通用户开放注册，不必等邀请。上传 Mod、发布 Pack、审核和紧急停发仍由社区管理员或开发者处理。

## 一、注册和登录

1. 打开 [https://mods.aic.la](https://mods.aic.la)。
2. 点「注册」，用户名 3–32 位（字母数字、点、下划线、横线），密码至少 10 位。
3. 邀请码可留空，注册后角色是「普通用户」。
4. 用同一组账号登录。

登录后，普通用户默认进入「服务器」页，可以看到已发布的 Pack 列表（在「Pack」页），并登记自己的服务器。

## 二、服主：创建服务器

登记服务器不会替你安装七日杀专用服。它只是告诉平台：玩家连 `地址:端口` 时，应该下载哪一个已发布的 Pack。

### 1. 先确认 Pack

1. 登录后打开「Pack」。
2. 确认要使用的 Pack 已经发布过 Release。没有可用 Pack 时，请联系社区管理员发布，或自己成为开发者后再上传 Mod。
3. 管理员创建 Pack 时会自动生成 Pack ID，并从已登记 Mod 里多选组装。

### 2. 在网页上登记

1. 打开「服务器」。
2. 填写：
   - **名称**：给你自己看的名字，例如 `周末 PVE`。
   - **Pack**：下拉选择已发布的 Pack。
   - **公开地址**：玩家进服时填写的地址，例如 `play.example.com:26900` 或 `1.2.3.4:26900`。必须和游戏里看到的一致，大小写不敏感。
3. 点「登记服务器」。
4. 页面会给出完整的 `server.config.json`，字段与插件一致：`BaseUrl`、`ServerId`、`ServerToken`、`GameVersion`、`RefreshSeconds`、`HandshakeTimeoutSeconds`。令牌只显示这一次，立刻复制覆盖到插件目录。丢了只能删掉重登，或请管理员协助。

同一公开地址不能登记两次。以后要换 Pack 或改地址：点表格里的那一行，改完后点「更新绑定」。你只能改自己登记的服务器。

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
  "HandshakeTimeoutSeconds": 15,
  "AutoSync": true,
  "AutoRestart": false
}
```

`ServerToken` 不要发给玩家，也不要放进客户端插件。

### 4. 同步 Mod 并开服

服务端插件会按当前 Pack **自动下载并安装** Mod 到同级 `Mods` 目录（与 `ModPlatformServer` 并列）。后台发布新 Release 后，专用服会在下一次刷新（默认 60 秒）再下一遍。

含 DLL 的 Mod 必须重启专用服才会加载。日志出现 `restartRequired=True` 时重启一次。若希望下完自动退出以便外部守护进程拉起，把 `server.config.json` 里的 `AutoRestart` 设为 `true`。

也可以继续用更新器或 guardian 预装：

```powershell
node apps/updater/src/cli.js --base-url https://mods.aic.la --server-address "play.example.com:26900" --mods-dir "C:\7DTDDedicated\Mods"
```

启动后在服务端日志里应看到：

```text
[ModPlatform] Server bootstrap started
[ModPlatform] Active pack <packId> v<version>
```

平台「服务器」列表里，该行会在约 5 分钟内心跳显示为在线。

## 三、玩家：同步并进服

玩家不必登记服务器。只要服主已经登记了公开地址，你用同一地址就能解析到 Pack。

### 1. 安装客户端插件

把整个 `ModPlatformClient` 文件夹复制到用户 Mods 目录：

```text
%APPDATA%\7DaysToDie\Mods\ModPlatformClient\
```

编辑 `client.config.json`：

```json
{
  "BaseUrl": "https://mods.aic.la",
  "GameVersion": "3.10.14",
  "DiagnosticsEnabled": true
}
```

插件包可向服主或社区管理员索取，仓库里的现成目录是 `artifacts/plugins/ModPlatformClient`。

### 2. 用启动器一键同步（推荐）

已有便携启动器时：

```text
ModPlatformLauncher.exe join --base-url https://mods.aic.la --address 服主给你的地址:26900
```

本机有 Node.js 时：

```powershell
npm run launcher -- join --base-url https://mods.aic.la --address play.example.com:26900
```

启动器会发现游戏和 Mods 目录，列出要安装、更新或删除的内容，标出含 DLL 的 Mod，同步完成后启动游戏并尝试重连。

第一次同步会钉住平台公钥。以后公钥变了会拒绝安装，这是正常保护。

### 3. 只用更新器、自己开游戏

```powershell
node apps/updater/src/cli.js --base-url https://mods.aic.la --server-address play.example.com:26900 --mods-dir "$env:APPDATA\7DaysToDie\Mods"
```

同步完成后再启动七日杀，连同一地址。若 Pack 含 DLL，必须先关游戏再同步，装完再开。

### 4. 进服时可能看到的提示

- 未装客户端插件：按踢出说明安装插件和启动器。
- ModPack 不一致：先跑启动器同步，再进。
- 游戏版本不符：需要 `3.10.14`。
- 服务器还在同步 / 分发暂停：等服主处理后再进。

游戏日志里应有：

```text
[ModPlatform] Client bootstrap initialized
[ModPlatform] Handshake sent
```

## 四、常见问题

- **登记时提示 Unknown packId**：下拉列表里没有可用 Pack，或该 Pack 已被删除。到「Pack」页确认已发布。
- **登记时提示地址已被占用**：换一个公开地址，或让原登记人改绑定。
- **玩家 resolve 失败**：地址必须和登记时完全一致（端口也要有）。
- **令牌丢了**：普通用户无法再看原文。重新登记一个新服务器，或请超级管理员协助。
- **插件没有日志**：确认整个文件夹在 `Mods` 下，且 `ModInfo.xml`、主 DLL、`ModPlatform.Shared.dll` 都在；EAC 已关。
- **想上传自己的 Mod**：先用开发者邀请码激活，或注册时带上开发者邀请码。发布 Pack 需要社区管理员。

更细的插件安装见 [插件指南](PLUGIN.zh-CN.md)。后台部署见 [部署指南](DEPLOYMENT.zh-CN.md)。
