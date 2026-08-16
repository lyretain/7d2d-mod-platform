import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { extractZip, listZip, safeEntryName } from '../src/zip.js';
import { createStoredZip } from './zip-helper.js';

test('extracts a valid ZIP and preserves content', async () => {
  const archive = createStoredZip({ 'ExampleMod/ModInfo.xml': '<xml />', 'ExampleMod/Config/a.txt': 'ok' });
  const destination = await mkdtemp(path.join(os.tmpdir(), 'mod-platform-zip-'));
  assert.equal(listZip(archive).length, 2);
  await extractZip(archive, destination);
  assert.equal(await readFile(path.join(destination, 'ExampleMod', 'Config', 'a.txt'), 'utf8'), 'ok');
});

test('rejects path traversal', () => {
  assert.throws(() => safeEntryName('../outside.txt'), /Unsafe ZIP path/);
  assert.throws(() => safeEntryName('C:\\outside.txt'), /Unsafe ZIP path/);
  const archive = createStoredZip({ '../outside.txt': 'bad' });
  assert.throws(() => listZip(archive), /Unsafe ZIP path/);
});

test('rejects duplicate paths ignoring case', () => {
  const archive = createStoredZip({ 'Mod/a.txt': 'a', 'mod/A.txt': 'b' });
  assert.throws(() => listZip(archive), /Duplicate ZIP path/);
});
