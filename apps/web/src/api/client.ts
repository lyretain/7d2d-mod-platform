export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

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

export async function uploadZip(sha: string, file: File) {
  const bytes = await file.arrayBuffer();
  return api<{ size: number; review?: { status?: string; analysis?: any } }>(`/api/v1/artifacts/${sha}`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${token()}`,
      'content-type': 'application/zip',
      'x-file-name': encodeURIComponent(file.name)
    },
    body: bytes
  });
}

export function friendlyError(message: string) {
  if (/Artifact must be reviewed and have a confirmed redistribution license/i.test(message)) return tSafe('mod.errLicense', message);
  if (/is not approved for redistribution/i.test(message)) return tSafe('mod.errRedistrib', message);
  return message;
}

function tSafe(key: string, fallback: string) {
  return window.I18N?.t(key) || fallback;
}
