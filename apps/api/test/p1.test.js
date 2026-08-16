import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { analyzeZipBuffer } from '../src/analyze.js';
import { createApp } from '../src/app.js';
import { compatibilityMatrix, ingestDiagnostic, shouldBlockInstalls } from '../src/compatibility.js';
import { s3Sign } from '../src/objects.js';
import { inspectRequest, securityHeaders } from '../src/security.js';
import { SigningService } from '../src/signing.js';
import { JsonStore } from '../src/store.js';
import { totp } from '../src/totp.js';
import { sha256 } from '../src/util.js';
import { verifyManifest } from '../../updater/src/verify.js';
import { createStoredZip } from '../../updater/test/zip-helper.js';

async function fixture(t, extra = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'mod-platform-p1-'));
  const store = new JsonStore(path.join(dataDir, 'state', 'database.json'));
  const signing = new SigningService({ dataDir });
  await Promise.all([store.init(), signing.init()]);
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
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

test('analyzes ZIP structure, ModInfo and DLL rules', () => {
  const archive = createStoredZip({
    'ExampleMod/ModInfo.xml': '<ModInfo><Name value="Example" /><Version value="1.0.0" /><Author value="Ada" /></ModInfo>',
    'ExampleMod/Harmony/Example.dll': 'MZ-fake VirtualAlloc password=secret'
  });
  const analysis = analyzeZipBuffer(archive, 'example.zip');
  assert.deepEqual(analysis.roots, ['ExampleMod']);
  assert.equal(analysis.containsDll, true);
  assert.equal(analysis.modInfo.name, 'Example');
  assert.ok(analysis.findings.some((item) => item.rule === 'native-inject'));
  assert.ok(analysis.sbom.components.length >= 1);
});

test('rejects expired or unknown-key manifests', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'mod-platform-sign-'));
  const signing = new SigningService({ dataDir, ttlDays: 90 });
  await signing.init();
  const live = await signing.signObject({ schemaVersion: 1, packId: 'p', packVersion: 1, gameVersion: '2.6', issuedAt: new Date().toISOString(), mods: [] });
  assert.equal(verifyManifest(live, signing.publicJwk().publicKey), true);
  const expired = await signing.signObject({ schemaVersion: 1, packId: 'p', packVersion: 1, gameVersion: '2.6', issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() - 1000).toISOString(), mods: [] });
  assert.equal(verifyManifest(expired, signing.publicJwk().publicKey), false);
  assert.equal(verifyManifest(live, signing.publicJwk().publicKey, { revokedKeyIds: [live.signing.keyId] }), false);
});

test('builds a compatibility matrix and crash-rate gate', () => {
  const draft = { diagnostics: [], fingerprints: {} };
  for (let index = 0; index < 8; index += 1) {
    ingestDiagnostic(draft, { id: `e${index}`, fingerprint: 'fp', receivedAt: new Date().toISOString(), gameVersion: '3.10.14', packId: 'pack', stage: 'crash', mods: [{ id: 'example', version: '1.0.0' }] });
  }
  ingestDiagnostic(draft, { id: 'ok', fingerprint: 'fp', receivedAt: new Date().toISOString(), gameVersion: '3.10.14', packId: 'pack', stage: 'successful_session', exceptionType: 'Success', mods: [{ id: 'example', version: '1.0.0' }] });
  const rows = compatibilityMatrix(draft);
  assert.equal(rows[0].conclusion, 'confirmed');
  assert.equal(shouldBlockInstalls(draft, { threshold: 0.35, minSamples: 8 }).blocked, true);
});

test('pack sync HTTP failures do not trip the crash-rate gate', () => {
  const draft = { diagnostics: [], fingerprints: {} };
  for (let index = 0; index < 10; index += 1) {
    ingestDiagnostic(draft, { id: `e${index}`, fingerprint: 'fp', receivedAt: new Date().toISOString(), gameVersion: '3.10.14', packId: 'pack', stage: 'pack_sync_failed', exceptionType: 'HttpRequestException' });
  }
  assert.equal(shouldBlockInstalls(draft, { threshold: 0.35, minSamples: 8 }).blocked, false);
});

