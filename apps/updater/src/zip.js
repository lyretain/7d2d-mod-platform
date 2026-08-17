import { open } from 'node:fs/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

function crcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}
const CRC_TABLE = crcTable();

export function buildStoredZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const names = Object.keys(files);
  for (const name of names) {
    const fileName = Buffer.from(String(name).replaceAll('\\', '/'));
    const content = Buffer.isBuffer(files[name]) ? files[name] : Buffer.from(files[name] ?? '');
    const crc = crc32(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(fileName.length, 26);
    locals.push(local, fileName, content);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(content.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(fileName.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, fileName);
    offset += local.length + fileName.length + content.length;
  }
  const localData = Buffer.concat(locals);
  const centralData = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD, 0);
  eocd.writeUInt16LE(names.length, 8);
  eocd.writeUInt16LE(names.length, 10);
  eocd.writeUInt32LE(centralData.length, 12);
  eocd.writeUInt32LE(localData.length, 16);
  return Buffer.concat([localData, centralData, eocd]);
}

export function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function safeEntryName(input) {
  const value = input.replaceAll('\\', '/');
  if (!value || value.includes('\0') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) throw new Error(`Unsafe ZIP path: ${input}`);
  const parts = value.split('/').filter(Boolean);
  if (!parts.length || parts.some((part) => part === '.' || part === '..')) throw new Error(`Unsafe ZIP path: ${input}`);
  return parts.join('/') + (value.endsWith('/') ? '/' : '');
}

export function listZip(buffer, { maxEntries = 10_000, maxEntryBytes = 1024 ** 3, maxTotalBytes = 8 * 1024 ** 3 } = {}) {
  const searchStart = Math.max(0, buffer.length - 65_557);
  let eocd = -1;
  for (let offset = buffer.length - 22; offset >= searchStart; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD) { eocd = offset; break; }
  }
  if (eocd < 0) throw new Error('ZIP end-of-central-directory was not found');
  const disk = buffer.readUInt16LE(eocd + 4);
  const centralDisk = buffer.readUInt16LE(eocd + 6);
  const count = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (disk || centralDisk || count === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) throw new Error('Multi-disk and ZIP64 archives are not supported');
  if (count > maxEntries || centralOffset + centralSize > buffer.length) throw new Error('ZIP central directory exceeds configured limits');

  const entries = [];
  const seen = new Set();
  let total = 0;
  let offset = centralOffset;
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(offset) !== CENTRAL) throw new Error('Invalid ZIP central directory');
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const expectedCrc = buffer.readUInt32LE(offset + 16);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const externalAttributes = buffer.readUInt32LE(offset + 38);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = safeEntryName(buffer.subarray(offset + 46, offset + 46 + nameLength).toString((flags & 0x800) ? 'utf8' : 'utf8'));
    const key = name.toLocaleLowerCase('en-US');
    if (seen.has(key)) throw new Error(`Duplicate ZIP path: ${name}`);
    seen.add(key);
    if (flags & 1) throw new Error(`Encrypted ZIP entry is not allowed: ${name}`);
    if (![0, 8].includes(method)) throw new Error(`Unsupported ZIP compression method ${method}: ${name}`);
    const unixType = (externalAttributes >>> 16) & 0xf000;
    if (unixType === 0xa000) throw new Error(`Symbolic links are not allowed: ${name}`);
    if (size > maxEntryBytes) throw new Error(`ZIP entry is too large: ${name}`);
    total += size;
    if (total > maxTotalBytes) throw new Error('Uncompressed ZIP size exceeds configured limit');
    entries.push({ name, flags, method, expectedCrc, compressedSize, size, localOffset, directory: name.endsWith('/') });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export async function extractZip(buffer, destination, options = {}) {
  const entries = listZip(buffer, options);
  const base = path.resolve(destination);
  await mkdir(base, { recursive: true });
  for (const entry of entries) {
    const target = path.resolve(base, ...entry.name.split('/').filter(Boolean));
    if (target !== base && !target.startsWith(`${base}${path.sep}`)) throw new Error(`ZIP entry escaped destination: ${entry.name}`);
    if (entry.directory) {
      await mkdir(target, { recursive: true });
      continue;
    }
    if (buffer.readUInt32LE(entry.localOffset) !== LOCAL) throw new Error(`Invalid local ZIP header: ${entry.name}`);
    const nameLength = buffer.readUInt16LE(entry.localOffset + 26);
    const extraLength = buffer.readUInt16LE(entry.localOffset + 28);
    const start = entry.localOffset + 30 + nameLength + extraLength;
    const compressed = buffer.subarray(start, start + entry.compressedSize);
    const content = entry.method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed, { maxOutputLength: entry.size });
    if (content.length !== entry.size || crc32(content) !== entry.expectedCrc) throw new Error(`ZIP integrity check failed: ${entry.name}`);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, { flag: 'wx' });
  }
  return entries;
}

