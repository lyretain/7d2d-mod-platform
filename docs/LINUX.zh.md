# Linux 上线（宝塔）

[English](LINUX.md) · [简体中文](LINUX.zh.md)

最后更新：2026-09-08。适合 Ubuntu 22.04 / 24.04 和 Rocky / Alma / Stream 8、9。不要用 CentOS 7。不用宝塔见文末。

**记住三件事：** 用 PostgreSQL（不要 MySQL）；单机不要配 S3；环境变量必须填进宝塔项目，仓库里的 `.env` 进程读不到。

需要：Node.js **22**、PostgreSQL **14+**。本项目不是 Python 应用。申请证书时系统 Python 3.9+ 即可（Ubuntu 自带 3.10/3.12）。

## 1. 装软件、建库

软件商店安装 **Nginx、Node.js 22、PostgreSQL**。建用户和库，都叫 `modplatform`。

```bash
mkdir -p /www/mod-platform-data
chown -R www:www /www/mod-platform-data
```

代码放到 `/www/wwwroot/hordepin`（或你的站点目录）。然后：

```bash
cd /www/wwwroot/hordepin
npm --prefix apps/web install
npm run build:web
```

测库（宝塔的 `psql` 常在 `/www/server/pgsql/bin/psql`）：

```bash
/www/server/pgsql/bin/psql "postgres://modplatform:密码@127.0.0.1:5432/modplatform" -c 'SELECT 1'
```

## 2. 签名私钥（生产必填，缺了会假活）

进程能起来但 **8080 不监听**，多半缺这项。

```bash
openssl genpkey -algorithm ED25519 -out /www/mod-platform-data/signing.pk8
chmod 600 /www/mod-platform-data/signing.pk8
chown www:www /www/mod-platform-data/signing.pk8
openssl pkey -in /www/mod-platform-data/signing.pk8 -outform DER | base64 -w 0
```

把输出填进 `SIGNING_PRIVATE_KEY`，并单独备份。换密钥后旧 manifest 会失效。

## 3. 宝塔 Node 项目

不要点「一键安装模块」。API **没有** npm 运行时依赖，模块列表为空是正常的。

| 项 | 填什么 |
|---|---|
| Node 版本 | v22 |
| 启动文件 | `/www/wwwroot/hordepin/apps/api/src/server.js` |
| 运行目录 | `/www/wwwroot/hordepin`（仓库根，不要填到 `apps/api/src`） |
| 实例数 | **1**（不要 cluster） |
| 项目端口 | 8080 |
| 运行用户 | www |
| 环境变量 | 见下一节，必须填进这个框 |

用 **Node 项目管理器 / PM2**，不要 SSH 里直接 `node`。

## 4. 环境变量

模板：[`.env.baota.example`](../.env.baota.example)。最少这些：

```env
HOST=127.0.0.1
PORT=8080
NODE_ENV=production
PUBLIC_BASE_URL=https://你的域名
PUBLIC_LAUNCHER_URL=https://你的域名
PUBLIC_CDN_URL=https://你的域名
CDN_STYLE=origin
DATA_DIR=/www/mod-platform-data
DATABASE_URL=postgres://modplatform:密码@127.0.0.1:5432/modplatform
ADMIN_TOKEN=至少16位随机串
ALLOW_BOOTSTRAP_ADMIN=false
FORCE_HTTPS=true
TRUSTED_PROXY=true
SIGNING_PRIVATE_KEY=第二节生成的Base64
```

`S3_*` 留空。`ALLOW_BOOTSTRAP_ADMIN` 保持 `false`，首次 `/setup` 也能用 `ADMIN_TOKEN`。`HOST` 用 `127.0.0.1`，不要 `0.0.0.0`。

密码里若有 `@` `#` `%` `/`，`DATABASE_URL` 里要做 URL 编码。

## 5. 网站反代

站点根目录用仓库根，不要用 `apps/api/src`。申请 SSL，**整站**反代到 `http://127.0.0.1:8080`。

不要填 `https://你的域名`（会打回 Cloudflare，变成 502）。只放行 80/443。Cloudflare SSL 用 Full 或 Full (strict)。

## 6. 验收

```bash
ss -lntp | grep 8080
curl -sS http://127.0.0.1:8080/health
curl -sS http://127.0.0.1:8080/health/ready
```

应看到 `127.0.0.1:8080`，两个接口返回 JSON。打开域名进入 `/setup`，建第一位管理员，之后用账户登录。

## 7. 常见问题

| 现象 | 原因 |
|---|---|
| 启动马上停 | 环境变量没进项目，缺 `ADMIN_TOKEN` |
| 面板显示运行中，502 / `Connection refused` | 缺 `SIGNING_PRIVATE_KEY`，或卡在连库；进程没在听 8080 |
| `ss` 没有 8080 | `tr '\0' '\n' < /proc/进程PID/environ \| grep SIGNING_` 看密钥在不在 |
| 模块管理是空的 | 正常，不要一键安装 |
| 上传 413 | Nginx `client_max_body_size` 调到 `2048m` |

## 8. 升级与备份

```bash
cd /www/wwwroot/hordepin
git pull
npm --prefix apps/web install
npm run build:web
# 宝塔里重启 Node 项目

/www/server/pgsql/bin/pg_dump -Fc modplatform > /root/modplatform.dump
tar -czf /root/data.tgz -C /www mod-platform-data
```

库、`objects/`、签名私钥必须一起备份。

## 不用宝塔（裸机）

目录：代码 `/opt/mod-platform`，数据 `/var/lib/mod-platform`，变量 `/etc/mod-platform/env`（systemd `EnvironmentFile`）。单元和 Nginx 模板在 `deploy/linux/`。

Ubuntu 装 `nodejs`（NodeSource 22）、`postgresql`、`nginx`。CentOS 系用 `dnf` + PGDG 的 `postgresql-16`。只开 80/443；CentOS 还要 `setsebool -P httpd_can_network_connect 1`。

本机开发、Docker、CI 见 [DEPLOYMENT.zh.md](DEPLOYMENT.zh.md)。
