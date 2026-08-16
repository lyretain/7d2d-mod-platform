export function artifactPublicUrl(sha, config = {}, fallbackBase = '') {
  const cdn = String(config.cdnBaseUrl || fallbackBase || '').replace(/\/$/, '');
  const style = config.cdnStyle || 'origin';
  if (style === 'r2') {
    const prefix = String(config.s3?.prefix || 'objects/').replace(/^\/+|\/+$/g, '');
    return `${cdn}/${prefix}/${sha}`;
  }
  return `${cdn}/api/v1/public/artifacts/${sha}`;
}

export function manifestPublicUrl(packId, config = {}, fallbackBase = '') {
  const origin = String(config.publicBaseUrl || fallbackBase || '').replace(/\/$/, '');
  return `${origin}/api/v1/public/packs/${encodeURIComponent(packId)}/latest`;
}

export function cloudflareCacheHeaders(kind) {
  if (kind === 'artifact') {
    return {
      'cache-control': 'public, max-age=31536000, immutable',
      'cdn-cache-control': 'public, max-age=31536000',
      'accept-ranges': 'bytes'
    };
  }
  if (kind === 'manifest') {
    return {
      'cache-control': 'public, max-age=30',
      'cdn-cache-control': 'public, max-age=30'
    };
  }
  return { 'cache-control': 'no-store', 'cdn-cache-control': 'no-store' };
}

export async function purgeCloudflare(config, urls) {
  const files = [...new Set((urls || []).filter(Boolean))];
  if (!config.cloudflareZoneId || !config.cloudflareToken || !files.length) return { skipped: true, files };
  const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${config.cloudflareZoneId}/purge_cache`, {
    method: 'POST',
    headers: { authorization: `Bearer ${config.cloudflareToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ files }),
    signal: AbortSignal.timeout(10_000)
  });
  const body = await response.json().catch(() => ({}));
  return { ok: response.ok && body.success !== false, status: response.status, files, errors: body.errors || [] };
}
