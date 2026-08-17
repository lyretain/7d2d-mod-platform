# 插件构建与安装指南

[English](PLUGIN.md) · [简体中文](PLUGIN.zh-CN.md)

## 一、当前验证环境

- 七日杀：`V 3.10.14`
- Steam Build：`24436778`
- 游戏目录：`G:\SteamLibrary\steamapps\common\7 Days To Die`
- Unity：`2022.3.62f2`
- 插件目标框架：`netstandard2.1`
- 握手协议：`1`
- 插件版本：`0.2.11`

## 二、使用现成插件包

客户端插件：

```text
E:\Project\artifacts\plugins\ModPlatformClient
```

服务端插件：

```text
E:\Project\artifacts\plugins\ModPlatformServer
```

每个插件目录中包含：

- 插件 DLL
- `ModPlatform.Shared.dll`
- `ModInfo.xml`
- 对应配置文件

`ModInfo.xml` 必须是七日杀 V2 格式（字段直接写在 `<xml>` 下，不能再包一层 `<ModInfo>`）。V 3.x 会拒绝旧格式并忽略整个插件。

安装时把整个目录复制到七日杀 `Mods` 目录，不要只复制单个 DLL。专用服若设置了 `UserDataFolder`，应放到该目录下的 `Mods`，例如 `E:\GamerServer\SAVEDATA\7daystodiedev\Mods\ModPlatformServer`。

客户端示例：

```text
%APPDATA%\7DaysToDie\Mods\ModPlatformClient
```

服务端示例：

```text
<七日杀专用服务器>\Mods\ModPlatformServer
```

安装后编辑配置文件中的后台地址、游戏版本、服务器 ID 和服务器令牌。

## 三、重新编译

构建脚本会优先使用现代 .NET SDK；如果没有 SDK，则使用 Windows 自带的 C# 编译器。

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\deploy\build-plugins.ps1 `
  -GameManagedDir "G:\SteamLibrary\steamapps\common\7 Days To Die\7DaysToDie_Data\Managed" `
  -GameVersion "3.10.14"
```

输出目录：

```text
E:\Project\artifacts\plugins
```

每次七日杀更新后都应使用新版本的 `Assembly-CSharp.dll` 重新编译并测试。

## 四、服务端配置

`server.config.json` 示例：

```json
{
  "BaseUrl": "https://mods.aic.la",
  "ServerId": "srv_replace",
  "ServerToken": "replace",
  "GameVersion": "3.0.1-b4",
  "RefreshSeconds": 60,
  "HandshakeTimeoutSeconds": 180,
  "AutoSync": true,
  "AutoRestart": false
}
```

服务端令牌由服务器注册 API 返回一次。不要把它提交到 Git，也不要复制到客户端。

插件会按这个顺序查找配置：当前 Mod 目录（`Mod.Path`）、`UserDataFolder/Mods`、游戏安装目录 `Mods`。专用服把插件放在存档 Mods 时，请把 `server.config.json` 放在同一文件夹。

服务端插件会定期：

- 从后台获取当前 ModPack；
- 按 manifest 自动下载、校验 SHA-256 并安装到同级 `Mods`（`AutoSync` 默认开启）；已存在的同名目录会被认领并按 Pack 更新，不会再因「unmanaged」失败；
- Pack 发布新版本后，下次刷新会增量更新；
- 更新本地 `current-assignment.json` 并上报 `sync-status`；
- 含 DLL 或首次安装后要求重启；只更新内容 overlay 时不踢人。`AutoRestart=true` 时，在必须重启的下载完成后退出进程。
- 在刷新失败时上报诊断信息。

## 五、客户端配置

`client.config.json` 示例：

```json
{
  "BaseUrl": "https://mods.aic.la",
  "GameVersion": "3.0.1-b4",
  "DiagnosticsEnabled": true,
  "AutoSync": true,
  "AutoRestart": true
}
```

关闭 `DiagnosticsEnabled` 后，游戏内客户端插件不会主动发送故障事件。外部守护程序需要单独关闭。

`AutoSync` 默认开启：客户端按即将连接的 `地址:端口` 解析 Pack，下载并安装到 `%APPDATA%\7DaysToDie\Mods`。握手会等同步完成后再发。含 DLL 的 Pack 装完后会退出游戏并自动重连（`AutoRestart`，默认开启）。

这些项也可以在游戏里改：主菜单或 ESC → **选项** → **模组平台**。点「应用」后写入同一份 `client.config.json`，立即生效。

## 六、EAC 与重启

插件自身以及包含 Harmony/DLL 的 Mod 通常需要关闭 EAC。带 DLL 的 Mod 必须在游戏启动前完成安装；在游戏运行期间下载 DLL 后，应退出并重新启动游戏。

## 七、验证插件加载

启动游戏或专用服务器后，在日志中查找：

```text
[ModPlatform] Client bootstrap initialized
[ModPlatform] Server bootstrap started
```

服务端成功获取分配后还会记录：

```text
[ModPlatform] Active pack <packId> v<version>
```

如果没有这些日志，检查：

- 文件夹是否直接位于 `Mods` 下；
- `ModInfo.xml` 是否存在；
- 主插件 DLL 和 `ModPlatform.Shared.dll` 是否同时存在；
- 是否使用了对应游戏版本编译的 DLL；
- EAC 是否关闭；
- 配置文件名称是否正确。

## 八、当前限制

当前插件已实现：

- 后台 assignment 轮询和诊断上报；
- 握手协议 v1：客户端通过平台 HTTP 提交 Pack、版本、签名 Key 和已安装文件指纹，不再发送自定义 NetPackage（避免服务端多装了其它 Mod 后包 ID 错位）；
- 客户端按服务器地址自动下载并安装当前 Pack，再发送握手；
- 服务端按玩家 Steam/EOS/名称认领该握手，并在 `PlayerLogin` / `PlayerSpawning` 拒绝未同步、版本不符或超时的玩家，踢出原因包含启动器地址。等待下限 120 秒（正在同步时 180 秒），避免大体积 overlay 还没下完就被旧的 15 秒超时踢掉。
- 同步时会认领 Pack 已声明且已存在的同名目录；服务端缓存写在 `ModPlatformServer/.modplatform`。

客户端和服务端插件建议一起升级到 `0.2.11`。这次必须更新专用服插件，否则仍会 15 秒超时。只改内容 overlay、本体 ZIP 不变时也会写入安装目录；旧逻辑会跳过安装并带着过期指纹握手，导致 `PACK_MISMATCH`。

```powershell
npm run launcher -- join --base-url http://localhost:8080 --address game.example.com:26900
```
