import { randomBytes } from 'node:crypto';
import { activeRelease, releaseDiff } from './protocol.js';
import { gameVersionMatches } from './game-version.js';
import { serverAddresses } from './servers.js';
import { isSafeId } from './util.js';

const SLOT_SKIP = new Set(['config', 'xui', 'xui_ingame', 'localization', 'bin', 'harmony', 'uiatlases', 'resources', 'dancestates', 'modelstates']);
const SLOT_HINT_DIR = /^(avatars|dances|models|skins|outfits|emotes|motions|content|assets)$/i;
const SLOT_MEDIA = /\.(avatar3d|unity3d|bundle|assetbundle|vrm)$/i;
const SLOT_TEXT = [
  { id: 'avatars', path: 'Avatars', pattern: /avatar/i },
  { id: 'dances', path: 'Dances', pattern: /dance|emote/i }
];

export function normalizeDependsOn(value, selfId) {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[\s,]+/) : [];
  return [...new Set(raw.map((item) => String(item || '').trim()).filter((id) => isSafeId(id) && id !== selfId))];
}

export function isSafeSlotPath(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value);
}

export function normalizeContentSlots(value) {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[\s,]+/).map((pathName) => ({ path: pathName })) : [];
  const seen = new Set();
  const slots = [];
  for (const item of raw) {
    const pathName = String(item?.path || item?.id || item || '').trim();
    if (!isSafeSlotPath(pathName)) continue;
    const id = isSafeId(item?.id) ? item.id : pathName.toLocaleLowerCase('en-US');
    const key = id.toLocaleLowerCase('en-US');
    if (seen.has(key) || seen.has(pathName.toLocaleLowerCase('en-US'))) continue;
    seen.add(key);
    seen.add(pathName.toLocaleLowerCase('en-US'));
    slots.push({
      id,
      path: pathName,
      label: String(item?.label || pathName).trim().slice(0, 80) || pathName
    });
  }
  return slots;
}

export function suggestContentSlots({ files = [], roots = [], description = '' } = {}) {
  const rootSet = new Set((roots || []).map((item) => String(item).toLocaleLowerCase('en-US')));
  const dirs = new Map();
  for (const file of files) {
    const name = typeof file === 'string' ? file : file?.name;
    const parts = String(name || '').replaceAll('\\', '/').split('/').filter(Boolean);
    if (parts.length < 2) continue;
    let index = 0;
    if (rootSet.has(parts[0].toLocaleLowerCase('en-US'))) index = 1;
    if (index >= parts.length) continue;
    const dir = parts[index];
    if (!dir || SLOT_SKIP.has(dir.toLocaleLowerCase('en-US'))) continue;
    const rec = dirs.get(dir) || { media: 0 };
    if (SLOT_MEDIA.test(parts[parts.length - 1])) rec.media += 1;
    dirs.set(dir, rec);
  }
  const suggested = [];
  for (const [dir, rec] of dirs) {
    if (SLOT_HINT_DIR.test(dir) || rec.media > 0) suggested.push({ id: dir.toLocaleLowerCase('en-US'), path: dir, label: dir });
  }
  const text = String(description || '');
  for (const hint of SLOT_TEXT) {
    if (hint.pattern.test(text) && !suggested.some((item) => item.id === hint.id)) suggested.push(hint);
  }
  return normalizeContentSlots(suggested);
}

export function listModOverlays(mod) {
  const contents = mod?.slotContents || {};
  return (mod?.contentSlots || []).map((slot) => {
    const content = contents[slot.id];
    if (!content?.sha256) return null;
    return { id: slot.id, path: slot.path, sha256: content.sha256, size: Number(content.size) || 0 };
  }).filter(Boolean);
}

export function pickCompatibleVersion(mod, gameVersion) {
  const versions = Object.values(mod?.versions || {}).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  if (!versions.length) return null;
  if (!gameVersion) return versions[0];
  return versions.find((item) => !item.gameVersions?.length || gameVersionMatches(item.gameVersions, gameVersion, item.gameVersionRange)) || null;
}

