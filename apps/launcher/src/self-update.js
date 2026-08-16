import { access, copyFile, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { download, trustPublicKey } from '../../updater/src/installer.js';
import { verifyManifest } from '../../updater/src/verify.js';
import { extractZipFile } from '../../updater/src/zip.js';
import { compareVersions, isNewerVersion, LAUNCHER_VERSION, normalizePlatform } from './version.js';
import { validateLauncherEntries } from './layout.js';

const MARKERS = ['ModPlatformLauncher.cmd', 'ModPlatformLauncher.exe'];

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

export async function findInstallRoot(start) {
  if (process.env.LAUNCHER_ROOT) return path.resolve(process.env.LAUNCHER_ROOT);
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [start, process.cwd(), path.dirname(process.execPath), path.resolve(here, '../../..')].filter(Boolean);
  for (const dir of candidates) {
    const resolved = path.resolve(dir);
    for (const marker of MARKERS) {
      if (await exists(path.join(resolved, marker))) return resolved;
    }
  }
  return null;
}

export async function copyStageToRoot(stageDir, installRoot) {
  const names = await readdir(stageDir);
  for (const name of names) {
    if (name === '.update') continue;
    const from = path.join(stageDir, name);
    const to = path.join(installRoot, name);
    const info = await stat(from);
    if (info.isDirectory()) {
      await mkdir(to, { recursive: true });
      await copyStageToRoot(from, to);
    } else {
      await mkdir(path.dirname(to), { recursive: true });
      await copyFile(from, to);
    }
  }
}

function helperSource() {
  return [
    'const { spawn } = require("node:child_process");',
    'const fs = require("node:fs");',
    'const path = require("node:path");',
    'const apply = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));',
    'function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }',
    'function wait(pid) { return new Promise((resolve) => { const tick = () => { if (!pid || !alive(pid)) return resolve(); setTimeout(tick, 400); }; tick(); }); }',
    'function copy(src, dest) {',
    '  fs.mkdirSync(dest, { recursive: true });',
    '  for (const name of fs.readdirSync(src)) {',
    '    if (name === ".update") continue;',
    '    const from = path.join(src, name);',
    '    const to = path.join(dest, name);',
    '    if (fs.statSync(from).isDirectory()) copy(from, to);',
    '    else { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); }',
    '  }',
    '}',
    '(async () => {',
    '  await wait(apply.pid);',
    '  copy(apply.stageDir, apply.installRoot);',
    '  if (apply.relaunch && apply.relaunch[0]) {',
    '    const child = spawn(apply.relaunch[0], apply.relaunch.slice(1), { cwd: apply.installRoot, detached: true, stdio: "ignore" });',
    '    child.unref();',
    '  }',
    '})().catch((error) => { fs.writeFileSync(path.join(apply.installRoot, ".update", "apply-error.log"), String(error && error.stack || error)); process.exit(1); });',
    ''
  ].join('\n');
}

function relaunchCommand(installRoot, args) {
  const exe = path.join(installRoot, 'ModPlatformLauncher.exe');
  const cmd = path.join(installRoot, 'ModPlatformLauncher.cmd');
  if (process.platform === 'win32') return [existsSyncFallback(exe) ? exe : cmd, ...args];
  return [path.join(installRoot, 'node.exe'), path.join(installRoot, 'apps', 'launcher', 'src', 'cli.js'), ...args];
}

function existsSyncFallback(file) {
  try {
    return require('node:fs').existsSync(file);
  } catch {
    return false;
  }
}

export async function fetchLauncherManifest({ baseUrl, platform = process.platform, explicitPublicKey, trustDir }) {
  const normalized = normalizePlatform(platform);
  const trusted = await trustPublicKey(baseUrl, trustDir, explicitPublicKey);
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/v1/public/launcher/latest?platform=${encodeURIComponent(normalized)}`, { signal: AbortSignal.timeout(30_000) });
  if (response.status === 404) return { manifest: null, trusted };
  if (!response.ok) throw new Error(`Launcher manifest request failed (${response.status})`);
  const manifest = await response.json();
  if (manifest.kind !== 'launcher' || manifest.platform !== normalized) throw Object.assign(new Error('Launcher manifest platform mismatch'), { code: 'SIGNATURE' });
  if (!verifyManifest(manifest, trusted.publicKey, { keys: trusted.keys })) throw Object.assign(new Error('Launcher manifest signature verification failed'), { code: 'SIGNATURE' });
  return { manifest, trusted };
}

export async function checkLauncherUpdate(options = {}) {
  const currentVersion = options.currentVersion || LAUNCHER_VERSION;
  const platform = normalizePlatform(options.platform || process.platform);
  const installRoot = options.installRoot === undefined ? await findInstallRoot(options.startDir) : options.installRoot;
  const trustDir = options.trustDir || (installRoot ? path.join(installRoot, '.update') : path.join(process.cwd(), '.modplatform'));
  const { manifest } = await fetchLauncherManifest({
    baseUrl: options.baseUrl,
    platform,
    explicitPublicKey: options.explicitPublicKey,
    trustDir
  });
  if (!manifest) return { update: false, currentVersion, installRoot, reason: 'none' };
  if (!isNewerVersion(manifest.version, currentVersion)) return { update: false, currentVersion, remoteVersion: manifest.version, installRoot, reason: 'current', manifest };
  return { update: true, currentVersion, remoteVersion: manifest.version, installRoot, manifest };
}

export async function applyLauncherUpdate(options = {}) {
  const checked = options.checked || await checkLauncherUpdate(options);
  if (!checked.update) return { ...checked, applied: false };
  const installRoot = checked.installRoot;
  if (!installRoot) return { ...checked, applied: false, reason: 'not-portable' };
  const manifest = checked.manifest;
  const updateDir = path.join(installRoot, '.update');
  const zipPath = path.join(updateDir, `${manifest.sha256}.zip`);
  const stageDir = path.join(updateDir, 'stage');
  await mkdir(updateDir, { recursive: true });
  await rm(stageDir, { recursive: true, force: true });
  await download(manifest.url, zipPath, manifest.sha256, manifest.size, { onProgress: options.onProgress, bandwidth: options.bandwidth });
  const entries = await extractZipFile(zipPath, stageDir);
  validateLauncherEntries(entries);

  if (options.deferRestart) {
    await copyStageToRoot(stageDir, installRoot);
    return { ...checked, applied: true, restarting: false, installRoot };
  }

  const applyFile = path.join(updateDir, 'apply.json');
  const helperFile = path.join(updateDir, 'apply-update.cjs');
  const relaunch = options.relaunchArgs ? relaunchCommand(installRoot, options.relaunchArgs) : null;
  await writeFile(applyFile, JSON.stringify({ pid: process.pid, stageDir, installRoot, relaunch }, null, 2));
  await writeFile(helperFile, helperSource());
  const node = await exists(path.join(stageDir, 'node.exe')) ? path.join(stageDir, 'node.exe') : process.execPath;
  spawn(node, [helperFile, applyFile], { detached: true, stdio: 'ignore', cwd: stageDir }).unref();
  return { ...checked, applied: true, restarting: true, installRoot };
}

export { compareVersions, LAUNCHER_VERSION };
