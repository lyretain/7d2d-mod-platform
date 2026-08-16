import { listZipFile } from '../../updater/src/zip.js';
import { validateLauncherEntries } from '../../launcher/src/layout.js';
import { artifactPublicUrl } from './cloudflare.js';
import { compareVersions, normalizePlatform, parseVersion } from '../../launcher/src/version.js';

export { compareVersions, normalizePlatform, parseVersion, validateLauncherEntries };

export async function validateLauncherZip(filePath) {
  try {
    const entries = await listZipFile(filePath);
    validateLauncherEntries(entries);
    return entries;
  } catch (error) {
    throw Object.assign(error, { code: error.code || 'VALIDATION' });
  }
}

export function currentLauncher(snapshot, platform) {
  const channel = snapshot?.launcher?.channels?.[normalizePlatform(platform)];
  if (!channel || channel.revokedAt) return null;
  return channel;
}

export function launcherArtifactUrl(sha256, config = {}, publicBaseUrl = '') {
  return artifactPublicUrl(sha256, config, publicBaseUrl);
}

export function launcherManifestPayload({ version, platform, sha256, size, fileName, notes, url, minVersion }) {
  const normalized = normalizePlatform(platform);
  if (!parseVersion(version) || !normalized || !/^[a-f0-9]{64}$/.test(sha256)) {
    throw Object.assign(new Error('Launcher release requires version, platform and SHA-256'), { code: 'VALIDATION' });
  }
  return {
    kind: 'launcher',
    version,
    platform: normalized,
    channel: 'stable',
    sha256,
    size: Number(size) || 0,
    fileName: fileName || `ModPlatformLauncher-${version}-${normalized}.zip`,
    url,
    notes: notes || null,
    minVersion: minVersion || null
  };
}
