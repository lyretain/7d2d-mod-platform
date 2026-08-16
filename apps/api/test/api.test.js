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

async function fixture(t, extra = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'mod-platform-api-'));
  const store = new JsonStore(path.join(dataDir, 'state', 'database.json'));
  const signing = new SigningService({ dataDir });
  await Promise.all([store.init(), signing.init()]);
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  server.removeAllListeners('request');
  server.on('request', createApp({ store, signing, dataDir, adminToken: 'test-admin-token-1234', publicBaseUrl: base, ...extra }));
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
  const autoPack = await jsonRequest(`${base}/api/v1/packs`, { method: 'POST', headers: { ...admin, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Auto', gameVersion: '2.6', entries: [{ modId: 'example', version: '1.0.0' }] }) });
  assert.match(autoPack.id, /^pack_[0-9a-f]{32}$/);
  await jsonRequest(`${base}/api/v1/packs`, { method: 'POST', headers: { ...admin, 'content-type': 'application/json' }, body: JSON.stringify({ id: 'test-pack', name: 'Test', gameVersion: '2.6', entries: [{ modId: 'example', version: '1.0.0' }] }) });
  await jsonRequest(`${base}/api/v1/packs/test-pack/releases`, { method: 'POST', headers: { ...admin, 'content-type': 'application/json' }, body: '{}' });
  const manifest = await jsonRequest(`${base}/api/v1/public/packs/test-pack/latest`);
  assert.equal(manifest.mods[0].sha256, artifactSha);
  assert.equal(verifyManifest(manifest, signing.publicJwk().publicKey), true);
  manifest.gameVersion = 'tampered';
  assert.equal(verifyManifest(manifest, signing.publicJwk().publicKey), false);
});

test('major-range mods can join later 3.x packs but not the next major', async (t) => {
  const { base } = await fixture(t);
  const admin = { authorization: 'Bearer test-admin-token-1234', 'content-type': 'application/json' };
  const archive = createStoredZip({ 'ExampleMod/ModInfo.xml': '<xml />' });
  const artifactSha = sha256(archive);
  await jsonRequest(`${base}/api/v1/artifacts/${artifactSha}`, { method: 'PUT', headers: { ...admin, 'content-type': 'application/zip' }, body: archive });
  await jsonRequest(`${base}/api/v1/mods`, { method: 'POST', headers: admin, body: JSON.stringify({ id: 'generic', name: 'Generic', version: '1.0.0', artifactSha, gameVersions: ['3.0'], gameVersionRange: 'major', installRoots: ['ExampleMod'] }) });
  await jsonRequest(`${base}/api/v1/packs`, { method: 'POST', headers: admin, body: JSON.stringify({ name: 'V3', gameVersion: '3.10.14', entries: [{ modId: 'generic', version: '1.0.0' }] }) });
  assert.equal((await fetch(`${base}/api/v1/packs`, { method: 'POST', headers: admin, body: JSON.stringify({ name: 'V4', gameVersion: '4.0', entries: [{ modId: 'generic', version: '1.0.0' }] }) })).status, 422);
  assert.equal((await fetch(`${base}/api/v1/packs`, { method: 'POST', headers: admin, body: JSON.stringify({ name: 'V2', gameVersion: '2.6', entries: [{ modId: 'generic', version: '1.0.0' }] }) })).status, 422);
});

test('pack create pulls prerequisite mods into the release', async (t) => {
  const { base } = await fixture(t);
  const admin = { authorization: 'Bearer test-admin-token-1234', 'content-type': 'application/json' };
  const harmonyZip = createStoredZip({ 'Harmony/ModInfo.xml': '<xml />' });
  const gunZip = createStoredZip({ 'GunMod/ModInfo.xml': '<xml />' });
  const harmonySha = sha256(harmonyZip);
  const gunSha = sha256(gunZip);
  await jsonRequest(`${base}/api/v1/artifacts/${harmonySha}`, { method: 'PUT', headers: { ...admin, 'content-type': 'application/zip' }, body: harmonyZip });
  await jsonRequest(`${base}/api/v1/artifacts/${gunSha}`, { method: 'PUT', headers: { ...admin, 'content-type': 'application/zip' }, body: gunZip });
  await jsonRequest(`${base}/api/v1/mods`, { method: 'POST', headers: admin, body: JSON.stringify({ id: 'harmony', name: 'Harmony', version: '1.0.0', artifactSha: harmonySha, gameVersions: ['3.10.14'], installRoots: ['Harmony'] }) });
  assert.equal((await fetch(`${base}/api/v1/mods`, { method: 'POST', headers: admin, body: JSON.stringify({ id: 'gunmod', name: 'GunMod', version: '1.0.0', artifactSha: gunSha, gameVersions: ['3.10.14'], installRoots: ['GunMod'], dependsOn: ['missing-lib'] }) })).status, 422);
  const gun = await jsonRequest(`${base}/api/v1/mods`, { method: 'POST', headers: admin, body: JSON.stringify({ id: 'gunmod', name: 'GunMod', version: '1.0.0', artifactSha: gunSha, gameVersions: ['3.10.14'], installRoots: ['GunMod'], dependsOn: ['harmony'] }) });
  assert.deepEqual(gun.versions['1.0.0'].dependsOn, ['harmony']);
  const pack = await jsonRequest(`${base}/api/v1/packs`, { method: 'POST', headers: admin, body: JSON.stringify({ id: 'dep-pack', name: 'Deps', gameVersion: '3.10.14', entries: [{ modId: 'gunmod', version: '1.0.0' }] }) });
  assert.deepEqual(pack.entries.map((entry) => entry.modId), ['harmony', 'gunmod']);
  await jsonRequest(`${base}/api/v1/packs/dep-pack/releases`, { method: 'POST', headers: admin, body: '{}' });
  const latest = await jsonRequest(`${base}/api/v1/public/packs/dep-pack/latest`);
  assert.deepEqual(latest.mods.map((mod) => mod.id), ['harmony', 'gunmod']);
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
  const homePage = await (await fetch(base)).text();
  assert.match(homePage, /id="(gate|app)"/);
  const adminPage = await (await fetch(`${base}/legacy`)).text();
  assert.match(adminPage, /邀请码注册/);
  const adminScript = adminPage.split('<script>').pop()?.split('</script>')[0];
  assert.ok(adminScript, 'legacy admin page must include a script block');
  new Function(adminScript);
  const bootstrap = { authorization: 'Bearer test-admin-token-1234', 'content-type': 'application/json' };
  const invitation = await jsonRequest(`${base}/api/v1/invites`, { method: 'POST', headers: bootstrap, body: JSON.stringify({ role: 'admin', maxUses: 1, expiresInHours: 24 }) });
  assert.match(invitation.code, /^inv_/);

  const registration = await jsonRequest(`${base}/api/v1/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'Alice.Admin', password: 'correct horse battery staple', inviteCode: invitation.code }) });
  assert.equal(registration.user.role, 'superadmin');
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

  await jsonRequest(`${base}/api/v1/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'ReadOnlyUser', password: 'read only secure password' }) });
  const viewerLogin = await jsonRequest(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'ReadOnlyUser', password: 'read only secure password' }) });
  const viewerHeaders = { authorization: `Bearer ${viewerLogin.token}`, 'content-type': 'application/json' };
  assert.equal((await fetch(`${base}/api/v1/admin/state`, { headers: viewerHeaders })).status, 200);
  assert.equal((await fetch(`${base}/api/v1/invites`, { method: 'POST', headers: viewerHeaders, body: JSON.stringify({ role: 'admin' }) })).status, 403);

  const openUser = await jsonRequest(`${base}/api/v1/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'PlayerOne', password: 'community member password' }) });
  assert.equal(openUser.user.role, 'user');

  await jsonRequest(`${base}/api/v1/auth/logout`, { method: 'POST', headers: { ...sessionHeaders, 'content-type': 'application/json' }, body: '{}' });
  const afterLogout = await fetch(`${base}/api/v1/auth/me`, { headers: sessionHeaders });
  assert.equal(afterLogout.status, 401);
});

test('community admins need a superadmin invite and GitHub bind; developers activate by invite', async (t) => {
  const { base } = await fixture(t);
  const bootstrap = { authorization: 'Bearer test-admin-token-1234', 'content-type': 'application/json' };
  await jsonRequest(`${base}/api/v1/setup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'test-admin-token-1234', username: 'Owner', password: 'correct horse battery staple' }) });
  const owner = await jsonRequest(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'owner', password: 'correct horse battery staple' }) });
  const ownerHeaders = { authorization: `Bearer ${owner.token}`, 'content-type': 'application/json' };
  const communityInvite = await jsonRequest(`${base}/api/v1/invites`, { method: 'POST', headers: ownerHeaders, body: JSON.stringify({ role: 'community', maxUses: 1, expiresInHours: 24 }) });
  const community = await jsonRequest(`${base}/api/v1/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'CommAdmin', password: 'community admin password', inviteCode: communityInvite.code }) });
  assert.equal(community.user.role, 'community');
  const communityLogin = await jsonRequest(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'commadmin', password: 'community admin password' }) });
  const communityHeaders = { authorization: `Bearer ${communityLogin.token}`, 'content-type': 'application/json' };
  assert.equal((await fetch(`${base}/api/v1/invites`, { method: 'POST', headers: communityHeaders, body: JSON.stringify({ role: 'developer' }) })).status, 403);
  const bound = await jsonRequest(`${base}/api/v1/auth/github/bind`, { method: 'POST', headers: communityHeaders, body: JSON.stringify({ id: '12345', login: 'comm-admin' }) });
  assert.equal(bound.user.githubBound, true);
  const developerInvite = await jsonRequest(`${base}/api/v1/invites`, { method: 'POST', headers: communityHeaders, body: JSON.stringify({ role: 'developer', maxUses: 1, expiresInHours: 24 }) });
  assert.equal((await fetch(`${base}/api/v1/invites`, { method: 'POST', headers: communityHeaders, body: JSON.stringify({ role: 'community' }) })).status, 403);
  const player = await jsonRequest(`${base}/api/v1/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'Modder', password: 'regular user password' }) });
  assert.equal(player.user.role, 'user');
  const playerLogin = await jsonRequest(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'modder', password: 'regular user password' }) });
  const activated = await jsonRequest(`${base}/api/v1/auth/activate`, { method: 'POST', headers: { authorization: `Bearer ${playerLogin.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ inviteCode: developerInvite.code }) });
  assert.equal(activated.user.role, 'developer');
  assert.equal((await fetch(`${base}/api/v1/admin/distribution`, { method: 'POST', headers: { authorization: `Bearer ${playerLogin.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ paused: true }) })).status, 403);
  const paused = await jsonRequest(`${base}/api/v1/admin/distribution`, { method: 'POST', headers: communityHeaders, body: JSON.stringify({ paused: true, reason: 'community halt' }) });
  assert.equal(paused.distributionPaused, true);
  const resumed = await jsonRequest(`${base}/api/v1/admin/distribution`, { method: 'POST', headers: communityHeaders, body: JSON.stringify({ paused: false }) });
  assert.equal(resumed.distributionPaused, false);
});