test('account lifecycle, 2FA and health endpoints', async (t) => {
  const { base } = await fixture(t);
  const live = await jsonRequest(`${base}/health/live`);
  assert.equal(live.status, 'live');
  const ready = await jsonRequest(`${base}/health/ready`);
  assert.equal(ready.status, 'ready');
  const bootstrap = { authorization: 'Bearer test-admin-token-1234', 'content-type': 'application/json' };
  const invitation = await jsonRequest(`${base}/api/v1/invites`, { method: 'POST', headers: bootstrap, body: JSON.stringify({ role: 'admin', maxUses: 1, expiresInHours: 24 }) });
  await jsonRequest(`${base}/api/v1/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'TotpAdmin', password: 'correct horse battery staple', inviteCode: invitation.code }) });
  const login = await jsonRequest(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'totpadmin', password: 'correct horse battery staple' }) });
  const headers = { authorization: `Bearer ${login.token}`, 'content-type': 'application/json' };
  const setup = await jsonRequest(`${base}/api/v1/auth/totp/setup`, { method: 'POST', headers, body: '{}' });
  await jsonRequest(`${base}/api/v1/auth/totp/confirm`, { method: 'POST', headers, body: JSON.stringify({ code: totp(setup.secret) }) });
  await jsonRequest(`${base}/api/v1/auth/logout`, { method: 'POST', headers, body: '{}' });
  const challenged = await jsonRequest(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'totpadmin', password: 'correct horse battery staple' }) });
  assert.equal(challenged.requiresTotp, true);
  const completed = await jsonRequest(`${base}/api/v1/auth/login/totp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ticket: challenged.ticket, code: totp(setup.secret) }) });
  assert.ok(completed.token);
  const users = await jsonRequest(`${base}/api/v1/users`, { headers: { authorization: `Bearer ${completed.token}` } });
  assert.equal(users.users[0].totpEnabled, true);
  await jsonRequest(`${base}/api/v1/users/${users.users[0].id}`, { method: 'PATCH', headers: { authorization: `Bearer ${completed.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ disabled: true }) });
});

test('review, license gate, hash ban and public key ring', async (t) => {
  const { base, signing } = await fixture(t, { requireReview: true });
  const admin = { authorization: 'Bearer test-admin-token-1234', 'content-type': 'application/json' };
  const archive = createStoredZip({ 'ExampleMod/ModInfo.xml': '<xml />' });
  const artifactSha = sha256(archive);
  const uploaded = await jsonRequest(`${base}/api/v1/artifacts/${artifactSha}`, { method: 'PUT', headers: { authorization: admin.authorization, 'content-type': 'application/zip', 'x-file-name': encodeURIComponent('载具扩展.zip') }, body: archive });
  assert.equal(uploaded.fileName, '载具扩展.zip');
  assert.equal(uploaded.review.status, 'approved');
  const denied = await fetch(`${base}/api/v1/mods`, { method: 'POST', headers: admin, body: JSON.stringify({ id: 'example', name: 'Example', version: '1.0.0', artifactSha, gameVersions: ['2.6'], installRoots: ['ExampleMod'] }) });
  assert.equal(denied.status, 422);
  await jsonRequest(`${base}/api/v1/reviews/${artifactSha}`, { method: 'POST', headers: admin, body: JSON.stringify({ status: 'approved', licenseConfirmed: true, license: 'CC-BY' }) });
  await jsonRequest(`${base}/api/v1/mods`, { method: 'POST', headers: admin, body: JSON.stringify({ id: 'example', name: 'Example', version: '1.0.0', artifactSha, gameVersions: ['2.6'], installRoots: ['ExampleMod'] }) });
  const keys = await jsonRequest(`${base}/api/v1/public-key`);
  assert.equal(keys.keyId, signing.publicJwk().keyId);
  assert.ok(keys.keys.some((item) => item.keyId === keys.keyId));
  await jsonRequest(`${base}/api/v1/bans`, { method: 'POST', headers: admin, body: JSON.stringify({ sha256: artifactSha, reason: 'malware' }) });
  const banned = await fetch(`${base}/api/v1/artifacts/${artifactSha}`, { method: 'PUT', headers: { authorization: admin.authorization, 'content-type': 'application/zip' }, body: archive });
  assert.equal(banned.status, 409);
});

test('production signing refuses generated development keys', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'mod-platform-prod-sign-'));
  await assert.rejects(() => new SigningService({ dataDir, production: true }).init(), /SIGNING_PRIVATE_KEY|SIGNING_SERVICE_URL/);
});

test('S3 SigV4 string and CSRF same-origin policy', () => {
  const authorization = s3Sign({
    method: 'GET',
    url: 'https://minio.local/bucket/objects/abc',
    headers: { host: 'minio.local', 'x-amz-date': '20260816T000000Z', 'x-amz-content-sha256': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
    bodyHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    accessKey: 'AKIA',
    secretKey: 'secret',
    region: 'us-east-1'
  });
  assert.match(authorization, /^AWS4-HMAC-SHA256 Credential=AKIA\/20260816\/us-east-1\/s3\/aws4_request/);
  assert.equal(inspectRequest({ method: 'POST', url: '/api/v1/auth/login', headers: { host: 'mods.example', origin: 'https://mods.example' } }).blocked, false);
  assert.equal(inspectRequest({ method: 'POST', url: '/api/v1/auth/login', headers: { host: '127.0.0.1:8850', origin: 'https://mods.aic.la', 'x-forwarded-host': 'mods.aic.la' } }).blocked, false);
  assert.equal(inspectRequest({ method: 'POST', url: '/api/v1/setup', headers: { host: '127.0.0.1:8850', origin: 'https://mods.aic.la' } }, { publicBaseUrl: 'https://mods.aic.la' }).blocked, false);
  assert.equal(inspectRequest({ method: 'POST', url: '/api/v1/auth/login', headers: { host: 'mods.example', origin: 'https://evil.example' } }).blocked, true);
  const csp = securityHeaders({ headers: {}, url: '/' })['content-security-policy'];
  assert.match(csp, /script-src[^;]*'self'/);
  assert.match(csp, /style-src[^;]*'self'/);
  assert.match(csp, /challenges\.cloudflare\.com/);
});
