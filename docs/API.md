# HTTP API

[English](API.md) · [简体中文](API.zh-CN.md)

Administrator routes require:

```http
Authorization: Bearer <ADMIN_TOKEN>
```

Session routes use the login Bearer token instead. Server-token routes use the one-time dedicated-server token.

## Routes

| Method | Route | Who | Purpose |
|---|---|---|---|
| GET | `/health` | Public | Liveness |
| GET | `/health/live` | Public | Liveness |
| GET | `/health/ready` | Public | Readiness (database, object store, signing) |
| GET | `/status` | Public | Maintenance banner, pause flag, and whether setup finished |
| POST | `/api/v1/setup` | Bootstrap token | Create the first community admin |
| GET | `/metrics` | Signed-in | Volume, latency, login failures, crash rate |
| GET | `/api/v1/public-key` | Public | Ed25519 public key and key ring |
| POST | `/api/v1/auth/register` | Public | Register; a community/developer invite upgrades the role |
| POST | `/api/v1/auth/activate` | Regular user | Activate with a developer invite |
| GET | `/api/v1/auth/github` | Signed-in | GitHub OAuth; community admins must bind |
| POST | `/api/v1/auth/github/bind` | Signed-in | Bind GitHub in development |
| POST | `/api/v1/auth/login` | Public | Sign in; 2FA returns `requiresTotp` |
| POST | `/api/v1/auth/login/totp` | Public | Finish sign-in with TOTP or a recovery code |
| POST | `/api/v1/auth/logout` | Signed-in | Revoke this session |
| GET | `/api/v1/auth/me` | Signed-in | Current account (`adultVerified` after age check) |
| POST | `/api/v1/auth/adult-confirm` | Signed-in | Confirm age with `{ birthYear, confirmed: true }` before browsing R18 |
| GET | `/api/v1/users` | Admin | User list |
| PATCH | `/api/v1/users/{id}` | Admin | Disable/enable or change role |
| POST | `/api/v1/users/{id}/reset` | Admin | Issue a password-reset token |
| POST | `/api/v1/auth/password` | Signed-in | Change your password |
| POST | `/api/v1/auth/password/reset` | Public | Set a new password with a reset token |
| GET | `/api/v1/sessions` | Signed-in | List sessions |
| DELETE | `/api/v1/sessions/{hash}` | Signed-in | Revoke a session |
| DELETE | `/api/v1/users/{id}/sessions` | Admin | Revoke every session for a user |
| POST | `/api/v1/auth/totp/setup` | Signed-in | Start 2FA |
| POST | `/api/v1/auth/totp/confirm` | Signed-in | Confirm 2FA |
| GET | `/api/v1/reviews` | Signed-in | Upload review queue |
| POST | `/api/v1/reviews/{sha256}` | Admin | Review and confirm license |
| POST | `/api/v1/bans` | Admin | Ban a file hash |
| GET | `/api/v1/diagnostics/matrix` | Signed-in | Compatibility matrix and crash-rate breaker |
| POST | `/api/v1/diagnostics/fingerprints/{id}/dismiss` | Admin | Dismiss a false positive |
| DELETE | `/api/v1/diagnostics` | Signed-in | Delete diagnostic data |
| POST | `/api/v1/admin/gc` | Admin | Collect unreferenced objects and expired diagnostics |
| POST | `/api/v1/admin/maintenance` | Admin | Maintenance banner |
| POST | `/api/v1/admin/webhooks` | Admin | Register an alert webhook |
| POST | `/api/v1/admin/signing/rotate` | Admin | Rotate the local signing key |
| GET | `/api/v1/mods` | Signed-in | Mod list; `?q=` searches id/name/author/description |
| GET | `/api/v1/mods/{id}` | Signed-in | Mod detail and version history |
| GET | `/api/v1/packs` | Signed-in | ModPack list |
| GET | `/api/v1/packs/{id}` | Signed-in | Draft vs current Release diff |
| GET | `/api/v1/servers` | Signed-in | Server online status and sync |
| GET | `/api/v1/admin/stats` | Signed-in | Downloads, bytes, game-version mix |
| POST | `/api/v1/admin/confirm` | Admin | Issue a dangerous-action confirm token |
| POST | `/api/v1/admin/cdn/purge` | Admin | Purge Cloudflare cache |
| POST | `/api/v1/invites` | Admin | Create an invite |
| GET | `/api/v1/invites` | Admin | Invite metadata |
| DELETE | `/api/v1/invites/{id}` | Admin | Revoke an invite |
| PUT | `/api/v1/artifacts/{sha256}` | Signed-in | Upload a small immutable ZIP in one request |
| POST | `/api/v1/artifacts/{sha256}/uploads` | Signed-in | Start or reuse a chunked upload session |
| GET | `/api/v1/artifacts/{sha256}/uploads/{uploadId}` | Signed-in | List received chunks (resume) |
| PUT | `/api/v1/artifacts/{sha256}/uploads/{uploadId}/{index}` | Signed-in | Upload one chunk |
| POST | `/api/v1/artifacts/{sha256}/uploads/{uploadId}/complete` | Signed-in | Assemble chunks and store the artifact |
| POST | `/api/v1/mods` | Admin | Register a Mod version (`r18` marks the whole mod) |
| PATCH | `/api/v1/mods/{id}` | Developer | Update catalog flags such as `r18` |
| PUT | `/api/v1/mods/{id}/slots` | Developer | Replace content-slot definitions |
| GET | `/api/v1/mods/{id}/contents` | Signed-in | Content market for a mod; `?slot=` filters |
| POST | `/api/v1/mods/{id}/slots/{slotId}/contents` | Signed-in | Submit a named model ZIP (`name`, `description`, `artifactSha`, optional `r18`) |
| PATCH | `/api/v1/contents/{id}` | Author or developer | Rename, edit description, or set `r18` |
| DELETE | `/api/v1/contents/{id}` | Author or developer | Remove a content entry |
| POST | `/api/v1/packs` | Admin | Create or update a ModPack draft |
| POST | `/api/v1/packs/{id}/releases` | Admin | Publish a signed release |
| POST | `/api/v1/servers` | Signed-in | Register a game server; regular users must set a public address |
| GET | `/api/v1/admin/state` | Admin | Inspect state; server token hashes are stripped |
| GET | `/api/v1/packs/{id}/releases` | Signed-in | List releases; flags that rollback may affect saves |
| POST | `/api/v1/packs/{id}/releases/{releaseId}/revoke` | Admin | Revoke a release |
| POST | `/api/v1/packs/{id}/rollback` | Admin | Point latest at a previous release |
| PATCH | `/api/v1/servers/{id}` | Signed-in | Edit your server; community admins can edit any |
| DELETE | `/api/v1/servers/{id}` | Signed-in | Delete your server; community admins can delete any |
| POST | `/api/v1/admin/distribution` | Superadmin / community | Emergency pause or resume (platform-wide) |
| GET | `/api/v1/admin/audit` | Signed-in | Audit log of mutating operations; optional `?action=` `?actor=` `?from=` `?to=` `?limit=` |
| POST | `/api/v1/servers/{id}/sync-status` | Server token | Dedicated-server sync heartbeat |
| GET | `/api/v1/diagnostics/summary` | Signed-in | Aggregated fingerprints |
| GET | `/api/v1/public/packs/{id}/latest` | Public | Latest signed manifest |
| GET | `/api/v1/public/launcher/latest?platform=win32` | Public | Signed launcher self-update manifest |
| POST | `/api/v1/admin/launcher` | Admin | Publish a launcher ZIP already stored as an artifact |
| POST | `/api/v1/admin/launcher/revoke` | Admin | Revoke the current launcher for a platform |
| GET | `/api/v1/admin/launcher` | Admin | Published launcher channels |
| GET | `/api/v1/public/artifacts/{sha256}` | Public | Immutable artifact |
| GET | `/api/v1/public/servers/resolve?address=host:port` | Public | Resolve a server to its pack (`?serverId=` also works) |
| POST | `/api/v1/public/handshakes` | Public | Client plugin deposits a pending hello |
| POST | `/api/v1/servers/{id}/pending-handshake/claim` | Server token | Server plugin consumes a pending hello by player id |
| GET | `/api/v1/servers/{id}/assignment` | Server token | Assignment and heartbeat |
| POST | `/api/v1/diagnostics` | Public, rate-limited | Bounded diagnostic event |