function parseCentral(buffer, count, { maxEntries = 10_000, maxEntryBytes = 1024 ** 3, maxTotalBytes = 8 * 1024 ** 3 } = {}) {
  if (count > maxEntries) throw new Error('ZIP central directory exceeds configured limits');
  const entries = [];
  const seen = new Set();
  let total = 0;
  let offset = 0;
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(offset) !== CENTRAL) throw new Error('Invalid ZIP central directory');
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const expectedCrc = buffer.readUInt32LE(offset + 16);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const externalAttributes = buffer.readUInt32LE(offset + 38);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = safeEntryName(buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'));
    const key = name.toLocaleLowerCase('en-US');
    if (seen.has(key)) throw new Error(`Duplicate ZIP path: ${name}`);
    seen.add(key);
    if (flags & 1) throw new Error(`Encrypted ZIP entry is not allowed: ${name}`);
    if (![0, 8].includes(method)) throw new Error(`Unsupported ZIP compression method ${method}: ${name}`);
    const unixType = (externalAttributes >>> 16) & 0xf000;
    if (unixType === 0xa000) throw new Error(`Symbolic links are not allowed: ${name}`);
    if (size > maxEntryBytes) throw new Error(`ZIP entry is too large: ${name}`);
    total += size;
    if (total > maxTotalBytes) throw new Error('Uncompressed ZIP size exceeds configured limit');
    entries.push({ name, flags, method, expectedCrc, compressedSize, size, localOffset, directory: name.endsWith('/') });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export async function listZipFile(filePath, options = {}) {
  const handle = await open(filePath, 'r');
  try {
    const { size } = await handle.stat();
    const tailSize = Math.min(size, 65_557);
    const tail = Buffer.alloc(tailSize);
    await handle.read(tail, 0, tailSize, size - tailSize);
    let eocd = -1;
    for (let offset = tail.length - 22; offset >= 0; offset -= 1) {
      if (tail.readUInt32LE(offset) === EOCD) { eocd = offset; break; }
    }
    if (eocd < 0) throw new Error('ZIP end-of-central-directory was not found');
    const disk = tail.readUInt16LE(eocd + 4);
    const centralDisk = tail.readUInt16LE(eocd + 6);
    const count = tail.readUInt16LE(eocd + 10);
    const centralSize = tail.readUInt32LE(eocd + 12);
    const centralOffset = tail.readUInt32LE(eocd + 16);
    if (disk || centralDisk || count === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) throw new Error('Multi-disk and ZIP64 archives are not supported');
    if (centralOffset + centralSize > size) throw new Error('ZIP central directory exceeds configured limits');
    const central = Buffer.alloc(centralSize);
    if (centralSize) await handle.read(central, 0, centralSize, centralOffset);
    return parseCentral(central, count, options);
  } finally {
    await handle.close();
  }
}

export async function extractZipFile(filePath, destination, options = {}) {
  const entries = await listZipFile(filePath, options);
  const handle = await open(filePath, 'r');
  const base = path.resolve(destination);
  await mkdir(base, { recursive: true });
  try {
    for (const entry of entries) {
      const mapped = options.mapName ? options.mapName(entry.name) : entry.name;
      if (mapped == null || mapped === '') continue;
      const target = path.resolve(base, ...String(mapped).split('/').filter(Boolean));
      if (target !== base && !target.startsWith(`${base}${path.sep}`)) throw new Error(`ZIP entry escaped destination: ${entry.name}`);
      if (entry.directory) {
        await mkdir(target, { recursive: true });
        continue;
      }
      const header = Buffer.alloc(30);
      await handle.read(header, 0, 30, entry.localOffset);
      if (header.readUInt32LE(0) !== LOCAL) throw new Error(`Invalid local ZIP header: ${entry.name}`);
      const nameLength = header.readUInt16LE(26);
      const extraLength = header.readUInt16LE(28);
      const start = entry.localOffset + 30 + nameLength + extraLength;
      const compressed = Buffer.alloc(entry.compressedSize);
      if (entry.compressedSize) await handle.read(compressed, 0, entry.compressedSize, start);
      const content = entry.method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: entry.size });
      if (content.length !== entry.size || crc32(content) !== entry.expectedCrc) throw new Error(`ZIP integrity check failed: ${entry.name}`);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content, { flag: options.overwrite ? 'w' : 'wx' });
    }
  } finally {
    await handle.close();
  }
  return entries;
}
