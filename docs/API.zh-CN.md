# 中文 API 说明

管理员接口必须携带：

```http
Authorization: Bearer <ADMIN_TOKEN>
```

## 接口一览

| 方法 | 地址 | 权限 | 用途 |
|---|---|---|---|
| GET | `/health` | 公开 | 健康检查 |
| GET | `/health/live` | 公开 | 存活检查 |
| GET | `/health/ready` | 公开 | 就绪检查（数据库、对象存储、签名） |
| GET | `/status` | 公开 | 维护公告、停发状态，以及是否已完成初始化 |
| POST | `/api/v1/setup` | 引导令牌 | 未初始化时创建首位社区管理员 |
| GET | `/metrics` | 登录用户 | 请求量、延迟、登录失败、崩溃率 |
| GET | `/api/v1/public-key` | 公开 | 获取 Ed25519 公钥和钥匙环 |
| POST | `/api/v1/auth/register` | 公开 | 注册普通用户；携带社区/开发者邀请码则获得对应角色 |
| POST | `/api/v1/auth/activate` | 普通用户 | 用开发者邀请码激活 |
| GET | `/api/v1/auth/github` | 登录用户 | 跳转 GitHub OAuth，社区管理员必须绑定 |
| POST | `/api/v1/auth/github/bind` | 登录用户 | 开发环境绑定 GitHub 资料 |
| POST | `/api/v1/auth/login` | 公开 | 登录；启用 2FA 时返回 `requiresTotp` |
| POST | `/api/v1/auth/login/totp` | 公开 | 用 TOTP 或恢复码完成登录 |
| POST | `/api/v1/auth/logout` | 登录用户 | 注销当前会话 |
| GET | `/api/v1/auth/me` | 登录用户 | 获取当前账户 |
| GET | `/api/v1/users` | 管理员 | 用户列表 |
| PATCH | `/api/v1/users/{id}` | 管理员 | 禁用/启用或改角色 |
| POST | `/api/v1/users/{id}/reset` | 管理员 | 签发密码重置令牌 |
| POST | `/api/v1/auth/password` | 登录用户 | 修改自己的密码 |
| POST | `/api/v1/auth/password/reset` | 公开 | 使用重置令牌设新密码 |
| GET | `/api/v1/sessions` | 登录用户 | 查看会话 |
| DELETE | `/api/v1/sessions/{hash}` | 登录用户 | 撤销会话 |
| DELETE | `/api/v1/users/{id}/sessions` | 管理员 | 撤销某用户全部会话 |
| POST | `/api/v1/auth/totp/setup` | 登录用户 | 开始绑定 2FA |
| POST | `/api/v1/auth/totp/confirm` | 登录用户 | 确认 2FA |
| GET | `/api/v1/reviews` | 登录用户 | 上传审核列表 |
| POST | `/api/v1/reviews/{sha256}` | 管理员 | 审核、确认许可证 |
| POST | `/api/v1/bans` | 管理员 | 封禁文件哈希 |
| GET | `/api/v1/diagnostics/matrix` | 登录用户 | 兼容性矩阵与崩溃率熔断 |
| POST | `/api/v1/diagnostics/fingerprints/{id}/dismiss` | 管理员 | 解除误报 |
| DELETE | `/api/v1/diagnostics` | 登录用户 | 删除诊断数据 |
| POST | `/api/v1/admin/gc` | 管理员 | 清理无引用对象和过期诊断 |
| POST | `/api/v1/admin/maintenance` | 管理员 | 维护公告 |
| POST | `/api/v1/admin/webhooks` | 管理员 | 登记告警 Webhook |
| POST | `/api/v1/admin/signing/rotate` | 管理员 | 轮换本地签名密钥 |
| GET | `/api/v1/mods` | 登录用户 | Mod 列表，支持 `?q=` |
| GET | `/api/v1/mods/{id}` | 登录用户 | Mod 详情和版本历史 |
| GET | `/api/v1/packs` | 登录用户 | ModPack 列表 |
| GET | `/api/v1/packs/{id}` | 登录用户 | 草稿与当前 Release 差异预览 |
| GET | `/api/v1/servers` | 登录用户 | 服务器在线状态和同步 |
| GET | `/api/v1/admin/stats` | 登录用户 | 下载次数、字节、游戏版本分布 |
| POST | `/api/v1/admin/confirm` | 管理员 | 签发危险操作确认令牌 |
| POST | `/api/v1/admin/cdn/purge` | 管理员 | 刷新 Cloudflare 缓存 |
| POST | `/api/v1/invites` | 管理员 | 创建邀请码 |
| GET | `/api/v1/invites` | 管理员 | 查看邀请码状态 |
| DELETE | `/api/v1/invites/{id}` | 管理员 | 吊销邀请码 |
| PUT | `/api/v1/artifacts/{sha256}` | 管理员 | 上传不可变 Mod ZIP |
| POST | `/api/v1/mods` | 管理员 | 注册 Mod 版本 |
| POST | `/api/v1/packs` | 管理员 | 创建或更新 ModPack 草稿 |
| POST | `/api/v1/packs/{id}/releases` | 管理员 | 发布签名版本 |
| POST | `/api/v1/servers` | 登录用户 | 登记游戏服务器；普通用户必须填写公开地址 |
| GET | `/api/v1/admin/state` | 管理员 | 查看平台状态 |
| GET | `/api/v1/packs/{id}/releases` | 登录用户 | 列出 Release，并提示回滚可能影响存档 |
| POST | `/api/v1/packs/{id}/releases/{releaseId}/revoke` | 管理员 | 吊销 Release |
| POST | `/api/v1/packs/{id}/rollback` | 管理员 | 将 latest 指针回滚到指定 Release |
| PATCH | `/api/v1/servers/{id}` | 登录用户 | 修改自己的服务器；社区管理员可改全部 |
| POST | `/api/v1/admin/distribution` | 管理员 | 紧急停止或恢复分发 |
| GET | `/api/v1/admin/audit` | 登录用户 | 查看发布审计 |
| POST | `/api/v1/servers/{id}/sync-status` | 服务端令牌 | 上报同步状态 |
| GET | `/api/v1/diagnostics/summary` | 登录用户 | 查看故障聚合结果 |
| GET | `/api/v1/public/packs/{id}/latest` | 公开 | 获取最新签名 manifest |
| GET | `/api/v1/public/artifacts/{sha256}` | 公开 | 下载不可变 Mod 文件 |
| GET | `/api/v1/public/servers/resolve?address=host:port` | 公开 | 根据服务器地址解析 ModPack |
| GET | `/api/v1/servers/{id}/assignment` | 服务端令牌 | 获取服务器分配和心跳 |
| POST | `/api/v1/diagnostics` | 公开、受限流保护 | 上传诊断事件 |

