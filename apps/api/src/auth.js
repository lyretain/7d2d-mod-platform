import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { bearer, id, now } from './util.js';

const scrypt = promisify(scryptCallback);
const USERNAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{2,31}$/;

function tokenHash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function normalizedUsername(value) {
  return String(value || '').trim().toLocaleLowerCase('en-US');
}

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 10 || password.length > 128) {
    const error = new Error('Password must contain 10 to 128 characters');
    error.code = 'VALIDATION';
    throw error;
  }
}

export async function hashPassword(password) {
  validatePassword(password);
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return `scrypt-v1$${salt.toString('base64')}$${Buffer.from(derived).toString('base64')}`;
}

export async function verifyPassword(password, encoded) {
  try {
    const [version, saltText, hashText] = String(encoded).split('$');
    if (version !== 'scrypt-v1') return false;
    const expected = Buffer.from(hashText, 'base64');
    const actual = Buffer.from(await scrypt(password, Buffer.from(saltText, 'base64'), expected.length));
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function createAuthService({ store, bootstrapToken, allowBootstrapAfterSetup = false, sessionHours = 168 }) {
  const attempts = new Map();

  function principal(req) {
    const token = bearer(req);
    if (!token) return null;
    const snapshot = store.snapshot();
    if (bootstrapToken && token === bootstrapToken && (allowBootstrapAfterSetup || Object.keys(snapshot.users).length === 0)) return { id: 'bootstrap', username: 'bootstrap', role: 'admin', bootstrap: true };
    const session = snapshot.sessions[tokenHash(token)];
    if (!session || Date.parse(session.expiresAt) <= Date.now()) return null;
    const user = snapshot.users[session.userId];
    if (!user || user.disabledAt) return null;
    return { id: user.id, username: user.username, role: user.role, bootstrap: false, sessionHash: tokenHash(token) };
  }

  function allowLogin(req, username) {
    const address = String(req.socket?.remoteAddress || 'unknown');
    const key = `${address}|${normalizedUsername(username)}`;
    const current = attempts.get(key);
    const windowMs = 15 * 60 * 1000;
    if (!current || Date.now() - current.startedAt > windowMs) {
      attempts.set(key, { count: 1, startedAt: Date.now() });
      return true;
    }
    current.count += 1;
    return current.count <= 8;
  }

  function clearAttempts(req, username) {
    attempts.delete(`${String(req.socket?.remoteAddress || 'unknown')}|${normalizedUsername(username)}`);
  }

  async function createInvite({ createdBy, role = 'admin', maxUses = 1, expiresInHours = 168, code }) {
    if (!['admin', 'viewer'].includes(role)) throw Object.assign(new Error('Invite role must be admin or viewer'), { code: 'VALIDATION' });
    const uses = Number(maxUses);
    const hours = Number(expiresInHours);
    if (!Number.isInteger(uses) || uses < 1 || uses > 100 || !Number.isFinite(hours) || hours < 1 || hours > 8760) throw Object.assign(new Error('Invalid invite limits'), { code: 'VALIDATION' });
    const rawCode = code || `inv_${randomBytes(24).toString('base64url')}`;
    if (rawCode.length < 12 || rawCode.length > 256) throw Object.assign(new Error('Invite code must contain 12 to 256 characters'), { code: 'VALIDATION' });
    const invite = {
      id: id('invite'), codeHash: tokenHash(rawCode), role, maxUses: uses, usedCount: 0,
      createdBy, createdAt: now(), expiresAt: new Date(Date.now() + hours * 3600_000).toISOString(), revokedAt: null
    };
    await store.mutate((draft) => { draft.invites[invite.id] = invite; });
    return { invite, code: rawCode };
  }

  async function register({ username, password, inviteCode }) {
    const normalized = normalizedUsername(username);
    if (!USERNAME.test(String(username || '').trim())) throw Object.assign(new Error('Username must be 3-32 characters using letters, numbers, dot, underscore or dash'), { code: 'VALIDATION' });
    if (typeof inviteCode !== 'string' || !inviteCode) throw Object.assign(new Error('Invitation code is required'), { code: 'VALIDATION' });
    const passwordHash = await hashPassword(password);
    const codeHash = tokenHash(inviteCode);
    return store.mutate((draft) => {
      if (Object.values(draft.users).some((user) => user.normalizedUsername === normalized)) throw Object.assign(new Error('Username is already registered'), { code: 'CONFLICT' });
      const invite = Object.values(draft.invites).find((item) => item.codeHash === codeHash);
      if (!invite || invite.revokedAt || Date.parse(invite.expiresAt) <= Date.now() || invite.usedCount >= invite.maxUses) throw Object.assign(new Error('Invitation code is invalid, expired or fully used'), { code: 'INVALID_INVITE' });
      const user = { id: id('usr'), username: String(username).trim(), normalizedUsername: normalized, passwordHash, role: invite.role, createdAt: now(), invitedBy: invite.createdBy, disabledAt: null };
      invite.usedCount += 1;
      invite.lastUsedAt = now();
      draft.users[user.id] = user;
      return { id: user.id, username: user.username, role: user.role, createdAt: user.createdAt };
    });
  }

  async function login(req, { username, password }) {
    if (!allowLogin(req, username)) throw Object.assign(new Error('Too many login attempts; try again later'), { code: 'RATE_LIMITED' });
    const snapshot = store.snapshot();
    const normalized = normalizedUsername(username);
    const user = Object.values(snapshot.users).find((item) => item.normalizedUsername === normalized);
    let valid = false;
    if (user && !user.disabledAt) valid = await verifyPassword(String(password || ''), user.passwordHash);
    else await scrypt(String(password || ''), Buffer.alloc(16), 64);
    if (!valid) throw Object.assign(new Error('Invalid username or password'), { code: 'INVALID_CREDENTIALS' });
    clearAttempts(req, username);
    const token = randomBytes(32).toString('base64url');
    const session = { userId: user.id, createdAt: now(), expiresAt: new Date(Date.now() + sessionHours * 3600_000).toISOString() };
    await store.mutate((draft) => {
      for (const [key, value] of Object.entries(draft.sessions)) if (Date.parse(value.expiresAt) <= Date.now()) delete draft.sessions[key];
      draft.sessions[tokenHash(token)] = session;
    });
    return { token, expiresAt: session.expiresAt, user: { id: user.id, username: user.username, role: user.role } };
  }

  async function logout(req) {
    const token = bearer(req);
    if (!token || (bootstrapToken && token === bootstrapToken)) return;
    await store.mutate((draft) => { delete draft.sessions[tokenHash(token)]; });
  }

  async function revokeInvite(inviteId) {
    return store.mutate((draft) => {
      const invite = draft.invites[inviteId];
      if (!invite) return false;
      invite.revokedAt = now();
      return true;
    });
  }

  function listInvites() {
    return Object.values(store.snapshot().invites).map(({ codeHash, ...invite }) => invite).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  return { principal, createInvite, register, login, logout, revokeInvite, listInvites };
}
