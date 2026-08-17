# Security model

[English](SECURITY.md) · [简体中文](SECURITY.zh.md)

This document describes engineering controls. To report a vulnerability privately, follow the repository-root [Security Policy](../SECURITY.md); do not open a public issue.

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

Password reset, 2FA, recovery codes, account disablement, session revocation, and persistent rate limiting are implemented. Public deployments should still validate proxy IP handling, the 2FA recovery procedure, and audit retention.

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

Telemetry controls, diagnostic retention, user deletion, and audited administrative access are implemented. A public community operator should still provide:

- a privacy notice
- the public instance operator and contact channel
- a third-party Mod complaint, takedown, and data-request process

## Still required before public production

- Code-signed client updater
- Listen-server host mode and Linux dedicated-server validation
- PostgreSQL integration, browser end-to-end, and concurrent load-test gates
- Operator drills for restore, rollback, key compromise, and emergency distribution stop
- Actual production enablement of HTTPS, formal signing, rate limiting, malware scanning, and redistribution review on each public instance
- A published privacy notice and third-party content complaint/takedown process

Never silently install a DLL from a manifest that was not verified against a pinned key. EAC compatibility is outside this project; DLL/Harmony Mods generally require EAC off.
