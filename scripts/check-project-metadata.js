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
  expect('plugins/shared/PluginIdentity.cs', `TargetClientGameVersion = "${metadata.clientGameVersion}"`, 'target client game version'),
  expect('plugins/shared/PluginIdentity.cs', `TargetServerGameVersion = "${metadata.serverGameVersion}"`, 'target server game version'),
  expect('plugins/shared/PluginIdentity.cs', `TargetSteamBuild = "${metadata.steamBuildId}"`, 'Steam build ID'),
  expect('README.md', `V ${metadata.clientGameVersion}`),
  expect('README.md', `V ${metadata.serverGameVersion}`),
  expect('README.zh.md', `V ${metadata.clientGameVersion}`),
  expect('README.zh.md', `V ${metadata.serverGameVersion}`),
  expect('deploy/build-plugins.ps1', 'project-versions.json', 'metadata-backed plugin build'),
  expect('.github/workflows/ci.yml', 'extract_json project-versions.json', 'metadata-backed release detection'),
  reject('README.zh.md', 'cd E:\\Project', 'machine-specific test path'),
  expect('plugins/client/client.config.example.json', `"GameVersion":"${metadata.clientGameVersion}"`, 'client config game version'),
  expect('plugins/server/server.config.example.json', `"GameVersion":"${metadata.serverGameVersion}"`, 'server config game version'),
  expect('deploy/guardian.config.example.json', `"gameVersion": "${metadata.serverGameVersion}"`, 'guardian server game version'),
  expect('apps/api/src/catalog.js', `GameVersion: gameVersion || '${metadata.serverGameVersion}'`, 'generated server config game version'),
  expect('apps/web/src/views/PacksView.vue', `packGame.value = '${metadata.serverGameVersion}'`, 'Pack server game version')
]);

if (failures.length) {
  console.error('Project metadata check failed:\n- ' + failures.join('\n- '));
  process.exit(1);
}

console.log(`Project metadata OK: platform ${metadata.platformVersion}, plugin ${metadata.pluginVersion}, client ${metadata.clientGameVersion}, server ${metadata.serverGameVersion} (${metadata.steamBuildId})`);
