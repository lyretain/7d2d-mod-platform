import { randomUUID } from 'node:crypto';
import { logLine as defaultLogLine, redactPath } from './logger.js';

export function createMetrics() {
  const state = {
    requests: 0,
    errors: 0,
    bytesOut: 0,
    latencyMs: [],
    register: 0,
    loginFail: 0,
    invites: 0,
    syncOk: 0,
    syncFail: 0,
    crashes: 0
  };

  function observe(field, value = 1) {
    state[field] = (state[field] || 0) + value;
  }

  function request(durationMs, status, bytes) {
    state.requests += 1;
    if (status >= 500) state.errors += 1;
    state.bytesOut += bytes || 0;
    state.latencyMs.push(durationMs);
    if (state.latencyMs.length > 2000) state.latencyMs.splice(0, state.latencyMs.length - 2000);
  }

  function snapshot() {
    const sorted = [...state.latencyMs].sort((a, b) => a - b);
    const pct = (p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0;
    return {
      requests: state.requests,
      errors: state.errors,
      errorRate: state.requests ? state.errors / state.requests : 0,
      bytesOut: state.bytesOut,
      latencyMs: { p50: pct(0.5), p95: pct(0.95) },
      register: state.register,
      loginFail: state.loginFail,
      invites: state.invites,
      syncOk: state.syncOk,
      syncFail: state.syncFail,
      crashRate: (state.syncOk + state.crashes) ? state.crashes / (state.syncOk + state.crashes) : 0
    };
  }

  return { observe, request, snapshot };
}

export { logLine } from './logger.js';

function clientIp(req, trustedProxy) {
  if (trustedProxy) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (forwarded) return forwarded;
  }
  return req.socket?.remoteAddress || '';
}

export function wrapHandler(handler, { metrics, forceHttps, securityHeaders, logger, trustedProxy = false }) {
  const writeLog = logger?.write || defaultLogLine;
  return async function wrapped(req, res) {
    const traceId = req.headers['x-request-id'] || randomUUID();
    const started = Date.now();
    if (forceHttps && req.headers['x-forwarded-proto'] && req.headers['x-forwarded-proto'] !== 'https') {
      res.writeHead(308, { location: `https://${req.headers.host}${req.url}`, ...securityHeaders(req) });
      return res.end();
    }
    const originalWriteHead = res.writeHead.bind(res);
    res.writeHead = (status, headers = {}) => originalWriteHead(status, { 'x-request-id': traceId, ...securityHeaders(req), ...headers });
    const originalEnd = res.end.bind(res);
    let bytes = 0;
    res.end = (chunk, encoding) => {
      if (chunk) bytes += Buffer.byteLength(chunk, encoding);
      metrics.request(Date.now() - started, res.statusCode || 200, bytes);
      Promise.resolve(writeLog({
        level: 'info',
        type: 'http',
        traceId,
        method: req.method,
        path: redactPath(req.url),
        status: res.statusCode || 200,
        ms: Date.now() - started,
        ip: clientIp(req, trustedProxy)
      })).catch(() => {});
      return originalEnd(chunk, encoding);
    };
    return handler(req, res);
  };
}
