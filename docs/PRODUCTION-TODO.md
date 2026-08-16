# Production TODO

[English](PRODUCTION-TODO.md) · [简体中文](PRODUCTION-TODO.zh-CN.md)

Last reviewed: 2026-08-16

Status: P0, P1, and the admin API/console are in place. CDN is designed for Cloudflare (origin cache or an R2 custom domain). The Windows client plugin and Windows dedicated server have passed a live join on V 3.1.0 / Steam Build 24436778. Still open: listen-server host mode, Linux dedicated server, Authenticode on the launcher, and Postgres/browser/load-test gates. Launcher Ed25519 self-update and the standalone Vue console are done.

## Definition of done

Call it “ready for public production” only when all of these are true:

- Players can check, download, install, restart, and reconnect from the server join path
- Incompatible clients cannot enter the world
- API, database, object store, signing, and the client updater all have production controls
- Live 7 Days to Die client and dedicated-server tests have passed
- Backup, restore, rollback, and emergency revoke have been rehearsed
- Every hosted Mod has an explicit redistribution grant

## P0: core loop

### Current game version

- [x] Rebuild the client plugin against Steam Build `24436778` (game `V 3.1.0`) `Assembly-CSharp.dll`
- [x] Rebuild the server plugin against Steam Build `24436778` (game `V 3.1.0`) `Assembly-CSharp.dll`
- [x] Recheck `IModApi`, logging, network packages, and event callbacks
- [x] Write Steam Build ID, game version, and protocol version into plugin artifacts
- [x] Client plugin start test passed
- [ ] Listen-server / host mode test passed
- [x] Windows dedicated server test passed
- [ ] Linux dedicated server test passed
- [ ] Game updates automatically rebuild plugins and run compatibility tests

Accept: plugins load on the current stable 7 Days to Die build and report the correct game version and build id.

### Native client–server handshake

- [x] Define the handshake protocol version
- [x] Client sends plugin version, game version, Build ID, Pack ID, and Pack version
- [x] Server returns required Pack, manifest version, and signing key id
- [x] Server detects players without the client plugin
- [x] Missing plugin shows a clear download or install hint
- [x] Incompatible game versions are refused
- [x] ModPack mismatch blocks world entry
- [x] After sync, re-check and allow entry
- [x] Clients cannot trivially spoof “already synced” (compare installed-file fingerprints; a custom fake plugin can still lie)
- [x] Handshake timeout, retry, and reason codes
- [x] Handshake audit and diagnostic events

Accept: unsynced clients cannot enter; a correctly synced client enters without an admin.

### Standalone client launcher

- [x] Windows portable folder and EXE entry that does not need global Node.js (`deploy/build-launcher.ps1` ships `node.exe`)
- [x] Discover Steam and the 7 Days to Die install
- [x] Discover user data and Mods
- [x] Enter, favorite, and pick servers
- [x] Resolve the server’s ModPack
- [x] Show pending installs, updates, and removals
- [x] Mark DLL/Harmony Mods
- [x] Show total size, speed, progress, and ETA
- [x] Cancel, retry, and HTTP Range resume
- [x] Start the game after download
- [x] Restart after DLL updates
- [x] Reconnect to the original server
- [x] Detect EAC and offer the correct launch option
- [ ] Authenticode-sign the launcher binary
- [x] Secure launcher self-update

Accept: a new Windows player installs the launcher once, then one-clicks into a server.

### Server auto-sync and start/stop guard

- [x] Server fetches the signed manifest
- [x] Verify signature, size, and SHA-256
- [x] Download and install missing server Mods
- [x] Back up the current ModPack before update
- [x] Roll back on failed update
- [x] Guardian starts the dedicated server after sync when a restart is required
- [x] Do not open player connections until sync finishes
- [x] Use the last good manifest when the API is down
- [x] Stop infinite restart loops after repeated failures
- [x] Report server sync status and faults

Accept: after the console switches a server Pack, the dedicated server updates or rolls back unattended.

