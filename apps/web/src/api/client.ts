import { sha256File } from '../lib/sha256';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export type UploadProgress = {
  phase: 'hash' | 'upload' | 'analyze';
  loaded: number;
  total: number;
};

type UploadSession = {
  uploadId: string;
  chunkSize: number;
  totalChunks: number;
  received?: number[];
  missing?: number[];
  receivedBytes?: number;
  size?: number;
};

/** Keep each request well under Cloudflare's 100 MiB upload cap. */
export const ARTIFACT_CHUNK_BYTES = 8 * 1024 * 1024;
const UPLOAD_CONCURRENCY = 3;
const CHUNK_RETRIES = 3;

function token() {
  return localStorage.getItem('modPlatformToken') || '';
}

function uploadStorageKey(sha: string, size: number, chunkSize: number) {
  return `hordepin.artifactUpload.${sha}.${size}.${chunkSize}`;
}

function throwIfFailed(status: number, body: any) {
  if (status >= 200 && status < 300) return;
  throw new ApiError(body?.error?.message || `HTTP ${status}`, status);
}

function retryable(error: unknown) {
  if (!(error instanceof ApiError)) return true;
  return error.status === 0 || error.status === 429 || error.status >= 500;
}

async function withRetry<T>(run: () => Promise<T>) {
  let last: unknown;
  for (let attempt = 0; attempt < CHUNK_RETRIES; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      last = error;
      if (!retryable(error) || attempt === CHUNK_RETRIES - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    }
  }
  throw last;
}

export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (token()) headers.set('authorization', `Bearer ${token()}`);
  if (options.body && !(options.body instanceof ArrayBuffer) && !(options.body instanceof Blob) && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  const response = await fetch(path, { ...options, headers });
  let body: any = {};
  try { body = await response.json(); } catch { /* empty */ }
  if (!response.ok) throw new ApiError(body.error?.message || `HTTP ${response.status}`, response.status);
  return body as T;
}

function putBlob(url: string, blob: Blob, extraHeaders: Record<string, string>, onProgress?: (loaded: number) => void) {
  return new Promise<any>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.responseType = 'text';
    if (token()) xhr.setRequestHeader('authorization', `Bearer ${token()}`);
    for (const [key, value] of Object.entries(extraHeaders)) xhr.setRequestHeader(key, value);
    xhr.upload.onprogress = (event) => {
      onProgress?.(event.lengthComputable ? event.loaded : 0);
    };
    xhr.onload = () => {
      let body: any = {};
      try { body = JSON.parse(xhr.responseText || '{}'); } catch { /* empty */ }
      try {
        throwIfFailed(xhr.status, body);
        resolve(body);
      } catch (error) {
        reject(error);
      }
    };
    xhr.onerror = () => reject(new ApiError('Upload failed', 0));
    xhr.onabort = () => reject(new ApiError('Upload cancelled', 0));
    xhr.send(blob);
  });
}

async function putWhole(sha: string, file: File, onProgress?: (progress: UploadProgress) => void) {
  onProgress?.({ phase: 'upload', loaded: 0, total: file.size });
  return putBlob(
    `/api/v1/artifacts/${sha}`,
    file,
    { 'content-type': 'application/zip', 'x-file-name': encodeURIComponent(file.name) },
    (loaded) => onProgress?.({ phase: 'upload', loaded, total: file.size })
  );
}

async function loadSession(sha: string, file: File): Promise<UploadSession> {
  const key = uploadStorageKey(sha, file.size, ARTIFACT_CHUNK_BYTES);
  const savedId = localStorage.getItem(key);
  if (savedId) {
    try {
      const existing = await api<UploadSession>(`/api/v1/artifacts/${sha}/uploads/${savedId}`);
      if (existing.chunkSize === ARTIFACT_CHUNK_BYTES && existing.size === file.size) return existing;
    } catch {
      localStorage.removeItem(key);
    }
  }
  const session = await api<UploadSession>(`/api/v1/artifacts/${sha}/uploads`, {
    method: 'POST',
    body: JSON.stringify({ size: file.size, chunkSize: ARTIFACT_CHUNK_BYTES, fileName: file.name })
  });
  localStorage.setItem(key, session.uploadId);
  return session;
}

async function putChunked(sha: string, file: File, onProgress?: (progress: UploadProgress) => void) {
  const key = uploadStorageKey(sha, file.size, ARTIFACT_CHUNK_BYTES);
  const session = await loadSession(sha, file);
  const chunkSize = session.chunkSize || ARTIFACT_CHUNK_BYTES;
  const received = new Array(session.totalChunks).fill(0);
  const done = new Set(session.received || []);
  for (const index of done) {
    const start = index * chunkSize;
    received[index] = Math.min(start + chunkSize, file.size) - start;
  }
  const report = () => {
    onProgress?.({ phase: 'upload', loaded: received.reduce((sum, value) => sum + value, 0), total: file.size });
  };
  report();
  const pending = session.missing?.length
    ? [...session.missing]
    : Array.from({ length: session.totalChunks }, (_, index) => index).filter((index) => !done.has(index));
  let cursor = 0;
  async function worker() {
    while (cursor < pending.length) {
      const index = pending[cursor];
      cursor += 1;
      const start = index * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      await withRetry(() => putBlob(
        `/api/v1/artifacts/${sha}/uploads/${session.uploadId}/${index}`,
        file.slice(start, end),
        { 'content-type': 'application/octet-stream' },
        (loaded) => {
          received[index] = loaded;
          report();
        }
      ));
      received[index] = end - start;
      report();
    }
  }
  await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, Math.max(pending.length, 1)) }, () => worker()));
  try {
    const result = await api(`/api/v1/artifacts/${sha}/uploads/${session.uploadId}/complete`, { method: 'POST' });
    localStorage.removeItem(key);
    return result;
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 422 && /SHA-256/.test(error.message))) {
      localStorage.removeItem(key);
    }
    throw error;
  }
}

export async function uploadZip(sha: string, file: File, onProgress?: (progress: UploadProgress) => void) {
  if (file.size > ARTIFACT_CHUNK_BYTES) return putChunked(sha, file, onProgress);
  return putWhole(sha, file, onProgress);
}

export async function hashAndUploadZip(file: File, onProgress?: (progress: UploadProgress) => void) {
  const hash = await sha256File(file, (loaded, total) => onProgress?.({ phase: 'hash', loaded, total }));
  onProgress?.({ phase: 'upload', loaded: 0, total: file.size });
  const result = await uploadZip(hash, file, onProgress);
  onProgress?.({ phase: 'analyze', loaded: 1, total: 1 });
  return { hash, ...result };
}

export function friendlyError(message: string) {
  if (/Artifact must be reviewed and have a confirmed redistribution license/i.test(message)) return tSafe('mod.errLicense', message);
  if (/is not approved for redistribution/i.test(message)) return tSafe('mod.errRedistrib', message);
  if (/You must be 18 or older/i.test(message)) return tSafe('r18.underage', message);
  if (/Enter a valid birth year/i.test(message)) return tSafe('r18.badYear', message);
  if (/Adult confirmation is required/i.test(message)) return tSafe('r18.needConfirm', message);
  return message;
}

function tSafe(key: string, fallback: string) {
  return window.I18N?.t(key) || fallback;
}
