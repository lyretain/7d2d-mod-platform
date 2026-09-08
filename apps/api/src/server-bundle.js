import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { remapOverlayEntry } from '../../updater/src/overlay.js';
import { extractZipFile, writeStoredZipFromDir } from '../../updater/src/zip.js';
import { PLATFORM_PLUGIN_MODS, platformPluginDownloads } from './protocol.js';

const PLUGIN_ID = 'mod-platform-server';
const PLUGIN_ROOT = PLATFORM_PLUGIN_MODS[PLUGIN_ID].root;

export function serverBundleFileName(server, pack, packVersion) {
  const slug = String(server?.name || server?.id || 'server')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'server';
  const packId = String(pack?.id || 'pack').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 48);
  return `${slug}-${packId}-v${Number(packVersion) || 0}-server-plugin.zip`;
}

export function serverModsForBundle(snapshot, release, { requireReview = false } = {}) {
  const fromPack = (release?.manifest?.mods || []).find((mod) => String(mod.id).toLowerCase() === PLUGIN_ID);
  if (fromPack?.sha256) return [fromPack];
  const extra = platformPluginDownloads(snapshot, { requireReview }).find((item) => item.id === PLUGIN_ID);
  if (!extra) return [];
  const version = snapshot.mods?.[PLUGIN_ID]?.versions?.[extra.version];
  return [{
    id: extra.id,
    version: extra.version,
    sha256: extra.sha256,
    installRoots: version?.installRoots?.length ? version.installRoots : [PLUGIN_ROOT],
    overlays: []
  }];
}

export async function assembleServerModTree({ snapshot, release, objectDir, pluginConfig, requireReview = false }) {
  const mods = serverModsForBundle(snapshot, release, { requireReview });
  const stageDir = await mkdtemp(path.join(os.tmpdir(), 'hordepin-server-bundle-'));
  try {
    for (const mod of mods) {
      if (!/^[a-f0-9]{64}$/.test(mod.sha256 || '')) {
        throw Object.assign(new Error(`Invalid artifact for ${mod.id}`), { code: 'VALIDATION' });
      }
      const archive = path.join(objectDir, mod.sha256);
      await stat(archive);
      await extractZipFile(archive, stageDir);
      const cleared = new Set();
      for (const overlay of mod.overlays || []) {
        if (!/^[a-f0-9]{64}$/.test(overlay.sha256 || '')) {
          throw Object.assign(new Error(`Invalid overlay for ${mod.id}`), { code: 'VALIDATION' });
        }
        const overlayFile = path.join(objectDir, overlay.sha256);
        await stat(overlayFile);
        for (const root of mod.installRoots || []) {
          const dest = path.join(stageDir, root, overlay.path);
          if (!cleared.has(dest)) {
            await rm(dest, { recursive: true, force: true });
            cleared.add(dest);
          }
          await extractZipFile(overlayFile, dest, {
            overwrite: true,
            mapName: (name) => remapOverlayEntry(name, overlay.path, mod.installRoots)
          });
        }
      }
    }
    const configDir = path.join(stageDir, PLUGIN_ROOT);
    await mkdir(configDir, { recursive: true });
    await writeFile(path.join(configDir, 'server.config.json'), `${JSON.stringify(pluginConfig, null, 2)}\n`);
    return stageDir;
  } catch (error) {
    await rm(stageDir, { recursive: true, force: true });
    throw error;
  }
}

export async function buildServerModBundleZip(options) {
  const stageDir = await assembleServerModTree(options);
  const zipPath = `${stageDir}.zip`;
  try {
    await writeStoredZipFromDir(stageDir, zipPath);
    return { zipPath, stageDir };
  } catch (error) {
    await rm(stageDir, { recursive: true, force: true });
    await rm(zipPath, { force: true });
    throw error;
  }
}

export async function cleanupServerModBundle(bundle) {
  if (bundle?.stageDir) await rm(bundle.stageDir, { recursive: true, force: true }).catch(() => {});
  if (bundle?.zipPath) await rm(bundle.zipPath, { force: true }).catch(() => {});
}
