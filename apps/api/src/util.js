import { createHash, randomUUID } from 'node:crypto';

export function json(res, status, body, extraHeaders = {}) {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': payload.length,
    'cache-control': 'no-store',
    ...extraHeaders
  });
  res.end(payload);
}

export function problem(res, status, code, message, details) {
  json(res, status, { error: { code, message, ...(details ? { details } : {}) } });
}

export async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      const error = new Error('Request body is too large');
      error.code = 'BODY_TOO_LARGE';
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function readJson(req, limit = 1024 * 1024) {
  const body = await readBody(req, limit);
  if (!body.length) return {};
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    const error = new Error('Body must be valid JSON');
    error.code = 'INVALID_JSON';
    throw error;
  }
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

export function id(prefix) {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`;
}

export function now() {
  return new Date().toISOString();
}

export function isSafeId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,127}$/.test(value);
}

export function decodeHeaderFileName(value, fallback = 'upload.zip') {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function bearer(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

export function requireFields(body, fields) {
  const missing = fields.filter((field) => body[field] === undefined || body[field] === '');
  if (missing.length) {
    const error = new Error(`Missing fields: ${missing.join(', ')}`);
    error.code = 'VALIDATION';
    error.details = { missing };
    throw error;
  }
}
