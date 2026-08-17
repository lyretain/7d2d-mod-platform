#!/usr/bin/env node
import { syncPack } from './installer.js';

function args(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--force') parsed.force = true;
    else if (value.startsWith('--')) parsed[value.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[++index];
  }
  return parsed;
}

const options = args(process.argv.slice(2));
if (!options.baseUrl || (!options.packId && !options.serverAddress) || !options.modsDir) {
  console.error('Usage: npm run updater -- --base-url http://host:8080 (--pack-id my-pack | --server-address host:port) --mods-dir "C:\\...\\7DaysToDie\\Mods" [--side client|server] [--public-key BASE64] [--force]');
  process.exit(2);
}

try {
  if (!options.packId) {
    const response = await fetch(`${options.baseUrl.replace(/\/$/, '')}/api/v1/public/servers/resolve?address=${encodeURIComponent(options.serverAddress)}`);
    if (!response.ok) throw new Error(`Unable to resolve server ModPack (${response.status})`);
    options.packId = (await response.json()).packId;
  }
  const result = await syncPack({
    baseUrl: options.baseUrl,
    packId: options.packId,
    modsDir: options.modsDir,
    explicitPublicKey: options.publicKey,
    profile: options.profile,
    force: Boolean(options.force),
    concurrency: options.concurrency ? Number(options.concurrency) : 2,
    bandwidth: options.bandwidth ? Number(options.bandwidth) : undefined,
    side: options.side || (options.serverAddress ? 'client' : undefined)
  });
  console.log(JSON.stringify({ ok: true, packId: result.state.packId, packVersion: result.state.packVersion, requiresRestart: result.state.requiresRestart }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
}
