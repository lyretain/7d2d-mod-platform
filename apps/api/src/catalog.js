import { randomBytes } from 'node:crypto';
import { activeRelease, releaseDiff } from './protocol.js';

export function listMods(snapshot, query = '') {
  const needle = String(query || '').trim().toLocaleLowerCase('en-US');
  return Object.values(snapshot.mods || {}).map((mod) => {
    const versions = Object.values(mod.versions || {}).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return {
      id: mod.id,
      name: mod.name,
      versionCount: versions.length,
      latestVersion: versions[0]?.version || null,
      containsDll: versions.some((item) => item.containsDll),
      versions: versions.map((item) => ({ version: item.version, artifactSha: item.artifactSha, artifactSize: item.artifactSize, gameVersions: item.gameVersions, gameVersionRange: item.gameVersionRange || 'exact', containsDll: item.containsDll, createdAt: item.createdAt }))
    };
  }).filter((mod) => !needle || mod.id.includes(needle) || String(mod.name || '').toLocaleLowerCase('en-US').includes(needle));
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
    GameVersion: gameVersion || '3.10.14',
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
    return { ...safe, online, acceptingPlayers: online && server.sync?.ok !== false && !snapshot.settings?.distributionPaused };
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

