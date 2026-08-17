import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { createApp } from '../src/app.js';
import { SigningService } from '../src/signing.js';
import { JsonStore } from '../src/store.js';

function loadI18n(lang) {
  const src = readFileSync(new URL('../src/admin-i18n.js', import.meta.url), 'utf8');
  const root = {
    localStorage: { getItem: () => lang, setItem() {} },
    navigator: { language: lang === 'zh' ? 'zh-CN' : 'en-US' }
  };
  vm.runInNewContext(src, { window: root, globalThis: root });
  return root.I18N;
}

test('admin zh and en dictionaries expose the same keys', () => {
  const i18n = loadI18n('zh');
  const zhKeys = Object.keys(i18n.zh).sort();
  const enKeys = Object.keys(i18n.en).sort();
  assert.deepEqual(zhKeys, enKeys);
  assert.ok(zhKeys.length > 80);
});

test('admin i18n interpolates and switches language', () => {
  const zh = loadI18n('zh');
  const en = loadI18n('en');
  assert.equal(zh.t('logout'), '退出登录');
  assert.equal(en.t('logout'), 'Sign out');
  assert.equal(zh.t('ws.found', { n: 3 }), '找到 3 个 Mod');
  assert.equal(en.t('ws.found', { n: 3 }), 'Found 3 mods');
  assert.equal(zh.t('r18.badge'), 'R18');
  assert.equal(en.t('r18.title'), 'Age check');
  assert.equal(zh.currentLang(), 'zh');
  assert.equal(en.currentLang(), 'en');
});

test('admin page wires i18n script and language switch', () => {
  const html = readFileSync(new URL('../src/admin.html', import.meta.url), 'utf8');
  assert.match(html, /<script src="\/admin-i18n\.js"><\/script>/);
  assert.match(html, /data-lang-switch/);
  assert.match(html, /data-i18n="gate\.title"/);
  assert.match(html, /github.com\/lyretain\/7d2d-mod-platform/);
  assert.match(html, /function applyI18n\(/);
  assert.match(html, /function setLang\(/);
});

test('serves admin-i18n.js as javascript', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'mod-platform-i18n-'));
  const store = new JsonStore(path.join(dataDir, 'state', 'database.json'));
  const signing = new SigningService({ dataDir });
  await Promise.all([store.init(), signing.init()]);
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  server.removeAllListeners('request');
  server.on('request', createApp({ store, signing, dataDir, adminToken: 'test-admin-token-1234', publicBaseUrl: base }));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(`${base}/admin-i18n.js`);
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /javascript/);
  assert.match(body, /root\.I18N/);
  assert.match(body, /const zh =/);
  assert.match(body, /const en =/);
});

test('serves spa or embedded admin at / and always keeps /legacy', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'mod-platform-legacy-'));
  const store = new JsonStore(path.join(dataDir, 'state', 'database.json'));
  const signing = new SigningService({ dataDir });
  await Promise.all([store.init(), signing.init()]);
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  server.removeAllListeners('request');
  server.on('request', createApp({ store, signing, dataDir, adminToken: 'test-admin-token-1234', publicBaseUrl: base }));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const home = await fetch(`${base}/`);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /id="(gate|app)"/);
  const legacy = await fetch(`${base}/legacy`);
  assert.equal(legacy.status, 200);
  assert.match(await legacy.text(), /id="gate"/);
});
