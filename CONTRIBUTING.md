# Contributing to Hordepin

[简体中文](#简体中文) · [English](#english)

## 简体中文

感谢你帮助改进 Hordepin。项目接受缺陷修复、文档、测试、翻译和经过讨论的新功能。提交代码即表示你同意按本仓库的 MIT 许可证授权你的贡献。

### 开始之前

- 安装 Node.js 22 或更高版本、npm、Git；修改插件时还需要 .NET SDK 8。
- 阅读 [行为准则](CODE_OF_CONDUCT.md)、[支持说明](SUPPORT.md) 和 [安全报告政策](SECURITY.md)。
- 普通缺陷和功能建议使用 GitHub Issue；安全漏洞不要公开提交 Issue。
- 大型功能、协议变化、数据迁移或破坏兼容性的改动，请先创建讨论 Issue，说明问题、方案、兼容性和迁移路径。

### 本地开发

```powershell
git clone https://github.com/lyretain/7d2d-mod-platform.git
cd 7d2d-mod-platform
npm --prefix apps/web ci
npm run check
npm run build:web
```

启动本地后台：

```powershell
$env:ADMIN_TOKEN = "replace-with-at-least-16-random-characters"
$env:PUBLIC_BASE_URL = "http://localhost:8080"
npm run start:ui
```

插件构建需要你合法安装的 7 Days to Die 或 Dedicated Server 程序集。不要上传、提交或在 Issue 中附带 `Assembly-CSharp.dll`、Unity 程序集、游戏资源、签名私钥、令牌或真实玩家日志。构建方法见 [插件指南](docs/PLUGIN.zh.md)。

### 版本与兼容性

`project-versions.json` 是平台、插件、协议、目标游戏版本和 Steam Build 的唯一版本事实源。修改插件版本时，同时更新两个 `plugins/*/ModInfo.xml`。不要直接在文档或运行时代码中引入另一套“当前版本”。

游戏版本、握手协议、manifest、数据库结构或安装布局变化必须包含：

- 自动化测试；
- 向后兼容说明；
- 必要的迁移或回滚步骤；
- 面向用户的变更说明。

### Pull Request 要求

1. 每个 PR 聚焦一个问题，并链接对应 Issue。
2. 用户可见变化同时更新中英文文档；无法同步翻译时在 PR 中明确标记。
3. 新功能和缺陷修复必须补测试；纯文档变更可不增加代码测试。
4. 提交前运行 `npm run check` 和 `npm run build:web`。
5. 不提交 `node_modules`、`dist`、`bin`、`obj`、构建产物、游戏文件、`.env` 或运行数据。
6. PR 描述需填写测试证据、风险、回滚方式和涉及的游戏/平台环境。

维护者可以要求拆分 PR、补充测试或先形成设计共识。合并并不保证立即发布。

## English

Thank you for improving Hordepin. Bug fixes, documentation, tests, translations, and discussed features are welcome. By submitting code, you agree to license your contribution under this repository's MIT License.

### Before you start

- Install Node.js 22+, npm, and Git. Plugin work also needs the .NET 8 SDK.
- Read the [Code of Conduct](CODE_OF_CONDUCT.md), [Support policy](SUPPORT.md), and [Security policy](SECURITY.md).
- Use GitHub Issues for normal bugs and feature requests. Never disclose a vulnerability in a public issue.
- Open a design issue before implementing a large feature, protocol change, data migration, or compatibility break.

### Local development

```powershell
git clone https://github.com/lyretain/7d2d-mod-platform.git
cd 7d2d-mod-platform
npm --prefix apps/web ci
npm run check
npm run build:web
```

Run the local service:

```powershell
$env:ADMIN_TOKEN = "replace-with-at-least-16-random-characters"
$env:PUBLIC_BASE_URL = "http://localhost:8080"
npm run start:ui
```

Plugin builds require assemblies from a lawfully installed copy of 7 Days to Die or its Dedicated Server. Never submit game assemblies, game assets, signing keys, tokens, or real player logs. See [Plugin build and installation](docs/PLUGIN.md).

### Versions and compatibility

`project-versions.json` is the single source of truth for platform, plugin, protocol, target game, and Steam Build versions. When changing the plugin version, update both `plugins/*/ModInfo.xml` files as well.

Changes to game compatibility, handshakes, manifests, database schemas, or installation layout must include tests, compatibility notes, migration or rollback steps, and user-facing release notes.

### Pull request requirements

1. Keep each PR focused and link its issue.
2. Update both English and Chinese documentation for user-visible changes, or clearly mark a translation follow-up.
3. Add tests for features and bug fixes.
4. Run `npm run check` and `npm run build:web` before submission.
5. Do not commit dependencies, build outputs, game files, secrets, `.env`, or runtime data.
6. Complete the test evidence, risk, rollback, and environment sections of the PR template.

Maintainers may request a smaller PR, more tests, or design consensus. Merge does not guarantee immediate release.