### Publish, revoke, rollback

- [x] Release list API
- [x] Release revoke API
- [x] ModPack rollback API
- [x] Change the Pack bound to a server
- [x] Emergency distribution pause
- [x] Clients reject revoked releases
- [x] Servers reject revoked releases
- [x] Warn that rollback may affect saves
- [x] Store approver, time, reason, and diff
- [x] Audit every publish action

Accept: roll back or stop a bad version from the console without editing database files.

## P1: production infrastructure

### Database and object store

- [x] Move JSON metadata to PostgreSQL
- [x] Versioned schema migrations
- [x] Indexes for hot queries
- [x] Connection pool and transactions
- [x] Mod files on S3/MinIO/R2/OSS
- [x] Immutable object keys
- [x] CDN
- [x] Chunked or streaming upload
- [x] Garbage-collect unreferenced objects
- [x] Database vs object-store consistency check
- [x] JSON single-node migration tool

Accept: the API can run multiple instances without lost writes.

### Keys and signing

- [x] Ed25519 private key in KMS/HSM or a signing service
- [x] App process cannot export the private key
- [x] Signing-key rotation
- [x] Manifests accept multiple valid public keys
- [x] Old-key revoke and overlap window
- [x] Manifest expiry
- [x] Clients reject expired, unknown, or revoked manifests
- [x] Pinned public key shipped or delivered safely
- [x] Production cannot auto-generate a development key

Accept: compromising one API box is not enough to forge a valid ModPack.

### Upload analysis and supply chain

- [x] Automatic ZIP structure check
- [x] Read `ModInfo.xml`
- [x] Detect top-level install roots
- [x] Detect DLL, Harmony, AssetBundle, and POI
- [x] Extract assembly names and dependencies
- [x] Detect duplicate assemblies and dependency clashes
- [x] Isolate uploads and virus-scan
- [x] Static DLL rule scan
- [x] Uploads start in review
- [x] Record uploader, author, source, license, and reviewer
- [x] Block publish without a confirmed redistribution license
- [x] Generate an SBOM
- [x] Emergency file-hash ban

Accept: an admin cannot publish an unchecked DLL from hand-typed metadata alone.

### Client update reliability

- [x] Stream ZIP checks and extraction
- [x] Avoid loading a large ModPack entirely into memory
- [x] HTTP Range resume
- [x] Concurrent download cap
- [x] Bandwidth cap
- [x] Disk-space check before download
- [x] Recheck the target directory before install
- [x] Rehash installed files
- [x] Per-server config or profile
- [x] Safe switch between server Packs
- [x] Clean expired cache and old backups
- [x] Resume interrupted install transactions
- [x] Optional delta updates

Accept: large Packs, dropped networks, full disks, and process crashes do not corrupt the current install.

### Console accounts and permissions

- [x] User list
- [x] Disable and enable accounts
- [x] Change roles
- [x] Change password
- [x] Safe password reset
- [x] List and revoke sessions
- [x] Revoke every session for a user
- [x] TOTP 2FA
- [x] Recovery codes
- [x] Audit login, invites, and permission changes
- [x] Move in-memory login limits to Redis or the database
- [x] Disable the bootstrap admin token in production

Accept: the full account lifecycle works without editing the database.

### Diagnostics and compatibility

- [x] Client and server record successful starts
- [x] Report full Mod id, version, and hash lists
- [x] Compute failures, successes, and crash rate
- [x] Aggregate by game version, Mod version, and Mod combination
- [x] Confirmed / highly suspected / unknown conclusions
- [x] Offline event queue
- [x] Flush after the network returns
- [x] Retention cleanup
- [x] User delete-diagnostics API
- [x] Dismiss false positives
- [x] Email, webhook, or chat alerts
- [x] Stop new client installs when the failure rate crosses a threshold
- [x] Compatibility matrix

Accept: the console can prove a Mod version’s compatibility from success and failure samples, not only stack traces.

