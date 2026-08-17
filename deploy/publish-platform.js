#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { PLATFORM_PLUGIN_MODS, platformPluginMod } from '../apps/api/src/protocol.js';
import { DEFAULT_CHUNK_BYTES } from '../apps/api/src/artifact-upload.js';
import { buildStoredZip, listZip } from '../apps/updater/src/zip.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SMALL_UPLOAD_BYTES = 8 * 1024 * 1024;
const LOCAL = 0x04034b50;

export function sha256Buffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export async function collectFiles(dir, prefix = '') {
  const files = {};
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) Object.assign(files, await collectFiles(full, relative));
    else files[relative] = await readFile(full);
  }
  return files;
}

export async function zipPluginFolder(folder, rootName) {
  const files = await collectFiles(folder, rootName);
  if (!Object.keys(files).length) throw new Error(`Plugin folder is empty: ${folder}`);
  return buildStoredZip(files);
}

export function unzipStoredFiles(buffer) {
  const files = {};
  for (const entry of listZip(buffer)) {
    if (entry.directory) continue;
    if (buffer.readUInt32LE(entry.localOffset) !== LOCAL) continue;
    const nameLength = buffer.readUInt16LE(entry.localOffset + 26);
    const extraLength = buffer.readUInt16LE(entry.localOffset + 28);
    const start = entry.localOffset + 30 + nameLength + extraLength;
    const compressed = buffer.subarray(start, start + entry.compressedSize);
    files[entry.name] = entry.method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed, { maxOutputLength: entry.size });
  }
  return files;
}

export function pluginVersionFromFiles(files, rootName) {
  const raw = files[`${rootName}/plugin-version.json`];
  if (raw) {
    try {
      const parsed = JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw));
      if (parsed.pluginVersion) return String(parsed.pluginVersion);
    } catch {
      /* fall through */
    }
  }
  const xml = files[`${rootName}/ModInfo.xml`];
  const match = xml && String(xml).match(/<Version\s+value="([^"]+)"/i);
  if (!match) return '0.0.0';
  return String(match[1]).replace(/(\.0)+$/, '') || String(match[1]);
}

export function pluginSpecFromZip(id, zip, gameVersion = '3.10.14') {
  const meta = platformPluginMod(id);
  if (!meta) throw new Error(`Unknown platform plugin id: ${id}`);
  const files = unzipStoredFiles(zip);
  return {
    id,
    name: meta.name,
    root: meta.root,
    installSide: meta.side,
    zip,
    sha256: sha256Buffer(zip),
    version: pluginVersionFromFiles(files, meta.root),
    gameVersions: [gameVersion],
    containsDll: true,
    requiresRestart: true
  };
}

export function requestHeaders(env = process.env) {
  const headers = {
    'user-agent': 'HordepinCI/1.0 (+https://github.com/lyretain/7d2d-mod-platform)'
  };
  const skip = env.PLATFORM_CF_SKIP_TOKEN || env.CF_SKIP_TOKEN;
  if (skip) headers['x-hordepin-ci'] = skip;
  if (env.CF_ACCESS_CLIENT_ID) headers['cf-access-client-id'] = env.CF_ACCESS_CLIENT_ID;
  if (env.CF_ACCESS_CLIENT_SECRET) headers['cf-access-client-secret'] = env.CF_ACCESS_CLIENT_SECRET;
  return headers;
}

export function describeApiError(status, text) {
  const body = String(text || '');
  if (/just a moment|cf-mitigated|challenges\.cloudflare\.com/i.test(body)) {
    return `Cloudflare blocked this CI request (${status}). Skip Bot Fight Mode for /api/v1/*, or add a WAF skip for header x-hordepin-ci and set secret PLATFORM_CF_SKIP_TOKEN.`;
  }
  return body.slice(0, 500) || `HTTP ${status}`;
}

