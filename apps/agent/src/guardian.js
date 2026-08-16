#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { syncDedicatedServer } from './server-sync.js';
import { reportDiagnostic } from '../../updater/src/diagnostics-queue.js';

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
  const result = await reportDiagnostic(config.baseUrl, config.modsDir ? `${config.modsDir}/.modplatform` : './data', event);
  if (result.queued) console.error('Diagnostic queued for retry after network recovery');
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
let restartFailures = 0;

if (config.syncBeforeStart) {
  if (!config.modsDir) throw new Error('syncBeforeStart requires modsDir');
  try {
    const synced = await syncDedicatedServer(config);
    config.packId = synced.state.packId;
    config.packVersion = synced.state.packVersion;
    console.log(`Server mods synchronized: ${synced.state.packId} v${synced.state.packVersion}`);
  } catch (error) {
    await report(config, {
      sessionId, side: config.side, gameVersion: config.gameVersion, packId: config.packId,
      stage: 'server_sync', exceptionType: error.name, message: error.message,
      stackTrace: error.stack, occurredAt: new Date().toISOString()
    });
    if (config.allowStartOnSyncFailure) console.error(`Sync failed, starting last known server: ${error.message}`);
    else {
      console.error(`Refusing to start until sync succeeds: ${error.message}`);
      process.exit(1);
    }
  }
}

function startChild() {
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
    const ranMs = Date.now() - Date.parse(startedAt);
    await report(config, {
      sessionId, side: config.side, gameVersion: config.gameVersion, packId: config.packId,
      packVersion: config.packVersion, stage: failed ? 'process_exit' : 'successful_session',
      exceptionType: failed ? 'AbnormalProcessExit' : 'Success',
      message: failed ? `Process exited with code ${code}, signal ${signal || 'none'}` : 'Process exited normally',
      logExcerpt: failed ? await tail(config.logFile) : '', exitCode: code, startedAt, occurredAt: new Date().toISOString()
    });
    if (failed && ranMs < 60_000) {
      restartFailures += 1;
      if (restartFailures >= (config.maxRestartFailures || 3)) {
        console.error('Too many rapid server failures; guardian will not restart.');
        process.exit(code ?? 1);
      }
    }
    process.exit(code ?? 1);
  });
}

startChild();