## 初始化

未创建任何用户时，`GET /status` 的 `initialized` 为 `false`，首页只提供初始化页。

```json
{
  "token": "<ADMIN_TOKEN>",
  "username": "Owner",
  "password": "correct horse battery staple"
}
```

`POST /api/v1/setup` 只允许调用一次。成功后首位账户为管理员，引导令牌默认停用。

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

成功后返回 Bearer 会话令牌和过期时间。若账户已启用 TOTP，响应为 `{ "requiresTotp": true, "ticket": "..." }`，再调用 `/api/v1/auth/login/totp`。数据库只保存会话令牌的 SHA-256。默认会话有效期为 7 天，退出登录后立即删除。

生产环境 `REQUIRE_REVIEW=true`（或 `NODE_ENV=production`）时，上传 ZIP 会自动分析并进入审核。含 DLL 或高风险规则的文件默认为 `pending`；发布前必须 `licenseConfirmed=true`。

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

不传 `id` 时后台自动生成 `pack_<uuid>`。传入已有 `id` 则更新该草稿。

```json
{
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

响应中的 `config` 与插件 `server.config.json` 字段一致（`BaseUrl`、`ServerId`、`ServerToken`、`GameVersion`、`RefreshSeconds`、`HandshakeTimeoutSeconds`）。令牌只返回一次，应立即覆盖到插件目录。

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