export function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const options = {
    baseUrl: env.PLATFORM_BASE_URL || env.PUBLIC_BASE_URL || 'https://mods.aic.la',
    token: env.PLATFORM_TOKEN || '',
    username: env.PLATFORM_USERNAME || '',
    password: env.PLATFORM_PASSWORD || '',
    packId: env.PLATFORM_PACK_ID || '',
    packName: env.PLATFORM_PACK_NAME || 'Hordepin Platform',
    gameVersion: env.PLATFORM_GAME_VERSION || '3.10.14',
    publishLauncher: env.PLATFORM_PUBLISH_LAUNCHER !== 'false',
    clientDir: path.join(ROOT, 'artifacts', 'plugins', 'ModPlatformClient'),
    serverDir: path.join(ROOT, 'artifacts', 'plugins', 'ModPlatformServer'),
    launcherZip: '',
    outputDir: path.join(ROOT, 'artifacts'),
    packOnly: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--pack-only') options.packOnly = true;
    else if (value === '--no-launcher') options.publishLauncher = false;
    else if (value.startsWith('--')) {
      const key = value.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
      options[key] = argv[++index];
    }
  }
  return options;
}

async function api(baseUrl, token, pathname, { method = 'GET', headers = {}, body } = {}) {
  const response = await fetch(`${String(baseUrl).replace(/\/$/, '')}${pathname}`, {
    method,
    headers: {
      ...requestHeaders(process.env),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers
    },
    body
  });
  const text = await response.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text }; }
  if (!response.ok) {
    const message = parsed?.error?.message || parsed?.error?.code || describeApiError(response.status, text);
    throw Object.assign(new Error(message), { status: response.status, body: parsed?.error ? parsed : { raw: String(text || '').slice(0, 200) } });
  }
  return parsed;
}

export async function login(baseUrl, { token, username, password }) {
  if (token) return token;
  if (!username || !password) return '';
  const result = await api(baseUrl, '', '/api/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  if (result.requiresTotp) throw new Error('CI account has TOTP enabled; use a bot account without 2FA or pass PLATFORM_TOKEN');
  return result.token;
}

export async function uploadArtifact(baseUrl, token, buffer, fileName) {
  const hash = sha256Buffer(buffer);
  if (buffer.length <= SMALL_UPLOAD_BYTES) {
    return api(baseUrl, token, `/api/v1/artifacts/${hash}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/zip', 'x-file-name': encodeURIComponent(fileName) },
      body: buffer
    });
  }
  const session = await api(baseUrl, token, `/api/v1/artifacts/${hash}/uploads`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ size: buffer.length, chunkSize: DEFAULT_CHUNK_BYTES, fileName })
  });
  const chunkSize = session.chunkSize || DEFAULT_CHUNK_BYTES;
  const received = new Set(session.received || []);
  const chunks = Math.ceil(buffer.length / chunkSize) || 1;
  for (let index = 0; index < chunks; index += 1) {
    if (received.has(index)) continue;
    const slice = buffer.subarray(index * chunkSize, Math.min(buffer.length, (index + 1) * chunkSize));
    await api(baseUrl, token, `/api/v1/artifacts/${hash}/uploads/${session.uploadId}/${index}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream' },
      body: slice
    });
  }
  return api(baseUrl, token, `/api/v1/artifacts/${hash}/uploads/${session.uploadId}/complete`, { method: 'POST' });
}

