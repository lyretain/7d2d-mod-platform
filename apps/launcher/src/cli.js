#!/usr/bin/env node
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { discoverEnvironment, listInstalledMods, readFavorites } from './discover.js';
import { planPack, syncPack } from '../../updater/src/installer.js';

function args(argv) {
  const parsed = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--force') parsed.force = true;
    else if (value === '--no-launch') parsed.noLaunch = true;
    else if (value.startsWith('--')) parsed[value.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[++index];
    else parsed._.push(value);
  }
  return parsed;
}

async function atomicJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2));
  await rename(temporary, file);
}

function formatBytes(value) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

function printPlan(plan) {
  console.log(`Pack ${plan.packId} v${plan.packVersion}  game ${plan.gameVersion}`);
  console.log(`Download ${formatBytes(plan.downloadBytes)}  DLL=${plan.containsDll}  restart=${plan.requiresRestart}`);
  for (const item of plan.items) {
    const dll = item.containsDll ? ' [DLL/Harmony]' : '';
    console.log(`  ${item.action.padEnd(9)} ${item.root}  ${item.modId || ''}@${item.version || ''}${dll}`);
  }
}

async function resolveServer(baseUrl, address) {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/v1/public/servers/resolve?address=${encodeURIComponent(address)}`);
  if (!response.ok) throw new Error(`Unable to resolve server (${response.status})`);
  return response.json();
}

async function saveFavorite(env, server) {
  const current = await readFavorites(env.launcherState);
  current.servers = current.servers.filter((item) => item.address !== server.address);
  current.servers.unshift({ ...server, savedAt: new Date().toISOString() });
  await atomicJson(env.launcherState, current);
}

const options = args(process.argv.slice(2));
const command = options._[0] || 'join';

try {
  const env = await discoverEnvironment({ steamPath: options.steamPath, gameDir: options.gameDir });
  if (command === 'discover') {
    console.log(JSON.stringify({ ...env, installedMods: await listInstalledMods(env.modsDir) }, null, 2));
    process.exit(0);
  }
  if (command === 'servers') {
    if (options._[1] === 'add') {
      if (!options.address || !options.baseUrl) throw new Error('servers add requires --address and --base-url');
      await saveFavorite(env, { address: options.address, baseUrl: options.baseUrl, name: options.name || options.address });
    }
    console.log(JSON.stringify(await readFavorites(env.launcherState), null, 2));
    process.exit(0);
  }

  const address = options.serverAddress || options.address;
  const baseUrl = options.baseUrl;
  if (!baseUrl || (!options.packId && !address) || !env.modsDir) {
    console.error('Usage: node apps/launcher/src/cli.js <discover|plan|join|servers> --base-url URL (--pack-id ID | --address host:port) [--public-key KEY] [--no-launch]');
    process.exit(2);
  }
  let packId = options.packId;
  let resolved = null;
  if (!packId) {
    resolved = await resolveServer(baseUrl, address);
    packId = resolved.packId;
    if (resolved.handshake?.distributionPaused) throw new Error('Mod distribution is paused');
  }
  const planned = await planPack({ baseUrl, packId, modsDir: options.modsDir || env.modsDir, explicitPublicKey: options.publicKey, profile: options.profile });
  printPlan(planned.plan);
  if (command === 'plan') process.exit(0);

  let lastProgress = 0;
  const result = await syncPack({
    baseUrl,
    packId,
    modsDir: options.modsDir || env.modsDir,
    explicitPublicKey: options.publicKey,
    profile: options.profile,
    force: Boolean(options.force),
    concurrency: options.concurrency ? Number(options.concurrency) : 2,
    bandwidth: options.bandwidth ? Number(options.bandwidth) : undefined,
    onProgress(event) {
      if (event.phase !== 'download' || !event.total) return;
      const pct = Math.floor((event.bytes / event.total) * 100);
      if (pct < lastProgress + 5 && pct < 100) return;
      lastProgress = pct;
      const speed = event.elapsedMs ? event.bytes / (event.elapsedMs / 1000) : 0;
      const remain = speed ? (event.total - event.bytes) / speed : 0;
      console.error(`download ${pct}%  ${formatBytes(event.bytes)}/${formatBytes(event.total)}  ${formatBytes(speed)}/s  ETA ${Math.ceil(remain)}s`);
    }
  });
  if (address) {
    await saveFavorite(env, { address, baseUrl, packId, name: options.name || address });
    await atomicJson(path.join(env.modsDir, '.modplatform', 'reconnect.json'), { address, packId, updatedAt: new Date().toISOString() });
  }
  console.log(JSON.stringify({
    ok: true,
    packId: result.state.packId,
    packVersion: result.state.packVersion,
    requiresRestart: result.state.requiresRestart,
    eacPresent: env.eacPresent,
    launchAdvice: env.eacPresent && result.manifest.mods.some((mod) => mod.containsDll) ? 'DLL mods require launching 7DaysToDie.exe with EAC disabled' : null
  }, null, 2));

  if (!options.noLaunch) {
    if (!env.gameExe) throw new Error('7 Days To Die installation was not found');
    const exe = result.manifest.mods.some((mod) => mod.containsDll) ? env.gameExe : (env.eacExe || env.gameExe);
    const launchArgs = address ? ['-connect', address.replace(':', ' ')] : [];
    spawn(exe, launchArgs, { cwd: env.gameDir, detached: true, stdio: 'ignore' }).unref();
  }
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
}
