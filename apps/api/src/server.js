import { createServer } from 'node:http';
import path from 'node:path';
import { createApp } from './app.js';
import { SigningService } from './signing.js';
import { JsonStore } from './store.js';

const dataDir = path.resolve(process.env.DATA_DIR || './data');
const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || 8080);
const publicBaseUrl = process.env.PUBLIC_BASE_URL || `http://localhost:${port}`;
const adminToken = process.env.ADMIN_TOKEN;

if (!adminToken || adminToken.length < 16) {
  console.error('ADMIN_TOKEN must be set and contain at least 16 characters');
  process.exit(1);
}

const store = new JsonStore(path.join(dataDir, 'state', 'database.json'));
const signing = new SigningService({ dataDir, privateKeyBase64: process.env.SIGNING_PRIVATE_KEY });
await Promise.all([store.init(), signing.init()]);

const app = createApp({
  store,
  signing,
  dataDir,
  adminToken,
  allowBootstrapAdmin: process.env.ALLOW_BOOTSTRAP_ADMIN === 'true',
  publicBaseUrl,
  maxArtifactBytes: Number(process.env.MAX_ARTIFACT_BYTES || 2_147_483_648),
  maxDiagnosticBytes: Number(process.env.MAX_DIAGNOSTIC_BYTES || 262_144)
});

const server = createServer(app);
server.requestTimeout = 10 * 60 * 1000;
server.headersTimeout = 30_000;
server.listen(port, host, () => console.log(`7DTD Mod Platform listening at ${publicBaseUrl}`));

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
