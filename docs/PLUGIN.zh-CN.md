# 插件构建与安装指南

## 一、当前验证环境

- 七日杀：`V 3.0.1 (b4)`
- Steam Build：`24117861`
- 游戏目录：`G:\SteamLibrary\steamapps\common\7 Days To Die`
- Unity：`2022.3.62f2`
- 插件目标运行时：`v4.0.30319`

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

安装时把整个目录复制到七日杀 `Mods` 目录，不要只复制单个 DLL。

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
cd E:\Project
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\deploy\build-plugins.ps1 `
  -GameManagedDir "G:\SteamLibrary\steamapps\common\7 Days To Die\7DaysToDie_Data\Managed"
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
  "BaseUrl": "https://mods.example.com",
  "ServerId": "srv_replace",
  "ServerToken": "replace",
  "GameVersion": "3.0.1-b4",
  "RefreshSeconds": 60
}
```

服务端令牌由服务器注册 API 返回一次。不要把它提交到 Git，也不要复制到客户端。

服务端插件会定期：

- 从后台获取当前 ModPack；
- 更新本地 `current-assignment.json`；
- 发送心跳；
- 在刷新失败时上报诊断信息。

## 五、客户端配置

`client.config.json` 示例：

```json
{
  "BaseUrl": "https://mods.example.com",
  "GameVersion": "3.0.1-b4",
  "DiagnosticsEnabled": true
}
```

关闭 `DiagnosticsEnabled` 后，游戏内客户端插件不会主动发送故障事件。外部守护程序需要单独关闭。

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

当前插件已实现后台分配轮询和诊断上报。客户端在进入服务器前的可靠同步仍由外部启动器完成。原生游戏联网拦截必须针对具体七日杀构建继续集成和运行验证后，才能用于阻止未同步客户端进入世界。