## Setup

While no user exists, `GET /status` has `initialized: false` and `/` only offers setup.

```json
{
  "token": "<ADMIN_TOKEN>",
  "username": "Owner",
  "password": "correct horse battery staple"
}
```

`POST /api/v1/setup` works once. The first account is an admin and the bootstrap token is disabled afterwards.

## Invite, register, sign in

Create an invite:

```json
{
  "role": "admin",
  "maxUses": 1,
  "expiresInHours": 168
}
```

The response `code` is shown once. The store keeps only the hash.

Register:

```json
{
  "username": "Alice.Admin",
  "password": "at-least-10-characters",
  "inviteCode": "inv_..."
}
```

Usernames are case-insensitive and allow letters, digits, `.`, `_`, and `-`. Passwords use a random salt and scrypt. The database never stores the plaintext.

Sign in:

```json
{
  "username": "Alice.Admin",
  "password": "user-password"
}
```

Success returns a Bearer session token and expiry. If TOTP is on, the response is `{ "requiresTotp": true, "ticket": "..." }`; then call `/api/v1/auth/login/totp`. Only the SHA-256 of the session token is stored. Sessions last 7 days by default and are deleted on logout.

Mods and content entries may set `r18: true`. Workshop lists include `r18`, `r18ContentCount`, and `redacted`. Until the signed-in user posts `/api/v1/auth/adult-confirm` with a birth year that is 18+ and `confirmed: true`, R18 names and descriptions are omitted. A birth year under 18 returns `403 UNDERAGE`. Bootstrap tokens and already-verified accounts skip the gate. `GET /api/v1/admin/state` strips `adultBirthYear`. Age confirmation is written to the audit log without the birth year.