export function expandPackEntries(snapshot, entries, gameVersion) {
  const ordered = [];
  const seen = new Set();
  const visiting = new Set();

  function ensure(modId, preferredVersion, required) {
    if (seen.has(modId)) return;
    if (visiting.has(modId)) throw Object.assign(new Error(`Circular prerequisite: ${modId}`), { code: 'VALIDATION' });
    const mod = snapshot.mods?.[modId];
    if (!mod) throw Object.assign(new Error(`Unknown prerequisite mod: ${modId}`), { code: 'VALIDATION' });
    visiting.add(modId);
    const version = preferredVersion && mod.versions?.[preferredVersion]
      ? mod.versions[preferredVersion]
      : pickCompatibleVersion(mod, gameVersion);
    if (!version) throw Object.assign(new Error(`No compatible version of ${modId} for game ${gameVersion}`), { code: 'VALIDATION' });
    for (const depId of version.dependsOn || []) ensure(depId, null, true);
    visiting.delete(modId);
    seen.add(modId);
    ordered.push({ modId, version: version.version, required: required !== false });
  }

  for (const entry of entries || []) {
    if (!entry?.modId) throw Object.assign(new Error('Invalid pack entry'), { code: 'VALIDATION' });
    ensure(entry.modId, entry.version, entry.required);
  }
  return ordered;
}

function modInfoFrom(snapshot, version) {
  if (!version) return { author: null, description: null };
  const review = snapshot.reviews?.[version.artifactSha]?.analysis?.modInfo || {};
  return {
    author: version.author || review.author || null,
    description: version.description || review.description || null
  };
}

export function listMods(snapshot, query = '', options = {}) {
  const needle = String(query || '').trim().toLocaleLowerCase('en-US');
  const wantedGame = String(options.gameVersion || '').trim();
  const dll = String(options.dll || '').trim().toLocaleLowerCase('en-US');
  return Object.values(snapshot.mods || {}).map((mod) => {
    const versions = Object.values(mod.versions || {}).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    const latest = versions[0];
    const info = modInfoFrom(snapshot, latest);
    const gameVersions = [...new Set(versions.flatMap((item) => item.gameVersions || []))];
    const downloads = versions.reduce((sum, item) => sum + Number(snapshot.stats?.artifacts?.[item.artifactSha] || 0), 0);
    return {
      id: mod.id,
      name: mod.name,
      versionCount: versions.length,
      latestVersion: latest?.version || null,
      containsDll: versions.some((item) => item.containsDll),
      author: info.author,
      description: info.description,
      gameVersions,
      artifactSize: latest?.artifactSize || 0,
      downloads,
      updatedAt: latest?.createdAt || null,
      dependsOn: latest?.dependsOn || [],
      contentSlots: mod.contentSlots || [],
      slotContents: mod.slotContents || {},
      versions: versions.map((item) => ({ version: item.version, artifactSha: item.artifactSha, artifactSize: item.artifactSize, gameVersions: item.gameVersions, gameVersionRange: item.gameVersionRange || 'exact', containsDll: item.containsDll, dependsOn: item.dependsOn || [], createdAt: item.createdAt }))
    };
  }).filter((mod) => {
    if (wantedGame && !(mod.versions || []).some((item) => gameVersionMatches(item.gameVersions, wantedGame, item.gameVersionRange))) return false;
    if (dll === 'yes' && !mod.containsDll) return false;
    if (dll === 'no' && mod.containsDll) return false;
    if (!needle) return true;
    const hay = [mod.id, mod.name, mod.author, mod.description].join(' ').toLocaleLowerCase('en-US');
    return hay.includes(needle);
  });
}

export function listPacks(snapshot) {
  return Object.values(snapshot.packs || {}).map((pack) => {
    const release = activeRelease(snapshot, pack);
    return {
      id: pack.id,
      name: pack.name,
      gameVersion: pack.gameVersion,
      entryCount: (pack.entries || []).length,
      entries: pack.entries || [],
      latestReleaseId: pack.latestReleaseId,
      packVersion: release?.packVersion || null,
      updatedAt: pack.updatedAt
    };
  });
}

