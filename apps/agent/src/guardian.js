#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

function parseArgs(argv) {
  const output = {};
  for (let index = 0; index < argv.length; index += 1) if (argv[index].startsWith('--')) output[argv[index].slice(2)] = argv[++index];
  return output;
}

async function tail(file, maxLines = 300) {
  if (!file) return '';
  try {
    const content = await readFile(file, 'utf8');
    return content.split(/\r?\n/).slice(-maxLines).join('\n').slice(-128 * 1024);
  } catch { return ''; }
}

async function report(config, event) {
  try {
    const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/api/v1/diagnostics`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(15_000)
    });
    if (!response.ok) throw new Error(`diagnostic API returned ${response.status}`);
  } catch (error) {
    console.error(`Unable to upload diagnostic: ${error.message}`);
  }
}

const args = parseArgs(process.argv.slice(2));
if (!args.config) {
  console.error('Usage: npm run agent -- --config guardian.config.json');
  process.exit(2);
}
const config = JSON.parse(await readFile(path.resolve(args.config), 'utf8'));
if (!config.baseUrl || !config.command || !config.side || !config.gameVersion) throw new Error('guardian config requires baseUrl, command, side and gameVersion');

const sessionId = randomUUID();
const startedAt = new Date().toISOString();
const child = spawn(config.command, config.args || [], {
  cwd: config.cwd || process.cwd(),
  env: { ...process.env, ...(config.environment || {}) },
  stdio: 'inherit',
  windowsHide: true
});

child.on('error', async (error) => {
  await report(config, {
    sessionId, side: config.side, gameVersion: config.gameVersion, packId: config.packId,
    stage: 'process_start', exceptionType: error.name, message: error.message,
    stackTrace: error.stack, logExcerpt: await tail(config.logFile), occurredAt: new Date().toISOString()
  });
});

child.on('exit', async (code, signal) => {
  const failed = code !== 0;
  await report(config, {
    sessionId, side: config.side, gameVersion: config.gameVersion, packId: config.packId,
    packVersion: config.packVersion, stage: failed ? 'process_exit' : 'successful_session',
    exceptionType: failed ? 'AbnormalProcessExit' : 'Success',
    message: failed ? `Process exited with code ${code}, signal ${signal || 'none'}` : 'Process exited normally',
    logExcerpt: failed ? await tail(config.logFile) : '', exitCode: code, startedAt, occurredAt: new Date().toISOString()
  });
  process.exit(code ?? 1);
});