## P1: network and runtime safety

### Edge

- [x] Force HTTPS on all public access
- [x] HSTS
- [x] Security response headers
- [x] Separate admin host or path protection
- [x] Separate rate limits for login, register, invites, diagnostics, and downloads
- [x] Upload size and request timeouts
- [x] Reverse-proxy access logs
- [x] Do not trust client IPs from an unconfigured proxy
- [x] Brute-force and invite-enumeration protection
- [x] WAF or basic malicious-request rules
- [x] CSRF/XSS checks on the console
- [x] Dependency and secret scanning

### Audit and observability

- [x] Structured logs
- [x] Request trace id
- [x] Metrics: volume, latency, errors, download bandwidth
- [x] Metrics: register, login failures, invite use
- [x] Metrics: client sync success and crash rate
- [x] Liveness vs readiness
- [x] Dependency checks for database, object store, and signing
- [x] Immutable admin audit log
- [x] Alert rules and channels
- [x] Separate retention for logs, metrics, and diagnostics

## P1: backup, restore, operations

- [x] Automatic PostgreSQL backups
- [x] Object-store versioning or replication
- [x] Signing-key backup and restore
- [x] Config and secret inventory
- [x] Periodic restore drills
- [x] RPO and RTO
- [x] Blue/green or rolling deploys
- [x] Database migration rollback
- [x] ModPack emergency-rollback runbook
- [x] Key-leak runbook
- [x] Malicious-Mod takedown runbook
- [x] Status page and maintenance banner

Accept: restore API, files, and signing on a clean box inside the RTO.

## P2: console product

- [x] Split the embedded HTML into a standalone frontend
- [x] Mod list, filters, detail, and version history
- [x] ModPack edit, diff preview, and publish confirm
- [x] Server list, online status, and Pack binding
- [x] Users, roles, sessions, and invites
- [x] Release history, revoke, and rollback
- [x] Fault trends and compatibility matrix
- [x] Downloads, bandwidth, and client-version stats
- [x] Audit-log search
- [x] Bulk actions and second confirm for dangerous ops
- [x] Chinese / English UI
- [x] Usable on a phone

## P2: tests and quality gates

- [x] API unit tests cover main success and failure paths
- [ ] Database integration tests
- [x] Object-store integration tests
- [ ] Browser end-to-end tests
- [x] Launcher install and update tests
- [x] Live Windows client game tests
- [x] Windows dedicated-server tests
- [ ] Linux dedicated-server tests
- [x] Client–server handshake compatibility tests
- [x] Large ZIP and ZIP64 tests
- [x] Offline, timeout, and download-resume tests
- [ ] Concurrent upload/download load tests
- [x] Malicious ZIP, traversal, and zip-bomb tests
- [x] Auth, permission, and session tests
- [x] Every release runs tests and writes a report
- [x] Failed tests block a production release

## Suggested order

1. ~~Rebuild plugins for the current Build and live-start them~~ (Windows client and dedicated server accepted)
2. ~~Client–server handshake and pre-world gate~~ (Windows join accepted)
3. Authenticode on the standalone launcher (Ed25519 self-update is done)
4. Listen-server host mode and Linux dedicated server
5. Rebuild plugins automatically after a game update
6. Human drill of backup, restore, rollback, and emergency revoke
7. Console split and i18n, plus Postgres / browser / load-test gates

## First production milestone

Keep the first milestone to:

- [x] Plugins compile for the current game (`V 3.1.0` / Build `24436778`)
- [x] Live Windows handshake blocks incompatible players and allows entry after sync
- [ ] Standalone launcher is Authenticode-signed and can sync, start, reconnect, and self-update in one click
- [x] Windows dedicated server auto-syncs the Pack
- [ ] An admin has rehearsed revoke, rollback, and emergency pause from the runbook

The Windows plugin loop is there. Before opening to outside players, still do Authenticode, confirm the production API deploy, and rehearse licenses plus operations.
