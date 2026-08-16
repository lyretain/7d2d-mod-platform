import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const EMPTY = {
  schemaVersion: 3,
  mods: {},
  packs: {},
  releases: {},
  servers: {},
  users: {},
  invites: {},
  sessions: {},
  diagnostics: [],
  fingerprints: {},
  settings: { distributionPaused: false, distributionPausedAt: null, distributionPausedBy: null, distributionPausedReason: null },
  audit: [],
  reviews: {},
  bannedHashes: {},
  rateLimits: {},
  signingKeys: {},
  passwordResets: {},
  webhooks: [],
  maintenance: { enabled: false, message: null },
  stats: { downloads: 0, bytes: 0, artifacts: {}, gameVersions: {} },
  confirmations: {}
};

export class JsonStore {
  constructor(file) {
    this.file = file;
    this.data = structuredClone(EMPTY);
    this.queue = Promise.resolve();
  }

  async init() {
    await mkdir(path.dirname(this.file), { recursive: true });
    try {
      const loaded = JSON.parse(await readFile(this.file, 'utf8'));
      this.data = {
        ...structuredClone(EMPTY),
        ...loaded,
        settings: { ...structuredClone(EMPTY.settings), ...(loaded.settings || {}) },
        audit: Array.isArray(loaded.audit) ? loaded.audit : [],
        reviews: loaded.reviews || {},
        bannedHashes: loaded.bannedHashes || {},
        rateLimits: loaded.rateLimits || {},
        signingKeys: loaded.signingKeys || {},
        passwordResets: loaded.passwordResets || {},
        webhooks: Array.isArray(loaded.webhooks) ? loaded.webhooks : [],
        maintenance: { ...structuredClone(EMPTY.maintenance), ...(loaded.maintenance || {}) },
        stats: { ...structuredClone(EMPTY.stats), ...(loaded.stats || {}) },
        confirmations: loaded.confirmations || {},
        schemaVersion: 3
      };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await this.persist();
    }
  }

  snapshot() {
    return structuredClone(this.data);
  }

  async mutate(fn) {
    const operation = this.queue.then(async () => {
      const draft = structuredClone(this.data);
      const result = await fn(draft);
      this.data = draft;
      await this.persist();
      return result;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }

  async persist() {
    const temporary = `${this.file}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(this.data, null, 2));
    await rename(temporary, this.file);
  }
}
