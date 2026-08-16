import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { artifactPublicUrl, cloudflareCacheHeaders } from '../src/cloudflare.js';
import { inspectRequest } from '../src/security.js';
import { SigningService } from '../src/signing.js';
import { JsonStore } from '../src/store.js';
import { sha256 } from '../src/util.js';
import { createStoredZip } from '../../updater/test/zip-helper.js';
import { listZip } from '../../updater/src/zip.js';

async function fixture(t, extra = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'mod-platform-backend-'));
  const store = new JsonStore(path.join(dataDir, 'state', 'database.json'));
  const signing = new SigningService({ dataDir });
  await Promise.all([store.init(), signing.init()]);
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  server.removeAllListeners('request');
  server.on('request', createApp({ store, signing, dataDir, adminToken: 'test-admin-token-1234', publicBaseUrl: base, ...extra }));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { base, store };
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json();
  assert.ok(response.ok, JSON.stringify(body));
  return body;
}

test('lists mods, packs, servers, stats and filtered audit', async (t) => {
  const { base } = await fixture(t);
  const admin = { authorization: 'Bearer test-admin-token-1234', 'content-type': 'application/json' };
  const archive = createStoredZip({ 'ExampleMod/ModInfo.xml': '<xml />' });
  const artifactSha = sha256(archive);
  await jsonRequest(`${base}/api/v1/artifacts/${artifactSha}`, { method: 'PUT', headers: { authorization: admin.authorization, 'content-type': 'application/zip' }, body: archive });
  await jsonRequest(`${base}/api/v1/mods`, { method: 'POST', headers: admin, body: JSON.stringify({ id: 'example', name: 'Example', version: '1.0.0', artifactSha, gameVersions: ['2.6'], installRoots: ['ExampleMod'] }) });
  await jsonRequest(`${base}/api/v1/packs`, { method: 'POST', headers: admin, body: JSON.stringify({ id: 'ops-pack', name: 'Ops', gameVersion: '2.6', entries: [{ modId: 'example', version: '1.0.0' }] }) });
  await jsonRequest(`${base}/api/v1/packs/ops-pack/releases`, { method: 'POST', headers: admin, body: '{}' });
  const mods = await jsonRequest(`${base}/api/v1/mods`, { headers: { authorization: admin.authorization } });
  assert.equal(mods.mods[0].id, 'example');
  const packs = await jsonRequest(`${base}/api/v1/packs`, { headers: { authorization: admin.authorization } });
  assert.equal(packs.packs[0].id, 'ops-pack');
  const servers = await jsonRequest(`${base}/api/v1/servers`, { headers: { authorization: admin.authorization } });
  assert.ok(Array.isArray(servers.servers));
  const stats = await jsonRequest(`${base}/api/v1/admin/stats`, { headers: { authorization: admin.authorization } });
  assert.equal(stats.mods, 1);
  const audit = await jsonRequest(`${base}/api/v1/admin/audit`, { headers: { authorization: admin.authorization } });
  assert.ok(audit.audit.some((item) => item.action === 'release.publish'));
});

test('viewer cannot manage users and disabled accounts cannot login', async (t) => {
  const { base } = await fixture(t);
  const bootstrap = { authorization: 'Bearer test-admin-token-1234', 'content-type': 'application/json' };
  const adminInvite = await jsonRequest(`${base}/api/v1/invites`, { method: 'POST', headers: bootstrap, body: JSON.stringify({ role: 'admin', maxUses: 1, expiresInHours: 24 }) });
  await jsonRequest(`${base}/api/v1/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'Boss', password: 'correct horse battery staple', inviteCode: adminInvite.code }) });
  const adminLogin = await jsonRequest(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'boss', password: 'correct horse battery staple' }) });
  const adminHeaders = { authorization: `Bearer ${adminLogin.token}`, 'content-type': 'application/json' };
  const viewer = await jsonRequest(`${base}/api/v1/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'Looker', password: 'read only secure password' }) });
  const viewerLogin = await jsonRequest(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'looker', password: 'read only secure password' }) });
  assert.equal((await fetch(`${base}/api/v1/users`, { headers: { authorization: `Bearer ${viewerLogin.token}` } })).status, 403);
  await jsonRequest(`${base}/api/v1/users/${viewer.user.id}`, { method: 'PATCH', headers: adminHeaders, body: JSON.stringify({ disabled: true }) });
  assert.equal((await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'looker', password: 'read only secure password' }) })).status, 401);
});

test('production confirm token is required for rollback', async (t) => {
  const { base } = await fixture(t, { config: { requireConfirm: true } });
  const admin = { authorization: 'Bearer test-admin-token-1234', 'content-type': 'application/json' };
  const archive = createStoredZip({ 'ExampleMod/ModInfo.xml': '<xml />' });
  const artifactSha = sha256(archive);
  await jsonRequest(`${base}/api/v1/artifacts/${artifactSha}`, { method: 'PUT', headers: { authorization: admin.authorization, 'content-type': 'application/zip' }, body: archive });
  await jsonRequest(`${base}/api/v1/mods`, { method: 'POST', headers: admin, body: JSON.stringify({ id: 'example', name: 'Example', version: '1.0.0', artifactSha, installRoots: ['ExampleMod'] }) });
  await jsonRequest(`${base}/api/v1/packs`, { method: 'POST', headers: admin, body: JSON.stringify({ id: 'ops-pack', name: 'Ops', gameVersion: '2.6', entries: [{ modId: 'example', version: '1.0.0' }] }) });
  const first = await jsonRequest(`${base}/api/v1/packs/ops-pack/releases`, { method: 'POST', headers: admin, body: '{}' });
  await jsonRequest(`${base}/api/v1/packs/ops-pack/releases`, { method: 'POST', headers: admin, body: '{}' });
  assert.equal((await fetch(`${base}/api/v1/packs/ops-pack/rollback`, { method: 'POST', headers: admin, body: JSON.stringify({ releaseId: first.id }) })).status, 422);
  const confirm = await jsonRequest(`${base}/api/v1/admin/confirm`, { method: 'POST', headers: admin, body: JSON.stringify({ action: 'pack.rollback' }) });
  await jsonRequest(`${base}/api/v1/packs/ops-pack/rollback`, { method: 'POST', headers: admin, body: JSON.stringify({ releaseId: first.id, confirmToken: confirm.token }) });
});

test('Cloudflare artifact URLs and cache headers', () => {
  assert.equal(artifactPublicUrl('ab'.repeat(32), { cdnStyle: 'origin', cdnBaseUrl: 'https://mods.example.com' }), `https://mods.example.com/api/v1/public/artifacts/${'ab'.repeat(32)}`);
  assert.equal(artifactPublicUrl('ab'.repeat(32), { cdnStyle: 'r2', cdnBaseUrl: 'https://cdn.example.com', s3: { prefix: 'objects/' } }), `https://cdn.example.com/objects/${'ab'.repeat(32)}`);
  assert.match(cloudflareCacheHeaders('artifact')['cdn-cache-control'], /31536000/);
  assert.equal(inspectRequest({ method: 'GET', url: '/', headers: { 'cf-connecting-ip': '203.0.113.9' } }, { trustedProxy: true }).ip, '203.0.113.9');
});

test('rejects zip bombs by uncompressed size', () => {
  const huge = createStoredZip({ 'ExampleMod/big.bin': 'x'.repeat(100) });
  assert.throws(() => listZip(huge, { maxTotalBytes: 10 }), /Uncompressed ZIP size/);
});
