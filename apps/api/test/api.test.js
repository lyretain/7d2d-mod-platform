import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { SigningService } from '../src/signing.js';
import { JsonStore } from '../src/store.js';
import { sha256 } from '../src/util.js';
import { verifyManifest } from '../../updater/src/verify.js';
import { createStoredZip } from '../../updater/test/zip-helper.js';

async function fixture(t) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'mod-platform-api-'));
  const store = new JsonStore(path.join(dataDir, 'state', 'database.json'));
  const signing = new SigningService({ dataDir });
  await Promise.all([store.init(), signing.init()]);
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  server.removeAllListeners('request');
  server.on('request', createApp({ store, signing, dataDir, adminToken: 'test-admin-token-1234', publicBaseUrl: base }));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { base, signing, store };
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json();
  assert.ok(response.ok, JSON.stringify(body));
  return body;
}

test('publishes and verifies an immutable ModPack manifest', async (t) => {
  const { base, signing } = await fixture(t);
  const admin = { authorization: 'Bearer test-admin-token-1234' };
  const archive = createStoredZip({ 'ExampleMod/ModInfo.xml': '<xml />' });
  const artifactSha = sha256(archive);
  await jsonRequest(`${base}/api/v1/artifacts/${artifactSha}`, { method: 'PUT', headers: { ...admin, 'content-type': 'application/zip' }, body: archive });
  await jsonRequest(`${base}/api/v1/mods`, { method: 'POST', headers: { ...admin, 'content-type': 'application/json' }, body: JSON.stringify({ id: 'example', name: 'Example', version: '1.0.0', artifactSha, gameVersions: ['2.6'], installRoots: ['ExampleMod'] }) });
  await jsonRequest(`${base}/api/v1/packs`, { method: 'POST', headers: { ...admin, 'content-type': 'application/json' }, body: JSON.stringify({ id: 'test-pack', name: 'Test', gameVersion: '2.6', entries: [{ modId: 'example', version: '1.0.0' }] }) });
  await jsonRequest(`${base}/api/v1/packs/test-pack/releases`, { method: 'POST', headers: { ...admin, 'content-type': 'application/json' }, body: '{}' });
  const manifest = await jsonRequest(`${base}/api/v1/public/packs/test-pack/latest`);
  assert.equal(manifest.mods[0].sha256, artifactSha);
  assert.equal(verifyManifest(manifest, signing.publicJwk().publicKey), true);
  manifest.gameVersion = 'tampered';
  assert.equal(verifyManifest(manifest, signing.publicJwk().publicKey), false);
});

test('redacts and aggregates diagnostics', async (t) => {
  const { base } = await fixture(t);
  const event = { sessionId: 's1', side: 'client', gameVersion: '2.6', stage: 'startup', exceptionType: 'TypeLoadException', message: 'token=secret-value from 192.168.1.8', stackTrace: 'at Mod.Run() in C:\\Users\\Alice\\x.cs:42', logExcerpt: 'password=hunter2' };
  const accepted = await jsonRequest(`${base}/api/v1/diagnostics`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event) });
  assert.equal(accepted.accepted, true);
  const state = await jsonRequest(`${base}/api/v1/admin/state`, { headers: { authorization: 'Bearer test-admin-token-1234' } });
  assert.match(state.diagnostics[0].message, /\[REDACTED\]/);
  assert.doesNotMatch(state.diagnostics[0].message, /secret-value|192\.168/);
  assert.equal(state.fingerprints[accepted.fingerprint].count, 1);
});

