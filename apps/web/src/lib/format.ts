export function prettyBytes(n: number) {
  n = Number(n) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

export function fmt(key: string, value: unknown, yes: string, no: string) {
  if (value == null || value === '') return '—';
  if (typeof value === 'boolean') return value ? yes : no;
  if (key === 'bytes' || key === 'artifactSize' || key === 'size') return prettyBytes(Number(value));
  if (/At$/.test(key) || key === 'createdAt' || key === 'expiresAt') return String(value).replace('T', ' ').slice(0, 19);
  if ((key === 'sha256' || key === 'artifactSha' || key === 'hash') && String(value).length > 16) return `${String(value).slice(0, 10)}…`;
  if (key === 'crashRate' && typeof value === 'number') return `${(value * 100).toFixed(1)}%`;
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export async function sha256Hex(buffer: ArrayBuffer) {
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))];
  return hash.map((x) => x.toString(16).padStart(2, '0')).join('');
}
