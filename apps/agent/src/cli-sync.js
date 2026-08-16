#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { syncDedicatedServer } from './server-sync.js';

const index = process.argv.indexOf('--config');
if (index < 0 || !process.argv[index + 1]) {
  console.error('Usage: npm run server-sync -- --config deploy/guardian.config.json');
  process.exit(2);
}
const config = JSON.parse(await readFile(path.resolve(process.argv[index + 1]), 'utf8'));
const result = await syncDedicatedServer(config);
console.log(JSON.stringify({ ok: true, packId: result.state.packId, packVersion: result.state.packVersion, requiresRestart: result.state.requiresRestart }, null, 2));