Mutating API calls (register, login, catalog edits, pack publish, reviews, and similar) append to an unbounded audit log. Reads, ZIP chunk uploads, and server heartbeats are not logged. `AUDIT_RETENTION_DAYS=0` (the default) keeps entries forever; a positive day count prunes only during `POST /api/v1/admin/gc`.

With `REQUIRE_REVIEW=true` (or `NODE_ENV=production`), uploaded ZIPs are analyzed and enter review. DLL or high-risk files start as `pending`. Publish requires `licenseConfirmed=true`.

## Upload a Mod file

Hash the ZIP on the client. Files under about 8 MiB can be sent in one request:

```http
PUT /api/v1/artifacts/<sha256>
Content-Type: application/zip
Authorization: Bearer <ADMIN_TOKEN>
```

Larger files should be chunked so each request stays under Cloudflare's 100 MB upload limit. The default chunk size is 8 MiB and must be between 256 KiB and 32 MiB. An unfinished session with the same SHA-256, size, and chunk size is reused; chunks that already arrived are skipped:

```http
POST /api/v1/artifacts/<sha256>/uploads
{ "size": 114066860, "chunkSize": 8388608, "fileName": "Z_CustomAvatars.zip" }

GET /api/v1/artifacts/<sha256>/uploads/<uploadId>
# { "received": [0, 1, 4], "missing": [2, 3], "receivedBytes": ... }

PUT /api/v1/artifacts/<sha256>/uploads/<uploadId>/<index>
Content-Type: application/octet-stream

POST /api/v1/artifacts/<sha256>/uploads/<uploadId>/complete
```

The API hashes the assembled file. A URL hash that does not match never enters the object directory. The admin UI chunks ZIP files larger than 8 MiB and resumes from chunks that already reached the server.

## Register a Mod version

```json
{
  "id": "example-vehicles",
  "name": "Example Vehicles",
  "version": "1.2.0",
  "artifactSha": "64 lowercase hex characters",
  "gameVersions": ["3.0"],
  "gameVersionRange": "major",
  "installRoots": ["ExampleVehicles"],
  "containsDll": true,
  "requiresRestart": true,
  "installSide": "both",
  "dependsOn": ["harmony"],
  "r18": false
}
```

`installRoots` must match the ZIP top-level directories exactly. The updater refuses to overwrite a same-name folder the platform does not manage.

`installSide` is `both` (default), `server`, or `client`. Dedicated servers auto-update server and shared mods; players auto-update client and shared mods. Handshake fingerprints only include `both`.

