import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadConfig } from '../src/config.js';
import { clampLogRetentionDays, createLogger, dayStamp, keepFromStamp, redactPath } from '../src/logger.js';
import { createMetrics, wrapHandler } from '../src/observe.js';

test('log retention defaults to 30 days and never exceeds 30', () => {
  assert.equal(clampLogRetentionDays(undefined), 30);
  assert.equal(loadConfig({}).logRetentionDays, 30);
  assert.equal(loadConfig({ LOG_RETENTION_DAYS: '90' }).logRetentionDays, 30);
  assert.equal(loadConfig({ LOG_RETENTION_DAYS: '7' }).logRetentionDays, 7);
  assert.equal(loadConfig({ LOG_RETENTION_DAYS: '0' }).logRetentionDays, 1);
});

test('writes one daily file and deletes logs older than 30 days', async () => {
  const logDir = await mkdtemp(path.join(os.tmpdir(), 'mod-platform-logs-'));
  const today = dayStamp();
  const keepFrom = keepFromStamp(new Date(), 30);
  const oldName = '2020-01-01.log';
  const keptName = `${keepFrom}.log`;
  await writeFile(path.join(logDir, oldName), 'stale\n');
  await writeFile(path.join(logDir, keptName), 'keep\n');

  const logger = createLogger({ logDir, retentionDays: 30, writeConsole: false });
  await logger.info('started', { type: 'boot' });
  await logger.prune();

  assert.equal(existsSync(path.join(logDir, oldName)), false);
  assert.equal(existsSync(path.join(logDir, keptName)), true);
  const todayLog = await readFile(path.join(logDir, `${today}.log`), 'utf8');
  assert.match(todayLog, /"message":"started"/);
  assert.match(todayLog, /"type":"boot"/);
});

test('redacts secrets in request paths', () => {
  assert.equal(redactPath('/api/v1/auth/github/callback?code=abc&state=1'), '/api/v1/auth/github/callback?code=%5Bredacted%5D&state=1');
  assert.equal(redactPath('/health'), '/health');
});

test('http wrapper writes a daily request log', async (t) => {
  const logDir = await mkdtemp(path.join(os.tmpdir(), 'mod-platform-http-logs-'));
  const logger = createLogger({ logDir, retentionDays: 30, writeConsole: false });
  const server = createServer(wrapHandler((req, res) => {
    res.writeHead(204);
    res.end();
  }, {
    metrics: createMetrics(),
    forceHttps: false,
    securityHeaders: () => ({}),
    logger
  }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/health?token=secret`);
  assert.equal(response.status, 204);
  await logger.flush();

  const todayLog = await readFile(path.join(logDir, `${dayStamp()}.log`), 'utf8');
  assert.match(todayLog, /"type":"http"/);
  assert.match(todayLog, /"path":"\/health\?token=%5Bredacted%5D"/);
  assert.match(todayLog, /"status":204/);
});