export function packDetail(snapshot, packId) {
  const pack = snapshot.packs[packId];
  if (!pack) return null;
  const release = activeRelease(snapshot, pack);
  const draftManifest = {
    mods: (pack.entries || []).map((entry) => {
      const version = snapshot.mods[entry.modId]?.versions?.[entry.version];
      return { id: entry.modId, version: entry.version, sha256: version?.artifactSha, size: version?.artifactSize };
    })
  };
  return {
    pack,
    activeRelease: release ? { id: release.id, packVersion: release.packVersion, createdAt: release.createdAt } : null,
    previewDiff: releaseDiff(release?.manifest, draftManifest)
  };
}

export function pluginServerConfig({ baseUrl, serverId, token, gameVersion }) {
  return {
    BaseUrl: String(baseUrl || '').replace(/\/$/, ''),
    ServerId: serverId,
    ServerToken: token,
    GameVersion: gameVersion || '3.1.0',
    RefreshSeconds: 60,
    HandshakeTimeoutSeconds: 15,
    AutoSync: true,
    AutoRestart: false
  };
}

export function listServers(snapshot) {
  const cutoff = Date.now() - 5 * 60_000;
  return Object.values(snapshot.servers || {}).map((server) => {
    const { tokenHash, ...safe } = server;
    const online = Boolean(server.lastSeenAt && Date.parse(server.lastSeenAt) >= cutoff);
    const addresses = serverAddresses(server);
    return {
      ...safe,
      publicAddresses: addresses,
      publicAddress: addresses[0] || null,
      online,
      acceptingPlayers: online && server.sync?.ok !== false && !snapshot.settings?.distributionPaused
    };
  });
}

export function filterAudit(snapshot, { action, actor, from, to, limit = 200 } = {}) {
  return (snapshot.audit || []).filter((item) => {
    if (action && item.action !== action) return false;
    if (actor && !String(item.actor || '').includes(actor)) return false;
    const at = Date.parse(item.at || 0);
    if (from && at < Date.parse(from)) return false;
    if (to && at > Date.parse(to)) return false;
    return true;
  }).slice(-(Number(limit) || 200)).reverse();
}

export function platformStats(snapshot) {
  const stats = snapshot.stats || { downloads: 0, bytes: 0, artifacts: {}, gameVersions: {} };
  const topArtifacts = Object.entries(stats.artifacts || {}).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([sha256, count]) => ({ sha256, count }));
  return {
    downloads: stats.downloads || 0,
    bytes: stats.bytes || 0,
    topArtifacts,
    gameVersions: stats.gameVersions || {},
    mods: Object.keys(snapshot.mods || {}).length,
    packs: Object.keys(snapshot.packs || {}).length,
    releases: Object.keys(snapshot.releases || {}).length,
    servers: Object.keys(snapshot.servers || {}).length,
    users: Object.keys(snapshot.users || {}).length
  };
}

export function recordDownload(draft, { sha256, bytes, gameVersion }) {
  draft.stats = draft.stats || { downloads: 0, bytes: 0, artifacts: {}, gameVersions: {} };
  draft.stats.downloads += 1;
  draft.stats.bytes += Number(bytes) || 0;
  draft.stats.artifacts[sha256] = (draft.stats.artifacts[sha256] || 0) + 1;
  if (gameVersion) draft.stats.gameVersions[gameVersion] = (draft.stats.gameVersions[gameVersion] || 0) + 1;
}

export function issueConfirm(draft, { action, actor }) {
  draft.confirmations = draft.confirmations || {};
  const token = randomBytes(16).toString('hex');
  draft.confirmations[token] = { action, actor, expiresAt: new Date(Date.now() + 5 * 60_000).toISOString() };
  return { token, action, expiresInSeconds: 300 };
}

export function consumeConfirm(draft, token, action) {
  const item = draft.confirmations?.[token];
  if (!item || item.action !== action || Date.parse(item.expiresAt) <= Date.now()) return false;
  delete draft.confirmations[token];
  return true;
}

export function requireConfirm(config, draft, body, action) {
  if (!config.requireConfirm) return true;
  if (!consumeConfirm(draft, body.confirmToken, action)) {
    throw Object.assign(new Error('Dangerous action requires a fresh confirmation token'), { code: 'VALIDATION' });
  }
  return true;
}