test('setup page creates the first community admin then retires the token', async (t) => {
  const { base } = await fixture(t, { bootstrapDisabled: true, allowBootstrapAdmin: false });
  const status = await jsonRequest(`${base}/status`);
  assert.equal(status.initialized, false);
  assert.equal((await fetch(`${base}/api/v1/setup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'wrong-token-value', username: 'Owner', password: 'correct horse battery staple' }) })).status, 401);
  const created = await jsonRequest(`${base}/api/v1/setup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'test-admin-token-1234', username: 'Owner', password: 'correct horse battery staple' }) });
  assert.equal(created.user.role, 'superadmin');
  assert.equal((await jsonRequest(`${base}/status`)).initialized, true);
  assert.equal((await fetch(`${base}/api/v1/setup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'test-admin-token-1234', username: 'Second', password: 'another secure password' }) })).status, 409);
  const login = await jsonRequest(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'owner', password: 'correct horse battery staple' }) });
  assert.ok(login.token);
});

test('production bootstrap token can create the first invite then retires', async (t) => {
  const { base } = await fixture(t, { bootstrapDisabled: true, allowBootstrapAdmin: false });
  const bootstrap = { authorization: 'Bearer test-admin-token-1234', 'content-type': 'application/json' };
  assert.equal((await fetch(`${base}/api/v1/invites`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role: 'admin' }) })).status, 401);
  const invitation = await jsonRequest(`${base}/api/v1/invites`, { method: 'POST', headers: bootstrap, body: JSON.stringify({ role: 'admin', maxUses: 1, expiresInHours: 24 }) });
  await jsonRequest(`${base}/api/v1/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'ProdAdmin', password: 'correct horse battery staple', inviteCode: invitation.code }) });
  assert.equal((await fetch(`${base}/api/v1/invites`, { method: 'POST', headers: bootstrap, body: JSON.stringify({ role: 'admin' }) })).status, 401);
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

