import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const EMPTY = {
  schemaVersion: 2,
  mods: {},
  packs: {},
  releases: {},
  servers: {},
  users: {},
  invites: {},
  sessions: {},
  diagnostics: [],
  fingerprints: {}
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
      this.data = { ...structuredClone(EMPTY), ...JSON.parse(await readFile(this.file, 'utf8')), schemaVersion: 2 };
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
