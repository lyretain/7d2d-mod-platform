# Production runbook

[English](RUNBOOK.md) · [简体中文](RUNBOOK.zh.md)

Goal: restore the API, object files, and signing on a clean machine inside the target RTO.

Suggested targets:

| Metric | Target | Notes |
|---|---|---|
| RPO | 1 hour | Metadata and object inventory at least hourly |
| RTO | 2 hours | Fresh-box restore of API, objects, and verification |

## Daily backups

These must be backed up together:

1. PostgreSQL: `deploy/backup-postgres.ps1 -DatabaseUrl $env:DATABASE_URL`, or `data/state/database.json` in JSON mode
2. Object store: S3/MinIO versioning or a snapshot of `data/objects/`
3. Signing material: `SIGNING_PRIVATE_KEY`, remote signing credentials, or `data/state/keyring.json` and the development key (test only)
4. Config: `.env`, reverse proxy, DNS, CDN

Restore drill: once a quarter, restore a backup on an empty machine, pull the latest manifest with the updater, and verify the signature.

## Emergency ModPack rollback

1. Open the console or call `GET /api/v1/packs/:id/releases` and confirm the last known-good Release.
2. `POST /api/v1/packs/:id/releases/:releaseId/revoke` with a clear reason.
3. `POST /api/v1/packs/:id/rollback` with that `releaseId`. Rollback can affect saves.
4. To stop downloads immediately: `POST /api/v1/admin/distribution` with `{ "paused": true }`.
5. Channels should receive the webhook; player updaters see 503.
6. After the console recovers, the server guardian syncs the rolled-back Pack.

## Key leak

1. Pause distribution: `POST /api/v1/admin/distribution` `{ "paused": true }`.
2. Local key: rotate in an isolated environment with `POST /api/v1/admin/signing/rotate`, or replace `SIGNING_PRIVATE_KEY` and restart.
3. `SIGNING_SERVICE_URL`: rotate on the signing service. The app process never sees the private key.
4. Revoke the old `keyId`. Installed clients reject revoked or unknown keys.
5. Republish the current Pack so new manifests use the new key.
6. Before resuming, verify TOFU / pinned-key policy on a clean client.
7. Rotate sessions: disable then re-enable admins, or revoke all of their sessions.

## Malicious Mod takedown

1. `POST /api/v1/bans` to ban the file SHA-256 and block re-upload.
2. Revoke Releases that contain that hash; pause distribution if needed.
3. Roll back to a Release that does not contain the file.
4. `POST /api/v1/admin/gc` to delete unreferenced objects.
5. The audit log should include reviewer, ban reason, and the diff.
6. Tell players to delete the local cache: `Mods/.modplatform/cache/<sha>.zip`.

## Database migrate and rollback

- JSON → PostgreSQL: `node deploy/migrate-json-to-pg.js data/state/database.json $DATABASE_URL`
- Migrations are recorded in `schema_migrations`. New migrations only append; do not edit applied SQL.
- Rollback: restore the pre-migration PostgreSQL backup and roll the app image back. Do not edit `platform_state` by hand.

## Blue/green and rolling deploys

1. The new image must include this build’s `apps/web/dist` (the Dockerfile runs `npm run build:web`).
2. New containers must pass `/health/live` and `/health/ready` (database, object store, signing all ok) and `GET /` must be the Vue console.
3. Multiple instances must use `DATABASE_URL` and shared object storage. Do not let several instances write one JSON file.
4. Cut traffic on the reverse proxy; drain old instances, then stop them.
5. On failure, point the proxy back and roll the database as above. Emergency console: `/legacy`.

## Maintenance banner

`POST /api/v1/admin/maintenance` with `{ "enabled": true, "message": "..." }`.  
Public status: `GET /status`.

## Dependency and secret scanning

The API still has zero npm runtime dependencies. The Docker image install of `apps/web` is temporary to produce `dist` and is deleted before start. Before go-live:

- Confirm the image is official Node (current Dockerfile is `node:24-alpine`) and apply OS security updates
- Scan the repo and image; never commit `.env`, `*.pk8`, or private keys
- Set `NODE_ENV=production` so development signing keys are not auto-generated and the bootstrap admin token stays off
