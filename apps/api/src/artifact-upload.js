import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import path from 'node:path';
import { Transform } from 'node:stream';
import { finished, pipeline } from 'node:stream/promises';
import { id, isSafeId } from './util.js';

export const DEFAULT_CHUNK_BYTES = 8 * 1024 * 1024;
export const MIN_CHUNK_BYTES = 256 * 1024;
export const MAX_CHUNK_BYTES = 32 * 1024 * 1024;
export const MAX_CHUNKS = 8192;
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function fail(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

export function normalizeChunkSize(value, fallback = DEFAULT_CHUNK_BYTES) {
  const chunkSize = Number(value == null || value === '' ? fallback : value);
  if (!Number.isInteger(chunkSize) || chunkSize < MIN_CHUNK_BYTES || chunkSize > MAX_CHUNK_BYTES) {
    throw fail('VALIDATION', `chunkSize must be an integer between ${MIN_CHUNK_BYTES} and ${MAX_CHUNK_BYTES}`);
  }
  return chunkSize;
}

export function totalChunks(size, chunkSize) {
  if (size <= 0) return 1;
  return Math.ceil(size / chunkSize);
}

export function chunkByteLength(size, chunkSize, index) {
  if (size <= 0) return index === 0 ? 0 : 0;
  const start = index * chunkSize;
  if (start >= size) return 0;
  return Math.min(chunkSize, size - start);
}

export async function receiveExactBytes(req, target, expectedSize, hardLimit) {
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  let size = 0;
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      size += chunk.length;
      if (size > expectedSize || size > hardLimit) {
        return callback(Object.assign(new Error('Request body is too large'), { code: 'BODY_TOO_LARGE' }));
      }
      callback(null, chunk);
    }
  });
  try {
    await mkdir(path.dirname(target), { recursive: true });
    await pipeline(req, meter, createWriteStream(temporary, { flags: 'w' }));
    if (size !== expectedSize) {
      throw fail('VALIDATION', `Chunk length ${size} does not match expected ${expectedSize}`);
    }
    await rename(temporary, target);
    return { size };
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

export function createChunkUploadStore({ dataDir, maxArtifactBytes, ttlMs = SESSION_TTL_MS }) {
  const root = path.join(dataDir, 'uploads');

  async function readMeta(sessionId) {
    try {
      return JSON.parse(await readFile(path.join(root, sessionId, 'meta.json'), 'utf8'));
    } catch {
      return null;
    }
  }

  async function writeMeta(session) {
    await mkdir(path.join(root, session.id), { recursive: true });
    await writeFile(path.join(root, session.id, 'meta.json'), `${JSON.stringify(session, null, 2)}\n`);
  }

  async function removeSession(sessionId) {
    await rm(path.join(root, sessionId), { recursive: true, force: true });
  }

  function expired(session) {
    return Date.parse(session.expiresAt) <= Date.now();
  }

  async function requireSession(sessionId, sha256) {
    if (!isSafeId(sessionId)) throw fail('NOT_FOUND', 'Upload session was not found');
    const session = await readMeta(sessionId);
    if (!session) throw fail('NOT_FOUND', 'Upload session was not found');
    if (expired(session)) {
      await removeSession(sessionId);
      throw fail('NOT_FOUND', 'Upload session expired');
    }
    if (session.sha256 !== sha256) throw fail('VALIDATION', 'Upload session does not match artifact hash');
    return session;
  }

  async function listReceived(session) {
    let names = [];
    try { names = await readdir(path.join(root, session.id)); }
    catch { return []; }
    const received = [];
    for (const name of names) {
      if (!/^\d+$/.test(name)) continue;
      const index = Number(name);
      const expected = chunkByteLength(session.size, session.chunkSize, index);
      try {
        const info = await stat(path.join(root, session.id, name));
        if (info.size === expected) received.push(index);
      } catch { /* skip incomplete */ }
    }
    return received.sort((a, b) => a - b);
  }

  async function sessionView(session) {
    const received = await listReceived(session);
    const receivedSet = new Set(received);
    const missing = [];
    let receivedBytes = 0;
    for (let index = 0; index < session.totalChunks; index += 1) {
      const length = chunkByteLength(session.size, session.chunkSize, index);
      if (receivedSet.has(index)) receivedBytes += length;
      else missing.push(index);
    }
    return {
      uploadId: session.id,
      sha256: session.sha256,
      size: session.size,
      chunkSize: session.chunkSize,
      totalChunks: session.totalChunks,
      fileName: session.fileName,
      expiresAt: session.expiresAt,
      received,
      missing,
      receivedBytes
    };
  }

  async function touch(session) {
    session.expiresAt = new Date(Date.now() + ttlMs).toISOString();
    await writeMeta(session);
    return session;
  }

  async function findReusable({ sha256, size, chunkSize }) {
    let names = [];
    try { names = await readdir(root); }
    catch { return null; }
    for (const name of names) {
      const session = await readMeta(name);
      if (!session) continue;
      if (expired(session)) {
        await removeSession(session.id);
        continue;
      }
      if (session.sha256 === sha256 && session.size === size && session.chunkSize === chunkSize) return session;
    }
    return null;
  }

  return {
    root,
    sessionView,
    async create({ sha256, size, chunkSize, fileName }) {
      const bytes = Number(size);
      if (!Number.isInteger(bytes) || bytes < 0) {
        throw fail('VALIDATION', 'size must be a non-negative integer');
      }
      if (bytes > maxArtifactBytes) {
        throw fail('BODY_TOO_LARGE', 'Request body is too large');
      }
      const chunk = normalizeChunkSize(chunkSize);
      const chunks = totalChunks(bytes, chunk);
      if (chunks > MAX_CHUNKS) {
        throw fail('VALIDATION', `Too many chunks (${chunks}); increase chunkSize`);
      }
      const existing = await findReusable({ sha256, size: bytes, chunkSize: chunk });
      if (existing) {
        if (fileName && fileName !== 'upload.zip') existing.fileName = fileName;
        await touch(existing);
        return existing;
      }
      const session = {
        id: id('up'),
        sha256,
        size: bytes,
        chunkSize: chunk,
        totalChunks: chunks,
        fileName: fileName || 'upload.zip',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + ttlMs).toISOString()
      };
      await writeMeta(session);
      return session;
    },
    async get(sessionId, sha256) {
      return touch(await requireSession(sessionId, sha256));
    },
    async hasChunk(session, index, expectedSize) {
      try {
        const info = await stat(path.join(root, session.id, String(index)));
        return info.size === expectedSize;
      } catch {
        return false;
      }
    },
    chunkPath(sessionId, index) {
      return path.join(root, sessionId, String(index));
    },
    expectedChunkLength(session, index) {
      if (!Number.isInteger(index) || index < 0 || index >= session.totalChunks) {
        throw fail('VALIDATION', `Chunk index must be between 0 and ${session.totalChunks - 1}`);
      }
      return chunkByteLength(session.size, session.chunkSize, index);
    },
    async assemble(session, target) {
      const temporary = `${target}.${process.pid}.${Date.now()}.part`;
      const hash = createHash('sha256');
      const out = createWriteStream(temporary, { flags: 'wx' });
      try {
        await mkdir(path.dirname(target), { recursive: true });
        for (let index = 0; index < session.totalChunks; index += 1) {
          const expected = chunkByteLength(session.size, session.chunkSize, index);
          const chunkPath = path.join(root, session.id, String(index));
          let info;
          try { info = await stat(chunkPath); }
          catch {
            throw fail('VALIDATION', `Missing chunk ${index}`);
          }
          if (info.size !== expected) {
            throw fail('VALIDATION', `Chunk ${index} length ${info.size} does not match expected ${expected}`);
          }
          const stream = createReadStream(chunkPath);
          for await (const piece of stream) {
            hash.update(piece);
            if (!out.write(piece)) await once(out, 'drain');
          }
        }
        out.end();
        await finished(out);
        const actual = hash.digest('hex');
        if (actual !== session.sha256) {
          throw fail('HASH_MISMATCH', 'Artifact SHA-256 does not match URL', { expected: session.sha256, actual });
        }
        try { await rename(temporary, target); }
        catch (error) {
          if (error.code !== 'EEXIST') throw error;
          await unlink(temporary);
        }
        await removeSession(session.id);
        return { size: session.size, actual };
      } catch (error) {
        out.destroy();
        await unlink(temporary).catch(() => {});
        throw error;
      }
    },
    async cleanup(sessionId) {
      await removeSession(sessionId);
    }
  };
}
