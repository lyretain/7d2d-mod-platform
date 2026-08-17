import { handshakeVersionsCompatible } from './game-version.js';

export const PROTOCOL_VERSION = 1;
export const PLUGIN_VERSION = '0.2.0';

export const HANDSHAKE_REASON = {
  OK: 'OK',
  MISSING_PLUGIN: 'MISSING_PLUGIN',
  GAME_VERSION: 'GAME_VERSION',
  PACK_MISMATCH: 'PACK_MISMATCH',
  REVOKED: 'RELEASE_REVOKED',
  DISTRIBUTION_PAUSED: 'DISTRIBUTION_PAUSED',
  TIMEOUT: 'HANDSHAKE_TIMEOUT',
  SYNCING: 'PACK_SYNCING',
  INVALID_HELLO: 'INVALID_HELLO'
};

export function artifactFingerprint(mods = []) {
  const hashes = [];
  for (const mod of mods) {
    if (mod?.sha256) hashes.push(String(mod.sha256).toLowerCase());
    for (const overlay of mod?.overlays || []) {
      if (overlay?.sha256) hashes.push(String(overlay.sha256).toLowerCase());
    }
  }
  return hashes.filter(Boolean).sort().join(',');
}

export function activeRelease(snapshot, pack) {
  if (!pack?.latestReleaseId) return null;
  const release = snapshot.releases[pack.latestReleaseId];
  if (!release || release.revokedAt) return null;
  return release;
}

export function handshakePolicy(snapshot, pack, signing, { launcherUrl, publicBaseUrl } = {}) {
  const paused = Boolean(snapshot.settings?.distributionPaused);
  const release = activeRelease(snapshot, pack);
  const manifest = release?.manifest || null;
  return {
    protocolVersion: PROTOCOL_VERSION,
    pluginRequired: true,
    distributionPaused: paused,
    launcherUrl: launcherUrl || publicBaseUrl || null,
    packId: pack?.id || null,
    packVersion: manifest?.packVersion || null,
    gameVersion: manifest?.gameVersion || pack?.gameVersion || null,
    keyId: manifest?.signing?.keyId || signing?.keyId || null,
    artifactFingerprint: manifest ? artifactFingerprint(manifest.mods) : null,
    releaseId: release?.id || null
  };
}

export function evaluateHello(hello, policy) {
  if (policy.distributionPaused) return { ok: false, reason: HANDSHAKE_REASON.DISTRIBUTION_PAUSED };
  if (!hello || hello.protocolVersion !== PROTOCOL_VERSION) return { ok: false, reason: HANDSHAKE_REASON.INVALID_HELLO };
  if (!policy.packVersion || !policy.artifactFingerprint) return { ok: false, reason: HANDSHAKE_REASON.REVOKED };
  if (hello.gameVersion && policy.gameVersion && !handshakeVersionsCompatible(hello.gameVersion, policy.gameVersion)) return { ok: false, reason: HANDSHAKE_REASON.GAME_VERSION };
  if (hello.packId !== policy.packId || Number(hello.packVersion) !== Number(policy.packVersion)) return { ok: false, reason: HANDSHAKE_REASON.PACK_MISMATCH };
  if (hello.keyId && policy.keyId && hello.keyId !== policy.keyId) return { ok: false, reason: HANDSHAKE_REASON.PACK_MISMATCH };
  if (hello.artifactFingerprint !== policy.artifactFingerprint) return { ok: false, reason: HANDSHAKE_REASON.PACK_MISMATCH };
  return { ok: true, reason: HANDSHAKE_REASON.OK };
}

export function recordAudit(draft, { actor, action, target, reason, details }) {
  draft.audit = Array.isArray(draft.audit) ? draft.audit : [];
  draft.audit.push({
    id: `aud_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    actor: actor || 'unknown',
    action,
    target: target || null,
    reason: reason || null,
    details: details || null
  });
}

export function releaseDiff(previousManifest, nextManifest) {
  const before = new Map((previousManifest?.mods || []).map((mod) => [mod.id, mod]));
  const after = new Map((nextManifest?.mods || []).map((mod) => [mod.id, mod]));
  const added = [];
  const removed = [];
  const changed = [];
  for (const [id, mod] of after) {
    const prior = before.get(id);
    if (!prior) added.push(`${id}@${mod.version}`);
    else if (prior.sha256 !== mod.sha256 || prior.version !== mod.version) changed.push(`${id}@${prior.version}->${mod.version}`);
  }
  for (const [id, mod] of before) if (!after.has(id)) removed.push(`${id}@${mod.version}`);
  return { added, removed, changed };
}
