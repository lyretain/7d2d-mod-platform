import { access, readFile, readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';

const exec = promisify(execFile);

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

async function registrySteamPath() {
  if (process.platform !== 'win32') return null;
  try {
    const { stdout } = await exec('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath']);
    const match = stdout.match(/SteamPath\s+REG_SZ\s+(.+)/i);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

function parseLibraryFolders(text) {
  const paths = [];
  for (const match of text.matchAll(/"path"\s+"([^"]+)"/g)) paths.push(match[1].replace(/\\\\/g, '\\'));
  return paths;
}

export async function discoverEnvironment({ steamPath, gameDir } = {}) {
  const home = os.homedir();
  const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const userData = path.join(appData, '7DaysToDie');
  const modsDir = path.join(userData, 'Mods');
  const candidates = [
    steamPath,
    await registrySteamPath(),
    'C:\\Program Files (x86)\\Steam',
    'C:\\Program Files\\Steam',
    path.join(home, 'Steam')
  ].filter(Boolean);
  let steam = null;
  for (const candidate of candidates) {
    if (await exists(path.join(candidate, 'steam.exe')) || await exists(path.join(candidate, 'steamapps'))) {
      steam = candidate;
      break;
    }
  }
  const libraries = [];
  if (steam) {
    libraries.push(path.join(steam, 'steamapps'));
    const vdf = path.join(steam, 'steamapps', 'libraryfolders.vdf');
    if (await exists(vdf)) libraries.push(...parseLibraryFolders(await readFile(vdf, 'utf8')).map((folder) => path.join(folder, 'steamapps')));
  }
  let resolvedGame = gameDir || null;
  let steamBuildId = null;
  if (!resolvedGame) {
    for (const library of libraries) {
      const install = path.join(library, 'common', '7 Days To Die');
      if (await exists(path.join(install, '7DaysToDie.exe'))) {
        resolvedGame = install;
        const manifest = path.join(library, 'appmanifest_251570.acf');
        if (await exists(manifest)) {
          const match = (await readFile(manifest, 'utf8')).match(/"buildid"\s+"(\d+)"/);
          steamBuildId = match ? match[1] : null;
        }
        break;
      }
    }
  }
  const eacExe = resolvedGame ? path.join(resolvedGame, '7DaysToDie_EAC.exe') : null;
  const gameExe = resolvedGame ? path.join(resolvedGame, '7DaysToDie.exe') : null;
  const eacEnabled = eacExe ? await exists(eacExe) : false;
  return {
    steamPath: steam,
    gameDir: resolvedGame,
    gameExe,
    eacExe: eacEnabled ? eacExe : null,
    eacPresent: eacEnabled,
    userData,
    modsDir,
    steamBuildId,
    launcherState: path.join(userData, '.modplatform', 'launcher.json')
  };
}

export async function readFavorites(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return { schemaVersion: 1, servers: [] }; }
}

export async function listInstalledMods(modsDir) {
  try {
    const entries = await readdir(modsDir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory() && entry.name !== '.modplatform').map((entry) => entry.name);
  } catch {
    return [];
  }
}
