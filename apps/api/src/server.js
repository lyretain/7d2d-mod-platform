import { createServer } from 'node:http';
import path from 'node:path';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
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
  requireReview: config.requireReview
});

const server = createServer(wrapHandler(app, {
  metrics,
  forceHttps: config.forceHttps,
  securityHeaders: (req) => securityHeaders(req, { forceHttps: config.forceHttps, adminHost: config.adminHost })
}));
server.requestTimeout = 10 * 60 * 1000;
server.headersTimeout = 30_000;
server.listen(config.port, config.host, () => console.log(`7DTD Mod Platform listening at ${config.publicBaseUrl}`));

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
