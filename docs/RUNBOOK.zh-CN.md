# 生产运维 Runbook

目标：在预定 RTO 内从全新环境恢复后台、对象文件和签名能力。

建议目标：

| 指标 | 目标 | 说明 |
|---|---|---|
| RPO | 1 小时 | 元数据与对象清单至少每小时备份一次 |
| RTO | 2 小时 | 全新机器恢复 API、对象和验签 |

## 日常备份

必须一起备份，缺一不可：

1. PostgreSQL：`deploy/backup-postgres.ps1 -DatabaseUrl $env:DATABASE_URL`，或 JSON 模式下的 `data/state/database.json`
2. 对象存储：S3/MinIO 版本控制或 `data/objects/` 快照
3. 签名材料：`SIGNING_PRIVATE_KEY`、远程签名服务凭证，或 `data/state/keyring.json` 与开发密钥（仅测试）
4. 配置：`.env`、反向代理、DNS、CDN

恢复演练：每季度在空机器上恢复一份备份，用更新器拉取 latest manifest 并验签。

## ModPack 紧急回滚

1. 打开管理页或调用 `GET /api/v1/packs/:id/releases`，确认上一个已知良好 Release。
2. `POST /api/v1/packs/:id/releases/:releaseId/revoke`，原因写清楚。
3. `POST /api/v1/packs/:id/rollback`，`releaseId` 指向良好版本。回滚可能影响存档。
4. 如需立即停止下载：`POST /api/v1/admin/distribution`，`{ "paused": true }`。
5. 通知频道应收到 webhook；玩家更新器会看到 503。
6. 服务端 guardian 在后台恢复后会同步回滚后的 Pack。

## 密钥泄露

1. 立刻停止分发：`POST /api/v1/admin/distribution` `{ "paused": true }`。
2. 若使用本地密钥：在隔离环境轮换 `POST /api/v1/admin/signing/rotate`，或更换 `SIGNING_PRIVATE_KEY` 后重启。
3. 若使用 `SIGNING_SERVICE_URL`：在签名服务侧轮换，应用进程拿不到私钥。
4. 吊销旧 `keyId`。已安装客户端会拒绝被吊销或未知密钥。
5. 重新发布当前 Pack，使新 manifest 使用新密钥。
6. 恢复分发前，用一台干净客户端验证 TOFU/固定公钥策略。
7. 轮换所有会话：禁用后重新启用管理员，或撤销其全部会话。

## 恶意 Mod 下架

1. `POST /api/v1/bans` 封禁文件 SHA-256，阻止再次上传。
2. 吊销包含该哈希的 Release，必要时紧急停发。
3. 回滚到不含该文件的 Release。
4. `POST /api/v1/admin/gc` 删除无引用对象。
5. 审计日志应包含审核人、封禁原因和差异。
6. 通知玩家删除本地缓存：`Mods/.modplatform/cache/<sha>.zip`。

## 数据库迁移与回滚

- JSON → PostgreSQL：`node deploy/migrate-json-to-pg.js data/state/database.json $DATABASE_URL`
- 迁移记录在 `schema_migrations`。新迁移只追加，不改已应用 SQL。
- 回滚方案：恢复迁移前的 PostgreSQL 备份，并将应用镜像回退到上一版本。不要手工改 `platform_state`。

## 蓝绿 / 滚动发布

1. 新镜像必须包含本次构建的 `apps/web/dist`（Dockerfile 会在构建阶段执行 `npm run build:web`）。
2. 新容器先通过 `/health/live` 和 `/health/ready`（数据库、对象存储、签名服务均 ok），并确认 `GET /` 为 Vue 后台。
3. 多实例必须使用 `DATABASE_URL` 和共享对象存储，禁止多实例写同一 JSON 文件。
4. 反向代理切流量；旧实例排空后退出。
5. 失败则把代理指回旧实例，数据库按上一节回滚。应急管理页：`/legacy`。

## 维护公告

`POST /api/v1/admin/maintenance` 设置 `{ "enabled": true, "message": "..." }`。  
公开状态页：`GET /status`。

## 依赖与密钥扫描

API 运行时仍为零 npm 依赖；Docker 镜像构建阶段会临时安装 `apps/web` 依赖以产出 `dist`，启动前即删除。上线前仍应：

- 确认镜像基于官方 Node（当前 Dockerfile 为 `node:24-alpine`），并安装系统安全更新
- 扫描仓库与镜像，禁止把 `.env`、`*.pk8`、私钥提交进 Git
- 生产环境设置 `NODE_ENV=production`，从而禁止自动生成开发签名密钥，并关闭引导管理员令牌
