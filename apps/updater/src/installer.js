import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import { extractZip, listZip } from './zip.js';
import { verifyManifest } from './verify.js';

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

async function atomicJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2));
  await rename(temporary, file);
}

async function download(url, target, expectedSha, expectedSize) {
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30 * 60 * 1000) });
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}): ${url}`);
  const advertised = Number(response.headers.get('content-length') || 0);
  if (expectedSize && advertised && advertised !== expectedSize) throw new Error(`Download size differs from manifest: ${url}`);
  const hash = createHash('sha256');
  let size = 0;
  const meter = new Transform({ transform(chunk, _encoding, callback) { size += chunk.length; hash.update(chunk); callback(null, chunk); } });
  await mkdir(path.dirname(target), { recursive: true });
  await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(target, { flags: 'wx' }));
  const actual = hash.digest('hex');
  if (actual !== expectedSha || (expectedSize && size !== expectedSize)) {
    await rm(target, { force: true });
    throw new Error(`Downloaded artifact failed integrity validation: ${expectedSha}`);
  }
}

export async function trustPublicKey(baseUrl, controlDir, explicitKey) {
  if (explicitKey) return explicitKey;
  const trustFile = path.join(controlDir, 'trusted-key.json');
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/v1/public-key`);
  if (!response.ok) throw new Error('Unable to retrieve platform public key');
  const remote = await response.json();
  const trusted = await readJson(trustFile, null);
  if (trusted && (trusted.keyId !== remote.keyId || trusted.publicKey !== remote.publicKey)) throw new Error('Platform signing key changed. Explicit administrator approval is required.');
  if (!trusted) await atomicJson(trustFile, { ...remote, trustedAt: new Date().toISOString(), trustModel: 'TOFU' });
  return remote.publicKey;
}

export async function syncPack({ baseUrl, packId, modsDir, explicitPublicKey, force = false }) {
  const resolvedMods = path.resolve(modsDir);
  const controlDir = path.join(resolvedMods, '.modplatform');
  const cacheDir = path.join(controlDir, 'cache');
  const stageDir = path.join(controlDir, `stage-${Date.now()}`);
  const backupDir = path.join(controlDir, 'backups', `${Date.now()}`);
  const stateFile = path.join(controlDir, 'state.json');
  await mkdir(controlDir, { recursive: true });

  const publicKey = await trustPublicKey(baseUrl, controlDir, explicitPublicKey);
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/v1/public/packs/${encodeURIComponent(packId)}/latest`, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Manifest request failed (${response.status})`);
  const manifest = await response.json();
  if (manifest.packId !== packId || !verifyManifest(manifest, publicKey)) throw new Error('Manifest signature verification failed');
  const state = await readJson(stateFile, { schemaVersion: 1, managedRoots: {}, installedArtifacts: {} });
  const desiredRoots = new Map();
  const transaction = [];

  try {
    for (const mod of manifest.mods) {
      if (!/^[a-f0-9]{64}$/.test(mod.sha256) || !Array.isArray(mod.installRoots) || !mod.installRoots.length) throw new Error(`Manifest contains an invalid artifact entry: ${mod.id}`);
      const cacheFile = path.join(cacheDir, `${mod.sha256}.zip`);
      if (!(await exists(cacheFile)) || (await stat(cacheFile)).size !== mod.size) {
        await rm(cacheFile, { force: true });
        await download(mod.url, cacheFile, mod.sha256, mod.size);
      } else {
        const hash = createHash('sha256');
        await pipeline(createReadStream(cacheFile), new Transform({ transform(chunk, _encoding, callback) { hash.update(chunk); callback(null, chunk); } }), new Transform({ transform(_chunk, _encoding, callback) { callback(); } }));
        if (hash.digest('hex') !== mod.sha256) { await rm(cacheFile, { force: true }); throw new Error(`Cached artifact hash mismatch: ${mod.id}`); }
      }
      const archive = await readFile(cacheFile);
      const entries = listZip(archive);
      const archiveRoots = new Set(entries.map((entry) => entry.name.split('/')[0]));
      for (const root of mod.installRoots) {
        if (!/^[^\\/:*?"<>|.][^\\/:*?"<>|]{0,127}$/.test(root) || !archiveRoots.has(root)) throw new Error(`Unsafe or missing install root '${root}' in ${mod.id}`);
        if (desiredRoots.has(root)) throw new Error(`Multiple artifacts own the same install root: ${root}`);
        desiredRoots.set(root, { modId: mod.id, version: mod.version, sha256: mod.sha256 });
      }
      await extractZip(archive, stageDir);
    }

    await mkdir(backupDir, { recursive: true });
    for (const [root, owner] of desiredRoots) {
      const target = path.join(resolvedMods, root);
      const staged = path.join(stageDir, root);
      const backup = path.join(backupDir, root);
      if (!(await exists(staged))) throw new Error(`Staged install root is missing: ${root}`);
      const hadTarget = await exists(target);
      if (await exists(target)) {
        if (!state.managedRoots[root] && !force) throw new Error(`Refusing to replace unmanaged Mod directory: ${root}`);
        await rename(target, backup);
      }
      await rename(staged, target);
      transaction.push({ target, backup, hadTarget, installed: true });
      state.managedRoots[root] = owner;
    }
    for (const root of Object.keys(state.managedRoots)) {
      if (desiredRoots.has(root)) continue;
      const target = path.join(resolvedMods, root);
      const backup = path.join(backupDir, root);
      const hadTarget = await exists(target);
      if (hadTarget) await rename(target, backup);
      transaction.push({ target, backup, hadTarget, installed: false });
      delete state.managedRoots[root];
    }
    state.packId = manifest.packId;
    state.packVersion = manifest.packVersion;
    state.gameVersion = manifest.gameVersion;
    state.updatedAt = new Date().toISOString();
    state.requiresRestart = manifest.mods.some((mod) => mod.requiresRestart);
    await atomicJson(stateFile, state);
    await rm(stageDir, { recursive: true, force: true });
    return { manifest, state, backupDir };
  } catch (error) {
    for (const item of transaction.reverse()) {
      if (item.installed) await rm(item.target, { recursive: true, force: true }).catch(() => {});
      if (item.hadTarget && await exists(item.backup)) await rename(item.backup, item.target).catch(() => {});
    }
    await rm(stageDir, { recursive: true, force: true });
    throw error;
  }
}
