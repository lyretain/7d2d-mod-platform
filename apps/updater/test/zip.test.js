import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { writeFile } from 'node:fs/promises';
import { extractZip, extractZipFile, listZip, listZipFile, safeEntryName } from '../src/zip.js';
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

test('lists and extracts a ZIP from disk without loading the whole archive in the caller', async () => {
  const archive = createStoredZip({ 'ExampleMod/ModInfo.xml': '<xml />', 'ExampleMod/Config/a.txt': 'streamed' });
  const root = await mkdtemp(path.join(os.tmpdir(), 'mod-platform-zipfile-'));
  const zipPath = path.join(root, 'mod.zip');
  await writeFile(zipPath, archive);
  assert.equal((await listZipFile(zipPath)).length, 2);
  await extractZipFile(zipPath, path.join(root, 'out'));
  assert.equal(await readFile(path.join(root, 'out', 'ExampleMod', 'Config', 'a.txt'), 'utf8'), 'streamed');
});
