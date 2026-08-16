const REQUIRED_SCRIPT = 'apps/launcher/src/cli.js';
const MARKERS = new Set(['ModPlatformLauncher.cmd', 'ModPlatformLauncher.exe', 'package.json']);

export function validateLauncherEntries(entries) {
  const names = (entries || []).map((entry) => String(entry.name || entry).replaceAll('\\', '/'));
  if (!names.includes(REQUIRED_SCRIPT)) throw Object.assign(new Error('Launcher ZIP must include apps/launcher/src/cli.js'), { code: 'VALIDATION' });
  if (!names.some((name) => MARKERS.has(name))) throw Object.assign(new Error('Launcher ZIP must include ModPlatformLauncher.cmd, ModPlatformLauncher.exe, or package.json'), { code: 'VALIDATION' });
  return true;
}