test('requires a one-use invitation for registration and supports login sessions', async (t) => {
  const { base } = await fixture(t);
  const adminPage = await (await fetch(base)).text();
  assert.match(adminPage, /邀请码注册/);
  const bootstrap = { authorization: 'Bearer test-admin-token-1234', 'content-type': 'application/json' };
  const invitation = await jsonRequest(`${base}/api/v1/invites`, { method: 'POST', headers: bootstrap, body: JSON.stringify({ role: 'admin', maxUses: 1, expiresInHours: 24 }) });
  assert.match(invitation.code, /^inv_/);

  const registration = await jsonRequest(`${base}/api/v1/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'Alice.Admin', password: 'correct horse battery staple', inviteCode: invitation.code }) });
  assert.equal(registration.user.role, 'admin');
  const retiredBootstrap = await fetch(`${base}/api/v1/admin/state`, { headers: { authorization: 'Bearer test-admin-token-1234' } });
  assert.equal(retiredBootstrap.status, 401);

  const reused = await fetch(`${base}/api/v1/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'SecondUser', password: 'another secure password', inviteCode: invitation.code }) });
  assert.equal(reused.status, 422);

  const login = await jsonRequest(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'alice.admin', password: 'correct horse battery staple' }) });
  assert.ok(login.token.length >= 40);
  const sessionHeaders = { authorization: `Bearer ${login.token}` };
  const me = await jsonRequest(`${base}/api/v1/auth/me`, { headers: sessionHeaders });
  assert.equal(me.user.username, 'Alice.Admin');

  const state = await jsonRequest(`${base}/api/v1/admin/state`, { headers: sessionHeaders });
  assert.equal(Object.values(state.users)[0].passwordHash, undefined);
  assert.equal(state.sessions.activeCount, 1);

  const viewerInvite = await jsonRequest(`${base}/api/v1/invites`, { method: 'POST', headers: { ...sessionHeaders, 'content-type': 'application/json' }, body: JSON.stringify({ role: 'viewer', maxUses: 1, expiresInHours: 24 }) });
  await jsonRequest(`${base}/api/v1/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'ReadOnlyUser', password: 'read only secure password', inviteCode: viewerInvite.code }) });
  const viewerLogin = await jsonRequest(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'ReadOnlyUser', password: 'read only secure password' }) });
  const viewerHeaders = { authorization: `Bearer ${viewerLogin.token}`, 'content-type': 'application/json' };
  assert.equal((await fetch(`${base}/api/v1/admin/state`, { headers: viewerHeaders })).status, 200);
  assert.equal((await fetch(`${base}/api/v1/invites`, { method: 'POST', headers: viewerHeaders, body: JSON.stringify({ role: 'admin' }) })).status, 403);

  await jsonRequest(`${base}/api/v1/auth/logout`, { method: 'POST', headers: { ...sessionHeaders, 'content-type': 'application/json' }, body: '{}' });
  const afterLogout = await fetch(`${base}/api/v1/auth/me`, { headers: sessionHeaders });
  assert.equal(afterLogout.status, 401);
});

test('can list, revoke, roll back releases and pause distribution', async (t) => {
  const { base } = await fixture(t);
  const admin = { authorization: 'Bearer test-admin-token-1234', 'content-type': 'application/json' };
  const archive = createStoredZip({ 'ExampleMod/ModInfo.xml': '<xml />' });
  const artifactSha = sha256(archive);
  await jsonRequest(`${base}/api/v1/artifacts/${artifactSha}`, { method: 'PUT', headers: { authorization: admin.authorization, 'content-type': 'application/zip' }, body: archive });
  await jsonRequest(`${base}/api/v1/mods`, { method: 'POST', headers: admin, body: JSON.stringify({ id: 'example', name: 'Example', version: '1.0.0', artifactSha, gameVersions: ['2.6'], installRoots: ['ExampleMod'] }) });
  await jsonRequest(`${base}/api/v1/packs`, { method: 'POST', headers: admin, body: JSON.stringify({ id: 'ops-pack', name: 'Ops', gameVersion: '2.6', entries: [{ modId: 'example', version: '1.0.0' }] }) });
  const first = await jsonRequest(`${base}/api/v1/packs/ops-pack/releases`, { method: 'POST', headers: admin, body: JSON.stringify({ reason: 'initial' }) });
  const second = await jsonRequest(`${base}/api/v1/packs/ops-pack/releases`, { method: 'POST', headers: admin, body: JSON.stringify({ reason: 'bump' }) });
  assert.equal(second.packVersion, 2);
  assert.ok(second.diff);
  const listed = await jsonRequest(`${base}/api/v1/packs/ops-pack/releases`, { headers: { authorization: admin.authorization } });
  assert.equal(listed.releases.length, 2);
  assert.equal(listed.mayAffectSaves, true);

  await jsonRequest(`${base}/api/v1/packs/ops-pack/releases/${second.id}/revoke`, { method: 'POST', headers: admin, body: JSON.stringify({ reason: 'broken dll' }) });
  assert.equal((await fetch(`${base}/api/v1/public/packs/ops-pack/latest`)).status, 404);

  const rolled = await jsonRequest(`${base}/api/v1/packs/ops-pack/rollback`, { method: 'POST', headers: admin, body: JSON.stringify({ releaseId: first.id, reason: 'restore last good' }) });
  assert.equal(rolled.release.id, first.id);
  assert.equal(rolled.mayAffectSaves, true);
  const latest = await jsonRequest(`${base}/api/v1/public/packs/ops-pack/latest`);
  assert.equal(latest.packVersion, 1);

  const server = await jsonRequest(`${base}/api/v1/servers`, { method: 'POST', headers: admin, body: JSON.stringify({ name: 'Test', packId: 'ops-pack', publicAddress: 'game.example.com:26900' }) });
  await jsonRequest(`${base}/api/v1/servers/${server.serverId}`, { method: 'PATCH', headers: admin, body: JSON.stringify({ publicAddress: 'pve.example.com:26900' }) });
  const resolved = await jsonRequest(`${base}/api/v1/public/servers/resolve?address=pve.example.com:26900`);
  assert.equal(resolved.handshake.packId, 'ops-pack');
  assert.equal(resolved.handshake.pluginRequired, true);

  await jsonRequest(`${base}/api/v1/admin/distribution`, { method: 'POST', headers: admin, body: JSON.stringify({ paused: true, reason: 'incident' }) });
  assert.equal((await fetch(`${base}/api/v1/public/packs/ops-pack/latest`)).status, 503);
  const assignment = await fetch(`${base}/api/v1/servers/${server.serverId}/assignment`, { headers: { authorization: `Bearer ${server.token}` } });
  const assigned = await assignment.json();
  assert.equal(assigned.handshake.distributionPaused, true);
  assert.equal(assigned.acceptingPlayers, false);
});

