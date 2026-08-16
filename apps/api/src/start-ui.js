import { spawnSync } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const build = spawnSync(npm, ['run', 'build:web'], { stdio: 'inherit', shell: true });
if (build.status) process.exit(build.status || 1);
process.env.OPEN_BROWSER = '1';
await import('./server.js');
