import { id, now } from './util.js';

const TTL_MS = 120_000;

export function normalizePlayerIds(value, extra) {
  const list = [
    ...(Array.isArray(value) ? value : value ? [value] : []),
    ...(Array.isArray(extra) ? extra : extra ? [extra] : [])
  ];
  const ids = [...new Set(list
    .map((item) => String(item || '').trim().toLocaleLowerCase('en-US'))
    .filter((item) => item && item.length <= 128))];
  if (!ids.length) throw Object.assign(new Error('playerIds is required'), { code: 'VALIDATION' });
  if (ids.length > 8) throw Object.assign(new Error('Too many playerIds'), { code: 'VALIDATION' });
  return ids;
}

export function sanitizeHello(hello) {
  if (!hello || typeof hello !== 'object') throw Object.assign(new Error('hello is required'), { code: 'VALIDATION' });
  const protocolVersion = Number(hello.protocolVersion);
  if (!Number.isInteger(protocolVersion) || protocolVersion < 1) {
    throw Object.assign(new Error('Unsupported handshake protocol'), { code: 'VALIDATION' });
  }
  return {
    protocolVersion,
    pluginVersion: String(hello.pluginVersion || '').slice(0, 32),
    gameVersion: String(hello.gameVersion || '').slice(0, 64),
    steamBuildId: String(hello.steamBuildId || '').slice(0, 32),
    packId: String(hello.packId || '').slice(0, 128),
    packVersion: Number.isFinite(Number(hello.packVersion)) ? Number(hello.packVersion) : 0,
    keyId: String(hello.keyId || '').slice(0, 128),
    artifactFingerprint: String(hello.artifactFingerprint || '').slice(0, 4096),
    sessionId: String(hello.sessionId || '').slice(0, 64),
    syncing: Boolean(hello.syncing)
  };
}

export function pruneHandshakes(draft, at = Date.now()) {
  draft.handshakes = draft.handshakes || {};
  for (const [serverId, entries] of Object.entries(draft.handshakes)) {
    for (const [playerId, item] of Object.entries(entries || {})) {
      if (!item || Date.parse(item.expiresAt) <= at) delete entries[playerId];
    }
    if (!Object.keys(entries || {}).length) delete draft.handshakes[serverId];
  }
}

export function storeHandshake(draft, serverId, playerIds, hello) {
  pruneHandshakes(draft);
  const groupId = id('hs');
  const expiresAt = new Date(Date.now() + TTL_MS).toISOString();
  const record = { groupId, hello, playerIds, expiresAt, createdAt: now() };
  draft.handshakes[serverId] = draft.handshakes[serverId] || {};
  for (const playerId of playerIds) draft.handshakes[serverId][playerId] = record;
  return { expiresAt };
}

export function claimHandshake(draft, serverId, playerIds) {
  pruneHandshakes(draft);
  const bucket = draft.handshakes[serverId] || {};
  let found = null;
  for (const playerId of playerIds) {
    const item = bucket[playerId];
    if (item && Date.parse(item.expiresAt) > Date.now()) {
      found = item;
      break;
    }
  }
  if (!found) return null;
  for (const [key, item] of Object.entries(bucket)) {
    if (item && item.groupId === found.groupId) delete bucket[key];
  }
  if (!Object.keys(bucket).length) delete draft.handshakes[serverId];
  return found.hello;
}
