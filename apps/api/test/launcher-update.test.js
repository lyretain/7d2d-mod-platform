import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { referencedHashes } from '../src/objects.js';
import { SigningService } from '../src/signing.js';
import { JsonStore } from '../src/store.js';
import { sha256 } from '../src/util.js';
import { createStoredZip } from '../../updater/test/zip-helper.js';
import { verifyManifest } from '../../updater/src/verify.js';
import { validateLauncherEntries } from '../../launcher/src/layout.js';

function launcherZip() {
  return createStoredZip({
    'apps/launcher/src/cli.js': 'console.log(1)',
    'ModPlatformLauncher.cmd': '@echo off\n'
  });
}

async function fixture(t) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'mod-platform-ln-'));
  const store = new JsonStore(path.join(dataDir, 'state', 'database.json'));
  const signing = new SigningService({ dataDir });
  await Promise.all([store.init(), signing.init()]);
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  server.removeAllListeners('request');
  server.on('request', createApp({ store, signing, dataDir, adminToken: 'test-admin-token-1234', publicBaseUrl: base }));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { base, store, signing };
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json();
  assert.ok(response.ok, JSON.stringify(body));
  return body;
}

test('publishes a signed launcher and hides it after revoke', async (t) => {
  const { base, store, signing } = await fixture(t);
  const admin = { authorization: 'Bearer test-admin-token-1234', 'content-type': 'application/json' };
  assert.equal((await fetch(`${base}/api/v1/public/launcher/latest?platform=win32`)).status, 404);

  const archive = launcherZip();
  const hash = sha256(archive);
  await jsonRequest(`${base}/api/v1/artifacts/${hash}`, { method: 'PUT', headers: { authorization: admin.authorization, 'content-type': 'application/zip' }, body: archive });
  const published = await jsonRequest(`${base}/api/v1/admin/launcher`, { method: 'POST', headers: admin, body: JSON.stringify({ sha256: hash, version: '0.3.1', platform: 'win32' }) });
  assert.equal(published.version, '0.3.1');
  assert.equal(referencedHashes(store.snapshot()).has(hash), true);

  const latest = await jsonRequest(`${base}/api/v1/public/launcher/latest?platform=win32`);
  assert.equal(latest.kind, 'launcher');
  assert.equal(latest.sha256, hash);
  assert.equal(verifyManifest(latest, signing.publicJwk().publicKey), true);

  await jsonRequest(`${base}/api/v1/admin/launcher/revoke`, { method: 'POST', headers: admin, body: JSON.stringify({ platform: 'win32' }) });
  assert.equal((await fetch(`${base}/api/v1/public/launcher/latest?platform=win32`)).status, 404);
});

test('refuses a ZIP that is not a portable launcher', async (t) => {
  const { base } = await fixture(t);
  const admin = { authorization: 'Bearer test-admin-token-1234', 'content-type': 'application/json' };
  const archive = createStoredZip({ 'readme.txt': 'nope' });
  const hash = sha256(archive);
  await jsonRequest(`${base}/api/v1/artifacts/${hash}`, { method: 'PUT', headers: { authorization: admin.authorization, 'content-type': 'application/zip' }, body: archive });
  const response = await fetch(`${base}/api/v1/admin/launcher`, { method: 'POST', headers: admin, body: JSON.stringify({ sha256: hash, version: '0.3.1', platform: 'win32' }) });
  assert.equal(response.status, 422);
  assert.throws(() => validateLauncherEntries([{ name: 'readme.txt' }]));
});