test('regular users can register a game server and open the user guide', async (t) => {
  const { base } = await fixture(t);
  const admin = { authorization: 'Bearer test-admin-token-1234', 'content-type': 'application/json' };
  const archive = createStoredZip({ 'ExampleMod/ModInfo.xml': '<xml />' });
  const artifactSha = sha256(archive);
  await jsonRequest(`${base}/api/v1/artifacts/${artifactSha}`, { method: 'PUT', headers: { ...admin, 'content-type': 'application/zip' }, body: archive });
  await jsonRequest(`${base}/api/v1/mods`, { method: 'POST', headers: admin, body: JSON.stringify({ id: 'example', name: 'Example', version: '1.0.0', artifactSha, gameVersions: ['3.10.14'], installRoots: ['ExampleMod'] }) });
  await jsonRequest(`${base}/api/v1/packs`, { method: 'POST', headers: admin, body: JSON.stringify({ id: 'prod-pack', name: 'Prod', gameVersion: '3.10.14', entries: [{ modId: 'example', version: '1.0.0' }] }) });
  await jsonRequest(`${base}/api/v1/packs/prod-pack/releases`, { method: 'POST', headers: admin, body: '{}' });

  await jsonRequest(`${base}/api/v1/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'HostUser', password: 'host user password' }) });
  const host = await jsonRequest(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'hostuser', password: 'host user password' }) });
  const hostHeaders = { authorization: `Bearer ${host.token}`, 'content-type': 'application/json' };
  const created = await jsonRequest(`${base}/api/v1/servers`, { method: 'POST', headers: hostHeaders, body: JSON.stringify({ name: 'Weekend', packId: 'prod-pack', publicAddress: 'play.example.com:26900' }) });
  assert.match(created.serverId, /^srv_/);
  assert.ok(created.token);
  assert.deepEqual(Object.keys(created.config), ['BaseUrl', 'ServerId', 'ServerToken', 'GameVersion', 'RefreshSeconds', 'HandshakeTimeoutSeconds', 'AutoSync', 'AutoRestart']);
  assert.equal(created.config.AutoSync, true);
  assert.equal(created.config.AutoRestart, false);
  assert.equal(created.config.BaseUrl, base);
  assert.equal(created.config.ServerId, created.serverId);
  assert.equal(created.config.ServerToken, created.token);
  assert.equal(created.config.GameVersion, '3.10.14');
  assert.equal(created.config.RefreshSeconds, 60);
  assert.equal(created.config.HandshakeTimeoutSeconds, 15);
  const resolved = await jsonRequest(`${base}/api/v1/public/servers/resolve?address=play.example.com:26900`);
  assert.equal(resolved.packId, 'prod-pack');
  assert.equal(resolved.serverId, created.serverId);
  const noAddr = await jsonRequest(`${base}/api/v1/servers`, { method: 'POST', headers: hostHeaders, body: JSON.stringify({ name: 'NoAddr', packId: 'prod-pack' }) });
  assert.match(noAddr.serverId, /^srv_/);
  assert.deepEqual(noAddr.publicAddresses, []);
  const byId = await jsonRequest(`${base}/api/v1/public/servers/resolve?serverId=${encodeURIComponent(noAddr.serverId)}`);
  assert.equal(byId.serverId, noAddr.serverId);

  await jsonRequest(`${base}/api/v1/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'OtherUser', password: 'other user password' }) });
  const other = await jsonRequest(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'otheruser', password: 'other user password' }) });
  assert.equal((await fetch(`${base}/api/v1/servers/${created.serverId}`, { method: 'PATCH', headers: { authorization: `Bearer ${other.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Stolen' }) })).status, 403);
  assert.equal((await fetch(`${base}/api/v1/servers/${created.serverId}`, { method: 'DELETE', headers: { authorization: `Bearer ${other.token}` } })).status, 403);
  const removed = await jsonRequest(`${base}/api/v1/servers/${noAddr.serverId}`, { method: 'DELETE', headers: hostHeaders });
  assert.equal(removed.deleted, true);
  assert.equal((await fetch(`${base}/api/v1/public/servers/resolve?serverId=${encodeURIComponent(noAddr.serverId)}`)).status, 404);

  const guide = await fetch(`${base}/guide`);
  assert.equal(guide.status, 200);
  assert.match(await guide.text(), /玩家与服主教程/);
  const guideEn = await fetch(`${base}/guide?lang=en`);
  assert.equal(guideEn.status, 200);
  assert.match(await guideEn.text(), /Player and host guide/);
});

test('client can deposit a handshake and the dedicated server claims it once', async (t) => {
  const { base } = await fixture(t);
  const admin = { authorization: 'Bearer test-admin-token-1234', 'content-type': 'application/json' };
  const archive = createStoredZip({ 'ExampleMod/ModInfo.xml': '<xml />' });
  const artifactSha = sha256(archive);
  await jsonRequest(`${base}/api/v1/artifacts/${artifactSha}`, { method: 'PUT', headers: { authorization: admin.authorization, 'content-type': 'application/zip' }, body: archive });
  await jsonRequest(`${base}/api/v1/mods`, { method: 'POST', headers: admin, body: JSON.stringify({ id: 'example', name: 'Example', version: '1.0.0', artifactSha, gameVersions: ['3.10.14'], installRoots: ['ExampleMod'] }) });
  await jsonRequest(`${base}/api/v1/packs`, { method: 'POST', headers: admin, body: JSON.stringify({ id: 'hs-pack', name: 'HS', gameVersion: '3.10.14', entries: [{ modId: 'example', version: '1.0.0' }] }) });
  await jsonRequest(`${base}/api/v1/packs/hs-pack/releases`, { method: 'POST', headers: admin, body: '{}' });
  const server = await jsonRequest(`${base}/api/v1/servers`, { method: 'POST', headers: admin, body: JSON.stringify({ name: 'LAN', packId: 'hs-pack', publicAddresses: ['192.168.3.42:26900', '27.185.99.144:26900'] }) });
  const twin = await jsonRequest(`${base}/api/v1/servers`, { method: 'POST', headers: admin, body: JSON.stringify({ name: 'Same LAN', packId: 'hs-pack', publicAddress: '192.168.3.42:26900' }) });
  assert.deepEqual(server.publicAddresses, ['192.168.3.42:26900', '27.185.99.144:26900']);
  const wan = await jsonRequest(`${base}/api/v1/public/servers/resolve?address=27.185.99.144:26900`);
  assert.equal(wan.serverId, server.serverId);
  await jsonRequest(`${base}/api/v1/servers/${server.serverId}/addresses`, { method: 'PUT', headers: { authorization: `Bearer ${server.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ publicAddresses: ['10.0.0.8:26900'] }) });
  assert.equal((await jsonRequest(`${base}/api/v1/public/servers/resolve?address=10.0.0.8:26900`)).serverId, server.serverId);

  assert.equal((await fetch(`${base}/api/v1/public/handshakes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address: 'no-such.example:26900', playerIds: ['Steam_1'], hello: { protocolVersion: 1, packId: 'hs-pack', packVersion: 1 } }) })).status, 404);
  const byServerId = await jsonRequest(`${base}/api/v1/public/handshakes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      serverId: twin.serverId,
      playerIds: ['Steam_twin'],
      hello: { protocolVersion: 1, packId: 'hs-pack', packVersion: 1, artifactFingerprint: artifactSha }
    })
  });
  assert.equal(byServerId.serverId, twin.serverId);

  const deposited = await jsonRequest(`${base}/api/v1/public/handshakes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      address: '192.168.3.42:26900',
      playerIds: ['Steam_76561198000000000', 'CariYui'],
      hello: { protocolVersion: 1, pluginVersion: '0.2.1', packId: 'hs-pack', packVersion: 1, artifactFingerprint: artifactSha }
    })
  });
  assert.equal(deposited.accepted, true);
  assert.equal(deposited.serverId, server.serverId);

  const adminState = await jsonRequest(`${base}/api/v1/admin/state`, { headers: { authorization: admin.authorization } });
  assert.equal(adminState.handshakes, undefined);

  const claimed = await jsonRequest(`${base}/api/v1/servers/${server.serverId}/pending-handshake/claim`, {
    method: 'POST',
    headers: { authorization: `Bearer ${server.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ playerIds: ['cariyui'] })
  });
  assert.equal(claimed.hello.packId, 'hs-pack');
  assert.equal(claimed.hello.packVersion, 1);
  assert.equal(claimed.hello.artifactFingerprint, artifactSha);

  assert.equal((await fetch(`${base}/api/v1/servers/${server.serverId}/pending-handshake/claim`, {
    method: 'POST',
    headers: { authorization: `Bearer ${server.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ playerIds: ['Steam_76561198000000000'] })
  })).status, 404);
});

test('workshop list searches description and filters by game version', async (t) => {
  const { base } = await fixture(t);
  const admin = { authorization: 'Bearer test-admin-token-1234', 'content-type': 'application/json' };
  const mapZip = createStoredZip({
    'PoiMap/ModInfo.xml': '<xml><Name value="PoiMap" /><DisplayName value="地图显示建筑" /><Author value="CariYui" /><Description value="在地图上显示建筑" /></xml>'
  });
  const dllZip = createStoredZip({ 'GunMod/ModInfo.xml': '<xml><Name value="GunMod" /><Description value="extra guns" /></xml>', 'GunMod/GunMod.dll': 'fake' });
  const mapSha = sha256(mapZip);
  const dllSha = sha256(dllZip);
  await jsonRequest(`${base}/api/v1/artifacts/${mapSha}`, { method: 'PUT', headers: { authorization: admin.authorization, 'content-type': 'application/zip' }, body: mapZip });
  await jsonRequest(`${base}/api/v1/artifacts/${dllSha}`, { method: 'PUT', headers: { authorization: admin.authorization, 'content-type': 'application/zip' }, body: dllZip });
  await jsonRequest(`${base}/api/v1/mods`, { method: 'POST', headers: admin, body: JSON.stringify({ id: 'poimap', name: 'PoiMap', version: '1.0.0', artifactSha: mapSha, gameVersions: ['3.0'], gameVersionRange: 'major', installRoots: ['PoiMap'] }) });
  await jsonRequest(`${base}/api/v1/mods`, { method: 'POST', headers: admin, body: JSON.stringify({ id: 'gunmod', name: 'GunMod', version: '2.0.0', artifactSha: dllSha, gameVersions: ['2.6'], containsDll: true, installRoots: ['GunMod'] }) });

  const listed = await jsonRequest(`${base}/api/v1/mods`, { headers: { authorization: admin.authorization } });
  const map = listed.mods.find((item) => item.id === 'poimap');
  assert.equal(map.author, 'CariYui');
  assert.match(map.description, /地图上显示建筑/);
  assert.equal(map.containsDll, false);

  const searched = await jsonRequest(`${base}/api/v1/mods?q=${encodeURIComponent('建筑')}`, { headers: { authorization: admin.authorization } });
  assert.deepEqual(searched.mods.map((item) => item.id), ['poimap']);

  const byGame = await jsonRequest(`${base}/api/v1/mods?gameVersion=3.10.14`, { headers: { authorization: admin.authorization } });
  assert.deepEqual(byGame.mods.map((item) => item.id), ['poimap']);

  const dlls = await jsonRequest(`${base}/api/v1/mods?dll=yes`, { headers: { authorization: admin.authorization } });
  assert.deepEqual(dlls.mods.map((item) => item.id), ['gunmod']);
});

