export async function notify(url, payload) {
  if (!url) return { skipped: true };
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source: '7dtd-mod-platform', ...payload }),
    signal: AbortSignal.timeout(10_000)
  });
  return { ok: response.ok, status: response.status };
}
