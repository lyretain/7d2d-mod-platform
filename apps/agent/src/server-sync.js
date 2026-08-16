import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { syncPack, planPack } from '../../updater/src/installer.js';

async function atomicJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2));
  await rename(temporary, file);
}

async function report(config, status) {
  if (!config.serverId || !config.serverToken) return;
  try {
    await fetch(`${config.baseUrl.replace(/\/$/, '')}/api/v1/servers/${encodeURIComponent(config.serverId)}/sync-status`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.serverToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(status),
      signal: AbortSignal.timeout(15_000)
    });
  } catch (error) {
    console.error(`Unable to report sync status: ${error.message}`);
  }
}

export async function syncDedicatedServer(config) {
  const modsDir = config.modsDir;
  const controlDir = path.join(modsDir, '.modplatform');
  const lastGoodFile = path.join(controlDir, 'last-good-manifest.json');
  const breakerFile = path.join(controlDir, 'restart-breaker.json');
  const breaker = JSON.parse(await readFile(breakerFile, 'utf8').catch(() => '{"failures":0}'));
  if (breaker.failures >= (config.maxRestartFailures || 3) && Date.now() - Date.parse(breaker.lastFailureAt || 0) < 30 * 60 * 1000) {
    throw new Error('Server sync circuit breaker is open after repeated failures');
  }
  await report(config, { stage: 'sync_start', ok: true, packId: config.packId });
  try {
    let packId = config.packId;
    if (!packId && config.serverAddress) {
      const resolved = await fetch(`${config.baseUrl.replace(/\/$/, '')}/api/v1/public/servers/resolve?address=${encodeURIComponent(config.serverAddress)}`);
      if (!resolved.ok) throw new Error(`Unable to resolve server pack (${resolved.status})`);
      packId = (await resolved.json()).packId;
    }
    const planned = await planPack({ baseUrl: config.baseUrl, packId, modsDir, explicitPublicKey: config.publicKey });
    const result = await syncPack({ baseUrl: config.baseUrl, packId, modsDir, explicitPublicKey: config.publicKey, force: Boolean(config.force) });
    await atomicJson(lastGoodFile, result.manifest);
    await atomicJson(breakerFile, { failures: 0, lastSuccessAt: new Date().toISOString() });
    await report(config, { stage: 'sync_ok', ok: true, packId: result.state.packId, packVersion: result.state.packVersion, requiresRestart: result.state.requiresRestart });
    return { ...result, plan: planned.plan };
  } catch (error) {
    const lastGood = JSON.parse(await readFile(lastGoodFile, 'utf8').catch(() => 'null'));
    await atomicJson(breakerFile, { failures: (breaker.failures || 0) + 1, lastFailureAt: new Date().toISOString(), message: error.message });
    await report(config, { stage: 'sync_failed', ok: false, packId: config.packId, message: error.message });
    if (lastGood && config.allowLastGood !== false) {
      console.error(`Sync failed (${error.message}); last good manifest remains ${lastGood.packId} v${lastGood.packVersion}`);
    }
    throw error;
  }
}
