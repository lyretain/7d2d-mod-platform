import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../../api/src/app.js';
import { SigningService } from '../../api/src/signing.js';
import { JsonStore } from '../../api/src/store.js';
import { sha256 } from '../../api/src/util.js';
import { createStoredZip } from '../../updater/test/zip-helper.js';
import { verifyManifest } from '../../updater/src/verify.js';
import { applyLauncherUpdate, checkLauncherUpdate, findInstallRoot } from '../src/self-update.js';
import { compareVersions, isNewerVersion, normalizePlatform } from '../src/version.js';

function launcherZip(script = 'console.log("v2")') {
  return createStoredZip({
    'apps/launcher/src/cli.js': script,
    'ModPlatformLauncher.cmd': '@echo off\n',
    'package.json': '{"name":"mod-platform-launcher"}'
  });
}

async function fixture(t) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'mod-platform-launcher-'));
  const store = new JsonStore(path.join(dataDir, 'state', 'database.json'));
  const signing = new SigningService({ dataDir });
  await Promise.all([store.init(), signing.init()]);
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  server.removeAllListeners('request');
  server.on('request', createApp({ store, signing, dataDir, adminToken: 'test-admin-token-1234', publicBaseUrl: base }));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { base, signing };
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json();
  assert.ok(response.ok, JSON.stringify(body));
  return body;
}

test('compares launcher versions and normalizes platforms', () => {
  assert.equal(compareVersions('0.3.1', '0.3.0'), 1);
  assert.equal(isNewerVersion('0.3.0', '0.3.0'), false);
  assert.equal(normalizePlatform('windows'), 'win32');
  assert.equal(normalizePlatform('macos'), 'darwin');
});

test('findInstallRoot only accepts a portable launcher folder', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mod-platform-portable-'));
  assert.equal(await findInstallRoot(dir), null);
  await writeFile(path.join(dir, 'ModPlatformLauncher.cmd'), '@echo off\n');
  assert.equal(await findInstallRoot(dir), path.resolve(dir));
});

test('downloads a signed launcher ZIP and replaces a portable install', async (t) => {
  const { base, signing } = await fixture(t);
  const admin = { authorization: 'Bearer test-admin-token-1234' };
  const archive = launcherZip('export const NEXT = true;\n');
  const hash = sha256(archive);
  await jsonRequest(`${base}/api/v1/artifacts/${hash}`, { method: 'PUT', headers: { ...admin, 'content-type': 'application/zip' }, body: archive });
  await jsonRequest(`${base}/api/v1/admin/launcher`, { method: 'POST', headers: { ...admin, 'content-type': 'application/json' }, body: JSON.stringify({ sha256: hash, version: '0.3.1', platform: process.platform, notes: 'test' }) });

  const latest = await jsonRequest(`${base}/api/v1/public/launcher/latest?platform=${process.platform}`);
  assert.equal(latest.kind, 'launcher');
  assert.equal(verifyManifest(latest, signing.publicJwk().publicKey), true);

  const installRoot = await mkdtemp(path.join(os.tmpdir(), 'mod-platform-install-'));
  await mkdir(path.join(installRoot, 'apps', 'launcher', 'src'), { recursive: true });
  await writeFile(path.join(installRoot, 'ModPlatformLauncher.cmd'), '@echo off\n');
  await writeFile(path.join(installRoot, 'apps', 'launcher', 'src', 'cli.js'), 'export const NEXT = false;\n');

  const checked = await checkLauncherUpdate({ baseUrl: base, currentVersion: '0.3.0', platform: process.platform, installRoot });
  assert.equal(checked.update, true);
  const applied = await applyLauncherUpdate({ baseUrl: base, checked, deferRestart: true });
  assert.equal(applied.applied, true);
  assert.match(await readFile(path.join(installRoot, 'apps', 'launcher', 'src', 'cli.js'), 'utf8'), /NEXT = true/);
});

test('rejects a tampered launcher manifest', async (t) => {
  const { base, signing } = await fixture(t);
  const admin = { authorization: 'Bearer test-admin-token-1234' };
  const archive = launcherZip();
  const hash = sha256(archive);
  await jsonRequest(`${base}/api/v1/artifacts/${hash}`, { method: 'PUT', headers: { ...admin, 'content-type': 'application/zip' }, body: archive });
  await jsonRequest(`${base}/api/v1/admin/launcher`, { method: 'POST', headers: { ...admin, 'content-type': 'application/json' }, body: JSON.stringify({ sha256: hash, version: '9.0.0', platform: process.platform }) });
  const latest = await jsonRequest(`${base}/api/v1/public/launcher/latest?platform=${process.platform}`);
  const key = signing.publicJwk().publicKey;
  assert.equal(verifyManifest(latest, key), true);
  latest.version = '9.9.9';
  assert.equal(verifyManifest(latest, key), false);
});
