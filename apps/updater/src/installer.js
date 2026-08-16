import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, mkdir, readdir, readFile, rename, rm, stat, statfs, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import { extractZipFile, listZipFile } from './zip.js';
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

function controlDirFor(modsDir, profile) {
  const resolved = path.resolve(modsDir);
  if (!profile) return path.join(resolved, '.modplatform');
  const safe = String(profile).replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(resolved, '.modplatform', 'profiles', safe);
}

function throttle(bytesPerSecond) {
  if (!bytesPerSecond) return new Transform({ transform(chunk, _encoding, callback) { callback(null, chunk); } });
  let windowStart = Date.now();
  let windowBytes = 0;
  return new Transform({
    async transform(chunk, _encoding, callback) {
      windowBytes += chunk.length;
      const elapsed = Date.now() - windowStart;
      if (elapsed < 1000 && windowBytes > bytesPerSecond) {
        await new Promise((resolve) => setTimeout(resolve, 1000 - elapsed));
        windowStart = Date.now();
        windowBytes = 0;
      } else if (elapsed >= 1000) {
        windowStart = Date.now();
        windowBytes = chunk.length;
      }
      callback(null, chunk);
    }
  });
}

async function mapLimit(items, limit, worker) {
  const results = [];
  let index = 0;
  async function run() {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await worker(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length || 1)) }, run));
  return results;
}

async function assertDiskSpace(dir, needed) {
  try {
    await mkdir(dir, { recursive: true });
    const info = await statfs(dir);
    if (info.bavail * info.bsize < needed + 64 * 1024 * 1024) throw new Error('Insufficient disk space for this ModPack');
  } catch (error) {
    if (error.message.startsWith('Insufficient')) throw error;
  }
}

async function recoverTransaction(txnFile) {
  const txn = await readJson(txnFile, null);
  if (!txn?.items?.length || txn.committed) {
    if (txn) await rm(txnFile, { force: true });
    return false;
  }
  for (const item of [...txn.items].reverse()) {
    if (item.installed) await rm(item.target, { recursive: true, force: true }).catch(() => {});
    if (item.hadTarget && await exists(item.backup)) await rename(item.backup, item.target).catch(() => {});
  }
  await rm(txnFile, { force: true });
  return true;
}

