import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createMetrics, wrapHandler } from './observe.js';
import { createObjectStore } from './objects.js';
import { securityHeaders } from './security.js';
import { SigningService } from './signing.js';
import { createStore } from './store-pg.js';

const config = loadConfig();
if (!config.adminToken || config.adminToken.length < 16) {
  console.error('ADMIN_TOKEN must be set and contain at least 16 characters');
  process.exit(1);
}

const dataDir = path.resolve(config.dataDir);
const logger = createLogger({
  logDir: path.join(dataDir, 'logs'),
  retentionDays: config.logRetentionDays
});
await logger.prune();
const store = await createStore({ dataDir, databaseUrl: config.databaseUrl });
const objects = createObjectStore({ dataDir, s3: config.s3, cdnBaseUrl: config.cdnBaseUrl, publicBaseUrl: config.publicBaseUrl, cdnStyle: config.cdnStyle });
const signing = new SigningService({
  dataDir,
  privateKeyBase64: config.signingPrivateKey,
  signingServiceUrl: config.signingServiceUrl,
  signingServiceToken: config.signingServiceToken,
  production: config.production,
  ttlDays: config.manifestTtlDays
});
await signing.init();
const metrics = createMetrics();

const app = createApp({
  store,
  signing,
  dataDir,
  adminToken: config.adminToken,
  allowBootstrapAdmin: config.allowBootstrapAdmin,
  bootstrapDisabled: config.bootstrapDisabled,
  publicBaseUrl: config.publicBaseUrl,
  launcherUrl: config.launcherUrl,
  cdnBaseUrl: config.cdnBaseUrl,
  maxArtifactBytes: config.maxArtifactBytes,
  maxDiagnosticBytes: config.maxDiagnosticBytes,
  objects,
  metrics,
  config,
  requireReview: config.requireReview,
  logger
});

const server = createServer(wrapHandler(app, {
  metrics,
  forceHttps: config.forceHttps,
  trustedProxy: config.trustedProxy,
  logger,
  securityHeaders: (req) => securityHeaders(req, { forceHttps: config.forceHttps, adminHost: config.adminHost })
}));
server.requestTimeout = 10 * 60 * 1000;
server.headersTimeout = 30_000;
const spaIndex = path.resolve(fileURLToPath(new URL('../../web/dist/index.html', import.meta.url)));
const localUi = `http://127.0.0.1:${config.port}`;

function openBrowser(url) {
  const command = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  execFile(command, args, { windowsHide: true }, (error) => {
    if (error) logger.error('open-browser', { error: error.message, url });
  });
}

server.listen(config.port, config.host, () => {
  const vueUi = existsSync(spaIndex);
  logger.info('listening', {
    url: config.publicBaseUrl,
    host: config.host,
    port: config.port,
    webUi: vueUi ? 'vue' : 'legacy',
    open: localUi
  });
  if (!vueUi) logger.info('web-ui-fallback', { hint: 'run npm run build:web to serve the Vue console at /' });
  if (process.env.OPEN_BROWSER === '1') openBrowser(localUi);
});

process.on('uncaughtException', (error) => {
  logger.error('uncaughtException', { error: error.message, stack: error.stack });
});
process.on('unhandledRejection', (reason) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  logger.error('unhandledRejection', { error: error.message, stack: error.stack });
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    logger.info('shutdown', { signal });
    server.close(() => process.exit(0));
  });
}
