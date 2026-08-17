import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { SigningService } from '../src/signing.js';
import { JsonStore } from '../src/store.js';
import { sha256 } from '../src/util.js';
import { createStoredZip } from '../../updater/test/zip-helper.js';
import { describeApiError, packArtifacts, pluginSpecFromZip, pluginVersionFromFiles, publishPlatform, requestHeaders, zipPluginFolder } from '../../../deploy/publish-platform.js';

async function fixture(t, extra = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'mod-platform-publish-'));
  const store = new JsonStore(path.join(dataDir, 'state', 'database.json'));
  const signing = new SigningService({ dataDir });
  await Promise.all([store.init(), signing.init()]);
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  server.removeAllListeners('request');
  server.on('request', createApp({
    store,
    signing,
    dataDir,
    adminToken: 'test-admin-token-1234',
    publicBaseUrl: base,
    requireReview: true,
    config: { requireConfirm: true },
    ...extra
  }));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { base, signing, store };
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json();
  assert.ok(response.ok, JSON.stringify(body));
  return body;
}

function pluginZip(root, version = '0.2.12') {
  return createStoredZip({
    [`${root}/ModInfo.xml`]: `<xml><Version value="${version}.0" /></xml>`,
    [`${root}/plugin-version.json`]: JSON.stringify({ pluginVersion: version }),
    [`${root}/ModPlatform.Shared.dll`]: 'dll'
  });
}

test('detects Cloudflare challenge pages and sends the skip header', () => {
  assert.match(describeApiError(403, '<title>Just a moment...</title> https://challenges.cloudflare.com'), /Cloudflare blocked/);
  assert.equal(requestHeaders({ PLATFORM_CF_SKIP_TOKEN: 'ci-secret' })['x-hordepin-ci'], 'ci-secret');
});

test('plugin zip version is read from plugin-version.json', () => {
  const zip = pluginZip('ModPlatformClient', '0.2.12');
  const spec = pluginSpecFromZip('mod-platform-client', zip);
  assert.equal(spec.version, '0.2.12');
  assert.equal(spec.installSide, 'client');
  assert.equal(spec.root, 'ModPlatformClient');
  assert.equal(pluginVersionFromFiles({ 'ModPlatformServer/ModInfo.xml': '<xml><Version value="0.2.11.0" /></xml>' }, 'ModPlatformServer'), '0.2.11');
});

test('CI can upload first-party plugins and developers cannot register those ids', async (t) => {
  const { base } = await fixture(t);
  const admin = { authorization: 'Bearer test-admin-token-1234', 'content-type': 'application/json' };
  const root = await mkdtemp(path.join(os.tmpdir(), 'plugin-pack-'));
  const clientDir = path.join(root, 'ModPlatformClient');
  const serverDir = path.join(root, 'ModPlatformServer');
  await mkdir(clientDir, { recursive: true });
  await mkdir(serverDir, { recursive: true });
  await writeFile(path.join(clientDir, 'ModInfo.xml'), '<xml><Version value="0.2.12.0" /></xml>');
  await writeFile(path.join(clientDir, 'plugin-version.json'), JSON.stringify({ pluginVersion: '0.2.12' }));
  await writeFile(path.join(serverDir, 'ModInfo.xml'), '<xml><Version value="0.2.12.0" /></xml>');
  await writeFile(path.join(serverDir, 'plugin-version.json'), JSON.stringify({ pluginVersion: '0.2.12' }));
  const packed = await packArtifacts({
    clientDir,
    serverDir,
    outputDir: path.join(root, 'out'),
    gameVersion: '3.10.14'
  });
  assert.equal(packed.specs.length, 2);
  assert.ok((await zipPluginFolder(clientDir, 'ModPlatformClient')).length > 0);

  const published = await publishPlatform({
    baseUrl: base,
    token: 'test-admin-token-1234',
    clientDir,
    serverDir,
    outputDir: path.join(root, 'out'),
    gameVersion: '3.10.14',
    packId: 'hordepin-platform',
    packName: 'Hordepin Platform',
    publishLauncher: false
  });
  assert.equal(published.published, true);
  assert.equal(published.uploaded.length, 2);
  assert.equal(published.pack.pack.id, 'hordepin-platform');
  const latest = await jsonRequest(`${base}/api/v1/public/packs/hordepin-platform/latest`);
  assert.deepEqual(latest.mods.map((mod) => mod.id).sort(), ['mod-platform-client', 'mod-platform-server']);
  assert.equal(latest.mods.find((mod) => mod.id === 'mod-platform-client').installSide, 'client');

  const invitation = await jsonRequest(`${base}/api/v1/invites`, { method: 'POST', headers: admin, body: JSON.stringify({ role: 'developer', maxUses: 1, expiresInHours: 24 }) });
  await jsonRequest(`${base}/api/v1/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'Modder', password: 'developer password', inviteCode: invitation.code }) });
  const login = await jsonRequest(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'Modder', password: 'developer password' }) });
  const clientZip = pluginZip('ModPlatformClient', '9.9.9');
  const hash = sha256(clientZip);
  await jsonRequest(`${base}/api/v1/artifacts/${hash}`, { method: 'PUT', headers: { authorization: `Bearer ${login.token}`, 'content-type': 'application/zip' }, body: clientZip });
  const denied = await fetch(`${base}/api/v1/mods`, {
    method: 'POST',
    headers: { authorization: `Bearer ${login.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'mod-platform-client', name: 'Hijack', version: '9.9.9', artifactSha: hash, installRoots: ['ModPlatformClient'] })
  });
  assert.equal(denied.status, 403);
});
