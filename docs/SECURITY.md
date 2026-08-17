# Security model

[English](SECURITY.md) · [简体中文](SECURITY.zh.md)

## Enforced in this MVP

- Manifests are Ed25519-signed
- Mod ZIPs are SHA-256 content-addressed
- Clients verify the signature before using artifact URLs from the manifest
- After download, size and SHA-256 are checked
- ZIP CRC is checked on extract
- Absolute paths, drive paths, and `..` traversal are rejected
- ZIP symlinks, encrypted entries, and unsupported compression are rejected
- Entry count, per-file size, and total decompressed size are capped
- Duplicate paths are rejected with Windows case-insensitive rules
- Extract to a staging directory, then replace
- Platform-managed folders are recorded; player-private Mods are not overwritten by default
- Old folders are backed up before update and rolled back on failure
- Game servers keep only their own token, never the platform signing private key
- Only server-token hashes are stored
- User passwords use a random salt and scrypt
- Invites and login sessions store SHA-256 only
- Failed logins are temporarily limited per IP and username
- `ADMIN_TOKEN` is disabled after the first user by default
- Diagnostic requests are size-limited and redacted on the server

## Console account security

- Register requires an unexpired, unrevoked invite that still has uses (community/developer roles); regular users may register openly
- Admin invites and read-only invites are different roles
- Admin invite plaintext is shown once
- Passwords must be 10–128 characters
- Usernames compare case-insensitively to avoid duplicates
- Sessions expire in 7 days and are revoked immediately on logout
- Enable `ALLOW_BOOTSTRAP_ADMIN=true` only for emergency recovery

Public deploys should still add password reset, 2FA, an account-disable UI, and durable distributed rate limits where those are not already on.

## Key trust

The first client connection uses TOFU (trust on first use) to store the platform public key. A later key change stops updates.

For production, ship the trusted public key with a code-signed client updater and pass `--public-key` so the first connection cannot be MITM’d.

Never put the private key on:

- a game server
- a client
- a git repository
- a public Docker image
- an unencrypted ordinary config file

## DLL risk

A 7 Days to Die Mod DLL can run native code. A correct ZIP and signature only prove the platform published it, not that the code is safe.

A production platform must:

- show clearly whether a ZIP contains DLLs
- require the user to confirm third-party DLL installs
- virus-scan and statically inspect DLLs
- keep uploader, source, license, and review records
- support emergency revoke of a bad version
- refuse arbitrary download URLs from a game server

## Diagnostic privacy

Do not upload full logs by default. Clients should send a short window around the error. The API also strips:

- Bearer tokens
- passwords, secrets, and API keys
- Windows/Linux home directories
- IPv4 addresses
- Steam/EOS player ids

Public deploys should also provide:

- a telemetry switch
- a retention period
- a user data-deletion path
- a privacy notice
- audit of admin access to diagnostics

## Still required before public production

- HTTPS
- KMS/HSM-backed signing
- PostgreSQL and object storage
- Admin accounts, RBAC, and audit logs
- Malware scan and human review of uploaded DLLs
- Rate limits on diagnostics, downloads, and login
- Signing-key rotation and a release-revoke UI
- Code-signed client updater
- Redistribution-license review for hosted Mods
- Full online and security tests on the current game version

Never silently install a DLL from a manifest that was not verified against a pinned key. EAC compatibility is outside this project; DLL/Harmony Mods generally require EAC off.
