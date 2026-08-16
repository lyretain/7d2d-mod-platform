export const LAUNCHER_VERSION = '0.3.0';

export function parseVersion(value) {
  const match = String(value || '').trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) throw new Error('Invalid launcher version');
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

export function isNewerVersion(remote, local) {
  return compareVersions(remote, local) > 0;
}

export function normalizePlatform(value = process.platform) {
  const platform = String(value || '').toLowerCase();
  if (platform === 'win' || platform === 'windows' || platform === 'win32') return 'win32';
  if (platform === 'linux') return 'linux';
  if (platform === 'darwin' || platform === 'mac' || platform === 'macos') return 'darwin';
  return '';
}
