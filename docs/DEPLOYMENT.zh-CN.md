# 中文部署指南

## 一、部署模式

当前版本适合单机、内网测试和小规模服务器。元数据保存在 JSON 文件中，Mod 文件保存在本地内容寻址目录中。

生产公开部署前，建议将元数据迁移到 PostgreSQL，将文件迁移到 S3、MinIO、R2 或 OSS，并将签名私钥放入 KMS/HSM。

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
| `ALLOW_BOOTSTRAP_ADMIN` | 首个用户注册后是否继续允许 `ADMIN_TOKEN` 登录，默认 `false` |
| `DATA_DIR` | 数据、Mod 文件和开发签名密钥目录 |
| `SIGNING_PRIVATE_KEY` | Base64 PKCS#8 Ed25519 私钥；生产环境建议由密钥服务提供 |
| `MAX_ARTIFACT_BYTES` | 单个 Mod ZIP 最大字节数 |
| `MAX_DIAGNOSTIC_BYTES` | 单条诊断请求最大字节数 |

如果未配置 `SIGNING_PRIVATE_KEY`，程序会在数据目录生成开发密钥。该方式只适合测试，部署时必须备份整个数据目录。

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

1. 进入管理页面，在首次部署区域填写 `ADMIN_TOKEN`。
2. 创建一个单次使用、管理员角色的邀请码。
3. 使用邀请码注册首个管理员账户。
4. 使用用户名和密码登录。首个账户创建后，引导令牌默认失效。
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
