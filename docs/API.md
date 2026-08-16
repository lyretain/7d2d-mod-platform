# HTTP API

All administrator routes require `Authorization: Bearer <ADMIN_TOKEN>`.

| Method | Route | Purpose |
|---|---|---|
| GET | `/health` | Liveness check |
| GET | `/api/v1/public-key` | Ed25519 SPKI public key |
| POST | `/api/v1/auth/register` | Register with an invitation code |
| POST | `/api/v1/auth/login` | Create a login session |
| POST | `/api/v1/auth/logout` | Revoke the current login session |
| GET | `/api/v1/auth/me` | Return the current account |
| POST | `/api/v1/invites` | Create an invitation as an administrator |
| GET | `/api/v1/invites` | List invitation metadata |
| DELETE | `/api/v1/invites/{id}` | Revoke an invitation |
| PUT | `/api/v1/artifacts/{sha256}` | Upload immutable ZIP |
| POST | `/api/v1/mods` | Register a Mod version |
| POST | `/api/v1/packs` | Create or update a ModPack draft |
| POST | `/api/v1/packs/{id}/releases` | Publish an immutable signed release |
| POST | `/api/v1/servers` | Register a game server and return its token once |
| GET | `/api/v1/admin/state` | Inspect state; server token hashes are removed |
| GET | `/api/v1/packs/{id}/releases` | List releases; response flags that rollback may affect saves |
| POST | `/api/v1/packs/{id}/releases/{releaseId}/revoke` | Revoke a release |
| POST | `/api/v1/packs/{id}/rollback` | Point the pack back at a previous release |
| PATCH | `/api/v1/servers/{id}` | Change the bound pack or public address |
| POST | `/api/v1/admin/distribution` | Emergency pause or resume distribution |
| GET | `/api/v1/admin/audit` | Publication audit log |
| POST | `/api/v1/servers/{id}/sync-status` | Dedicated-server sync heartbeat |
| GET | `/api/v1/diagnostics/summary` | Aggregated fingerprints |
| GET | `/api/v1/public/packs/{id}/latest` | Retrieve signed manifest |
| GET | `/api/v1/public/artifacts/{sha256}` | Retrieve immutable artifact |
| GET | `/api/v1/public/servers/resolve?address=host:port` | Resolve a server to its pack |
| GET | `/api/v1/servers/{id}/assignment` | Server-authenticated assignment and heartbeat |
| POST | `/api/v1/diagnostics` | Submit bounded diagnostic event |

## Register a Mod version

```json
{
  "id": "example-vehicles",
  "name": "Example Vehicles",
  "version": "1.2.0",
  "artifactSha": "64 lowercase hex characters",
  "gameVersions": ["3.0.1-b4"],
  "installRoots": ["ExampleVehicles"],
  "containsDll": true,
  "requiresRestart": true
}
```

`installRoots` must exactly match top-level ZIP directories. The updater refuses undeclared roots and refuses to overwrite an unmanaged directory unless an operator explicitly uses `--force`.

## Register a server

```json
{
  "name": "Tokyo PVE",
  "packId": "production-pack",
  "publicAddress": "game.example.com:26900"
}
```

Store the returned server token immediately; it is not returned again.
