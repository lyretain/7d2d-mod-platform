import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { bearer, id, now } from './util.js';
import { consumeRateLimit } from './security.js';
import { generateRecoveryCodes, generateTotpSecret, verifyTotp } from './totp.js';
import { recordAudit } from './protocol.js';

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

export function createAuthService({ store, bootstrapToken, allowBootstrapAfterSetup = false, bootstrapDisabled = false, sessionHours = 168 }) {
  function principal(req) {
    const token = bearer(req);
    if (!token) return null;
    const snapshot = store.snapshot();
    const noUsers = Object.keys(snapshot.users).length === 0;
    const bootstrapAllowed = noUsers || (allowBootstrapAfterSetup && !bootstrapDisabled);
    if (bootstrapToken && token === bootstrapToken && bootstrapAllowed) return { id: 'bootstrap', username: 'bootstrap', role: 'admin', bootstrap: true };
    const session = snapshot.sessions[tokenHash(token)];
    if (!session || Date.parse(session.expiresAt) <= Date.now()) return null;
    const user = snapshot.users[session.userId];
    if (!user || user.disabledAt) return null;
    return { id: user.id, username: user.username, role: user.role, bootstrap: false, sessionHash: tokenHash(token) };
  }

  async function allowLogin(req, username) {
    const address = String(req.socket?.remoteAddress || 'unknown');
    return consumeRateLimit(store, { key: `login:${address}|${normalizedUsername(username)}`, limit: 8, windowMs: 15 * 60 * 1000 });
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
    if (!await allowLogin(req, username)) throw Object.assign(new Error('Too many login attempts; try again later'), { code: 'RATE_LIMITED' });
    const snapshot = store.snapshot();
    const normalized = normalizedUsername(username);
    const user = Object.values(snapshot.users).find((item) => item.normalizedUsername === normalized);
    let valid = false;
    if (user && !user.disabledAt) valid = await verifyPassword(String(password || ''), user.passwordHash);
    else await scrypt(String(password || ''), Buffer.alloc(16), 64);
    if (!valid) throw Object.assign(new Error('Invalid username or password'), { code: 'INVALID_CREDENTIALS' });
    if (user.totpEnabled) {
      const ticket = randomBytes(24).toString('base64url');
      await store.mutate((draft) => {
        draft.passwordResets[`totp_${tokenHash(ticket)}`] = { userId: user.id, expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(), kind: 'totp' };
      });
      return { requiresTotp: true, ticket, expiresAt: new Date(Date.now() + 5 * 60_000).toISOString() };
    }
    return issueSession(user);
  }

  async function issueSession(user) {
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

  async function completeTotp(ticket, code) {
    const snapshot = store.snapshot();
    const pending = snapshot.passwordResets[`totp_${tokenHash(ticket)}`];
    if (!pending || pending.kind !== 'totp' || Date.parse(pending.expiresAt) <= Date.now()) throw Object.assign(new Error('TOTP ticket is invalid'), { code: 'INVALID_CREDENTIALS' });
    const user = snapshot.users[pending.userId];
    const recovery = (user.recoveryHashes || []).find((item) => item === tokenHash(String(code || '').toLowerCase()));
    if (!verifyTotp(user.totpSecret, code) && !recovery) throw Object.assign(new Error('Invalid TOTP code'), { code: 'INVALID_CREDENTIALS' });
    await store.mutate((draft) => {
      delete draft.passwordResets[`totp_${tokenHash(ticket)}`];
      if (recovery) draft.users[user.id].recoveryHashes = (draft.users[user.id].recoveryHashes || []).filter((item) => item !== recovery);
    });
    return issueSession(user);
  }

  function publicUser(user) {
    return { id: user.id, username: user.username, role: user.role, createdAt: user.createdAt, disabledAt: user.disabledAt || null, totpEnabled: Boolean(user.totpEnabled) };
  }

  async function listUsers() {
    return Object.values(store.snapshot().users).map(publicUser);
  }

  async function setUserDisabled(userId, disabled, actor) {
    return store.mutate((draft) => {
      const user = draft.users[userId];
      if (!user) return null;
      user.disabledAt = disabled ? now() : null;
      if (disabled) for (const [key, session] of Object.entries(draft.sessions)) if (session.userId === userId) delete draft.sessions[key];
      recordAudit(draft, { actor, action: disabled ? 'user.disable' : 'user.enable', target: userId });
      return publicUser(user);
    });
  }

  async function setUserRole(userId, role, actor) {
    if (!['admin', 'viewer'].includes(role)) throw Object.assign(new Error('Invalid role'), { code: 'VALIDATION' });
    return store.mutate((draft) => {
      const user = draft.users[userId];
      if (!user) return null;
      user.role = role;
      recordAudit(draft, { actor, action: 'user.role', target: userId, details: { role } });
      return publicUser(user);
    });
  }

  async function changePassword(userId, currentPassword, nextPassword) {
    const user = store.snapshot().users[userId];
    if (!user || !await verifyPassword(currentPassword, user.passwordHash)) throw Object.assign(new Error('Current password is incorrect'), { code: 'INVALID_CREDENTIALS' });
    const passwordHash = await hashPassword(nextPassword);
    await store.mutate((draft) => { draft.users[userId].passwordHash = passwordHash; });
    return { changed: true };
  }

  async function createPasswordReset(userId, actor) {
    const token = randomBytes(24).toString('base64url');
    await store.mutate((draft) => {
      if (!draft.users[userId]) return;
      draft.passwordResets[tokenHash(token)] = { userId, expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(), kind: 'reset' };
      recordAudit(draft, { actor, action: 'user.reset', target: userId });
    });
    return { token, expiresInMinutes: 60 };
  }

  async function consumePasswordReset(token, password) {
    const passwordHash = await hashPassword(password);
    return store.mutate((draft) => {
      const reset = draft.passwordResets[tokenHash(token)];
      if (!reset || reset.kind !== 'reset' || Date.parse(reset.expiresAt) <= Date.now()) throw Object.assign(new Error('Reset token is invalid'), { code: 'INVALID_INVITE' });
      draft.users[reset.userId].passwordHash = passwordHash;
      delete draft.passwordResets[tokenHash(token)];
      for (const [key, session] of Object.entries(draft.sessions)) if (session.userId === reset.userId) delete draft.sessions[key];
      return { reset: true };
    });
  }

  function listSessions(userId) {
    return Object.entries(store.snapshot().sessions).filter(([, session]) => !userId || session.userId === userId).map(([hash, session]) => ({ hash, ...session }));
  }

  async function revokeSession(hash, actor) {
    return store.mutate((draft) => {
      if (!draft.sessions[hash]) return false;
      delete draft.sessions[hash];
      recordAudit(draft, { actor, action: 'session.revoke', target: hash });
      return true;
    });
  }

  async function revokeUserSessions(userId, actor) {
    return store.mutate((draft) => {
      let count = 0;
      for (const [key, session] of Object.entries(draft.sessions)) if (session.userId === userId) { delete draft.sessions[key]; count += 1; }
      recordAudit(draft, { actor, action: 'session.revoke_all', target: userId, details: { count } });
      return { revoked: count };
    });
  }

  async function enableTotp(userId) {
    const secret = generateTotpSecret();
    const codes = generateRecoveryCodes();
    await store.mutate((draft) => {
      draft.users[userId].totpSecret = secret;
      draft.users[userId].totpEnabled = false;
      draft.users[userId].recoveryHashes = codes.map((code) => tokenHash(code));
    });
    return { secret, otpauth: `otpauth://totp/7DTD:${userId}?secret=${secret}&issuer=7DTD`, recoveryCodes: codes };
  }

  async function confirmTotp(userId, code) {
    const user = store.snapshot().users[userId];
    if (!user?.totpSecret || !verifyTotp(user.totpSecret, code)) throw Object.assign(new Error('Invalid TOTP code'), { code: 'INVALID_CREDENTIALS' });
    await store.mutate((draft) => { draft.users[userId].totpEnabled = true; });
    return { enabled: true };
  }

  return {
    principal, createInvite, register, login, logout, revokeInvite, listInvites,
    completeTotp, listUsers, setUserDisabled, setUserRole, changePassword,
    createPasswordReset, consumePasswordReset, listSessions, revokeSession, revokeUserSessions,
    enableTotp, confirmTotp
  };
}