`dependsOn` is a list of registered Mod IDs. Creating or publishing a Pack expands those prerequisites (including transitive ones) into `entries` so the updater downloads them automatically. Prerequisites are listed before the mods that need them.

`contentSlots` is an optional list of subfolders on the install root, for example `Avatars` and `Dances` on `Z_CustomAvatars`. The API also suggests slots from ZIP child folders and the ModInfo description. Content is a reusable catalog per mod, not one ZIP per slot:

```http
PUT /api/v1/mods/z-custom-avatars/slots
GET /api/v1/mods/z-custom-avatars/contents?slot=avatars
POST /api/v1/mods/z-custom-avatars/slots/avatars/contents
PATCH /api/v1/contents/{id}
DELETE /api/v1/contents/{id}
```

`PUT` replaces slot definitions. `POST .../contents` adds one named model (`name`, optional `description`, `artifactSha`, optional `r18`). The web and admin UIs can send several ZIPs in one picker; each file is submitted sequentially through this endpoint. Upload analysis records `previewPath` and `readmePath` when the ZIP contains a named preview image (`preview`/`cover`/`thumb`/…) or a `README`. Those paths are stored for a later preview/readme reader; bytes are not served yet. `PATCH /contents/{id}` updates `name`, `description`, and `r18`. Any signed-in role with `content.submit` may submit; production still requires review and a redistribution license. `GET /mods/{id}` includes `contentSlots`, approved `contents` (pending visible to staff/authors), `contentCounts`, `r18`, and `r18ContentCount`. Unverified viewers receive `redacted: true` with names, descriptions, and asset paths removed.

Pack `entries[]` may include `contents: { [slotId]: contentId[] }`. Unchecked slots install the framework only. Publishing writes each checked item as a manifest overlay: `id` is the content id, `path` is the slot directory. Several overlays may share the same `path`; the updater clears that subdirectory once, then merge-extracts each ZIP (later files overwrite). Use unique file names or subfolders inside each model ZIP. Legacy `slotContents` migrates to unnamed content entries and is not auto-selected into existing pack drafts.

## Create a ModPack

Omit `id` to get `pack_<uuid>`. An existing `id` updates that draft.

```json
{
  "name": "Production pack",
  "gameVersion": "3.0.1-b4",
  "entries": [
    {
      "modId": "example-vehicles",
      "version": "1.2.0",
      "required": true,
      "contents": {
        "avatars": ["cnt_..."]
      }
    }
  ]
}
```

If a Mod version declares compatible game versions and the Pack version is outside that range, create fails. With `gameVersionRange` `major`, a `3.0` Mod can enter a `3.10.14` Pack but not `4.0`. Unchecked still means exact match.

## Publish a ModPack

```http
POST /api/v1/packs/production-pack/releases
Authorization: Bearer <ADMIN_TOKEN>
Content-Type: application/json

{}
```

Publish writes an immutable manifest and signs it with Ed25519. Editing the draft does not change older releases.

## Register a game server

```json
{
  "name": "Tokyo PVE",
  "packId": "production-pack",
  "publicAddresses": ["192.168.3.42:26900", "game.example.com:26900"]
}
```

`publicAddress` is still accepted as a single value. Addresses are optional; resolve and handshake prefer `serverId`. `GET /api/v1/public/servers/resolve?serverId=` or `?address=` both work. Several servers may register the same LAN address. The server plugin merges listen addresses with `PUT /api/v1/servers/:id/addresses`.

The response `config` matches plugin `server.config.json` (`BaseUrl`, `ServerId`, `ServerToken`, `GameVersion`, `RefreshSeconds`, `HandshakeTimeoutSeconds`). The token is returned once; paste it over the plugin file immediately.

## Submit a diagnostic

```json
{
  "sessionId": "uuid",
  "side": "client",
  "gameVersion": "3.0.1-b4",
  "packId": "production-pack",
  "packVersion": 3,
  "stage": "game_startup",
  "exceptionType": "TypeLoadException",
  "message": "error text",
  "stackTrace": "stack",
  "logExcerpt": "bounded log excerpt",
  "occurredAt": "2026-07-14T12:00:00Z"
}
```

The API redacts credentials, IPs, home directories, and player platform ids, then fingerprints from game version, exception type, normalized stack, and ModPack.
