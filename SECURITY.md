# Security Policy

[简体中文](#简体中文) · [English](#english)

## 简体中文

### 支持范围

安全修复优先提供给默认分支和最新 GitHub Release。旧版本可能不会单独修复；报告者应注明受影响的平台、插件、协议和游戏版本。

### 私密报告漏洞

请使用本仓库 GitHub 页面 **Security → Report a vulnerability** 提交私密漏洞报告。如果该入口暂不可用，请联系仓库所有者请求私密沟通方式，不要创建公开 Issue。

报告应包含影响、受影响版本、复现步骤或最小 PoC、攻击前提和建议缓解措施。不要附带真实私钥、令牌、玩家数据、他人私有 Mod 或游戏专有程序集；可以提供已脱敏的样本。

维护者目标是在 7 天内确认收到报告，并在确认影响后协调修复与披露。实际修复时间取决于严重程度和游戏兼容性。修复发布前，请不要公开漏洞细节。

### 范围

欢迎报告认证/授权绕过、签名或更新链破坏、路径穿越、恶意 ZIP、远程代码执行、密钥或隐私泄露、服务端请求伪造以及可跨租户/用户利用的问题。普通安装问题、仅影响已被完全信任管理员的操作、第三方 Mod 自身漏洞和没有安全影响的崩溃应使用普通 Issue。

工程安全设计和部署加固见 [docs/SECURITY.zh.md](docs/SECURITY.zh.md)。

## English

### Supported versions

Security fixes target the default branch and latest GitHub Release. Older releases may not receive individual patches. Include the affected platform, plugin, protocol, and game versions in a report.

### Reporting a vulnerability privately

Use **Security → Report a vulnerability** on this repository's GitHub page. If private vulnerability reporting is unavailable, contact the repository owner to arrange a private channel; do not open a public issue.

Include impact, affected versions, reproduction steps or a minimal proof of concept, prerequisites, and suggested mitigations. Do not attach real private keys, tokens, player data, private third-party Mods, or proprietary game assemblies. Redacted samples are welcome.

Maintainers aim to acknowledge reports within seven days and coordinate remediation and disclosure after validation. Resolution time depends on severity and game compatibility. Do not disclose details before a coordinated release.

Authentication or authorization bypasses, update/signature-chain compromise, traversal, malicious archives, remote code execution, secret or privacy exposure, SSRF, and cross-user issues are in scope. Setup questions, trusted-administrator-only behavior, third-party Mod vulnerabilities, and crashes without security impact belong in normal Issues.

See [docs/SECURITY.md](docs/SECURITY.md) for engineering controls and deployment hardening.
