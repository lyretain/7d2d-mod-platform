import { PgPool } from './postgres.js';
import { EMPTY } from './store.js';

function hydrateState(value) {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  return {
    ...structuredClone(EMPTY),
    ...parsed,
    settings: { ...structuredClone(EMPTY.settings), ...(parsed.settings || {}) },
    reviews: parsed.reviews || {},
    bannedHashes: parsed.bannedHashes || {},
    rateLimits: parsed.rateLimits || {},
    signingKeys: parsed.signingKeys || {},
    passwordResets: parsed.passwordResets || {},
    webhooks: Array.isArray(parsed.webhooks) ? parsed.webhooks : [],
    maintenance: { ...structuredClone(EMPTY.maintenance), ...(parsed.maintenance || {}) },
    stats: { ...structuredClone(EMPTY.stats), ...(parsed.stats || {}) },
    confirmations: parsed.confirmations || {},
    handshakes: parsed.handshakes || {},
    launcher: { channels: {}, ...(parsed.launcher || {}) },
    audit: Array.isArray(parsed.audit) ? parsed.audit : [],
    schemaVersion: 3
  };
}

export const MIGRATIONS = [
  {
    id: 1,
    name: 'platform_state',
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id integer PRIMARY KEY,
        name text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS platform_state (
        id integer PRIMARY KEY DEFAULT 1,
        schema_version integer NOT NULL,
        data jsonb NOT NULL,
        version bigint NOT NULL DEFAULT 0
      );
    `
  },
  {
    id: 2,
    name: 'lookup_indexes',
    sql: `
      CREATE INDEX IF NOT EXISTS platform_state_users_gin ON platform_state USING gin ((data->'users'));
      CREATE INDEX IF NOT EXISTS platform_state_packs_gin ON platform_state USING gin ((data->'packs'));
      CREATE INDEX IF NOT EXISTS platform_state_diagnostics_gin ON platform_state USING gin ((data->'fingerprints'));
    `
  }
];

export class PostgresStore {
  constructor(databaseUrl) {
    this.pool = new PgPool(databaseUrl);
    this.data = null;
    this.version = 0;
  }

  async init() {
    await this.pool.query(MIGRATIONS[0].sql);
    for (const migration of MIGRATIONS) {
      const applied = await this.pool.query('SELECT id FROM schema_migrations WHERE id = $1', [migration.id]);
      if (!applied.rows.length) {
        if (migration.id !== 1) await this.pool.query(migration.sql);
        await this.pool.query('INSERT INTO schema_migrations(id, name) VALUES ($1, $2)', [migration.id, migration.name]);
      }
    }
    const existing = await this.pool.query('SELECT data, version FROM platform_state WHERE id = 1');
    if (existing.rows.length) {
      this.data = hydrateState(existing.rows[0].data);
      this.version = Number(existing.rows[0].version);
    }
  }

  snapshot() {
    return structuredClone(this.data);
  }

  async mutate(fn) {
    return this.pool.transaction(async (connection) => {
      const locked = await connection.query('SELECT data, version FROM platform_state WHERE id = 1 FOR UPDATE');
      const draft = locked.rows.length ? hydrateState(locked.rows[0].data) : structuredClone(this.data || EMPTY);
      const result = await fn(draft);
      const nextVersion = Number(locked.rows[0]?.version || 0) + 1;
      const payload = JSON.stringify(draft);
      if (locked.rows.length) await connection.query('UPDATE platform_state SET data = $1::jsonb, version = $2, schema_version = 3 WHERE id = 1', [payload, nextVersion]);
      else await connection.query('INSERT INTO platform_state(id, schema_version, data, version) VALUES (1, 3, $1::jsonb, $2)', [payload, nextVersion]);
      this.data = draft;
      this.version = nextVersion;
      return result;
    });
  }

  async ready() {
    try {
      await this.pool.query('SELECT 1');
      return { ok: true, driver: 'postgres', version: this.version };
    } catch (error) {
      return { ok: false, driver: 'postgres', error: error.message };
    }
  }

  async end() {
    await this.pool.end();
  }
}

export async function createStore({ dataDir, databaseUrl }) {
  if (!databaseUrl) {
    const { JsonStore } = await import('./store.js');
    const path = await import('node:path');
    const store = new JsonStore(path.join(dataDir, 'state', 'database.json'));
    await store.init();
    store.ready = async () => ({ ok: true, driver: 'json' });
    return store;
  }
  const store = new PostgresStore(databaseUrl);
  await store.init();
  if (!store.data) {
    store.data = structuredClone(EMPTY);
    await store.pool.query('INSERT INTO platform_state(id, schema_version, data, version) VALUES (1, 3, $1::jsonb, 0)', [JSON.stringify(store.data)]);
  }
  return store;
}

export async function migrateJsonToPostgres(jsonPath, databaseUrl) {
  const { readFile } = await import('node:fs/promises');
  const store = new PostgresStore(databaseUrl);
  await store.init();
  const data = JSON.parse(await readFile(jsonPath, 'utf8'));
  await store.pool.query('INSERT INTO platform_state(id, schema_version, data, version) VALUES (1, 3, $1::jsonb, 1) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, version = platform_state.version + 1', [JSON.stringify(data)]);
  await store.end();
  return { migrated: true };
}
