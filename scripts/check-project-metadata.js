import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFile(path.join(root, file), 'utf8');
const metadata = JSON.parse(await read('project-versions.json'));
const failures = [];

function expect(file, text, description = text) {
  return read(file).then((content) => {
    if (!content.includes(text)) failures.push(`${file}: missing ${description}`);
  });
}

function reject(file, text, description = text) {
  return read(file).then((content) => {
    if (content.includes(text)) failures.push(`${file}: contains stale ${description}`);
  });
}

const packageJson = JSON.parse(await read('package.json'));
if (packageJson.version !== metadata.platformVersion) {
  failures.push(`package.json: version ${packageJson.version} != ${metadata.platformVersion}`);
}

const modInfoVersion = `${metadata.pluginVersion}.0`;
await Promise.all([
  expect('plugins/client/ModInfo.xml', `Version value="${modInfoVersion}"`, 'client plugin version'),
  expect('plugins/server/ModInfo.xml', `Version value="${modInfoVersion}"`, 'server plugin version'),
  expect('plugins/shared/PluginIdentity.cs', `PluginVersion = "${metadata.pluginVersion}"`, 'plugin identity version'),
  expect('plugins/shared/PluginIdentity.cs', `ProtocolVersion = ${metadata.protocolVersion}`, 'protocol version'),
  expect('plugins/shared/PluginIdentity.cs', `TargetGameVersion = "${metadata.gameVersion}"`, 'target game version'),
  expect('plugins/shared/PluginIdentity.cs', `TargetSteamBuild = "${metadata.steamBuildId}"`, 'Steam build ID'),
  expect('README.md', `V ${metadata.gameVersion}`),
  expect('README.zh.md', `V ${metadata.gameVersion}`),
  expect('deploy/build-plugins.ps1', 'project-versions.json', 'metadata-backed plugin build'),
  expect('.github/workflows/ci.yml', 'extract_json project-versions.json', 'metadata-backed release detection'),
  reject('README.md', '3.10.14', 'legacy mislabeled game version 3.10.14'),
  reject('README.zh.md', '3.10.14', 'legacy mislabeled game version 3.10.14'),
  reject('README.zh.md', 'cd E:\\Project', 'machine-specific test path'),
  ...[
    'docs/API.md',
    'docs/API.zh.md',
    'docs/DEPLOYMENT.md',
    'docs/DEPLOYMENT.zh.md',
    'docs/PLUGIN.md',
    'docs/PLUGIN.zh.md',
    'docs/USER.md',
    'docs/USER.zh.md',
    'deploy/guardian.config.example.json',
    'deploy/publish-platform.js',
    'apps/api/src/admin.html',
    'apps/api/src/admin-i18n.js',
    'apps/web/src/views/AboutView.vue',
    'apps/web/src/views/ServersView.vue'
  ].map((file) => reject(file, '3.10.14', 'legacy mislabeled game version 3.10.14'))
]);

if (failures.length) {
  console.error('Project metadata check failed:\n- ' + failures.join('\n- '));
  process.exit(1);
}

console.log(`Project metadata OK: platform ${metadata.platformVersion}, plugin ${metadata.pluginVersion}, game ${metadata.gameVersion} (${metadata.steamBuildId})`);
