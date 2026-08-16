import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SigningService } from '../../api/src/signing.js';
import { sha256 } from '../../api/src/util.js';
import { syncPack } from '../src/installer.js';
import { createStoredZip } from './zip-helper.js';

test('downloads, verifies and installs a signed pack', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mod-platform-install-'));
  const modsDir = path.join(root, 'Mods');
  const signing = new SigningService({ dataDir: root });
  await signing.init();
  const archive = createStoredZip({ 'ExampleMod/ModInfo.xml': '<ModInfo />', 'ExampleMod/Config/value.txt': 'installed' });
  const artifactSha = sha256(archive);
  let manifest;
  const server = createServer((req, res) => {
    if (req.url.includes('/public/packs/')) {
      const body = Buffer.from(JSON.stringify(manifest));
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': body.length });
      res.end(body);
    } else if (req.url.includes('/public/artifacts/')) {
      res.writeHead(200, { 'content-type': 'application/zip', 'content-length': archive.length });
      res.end(archive);
    } else {
      res.writeHead(404); res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  manifest = await signing.signObject({ schemaVersion: 1, packId: 'test-pack', packVersion: 1, gameVersion: '2.6', issuedAt: new Date().toISOString(), mods: [{ id: 'example', version: '1.0.0', installRoots: ['ExampleMod'], requiresRestart: false, size: archive.length, sha256: artifactSha, url: `${baseUrl}/api/v1/public/artifacts/${artifactSha}` }] });

  const result = await syncPack({ baseUrl, packId: 'test-pack', modsDir, explicitPublicKey: signing.publicJwk().publicKey });
  assert.equal(result.state.packVersion, 1);
  assert.equal(await readFile(path.join(modsDir, 'ExampleMod', 'Config', 'value.txt'), 'utf8'), 'installed');
});

test('installs content overlays into a managed subdirectory', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mod-platform-overlay-'));
  const modsDir = path.join(root, 'Mods');
  const signing = new SigningService({ dataDir: root });
  await signing.init();
  const framework = createStoredZip({ 'Z_CustomAvatars/ModInfo.xml': '<xml />', 'Z_CustomAvatars/CustomAvatars.dll': 'dll' });
  const avatars = createStoredZip({ 'Avatars/hero.avatar3d': 'model-bytes' });
  const frameworkSha = sha256(framework);
  const avatarSha = sha256(avatars);
  let manifest;
  const server = createServer((req, res) => {
    if (req.url.includes('/public/packs/')) {
      const body = Buffer.from(JSON.stringify(manifest));
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': body.length });
      res.end(body);
    } else if (req.url.includes(frameworkSha)) {
      res.writeHead(200, { 'content-type': 'application/zip', 'content-length': framework.length });
      res.end(framework);
    } else if (req.url.includes(avatarSha)) {
      res.writeHead(200, { 'content-type': 'application/zip', 'content-length': avatars.length });
      res.end(avatars);
    } else {
      res.writeHead(404); res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  manifest = await signing.signObject({
    schemaVersion: 1,
    packId: 'avatar-pack',
    packVersion: 1,
    gameVersion: '3.1.0',
    issuedAt: new Date().toISOString(),
    mods: [{
      id: 'z-custom-avatars',
      version: '2.5.2.14',
      installRoots: ['Z_CustomAvatars'],
      requiresRestart: true,
      size: framework.length,
      sha256: frameworkSha,
      url: `${baseUrl}/api/v1/public/artifacts/${frameworkSha}`,
      overlays: [{ id: 'avatars', path: 'Avatars', sha256: avatarSha, size: avatars.length, url: `${baseUrl}/api/v1/public/artifacts/${avatarSha}` }]
    }]
  });
  const result = await syncPack({ baseUrl, packId: 'avatar-pack', modsDir, explicitPublicKey: signing.publicJwk().publicKey });
  assert.equal(await readFile(path.join(modsDir, 'Z_CustomAvatars', 'Avatars', 'hero.avatar3d'), 'utf8'), 'model-bytes');
  assert.equal(result.state.managedRoots.Z_CustomAvatars.overlays[0].sha256, avatarSha);
});
