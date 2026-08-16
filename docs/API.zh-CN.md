# 中文 API 说明

管理员接口必须携带：

```http
Authorization: Bearer <ADMIN_TOKEN>
```

## 接口一览

| 方法 | 地址 | 权限 | 用途 |
|---|---|---|---|
| GET | `/health` | 公开 | 健康检查 |
| GET | `/api/v1/public-key` | 公开 | 获取 Ed25519 公钥 |
| POST | `/api/v1/auth/register` | 邀请码 | 注册账户 |
| POST | `/api/v1/auth/login` | 公开 | 登录并获得会话令牌 |
| POST | `/api/v1/auth/logout` | 登录用户 | 注销当前会话 |
| GET | `/api/v1/auth/me` | 登录用户 | 获取当前账户 |
| POST | `/api/v1/invites` | 管理员 | 创建邀请码 |
| GET | `/api/v1/invites` | 管理员 | 查看邀请码状态 |
| DELETE | `/api/v1/invites/{id}` | 管理员 | 吊销邀请码 |
| PUT | `/api/v1/artifacts/{sha256}` | 管理员 | 上传不可变 Mod ZIP |
| POST | `/api/v1/mods` | 管理员 | 注册 Mod 版本 |
| POST | `/api/v1/packs` | 管理员 | 创建或更新 ModPack 草稿 |
| POST | `/api/v1/packs/{id}/releases` | 管理员 | 发布签名版本 |
| POST | `/api/v1/servers` | 管理员 | 注册游戏服务器 |
| GET | `/api/v1/admin/state` | 管理员 | 查看平台状态 |
| GET | `/api/v1/diagnostics/summary` | 管理员 | 查看故障聚合结果 |
| GET | `/api/v1/public/packs/{id}/latest` | 公开 | 获取最新签名 manifest |
| GET | `/api/v1/public/artifacts/{sha256}` | 公开 | 下载不可变 Mod 文件 |
| GET | `/api/v1/public/servers/resolve?address=host:port` | 公开 | 根据服务器地址解析 ModPack |
| GET | `/api/v1/servers/{id}/assignment` | 服务端令牌 | 获取服务器分配和心跳 |
| POST | `/api/v1/diagnostics` | 公开、受限流保护 | 上传诊断事件 |

## 邀请注册与登录

管理员创建邀请码：

```json
{
  "role": "admin",
  "maxUses": 1,
  "expiresInHours": 168
}
```

创建响应中的 `code` 只显示一次。后台只保存邀请码哈希。

用户注册：

```json
{
  "username": "Alice.Admin",
  "password": "至少10位的安全密码",
  "inviteCode": "inv_..."
}
```

用户名不区分大小写，允许字母、数字、点、下划线和连字符。密码使用随机盐和 scrypt 保存，数据库不保存明文密码。

登录：

```json
{
  "username": "Alice.Admin",
  "password": "用户密码"
}
```

成功后返回 Bearer 会话令牌和过期时间。数据库只保存会话令牌的 SHA-256。默认会话有效期为 7 天，退出登录后立即删除。

## 上传 Mod 文件

先在客户端计算 ZIP 的 SHA-256，然后上传到：

```http
PUT /api/v1/artifacts/<sha256>
Content-Type: application/zip
Authorization: Bearer <ADMIN_TOKEN>
```

后台会边接收边计算 SHA-256。如果 URL 中的哈希与文件不一致，文件不会进入对象目录。

## 注册 Mod 版本

```json
{
  "id": "example-vehicles",
  "name": "Example Vehicles",
  "version": "1.2.0",
  "artifactSha": "64位小写SHA-256",
  "gameVersions": ["3.0.1-b4"],
  "installRoots": ["ExampleVehicles"],
  "containsDll": true,
  "requiresRestart": true
}
```

`installRoots` 必须与 ZIP 中的顶层目录完全一致。更新器默认拒绝覆盖不属于平台管理的同名目录。

## 创建 ModPack

```json
{
  "id": "production-pack",
  "name": "正式服务器 ModPack",
  "gameVersion": "3.0.1-b4",
  "entries": [
    {
      "modId": "example-vehicles",
      "version": "1.2.0",
      "required": true
    }
  ]
}
```

如果 Mod 版本声明了兼容游戏版本，而该列表不包含 ModPack 的游戏版本，后台会拒绝创建。

## 发布 ModPack

```http
POST /api/v1/packs/production-pack/releases
Authorization: Bearer <ADMIN_TOKEN>
Content-Type: application/json

{}
```

发布后生成不可变 manifest，并使用 Ed25519 签名。修改草稿不会改变以前发布的 release。

## 注册游戏服务器

```json
{
  "name": "Tokyo PVE",
  "packId": "production-pack",
  "publicAddress": "game.example.com:26900"
}
```

响应中的服务器令牌只返回一次，应立即保存到服务端插件配置。

## 上传诊断信息

```json
{
  "sessionId": "uuid",
  "side": "client",
  "gameVersion": "3.0.1-b4",
  "packId": "production-pack",
  "packVersion": 3,
  "stage": "game_startup",
  "exceptionType": "TypeLoadException",
  "message": "错误信息",
  "stackTrace": "堆栈",
  "logExcerpt": "有限长度的日志片段",
  "occurredAt": "2026-07-14T12:00:00Z"
}
```

后台会再次删除凭据、IP、用户主目录和玩家平台 ID，并根据游戏版本、异常类型、规范化堆栈和 ModPack 生成故障指纹。
