const BLOCKED_UA = /sqlmap|nikto|nessus|masscan|dirbuster/i;
const BLOCKED_PATH = /\.(php|asp|aspx)$|\/wp-admin|\/\.git|\/\.env/i;

export function clientIp(req, trustedProxy) {
  if (trustedProxy) {
    const cf = String(req.headers['cf-connecting-ip'] || '').trim();
    if (cf) return cf;
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (forwarded) return forwarded;
  }
  return req.socket?.remoteAddress || 'unknown';
}

export function securityHeaders(req, { forceHttps = false, adminHost = '' } = {}) {
  const headers = {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'geolocation=(), microphone=(), camera=()',
    'content-security-policy': "default-src 'none'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://static.cloudflareinsights.com; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; frame-ancestors 'none'"
  };
  if (forceHttps) headers['strict-transport-security'] = 'max-age=31536000; includeSubDomains';
  if (adminHost && req.headers.host && req.headers.host.split(':')[0] !== adminHost && (req.url === '/' || req.url.startsWith('/api/v1/admin') || req.url.startsWith('/api/v1/auth') || req.url.startsWith('/api/v1/invites'))) {
    headers['x-admin-host-required'] = adminHost;
  }
  return headers;
}

export function inspectRequest(req, { trustedProxy = false } = {}) {
  const path = req.url || '/';
  if (BLOCKED_PATH.test(path) || BLOCKED_UA.test(String(req.headers['user-agent'] || ''))) {
    return { blocked: true, reason: 'WAF_RULE' };
  }
  const origin = req.headers.origin;
  if (origin && req.method !== 'GET' && req.method !== 'HEAD' && !req.headers.authorization) {
    try {
      if (new URL(origin).host !== req.headers.host) return { blocked: true, reason: 'CSRF' };
    } catch {
      return { blocked: true, reason: 'CSRF' };
    }
  }
  return { blocked: false, ip: clientIp(req, trustedProxy) };
}

export async function consumeRateLimit(store, { key, limit, windowMs }) {
  const now = Date.now();
  return store.mutate((draft) => {
    draft.rateLimits = draft.rateLimits || {};
    const current = draft.rateLimits[key];
    if (!current || now - Date.parse(current.startedAt) > windowMs) {
      draft.rateLimits[key] = { count: 1, startedAt: new Date(now).toISOString() };
      return true;
    }
    current.count += 1;
    return current.count <= limit;
  });
}

export function routeLimit(pathname, method) {
  if (method === 'POST' && pathname === '/api/v1/auth/login') return { key: 'login', limit: 40, windowMs: 15 * 60_000 };
  if (method === 'POST' && pathname === '/api/v1/auth/register') return { key: 'register', limit: 40, windowMs: 60 * 60_000 };
  if (method === 'POST' && pathname === '/api/v1/invites') return { key: 'invite', limit: 30, windowMs: 60 * 60_000 };
  if (method === 'POST' && pathname === '/api/v1/diagnostics') return { key: 'diagnostics', limit: 60, windowMs: 60_000 };
  if (method === 'GET' && pathname.startsWith('/api/v1/public/artifacts/')) return { key: 'download', limit: 120, windowMs: 60_000 };
  return null;
}
