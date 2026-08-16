import assert from 'node:assert/strict';
import test from 'node:test';
import { planFromManifest } from '../../updater/src/installer.js';
import { discoverEnvironment } from '../src/discover.js';

test('discoverEnvironment returns user Mods path on Windows or Linux', async () => {
  const env = await discoverEnvironment();
  assert.match(env.modsDir, /7DaysToDie/);
  assert.match(env.modsDir, /Mods$/);
  assert.ok(env.launcherState.includes('.modplatform'));
});

test('planFromManifest marks DLL mods and removals', () => {
  const plan = planFromManifest({
    packId: 'p',
    packVersion: 3,
    gameVersion: '3.10.14',
    mods: [{ id: 'cars', version: '2', sha256: 'abc', size: 10, containsDll: true, requiresRestart: true, installRoots: ['Cars'] }]
  }, { managedRoots: { OldMod: { modId: 'old', version: '1', sha256: 'zzz' } } });
  assert.equal(plan.containsDll, true);
  assert.equal(plan.items.find((item) => item.root === 'Cars').action, 'install');
  assert.equal(plan.items.find((item) => item.root === 'OldMod').action, 'remove');
});
