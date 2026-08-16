# Security model

## Enforced in this MVP

- Ed25519 signed canonical manifests.
- Content-addressed immutable artifacts with SHA-256 verification.
- Download size verification and timeouts.
- ZIP traversal, absolute path, drive path, symlink, duplicate path, encryption, unsupported compression, entry-count and decompressed-size protections.
- ZIP CRC verification.
- Staging installation, ownership tracking, backups and rollback on failed replacement.
- Signed-manifest install roots are adopted if the folder already exists; Harmony, `TFP_*`, and plugin directories stay protected.
- Server credentials stored as SHA-256 token hashes.
- Diagnostic request limits and server-side redaction.
- No game server receives the platform signing private key.

## Required before public production

- Put HTTPS in front of the service.
- Store the signing key in KMS/HSM instead of the development key file.
- Replace the single-node JSON metadata store and local object directory with PostgreSQL and S3-compatible storage for multi-instance deployment.
- Add malware scanning and manual approval for uploaded DLLs.
- Add reverse-proxy rate limits to diagnostics, downloads and authentication failures.
- Add organization accounts, RBAC, audit logs, key rotation and release revocation UI.
- Obtain redistribution permission for every hosted Mod.
- Package the updater as a signed standalone executable and publish its checksum.
- The portable launcher already verifies Ed25519-signed self-update ZIPs against the pinned platform key; Authenticode on `ModPlatformLauncher.exe` is still recommended for first install.
- Perform a game-version-specific review of the 7DTD adapter before release.

Never silently install a DLL from a manifest that was not verified against a pinned key. EAC compatibility is outside this project; DLL/Harmony Mods generally require EAC to be disabled.
