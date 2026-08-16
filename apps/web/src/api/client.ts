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

function token() {
  return localStorage.getItem('modPlatformToken') || '';
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

export async function uploadZip(sha: string, file: File, onProgress?: (progress: UploadProgress) => void) {
  return new Promise<{ size: number; review?: { status?: string; analysis?: any } }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `/api/v1/artifacts/${sha}`);
    xhr.responseType = 'text';
    if (token()) xhr.setRequestHeader('authorization', `Bearer ${token()}`);
    xhr.setRequestHeader('content-type', 'application/zip');
    xhr.setRequestHeader('x-file-name', encodeURIComponent(file.name));
    xhr.upload.onprogress = (event) => {
      const total = event.lengthComputable ? event.total : file.size;
      onProgress?.({ phase: 'upload', loaded: event.loaded, total: total || file.size });
    };
    xhr.onload = () => {
      let body: any = {};
      try { body = JSON.parse(xhr.responseText || '{}'); } catch { /* empty */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new ApiError(body.error?.message || `HTTP ${xhr.status}`, xhr.status));
    };
    xhr.onerror = () => reject(new ApiError('Upload failed', 0));
    xhr.onabort = () => reject(new ApiError('Upload cancelled', 0));
    onProgress?.({ phase: 'upload', loaded: 0, total: file.size });
    xhr.send(file);
  });
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
  return message;
}

function tSafe(key: string, fallback: string) {
  return window.I18N?.t(key) || fallback;
}