async function pruneDir(dir, { keep = new Set(), maxAgeMs = 14 * 86400_000 } = {}) {
  try {
    const names = await readdir(dir);
    const cutoff = Date.now() - maxAgeMs;
    for (const name of names) {
      if (keep.has(name)) continue;
      const full = path.join(dir, name);
      const info = await stat(full).catch(() => null);
      if (!info) continue;
      if (info.mtimeMs < cutoff || !keep.size) {
        if (!keep.size && info.mtimeMs >= cutoff) continue;
        await rm(full, { recursive: true, force: true });
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function download(url, target, expectedSha, expectedSize, { signal, onProgress, resume = true, bandwidth } = {}) {
  const partial = `${target}.partial`;
  let existing = 0;
  if (resume && await exists(partial)) existing = (await stat(partial)).size;
  const headers = {};
  if (existing > 0) headers.Range = `bytes=${existing}-`;
  const response = await fetch(url, { redirect: 'follow', headers, signal: signal || AbortSignal.timeout(30 * 60 * 1000) });
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}): ${url}`);
  if (existing && response.status !== 206) {
    existing = 0;
    await rm(partial, { force: true });
  }
  const advertised = Number(response.headers.get('content-length') || 0);
  const total = expectedSize || (existing + advertised) || advertised;
  if (expectedSize && response.status !== 206 && advertised && advertised !== expectedSize) throw new Error(`Download size differs from manifest: ${url}`);
  const hash = createHash('sha256');
  if (existing) hash.update(await readFile(partial));
  let size = existing;
  const started = Date.now();
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      size += chunk.length;
      hash.update(chunk);
      if (onProgress) onProgress({ phase: 'download', url, bytes: size, total, elapsedMs: Date.now() - started });
      callback(null, chunk);
    }
  });
  await mkdir(path.dirname(target), { recursive: true });
  await pipeline(Readable.fromWeb(response.body), throttle(bandwidth), meter, createWriteStream(partial, { flags: existing ? 'a' : 'wx' }));
  const actual = hash.digest('hex');
  if (actual !== expectedSha || (expectedSize && size !== expectedSize)) {
    await rm(partial, { force: true });
    throw new Error(`Downloaded artifact failed integrity validation: ${expectedSha}`);
  }
  await rename(partial, target);
}

export async function trustPublicKey(baseUrl, controlDir, explicitKey) {
  if (explicitKey) return { publicKey: explicitKey, keys: [{ publicKey: explicitKey }] };
  const trustFile = path.join(controlDir, 'trusted-key.json');
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/v1/public-key`);
  if (!response.ok) throw new Error('Unable to retrieve platform public key');
  const remote = await response.json();
  const remoteKeys = remote.keys?.length ? remote.keys : [{ keyId: remote.keyId, publicKey: remote.publicKey, algorithm: remote.algorithm }];
  const trusted = await readJson(trustFile, null);
  if (trusted) {
    const known = new Set((trusted.keys || [{ keyId: trusted.keyId }]).map((item) => item.keyId).filter(Boolean));
    if (known.size && !known.has(remote.keyId) && !remoteKeys.some((item) => known.has(item.keyId))) {
      throw new Error('Platform signing key changed. Explicit administrator approval is required.');
    }
  }
  await atomicJson(trustFile, { ...remote, keys: remoteKeys, trustedAt: trusted?.trustedAt || new Date().toISOString(), trustModel: 'TOFU' });
  return { publicKey: remote.publicKey, keys: remoteKeys };
}

export async function loadVerifiedManifest({ baseUrl, packId, modsDir, explicitPublicKey, profile, signal }) {
  const resolvedMods = path.resolve(modsDir);
  const controlDir = controlDirFor(resolvedMods, profile);
  await mkdir(controlDir, { recursive: true });
  await recoverTransaction(path.join(controlDir, 'transaction.json'));
  const trusted = await trustPublicKey(baseUrl, controlDir, explicitPublicKey);
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/v1/public/packs/${encodeURIComponent(packId)}/latest`, { signal: signal || AbortSignal.timeout(30_000) });
  if (response.status === 503) {
    const body = await response.json().catch(() => ({}));
    throw Object.assign(new Error(body.error?.message || 'Mod distribution is paused'), { code: body.error?.code || 'DISTRIBUTION_PAUSED' });
  }
  if (!response.ok) throw new Error(`Manifest request failed (${response.status})`);
  const manifest = await response.json();
  if (manifest.packId !== packId || !verifyManifest(manifest, trusted.publicKey, { keys: trusted.keys })) throw new Error('Manifest signature verification failed');
  return { manifest, publicKey: trusted.publicKey, keys: trusted.keys, controlDir, resolvedMods };
}

export function planFromManifest(manifest, state = { managedRoots: {} }) {
  const desired = new Map();
  const items = [];
  for (const mod of manifest.mods) {
    for (const root of mod.installRoots || []) {
      const current = state.managedRoots?.[root];
      const action = !current ? 'install' : current.sha256 === mod.sha256 ? 'unchanged' : 'update';
      desired.set(root, mod);
      items.push({
        action,
        root,
        modId: mod.id,
        version: mod.version,
        sha256: mod.sha256,
        size: mod.size,
        containsDll: Boolean(mod.containsDll),
        requiresRestart: Boolean(mod.requiresRestart)
      });
    }
  }
  for (const root of Object.keys(state.managedRoots || {})) {
    if (!desired.has(root)) items.push({ action: 'remove', root, ...state.managedRoots[root] });
  }
  const bytes = items.filter((item) => item.action === 'install' || item.action === 'update').reduce((sum, item) => sum + (item.size || 0), 0);
  return {
    packId: manifest.packId,
    packVersion: manifest.packVersion,
    gameVersion: manifest.gameVersion,
    requiresRestart: manifest.mods.some((mod) => mod.requiresRestart),
    containsDll: manifest.mods.some((mod) => mod.containsDll),
    downloadBytes: bytes,
    items
  };
}

export async function planPack(options) {
  const { manifest, controlDir } = await loadVerifiedManifest(options);
  const state = await readJson(path.join(controlDir, 'state.json'), { schemaVersion: 1, managedRoots: {}, installedArtifacts: {} });
  return { manifest, plan: planFromManifest(manifest, state) };
}

export async function syncPack({ baseUrl, packId, modsDir, explicitPublicKey, profile, force = false, onProgress, signal, concurrency = 2, bandwidth, cacheDays = 14 } = {}) {
  const { manifest, controlDir, resolvedMods } = await loadVerifiedManifest({ baseUrl, packId, modsDir, explicitPublicKey, profile, signal });
  const cacheDir = path.join(controlDir, 'cache');
  const stageDir = path.join(controlDir, `stage-${Date.now()}`);
  const backupDir = path.join(controlDir, 'backups', `${Date.now()}`);
  const stateFile = path.join(controlDir, 'state.json');
  const txnFile = path.join(controlDir, 'transaction.json');
  const state = await readJson(stateFile, { schemaVersion: 1, managedRoots: {}, installedArtifacts: {} });
  const plan = planFromManifest(manifest, state);
  if (onProgress) onProgress({ phase: 'plan', plan });
  await assertDiskSpace(controlDir, plan.downloadBytes + manifest.mods.reduce((sum, mod) => sum + (mod.size || 0), 0));
  const desiredRoots = new Map();
  const transaction = [];

  try {
    const needed = manifest.mods.filter((mod) => {
      if (!/^[a-f0-9]{64}$/.test(mod.sha256) || !Array.isArray(mod.installRoots) || !mod.installRoots.length) throw new Error(`Manifest contains an invalid artifact entry: ${mod.id}`);
      return !mod.installRoots.every((root) => state.managedRoots?.[root]?.sha256 === mod.sha256);
    });
    await mapLimit(needed, concurrency, async (mod) => {
      const cacheFile = path.join(cacheDir, `${mod.sha256}.zip`);
      if (!(await exists(cacheFile)) || (await stat(cacheFile)).size !== mod.size) {
        await rm(cacheFile, { force: true });
        await download(mod.url, cacheFile, mod.sha256, mod.size, { signal, onProgress, bandwidth });
      } else {
        const hash = createHash('sha256');
        await pipeline(createReadStream(cacheFile), new Transform({ transform(chunk, _encoding, callback) { hash.update(chunk); callback(null, chunk); } }), new Transform({ transform(_chunk, _encoding, callback) { callback(); } }));
        if (hash.digest('hex') !== mod.sha256) { await rm(cacheFile, { force: true }); throw new Error(`Cached artifact hash mismatch: ${mod.id}`); }
      }
    });

    for (const mod of manifest.mods) {
      const unchanged = mod.installRoots.every((root) => state.managedRoots?.[root]?.sha256 === mod.sha256);
      if (unchanged) {
        for (const root of mod.installRoots) desiredRoots.set(root, { modId: mod.id, version: mod.version, sha256: mod.sha256 });
        continue;
      }
      const cacheFile = path.join(cacheDir, `${mod.sha256}.zip`);
      const entries = await listZipFile(cacheFile);
      const archiveRoots = new Set(entries.map((entry) => entry.name.split('/')[0]));
      for (const root of mod.installRoots) {
        if (!/^[^\\/:*?"<>|.][^\\/:*?"<>|]{0,127}$/.test(root) || !archiveRoots.has(root)) throw new Error(`Unsafe or missing install root '${root}' in ${mod.id}`);
        if (desiredRoots.has(root)) throw new Error(`Multiple artifacts own the same install root: ${root}`);
        desiredRoots.set(root, { modId: mod.id, version: mod.version, sha256: mod.sha256 });
      }
      await extractZipFile(cacheFile, stageDir);
    }

    await mkdir(backupDir, { recursive: true });
    for (const [root, owner] of desiredRoots) {
      if (state.managedRoots?.[root]?.sha256 === owner.sha256 && await exists(path.join(resolvedMods, root))) continue;
      const target = path.join(resolvedMods, root);
      const staged = path.join(stageDir, root);
      const backup = path.join(backupDir, root);
      if (!(await exists(staged))) throw new Error(`Staged install root is missing: ${root}`);
      const hadTarget = await exists(target);
      if (hadTarget && !state.managedRoots[root] && !force) throw new Error(`Refusing to replace unmanaged Mod directory: ${root}`);
      transaction.push({ target, backup, staged, hadTarget, installed: true, root, owner });
    }
    for (const root of Object.keys(state.managedRoots)) {
      if (desiredRoots.has(root)) continue;
      const target = path.join(resolvedMods, root);
      const backup = path.join(backupDir, root);
      transaction.push({ target, backup, hadTarget: await exists(target), installed: false, root });
    }
    await atomicJson(txnFile, { items: transaction.map(({ staged, root, owner, ...item }) => item), committed: false, startedAt: new Date().toISOString() });
    for (const item of transaction) {
      if (item.installed) {
        if (item.hadTarget) await rename(item.target, item.backup);
        await rename(item.staged, item.target);
        state.managedRoots[item.root] = item.owner;
      } else {
        if (item.hadTarget) await rename(item.target, item.backup);
        delete state.managedRoots[item.root];
      }
    }
    state.packId = manifest.packId;
    state.packVersion = manifest.packVersion;
    state.gameVersion = manifest.gameVersion;
    state.profile = profile || null;
    state.keyId = manifest.signing?.keyId || null;
    state.installedArtifacts = Object.fromEntries([...desiredRoots].map(([root, owner]) => [root, owner]));
    state.updatedAt = new Date().toISOString();
    state.requiresRestart = manifest.mods.some((mod) => mod.requiresRestart);
    await atomicJson(stateFile, state);
    await atomicJson(txnFile, { items: transaction.map(({ staged, root, owner, ...item }) => item), committed: true, startedAt: new Date().toISOString() });
    await rm(txnFile, { force: true });
    await rm(stageDir, { recursive: true, force: true });
    await pruneDir(cacheDir, { keep: new Set([...desiredRoots.values()].map((item) => `${item.sha256}.zip`)), maxAgeMs: cacheDays * 86400_000 });
    await pruneDir(path.join(controlDir, 'backups'), { maxAgeMs: cacheDays * 86400_000 });
    return { manifest, state, backupDir };
  } catch (error) {
    for (const item of transaction.reverse()) {
      if (item.installed) await rm(item.target, { recursive: true, force: true }).catch(() => {});
      if (item.hadTarget && await exists(item.backup)) await rename(item.backup, item.target).catch(() => {});
    }
    await rm(txnFile, { force: true }).catch(() => {});
    await rm(stageDir, { recursive: true, force: true });
    throw error;
  }
}