export async function approveReview(baseUrl, token, sha256) {
  try {
    return await api(baseUrl, token, `/api/v1/reviews/${sha256}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'approved', licenseConfirmed: true, license: 'platform-first-party' })
    });
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

export async function registerMod(baseUrl, token, spec) {
  if (!platformPluginMod(spec.id)) throw new Error(`Refusing to register non-platform plugin id: ${spec.id}`);
  return api(baseUrl, token, '/api/v1/mods', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: spec.id,
      name: spec.name,
      version: spec.version,
      artifactSha: spec.sha256,
      gameVersions: spec.gameVersions,
      gameVersionRange: 'major',
      installRoots: [spec.root],
      installSide: spec.installSide,
      containsDll: true,
      requiresRestart: true,
      r18: false
    })
  });
}

export async function publishLauncher(baseUrl, token, { sha256, version, platform = 'win32', notes, fileName }) {
  const confirm = await api(baseUrl, token, '/api/v1/admin/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'launcher.publish' })
  });
  return api(baseUrl, token, '/api/v1/admin/launcher', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sha256,
      version,
      platform,
      notes,
      fileName,
      confirmToken: confirm.token
    })
  });
}

export async function upsertPlatformPack(baseUrl, token, { packId, packName, gameVersion, specs }) {
  if (!packId || !specs.length) return null;
  let existing = null;
  try {
    existing = await api(baseUrl, token, `/api/v1/packs/${encodeURIComponent(packId)}`);
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  const kept = (existing?.pack?.entries || []).filter((entry) => !platformPluginMod(entry.modId));
  const entries = kept.concat(specs.map((spec) => ({ modId: spec.id, version: spec.version, required: true })));
  const pack = await api(baseUrl, token, '/api/v1/packs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: packId,
      name: existing?.pack?.name || packName,
      gameVersion: existing?.pack?.gameVersion || gameVersion,
      entries
    })
  });
  const release = await api(baseUrl, token, `/api/v1/packs/${encodeURIComponent(pack.id)}/releases`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason: `ci:${process.env.GITHUB_SHA || 'local'}` })
  });
  return { pack, release };
}

async function findLauncherZip(outputDir, explicit) {
  if (explicit) return explicit;
  let names = [];
  try { names = await readdir(path.resolve(outputDir)); } catch { return ''; }
  const match = names.filter((name) => /^ModPlatformLauncher-.*-win32\.zip$/i.test(name)).sort().at(-1);
  return match ? path.join(outputDir, match) : '';
}

export async function packArtifacts(options) {
  await mkdir(options.outputDir, { recursive: true });
  const result = { files: [], specs: [] };
  for (const id of Object.keys(PLATFORM_PLUGIN_MODS)) {
    const meta = PLATFORM_PLUGIN_MODS[id];
    const folder = id === 'mod-platform-client' ? options.clientDir : options.serverDir;
    try { await stat(folder); } catch { continue; }
    const zip = await zipPluginFolder(folder, meta.root);
    const spec = pluginSpecFromZip(id, zip, options.gameVersion);
    const file = path.join(options.outputDir, `${meta.root}-${spec.version}.zip`);
    await writeFile(file, zip);
    result.files.push({ id, file, sha256: spec.sha256, version: spec.version, size: zip.length });
    result.specs.push(spec);
  }
  return result;
}

export async function publishPlatform(options) {
  const packed = await packArtifacts(options);
  if (options.packOnly) return { packed, published: false, skipped: 'pack-only' };
  const token = await login(options.baseUrl, options);
  if (!token) return { packed, published: false, skipped: 'no credentials' };
  const uploaded = [];
  for (const spec of packed.specs) {
    const fileName = `${spec.root}-${spec.version}.zip`;
    const artifact = await uploadArtifact(options.baseUrl, token, spec.zip, fileName);
    await approveReview(options.baseUrl, token, spec.sha256);
    const mod = await registerMod(options.baseUrl, token, spec);
    uploaded.push({ id: spec.id, version: spec.version, sha256: spec.sha256, size: spec.zip.length, artifact, mod });
  }
  let launcher = null;
  const launcherPath = await findLauncherZip(options.outputDir, options.launcherZip);
  if (options.publishLauncher && launcherPath) {
    const zip = await readFile(launcherPath);
    const hash = sha256Buffer(zip);
    const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
    await uploadArtifact(options.baseUrl, token, zip, path.basename(launcherPath));
    await approveReview(options.baseUrl, token, hash);
    launcher = await publishLauncher(options.baseUrl, token, {
      sha256: hash,
      version: pkg.version,
      fileName: path.basename(launcherPath),
      notes: process.env.GITHUB_SHA ? `github:${process.env.GITHUB_SHA}` : 'ci'
    });
  }
  const pack = await upsertPlatformPack(options.baseUrl, token, {
    packId: options.packId,
    packName: options.packName,
    gameVersion: options.gameVersion,
    specs: packed.specs
  });
  return { packed: { files: packed.files }, published: true, uploaded, launcher, pack };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const result = await publishPlatform(parseArgs());
  console.log(JSON.stringify(result, (key, value) => (Buffer.isBuffer(value) ? undefined : value), 2));
}
