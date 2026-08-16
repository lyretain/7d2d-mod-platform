import { readFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { listZip } from '../../updater/src/zip.js';

const SCAN_BYTES = 64 * 1024;
const INFLATE_HARD_CAP = 32 * 1024 * 1024;

const DLL_RULES = [
  { id: 'process-spawn', pattern: /cmd\.exe|powershell|wscript|cscript/i, severity: 'high' },
  { id: 'native-inject', pattern: /VirtualAlloc|WriteProcessMemory|CreateRemoteThread/i, severity: 'high' },
  { id: 'credential', pattern: /password=|api[_-]?key|Bearer /i, severity: 'medium' }
];

function parseModInfo(xml) {
  const value = (name) => {
    const match = xml.match(new RegExp(`<${name}[^>]*value="([^"]*)"`, 'i')) || xml.match(new RegExp(`<${name}[^>]*>([^<]*)</${name}>`, 'i'));
    return match ? match[1].trim() : null;
  };
  return { name: value('Name'), displayName: value('DisplayName'), version: value('Version'), author: value('Author'), description: value('Description') };
}

function classify(name) {
  const lower = name.toLocaleLowerCase('en-US');
  if (lower.endsWith('.dll')) return lower.includes('harmony') ? 'harmony' : 'dll';
  if (lower.endsWith('.unity3d') || lower.endsWith('.bundle') || lower.endsWith('.assetbundle')) return 'assetBundle';
  if (lower.endsWith('.tts') || lower.includes('/prefabs/') || lower.endsWith('.mesh')) return 'poi';
  return 'other';
}

function assemblyName(fileName, bytes) {
  const ascii = bytes.toString('latin1');
  const match = ascii.match(/([A-Za-z0-9._-]{3,80})(\.dll|\.exe)/);
  return match ? match[1] : fileName.replace(/\.dll$/i, '');
}

function inflateEntryPrefix(compressed, uncompressedSize, max) {
  const known = Number(uncompressedSize) > 0 ? uncompressedSize : 0;
  const limit = Math.min(known > 0 ? known : INFLATE_HARD_CAP, INFLATE_HARD_CAP);
  try {
    const inflated = inflateRawSync(compressed, { maxOutputLength: Math.max(limit, max) });
    return inflated.subarray(0, Math.min(inflated.length, max));
  } catch {
    return Buffer.alloc(0);
  }
}

function entryBytes(buffer, entry, max = SCAN_BYTES) {
  try {
    if (!Number.isInteger(entry.localOffset) || entry.localOffset + 30 > buffer.length) return Buffer.alloc(0);
    const nameLength = buffer.readUInt16LE(entry.localOffset + 26);
    const extraLength = buffer.readUInt16LE(entry.localOffset + 28);
    const start = entry.localOffset + 30 + nameLength + extraLength;
    if (start < 0 || start > buffer.length) return Buffer.alloc(0);
    const raw = buffer.subarray(start, Math.min(buffer.length, start + (entry.compressedSize || 0)));
    if (entry.method === 0) return Buffer.from(raw.subarray(0, Math.min(raw.length, max)));
    return inflateEntryPrefix(raw, entry.size, max);
  } catch {
    return Buffer.alloc(0);
  }
}

export function analyzeZipBuffer(buffer, fileName = 'upload.zip') {
  const entries = listZip(buffer);
  const files = entries.filter((entry) => !entry.directory);
  const roots = [...new Set(files.map((entry) => entry.name.split('/')[0]).filter(Boolean))];
  const kinds = { dll: [], harmony: [], assetBundle: [], poi: [], other: [] };
  const assemblies = [];
  const findings = [];
  let modInfo = null;
  for (const entry of files) {
    const kind = classify(entry.name);
    kinds[kind].push(entry.name);
    if (entry.name.endsWith('/ModInfo.xml') || entry.name === 'ModInfo.xml') {
      try { modInfo = parseModInfo(entryBytes(buffer, entry, 256 * 1024).toString('utf8')); } catch { /* ignore */ }
    }
    if (kind === 'dll' || kind === 'harmony') {
      const slice = entryBytes(buffer, entry);
      const name = assemblyName(entry.name.split('/').pop(), slice);
      assemblies.push({ file: entry.name, name, size: entry.size });
      for (const rule of DLL_RULES) {
        if (rule.pattern.test(slice.toString('latin1'))) findings.push({ rule: rule.id, severity: rule.severity, file: entry.name });
      }
    }
  }
  const assemblyNames = assemblies.map((item) => item.name.toLocaleLowerCase('en-US'));
  const duplicates = assemblyNames.filter((name, index) => assemblyNames.indexOf(name) !== index);
  if (duplicates.length) findings.push({ rule: 'duplicate-assembly', severity: 'high', file: duplicates.join(',') });
  return {
    fileName,
    roots,
    entryCount: files.length,
    containsDll: kinds.dll.length + kinds.harmony.length > 0,
    containsHarmony: kinds.harmony.length > 0,
    containsAssetBundle: kinds.assetBundle.length > 0,
    containsPoi: kinds.poi.length > 0,
    kinds,
    assemblies,
    modInfo,
    findings,
    sbom: {
      schema: 'modplatform-sbom-1',
      components: [
        ...assemblies.map((item) => ({ type: 'library', name: item.name, file: item.file, size: item.size })),
        ...kinds.assetBundle.map((file) => ({ type: 'asset', name: file, file })),
        ...kinds.poi.map((file) => ({ type: 'poi', name: file, file }))
      ]
    }
  };
}

export async function analyzeZipFile(file, fileName) {
  try {
    return analyzeZipBuffer(await readFile(file), fileName);
  } catch (error) {
    if (!error.code) error.code = 'VALIDATION';
    throw error;
  }
}

export async function scanFile(file) {
  const { spawn } = await import('node:child_process');
  const binary = process.env.CLAMSCAN_PATH || 'clamscan';
  return new Promise((resolve) => {
    const child = spawn(binary, ['--no-summary', file], { windowsHide: true });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('error', () => resolve({ ok: true, skipped: true, engine: 'none' }));
    child.on('exit', (code) => resolve({ ok: code === 0, skipped: false, engine: 'clamscan', output: output.slice(0, 4000) }));
  });
}
