import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { prepareDiagnostic } from './diagnostics.js';
import { createAuthService } from './auth.js';
import { activeRelease, handshakePolicy, normalizeInstallSide, recordAudit, releaseDiff } from './protocol.js';
import { bearer, decodeHeaderFileName, id, isSafeId, json, now, problem, readJson, requireFields } from './util.js';
import { analyzeZipFile, scanFile } from './analyze.js';
import { ingestDiagnostic, shouldBlockInstalls } from './compatibility.js';
import { handleP1 } from './p1-routes.js';
import { consumeRateLimit, inspectRequest, routeLimit, securityHeaders } from './security.js';
import { notify } from './alerts.js';
import { assignmentAcceptingPlayers, expandPackEntries, listModContents, migrateSlotContents, normalizeContentSlots, normalizeDependsOn, normalizeEntryContents, overlaysForPackEntry, pluginServerConfig, purgeContentRefs, recordDownload, requireConfirm } from './catalog.js';
import { gameVersionMatches } from './game-version.js';
import { artifactPublicUrl, cloudflareCacheHeaders, manifestPublicUrl, purgeCloudflare } from './cloudflare.js';
import { can, canViewAdult, denyReason, describePrincipal } from './roles.js';
import { exchangeGithubCode, githubAuthorizeUrl } from './github.js';
import { renderUserGuide } from './guide.js';
import { claimHandshake, normalizePlayerIds, sanitizeHello, storeHandshake } from './handshakes.js';
import { applyAddresses, parseAddresses, publicAddressView, resolveRegisteredServer } from './servers.js';
import { currentLauncher, launcherArtifactUrl, launcherManifestPayload, normalizePlatform, validateLauncherZip } from './launcher-update.js';
import { createChunkUploadStore, DEFAULT_CHUNK_BYTES, receiveExactBytes } from './artifact-upload.js';

const ADMIN_HTML_V2 = readFileSync(new URL('./admin.html', import.meta.url), 'utf8');
const WEB_DIST = path.resolve(fileURLToPath(new URL('../../web/dist/', import.meta.url)));

function spaIndexPath() {
  return path.join(WEB_DIST, 'index.html');
}

function spaAvailable() {
  return existsSync(spaIndexPath());
}

function mimeFor(filePath) {
  return {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.map': 'application/json'
  }[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function sendHtml(res, html) {
  const body = Buffer.isBuffer(html) ? html : Buffer.from(html);
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': body.length, 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
  return res.end(body);
}

function sendWebFile(res, relPath) {
  const target = path.resolve(WEB_DIST, relPath);
  const relative = path.relative(WEB_DIST, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return false;
  if (!existsSync(target) || !statSync(target).isFile()) return false;
  const body = readFileSync(target);
  const cache = relative.startsWith(`assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache';
  res.writeHead(200, { 'content-type': mimeFor(target), 'content-length': body.length, 'cache-control': cache, 'x-content-type-options': 'nosniff' });
  res.end(body);
  return true;
}

function isSpaReserved(pathname) {
  return pathname.startsWith('/api')
    || pathname.startsWith('/docs')
    || pathname === '/status'
    || pathname === '/health'
    || pathname.startsWith('/health/')
    || pathname === '/metrics'
    || pathname === '/guide'
    || pathname === '/admin-i18n.js'
    || pathname === '/legacy';
}

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

async function receiveArtifact(req, target, expectedHash, limit) {
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  const hash = createHash('sha256');
  let size = 0;
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      size += chunk.length;
      if (size > limit) return callback(Object.assign(new Error('Request body is too large'), { code: 'BODY_TOO_LARGE' }));
      hash.update(chunk);
      callback(null, chunk);
    }
  });
  try {
    await pipeline(req, meter, createWriteStream(temporary, { flags: 'wx' }));
    const actual = hash.digest('hex');
    if (actual !== expectedHash) throw Object.assign(new Error('Artifact SHA-256 does not match URL'), { code: 'HASH_MISMATCH', details: { expected: expectedHash, actual } });
    try { await rename(temporary, target); }
    catch (error) { if (error.code !== 'EEXIST') throw error; await unlink(temporary); }
    return { size, actual };
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

export function createApp({ store, signing, dataDir, adminToken, allowBootstrapAdmin = false, bootstrapDisabled = false, publicBaseUrl, launcherUrl, cdnBaseUrl, maxArtifactBytes = 2_147_483_648, maxDiagnosticBytes = 262_144, objects, metrics, config = {}, requireReview = false, logger }) {
  const objectDir = objects?.localDir || path.join(dataDir, 'objects');
  const chunkUploads = createChunkUploadStore({ dataDir, maxArtifactBytes });
  const auth = createAuthService({ store, bootstrapToken: adminToken, allowBootstrapAfterSetup: allowBootstrapAdmin, bootstrapDisabled });
  const artifactBase = (cdnBaseUrl || publicBaseUrl || '').replace(/\/$/, '');
  const metricsApi = metrics || { snapshot: () => ({}), observe() {} };

  function requirePerm(req, res, permission) {
    const user = auth.principal(req);
    const reason = denyReason(user, permission);
    if (!reason) return user;
    problem(res, user ? 403 : 401, user ? 'FORBIDDEN' : 'UNAUTHORIZED', reason === 'GitHub binding required' ? 'Community admins must bind GitHub first' : (user ? 'Insufficient role' : 'Login required'));
    return null;
  }

  function requireAdmin(req, res) {
    return Boolean(requirePerm(req, res, 'platform.manage'));
  }

  function requireUser(req, res) {
    const user = auth.principal(req);
    if (user) return user;
    problem(res, 401, 'UNAUTHORIZED', 'Login required');
    return null;
  }

  function auditActor(req) {
    const user = auth.principal(req);
    return user?.username || user?.id || 'unknown';
  }

  async function handler(req, res) {
    const url = new URL(req.url, publicBaseUrl);
    const pathname = decodeURIComponent(url.pathname);
    const originalWriteHead = res.writeHead.bind(res);
    res.writeHead = (status, headers = {}) => originalWriteHead(status, { ...securityHeaders(req, { forceHttps: config.forceHttps, adminHost: config.adminHost }), ...headers });
    try {
      const inspection = inspectRequest(req, { trustedProxy: config.trustedProxy, publicBaseUrl });
      if (inspection.blocked) return problem(res, 403, inspection.reason, 'Request blocked by security policy');
      if (config.adminHost && req.headers.host && req.headers.host.split(':')[0] !== config.adminHost && (pathname === '/' || pathname.startsWith('/api/v1/admin') || pathname.startsWith('/api/v1/users'))) {
        return problem(res, 404, 'NOT_FOUND', 'Route not found');
      }
      const limit = routeLimit(pathname, req.method);
      if (limit && !await consumeRateLimit(store, { key: `${limit.key}:${inspection.ip}`, limit: limit.limit, windowMs: limit.windowMs })) {
        return problem(res, 429, 'RATE_LIMITED', 'Too many requests');
      }
      if (await handleP1(req, res, { pathname, store, auth, signing, objects: objects || { localDir: objectDir, ready: async () => ({ ok: true, driver: 'local' }), listLocal: async () => [], remove: async () => {} }, metrics: metricsApi, config, requireReview })) return;
      if (req.method === 'GET' && pathname === '/admin-i18n.js') {
        const body = readFileSync(new URL('./admin-i18n.js', import.meta.url));
        res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
        return res.end(body);
      }
      if (req.method === 'GET' && pathname === '/legacy') {
        return sendHtml(res, ADMIN_HTML_V2);
      }
      if (req.method === 'GET' && pathname === '/') {
        if (spaAvailable()) return sendHtml(res, readFileSync(spaIndexPath()));
        return sendHtml(res, ADMIN_HTML_V2);
      }
      if (req.method === 'GET' && spaAvailable() && pathname.startsWith('/assets/')) {
        if (sendWebFile(res, pathname.slice(1))) return;
      }
      if (req.method === 'GET' && (pathname === '/guide' || pathname === '/docs/user')) {
        const lang = url.searchParams.get('lang') === 'en' ? 'en' : 'zh';
        const guideFile = lang === 'en' ? '../../../docs/USER.md' : '../../../docs/USER.zh-CN.md';
        const markdown = readFileSync(new URL(guideFile, import.meta.url), 'utf8');
        const body = Buffer.from(renderUserGuide(markdown, lang));
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': body.length, 'x-content-type-options': 'nosniff' });
        return res.end(body);
      }
      if (req.method === 'GET' && pathname === '/health') return json(res, 200, { status: 'ok', time: now() });
      if (req.method === 'GET' && pathname === '/api/v1/public-key') return json(res, 200, signing.publicJwk());

      if (req.method === 'POST' && pathname === '/api/v1/setup') {
        const body = await readJson(req, 32 * 1024);
        requireFields(body, ['token', 'username', 'password']);
        const user = await auth.setupFirstAdmin(body);
        metricsApi.observe('setup');
        return json(res, 201, { initialized: true, user });
      }

      if (req.method === 'POST' && pathname === '/api/v1/auth/register') {
        const body = await readJson(req, 32 * 1024);
        requireFields(body, ['username', 'password']);
        const user = await auth.register(body);
        metricsApi.observe('register');
        return json(res, 201, { user });
      }

      if (req.method === 'POST' && pathname === '/api/v1/auth/login') {
        const body = await readJson(req, 32 * 1024);
        requireFields(body, ['username', 'password']);
        try {
          return json(res, 200, await auth.login(req, body));
        } catch (error) {
          if (error.code === 'INVALID_CREDENTIALS' || error.code === 'RATE_LIMITED') metricsApi.observe('loginFail');
          throw error;
        }
      }

      if (req.method === 'POST' && pathname === '/api/v1/auth/logout') {
        await auth.logout(req);
        return json(res, 200, { loggedOut: true });
      }

      if (req.method === 'GET' && pathname === '/api/v1/auth/me') {
        const user = auth.principal(req);
        if (!user) return problem(res, 401, 'UNAUTHORIZED', 'Login required');
        return json(res, 200, { user: describePrincipal(user) });
      }

      if (req.method === 'POST' && pathname === '/api/v1/auth/adult-confirm') {
        const user = requireUser(req, res);
        if (!user) return;
        if (user.bootstrap) return json(res, 200, { user: describePrincipal(user) });
        const body = await readJson(req, 32 * 1024);
        return json(res, 200, { user: await auth.confirmAdult(user.id, body) });
      }

      if (req.method === 'POST' && pathname === '/api/v1/auth/activate') {
        const user = requireUser(req, res);
        if (!user) return;
        const body = await readJson(req, 32 * 1024);
        requireFields(body, ['inviteCode']);
        return json(res, 200, { user: await auth.activateDeveloper(user.id, body.inviteCode) });
      }

      if (req.method === 'GET' && pathname === '/api/v1/auth/github') {
        const user = requireUser(req, res);
        if (!user) return;
        if (!config.githubClientId) return problem(res, 503, 'GITHUB_NOT_CONFIGURED', 'GitHub OAuth is not configured');
        const state = await auth.createGithubState(user.id);
        const redirectUri = `${publicBaseUrl.replace(/\/$/, '')}/api/v1/auth/github/callback`;
        res.writeHead(302, { location: githubAuthorizeUrl({ clientId: config.githubClientId, redirectUri, state }) });
        return res.end();
      }

      if (req.method === 'GET' && pathname === '/api/v1/auth/github/callback') {
        const pending = auth.consumeGithubState(url.searchParams.get('state'));
        if (!pending) return problem(res, 401, 'UNAUTHORIZED', 'GitHub state is invalid');
        const redirectUri = `${publicBaseUrl.replace(/\/$/, '')}/api/v1/auth/github/callback`;
        const profile = await exchangeGithubCode({ clientId: config.githubClientId, clientSecret: config.githubClientSecret, code: url.searchParams.get('code'), redirectUri });
        await auth.bindGithub(pending.userId, profile);
        res.writeHead(302, { location: `${publicBaseUrl.replace(/\/$/, '')}/?github=bound` });
        return res.end();
      }

      if (req.method === 'POST' && pathname === '/api/v1/auth/github/bind') {
        const user = requireUser(req, res);
        if (!user) return;
        if (config.githubClientId && config.production) return problem(res, 400, 'USE_OAUTH', 'Use GitHub OAuth to bind this account');
        const body = await readJson(req, 32 * 1024);
        requireFields(body, ['id', 'login']);
        return json(res, 200, { user: await auth.bindGithub(user.id, body) });
      }

      if (req.method === 'POST' && pathname === '/api/v1/invites') {
        const principal = auth.principal(req);
        if (!principal) return problem(res, 401, 'UNAUTHORIZED', 'Login required');
        const body = await readJson(req, 32 * 1024);
        const result = await auth.createInvite({ ...body, createdBy: principal.id, actor: principal });
        metricsApi.observe('invites');
        return json(res, 201, result);
      }

      if (req.method === 'GET' && pathname === '/api/v1/invites') {
        if (!requirePerm(req, res, 'invite.developer')) return;
        return json(res, 200, { invites: auth.listInvites() });
      }

      const revokeInviteMatch = pathname.match(/^\/api\/v1\/invites\/([^/]+)$/);
      if (req.method === 'DELETE' && revokeInviteMatch) {
        if (!requirePerm(req, res, 'invite.developer')) return;
        if (!await auth.revokeInvite(revokeInviteMatch[1], auth.principal(req))) return problem(res, 404, 'INVITE_NOT_FOUND', 'Invitation was not found');
        return json(res, 200, { revoked: true });
      }

      if (req.method === 'GET' && pathname === '/api/v1/admin/state') {
        if (!requireUser(req, res)) return;
        const state = store.snapshot();
        state.diagnostics = state.diagnostics.slice(-20);
        state.audit = (state.audit || []).slice(-30);
        for (const server of Object.values(state.servers)) delete server.tokenHash;
        for (const user of Object.values(state.users)) {
          delete user.passwordHash;
          delete user.adultBirthYear;
        }
        for (const invite of Object.values(state.invites)) delete invite.codeHash;
        state.sessions = { activeCount: Object.values(state.sessions).filter((session) => Date.parse(session.expiresAt) > Date.now()).length };
        delete state.handshakes;
        return json(res, 200, state);
      }

      async function commitArtifact(expected, target, size, fileName) {
        if (objects?.put) await objects.put(expected, target, size);
        const analysis = await analyzeZipFile(target, fileName);
        const scan = config.production ? await scanFile(target) : { skipped: true, ok: true };
        const highRisk = analysis.findings.some((item) => item.severity === 'high') || scan.ok === false;
        const review = await store.mutate((draft) => {
          draft.reviews = draft.reviews || {};
          const value = {
            sha256: expected,
            fileName,
            size,
            status: highRisk || analysis.containsDll ? 'pending' : 'approved',
            licenseConfirmed: false,
            analysis,
            scan,
            createdAt: now()
          };
          draft.reviews[expected] = value;
          recordAudit(draft, { actor: auditActor(req), action: 'artifact.upload', target: expected, details: { fileName, size, status: value.status } });
          return value;
        });
        return { sha256: expected, size, fileName, review };
      }

      const artifactUploadMatch = pathname.match(/^\/api\/v1\/artifacts\/([a-f0-9]{64})\/uploads$/);
      if (req.method === 'POST' && artifactUploadMatch) {
        if (!requirePerm(req, res, 'content.submit')) return;
        const expected = artifactUploadMatch[1];
        if (store.snapshot().bannedHashes?.[expected]) return problem(res, 409, 'HASH_BANNED', 'This artifact hash is banned');
        const body = await readJson(req, 32 * 1024);
        const session = await chunkUploads.create({
          sha256: expected,
          size: body.size,
          chunkSize: body.chunkSize || DEFAULT_CHUNK_BYTES,
          fileName: body.fileName || decodeHeaderFileName(req.headers['x-file-name'])
        });
        return json(res, 201, await chunkUploads.sessionView(session));
      }

      const artifactStatusMatch = pathname.match(/^\/api\/v1\/artifacts\/([a-f0-9]{64})\/uploads\/([^/]+)$/);
      if (req.method === 'GET' && artifactStatusMatch) {
        if (!requirePerm(req, res, 'content.submit')) return;
        const session = await chunkUploads.get(artifactStatusMatch[2], artifactStatusMatch[1]);
        return json(res, 200, await chunkUploads.sessionView(session));
      }

      const artifactChunkMatch = pathname.match(/^\/api\/v1\/artifacts\/([a-f0-9]{64})\/uploads\/([^/]+)\/(\d+)$/);
      if (req.method === 'PUT' && artifactChunkMatch) {
        if (!requirePerm(req, res, 'content.submit')) return;
        const expected = artifactChunkMatch[1];
        const session = await chunkUploads.get(artifactChunkMatch[2], expected);
        const index = Number(artifactChunkMatch[3]);
        const expectedSize = chunkUploads.expectedChunkLength(session, index);
        const already = await chunkUploads.hasChunk(session, index, expectedSize);
        if (already) {
          for await (const _chunk of req) { /* discard duplicate chunk for resume/retry */ }
        } else {
          await receiveExactBytes(req, chunkUploads.chunkPath(session.id, index), expectedSize, Math.min(session.chunkSize, maxArtifactBytes));
        }
        const view = await chunkUploads.sessionView(session);
        return json(res, 200, { ...view, index, size: expectedSize, skipped: already });
      }

      const artifactCompleteMatch = pathname.match(/^\/api\/v1\/artifacts\/([a-f0-9]{64})\/uploads\/([^/]+)\/complete$/);
      if (req.method === 'POST' && artifactCompleteMatch) {
        if (!requirePerm(req, res, 'content.submit')) return;
        const expected = artifactCompleteMatch[1];
        if (store.snapshot().bannedHashes?.[expected]) return problem(res, 409, 'HASH_BANNED', 'This artifact hash is banned');
        const session = await chunkUploads.get(artifactCompleteMatch[2], expected);
        await mkdir(objectDir, { recursive: true });
        const target = path.join(objectDir, expected);
        const received = await chunkUploads.assemble(session, target);
        return json(res, 201, await commitArtifact(expected, target, received.size, session.fileName));
      }

      const artifactMatch = pathname.match(/^\/api\/v1\/artifacts\/([a-f0-9]{64})$/);
      if (req.method === 'PUT' && artifactMatch) {
        if (!requirePerm(req, res, 'content.submit')) return;
        const expected = artifactMatch[1];
        await mkdir(objectDir, { recursive: true });
        const target = path.join(objectDir, expected);
        if (store.snapshot().bannedHashes?.[expected]) return problem(res, 409, 'HASH_BANNED', 'This artifact hash is banned');
        const received = await receiveArtifact(req, target, expected, maxArtifactBytes);
        const fileName = decodeHeaderFileName(req.headers['x-file-name']);
        return json(res, 201, await commitArtifact(expected, target, received.size, fileName));
      }

      const publicArtifact = pathname.match(/^\/api\/v1\/public\/artifacts\/([a-f0-9]{64})$/);
      if (req.method === 'GET' && publicArtifact) {
        const file = path.join(objectDir, publicArtifact[1]);
        const info = await stat(file);
        const range = String(req.headers.range || '').match(/^bytes=(\d+)-(\d*)$/);
        const headers = {
          'content-type': 'application/zip',
          ...cloudflareCacheHeaders('artifact'),
          etag: `"${publicArtifact[1]}"`,
          'x-content-type-options': 'nosniff'
        };
        const start = range ? Number(range[1]) : 0;
        const end = range && range[2] ? Number(range[2]) : info.size - 1;
        if (range && (start >= info.size || end >= info.size || start > end)) return problem(res, 416, 'RANGE_NOT_SATISFIABLE', 'Requested range is invalid');
        const served = range ? end - start + 1 : info.size;
        store.mutate((draft) => recordDownload(draft, { sha256: publicArtifact[1], bytes: served, gameVersion: url.searchParams.get('gameVersion') })).catch(() => {});
        if (range) {
          res.writeHead(206, { ...headers, 'content-length': served, 'content-range': `bytes ${start}-${end}/${info.size}` });
          return createReadStream(file, { start, end }).pipe(res);
        }
        res.writeHead(200, { ...headers, 'content-length': info.size });
        return createReadStream(file).pipe(res);
      }

      if (req.method === 'POST' && pathname === '/api/v1/mods') {
        if (!requirePerm(req, res, 'catalog.write')) return;
        const body = await readJson(req);
        requireFields(body, ['id', 'name', 'version', 'artifactSha']);
        if (!isSafeId(body.id) || !isSafeId(body.version) || !/^[a-f0-9]{64}$/.test(body.artifactSha)) throw Object.assign(new Error('Invalid id, version, or SHA-256'), { code: 'VALIDATION' });
        const artifact = path.join(objectDir, body.artifactSha);
        const artifactInfo = await stat(artifact);
        const review = store.snapshot().reviews?.[body.artifactSha];
        if (store.snapshot().bannedHashes?.[body.artifactSha]) throw Object.assign(new Error('Artifact hash is banned'), { code: 'VALIDATION' });
        if (requireReview && (!review || review.status !== 'approved' || !review.licenseConfirmed)) throw Object.assign(new Error('Artifact must be reviewed and have a confirmed redistribution license'), { code: 'VALIDATION' });
        const analysis = review?.analysis;
        const dependsOn = normalizeDependsOn(body.dependsOn, body.id);
        for (const depId of dependsOn) {
          if (!store.snapshot().mods[depId]) throw Object.assign(new Error(`Unknown prerequisite mod: ${depId}`), { code: 'VALIDATION' });
        }
        const result = await store.mutate((draft) => {
          const mod = draft.mods[body.id] || { id: body.id, name: body.name, versions: {} };
          mod.name = body.name;
          mod.versions[body.version] = {
            version: body.version,
            artifactSha: body.artifactSha,
            artifactSize: artifactInfo.size,
            gameVersions: Array.isArray(body.gameVersions) ? body.gameVersions : [],
            gameVersionRange: body.gameVersionRange === 'major' || body.genericGameVersion ? 'major' : 'exact',
            installRoots: Array.isArray(body.installRoots) && body.installRoots.length ? body.installRoots : (analysis?.roots || []),
            containsDll: Boolean(body.containsDll || analysis?.containsDll),
            requiresRestart: Boolean(body.requiresRestart || body.containsDll || analysis?.containsDll),
            installSide: normalizeInstallSide(body.installSide),
            dependsOn,
            author: body.author || analysis?.modInfo?.author || null,
            description: body.description || analysis?.modInfo?.description || null,
            sbom: analysis?.sbom || null,
            createdAt: now()
          };
          if (Array.isArray(body.contentSlots) || typeof body.contentSlots === 'string') {
            mod.contentSlots = normalizeContentSlots(body.contentSlots);
          } else if (!Array.isArray(mod.contentSlots)) {
            mod.contentSlots = [];
          }
          if (body.r18 !== undefined) mod.r18 = Boolean(body.r18);
          else if (mod.r18 == null) mod.r18 = false;
          draft.mods[body.id] = mod;
          recordAudit(draft, { actor: auditActor(req), action: 'mod.register', target: body.id, details: { version: body.version, r18: Boolean(mod.r18), artifactSha: body.artifactSha } });
          return mod;
        });
        return json(res, 201, result);
      }

      const modPatchMatch = pathname.match(/^\/api\/v1\/mods\/([^/]+)$/);
      if (req.method === 'PATCH' && modPatchMatch) {
        if (!requirePerm(req, res, 'catalog.write')) return;
        const body = await readJson(req, 32 * 1024);
        const result = await store.mutate((draft) => {
          const mod = draft.mods[modPatchMatch[1]];
          if (!mod) throw Object.assign(new Error('Mod was not found'), { code: 'NOT_FOUND' });
          if (body.r18 !== undefined) mod.r18 = Boolean(body.r18);
          recordAudit(draft, { actor: auditActor(req), action: 'mod.update', target: mod.id, details: { r18: Boolean(mod.r18) } });
          return { id: mod.id, name: mod.name, r18: Boolean(mod.r18), contentSlots: mod.contentSlots || [] };
        });
        return json(res, 200, result);
      }

      const slotListMatch = pathname.match(/^\/api\/v1\/mods\/([^/]+)\/slots$/);
      if (req.method === 'PUT' && slotListMatch) {
        if (!requirePerm(req, res, 'catalog.write')) return;
        const body = await readJson(req);
        const slots = normalizeContentSlots(body.slots || body.contentSlots);
        const result = await store.mutate((draft) => {
          migrateSlotContents(draft);
          const mod = draft.mods[slotListMatch[1]];
          if (!mod) throw Object.assign(new Error('Mod was not found'), { code: 'NOT_FOUND' });
          const keep = new Set(slots.map((item) => item.id));
          mod.contentSlots = slots;
          for (const [contentId, item] of Object.entries(draft.contents || {})) {
            if (item.modId === mod.id && !keep.has(item.slotId)) delete draft.contents[contentId];
          }
          purgeContentRefs(draft, (item) => item.modId === mod.id && !keep.has(item.slotId));
          recordAudit(draft, { actor: auditActor(req), action: 'mod.slots', target: mod.id, details: { slots: slots.map((item) => item.id) } });
          return { id: mod.id, contentSlots: mod.contentSlots };
        });
        return json(res, 200, result);
      }

      const slotContentsMatch = pathname.match(/^\/api\/v1\/mods\/([^/]+)\/slots\/([^/]+)\/contents$/);
      if (req.method === 'POST' && slotContentsMatch) {
        if (!requirePerm(req, res, 'content.submit')) return;
        const modId = slotContentsMatch[1];
        const slotId = slotContentsMatch[2];
        const body = await readJson(req);
        requireFields(body, ['artifactSha', 'name']);
        if (!/^[a-f0-9]{64}$/.test(body.artifactSha)) throw Object.assign(new Error('Invalid SHA-256'), { code: 'VALIDATION' });
        const name = String(body.name || '').trim().slice(0, 80);
        if (!name) throw Object.assign(new Error('Content name is required'), { code: 'VALIDATION' });
        const description = String(body.description || '').trim().slice(0, 500);
        const artifactSize = (await stat(path.join(objectDir, body.artifactSha))).size;
        const user = auth.principal(req);
        const result = await store.mutate((draft) => {
          migrateSlotContents(draft);
          const mod = draft.mods[modId];
          if (!mod) throw Object.assign(new Error('Mod was not found'), { code: 'NOT_FOUND' });
          if (!(mod.contentSlots || []).length) throw Object.assign(new Error('This mod has no content slots'), { code: 'VALIDATION' });
          const slot = (mod.contentSlots || []).find((item) => item.id === slotId);
          if (!slot) throw Object.assign(new Error(`Unknown content slot: ${slotId}`), { code: 'VALIDATION' });
          const review = draft.reviews?.[body.artifactSha];
          if (draft.bannedHashes?.[body.artifactSha]) throw Object.assign(new Error('Artifact hash is banned'), { code: 'VALIDATION' });
          if (requireReview && (!review || review.status !== 'approved' || !review.licenseConfirmed)) {
            throw Object.assign(new Error('Artifact must be reviewed and have a confirmed redistribution license'), { code: 'VALIDATION' });
          }
          const contentId = id('cnt');
          const value = {
            id: contentId,
            modId,
            slotId,
            name,
            description,
            artifactSha: body.artifactSha,
            size: artifactSize || review?.size || 0,
            fileName: review?.fileName || null,
            uploadedBy: user?.id || null,
            createdAt: now(),
            r18: Boolean(body.r18),
            previewPath: review?.analysis?.previewPath || null,
            readmePath: review?.analysis?.readmePath || null
          };
          draft.contents = draft.contents || {};
          draft.contents[contentId] = value;
          recordAudit(draft, { actor: auditActor(req), action: 'content.submit', target: contentId, details: { modId, slotId, name, r18: Boolean(value.r18), artifactSha: body.artifactSha } });
          return value;
        });
        return json(res, 201, result);
      }

      const slotItemMatch = pathname.match(/^\/api\/v1\/mods\/([^/]+)\/slots\/([^/]+)$/);
      if (req.method === 'DELETE' && slotItemMatch) {
        if (!requirePerm(req, res, 'catalog.write')) return;
        const modId = slotItemMatch[1];
        const slotId = slotItemMatch[2];
        const result = await store.mutate((draft) => {
          migrateSlotContents(draft);
          const mod = draft.mods[modId];
          if (!mod) throw Object.assign(new Error('Mod was not found'), { code: 'NOT_FOUND' });
          mod.contentSlots = (mod.contentSlots || []).filter((item) => item.id !== slotId);
          for (const [contentId, item] of Object.entries(draft.contents || {})) {
            if (item.modId === modId && item.slotId === slotId) delete draft.contents[contentId];
          }
          purgeContentRefs(draft, (item) => item.modId === modId && item.slotId === slotId);
          recordAudit(draft, { actor: auditActor(req), action: 'mod.slot.delete', target: mod.id, details: { slotId } });
          return { id: mod.id, contentSlots: mod.contentSlots };
        });
        return json(res, 200, result);
      }

      const modContentsMatch = pathname.match(/^\/api\/v1\/mods\/([^/]+)\/contents$/);
      if (req.method === 'GET' && modContentsMatch) {
        if (!requireUser(req, res)) return;
        const snapshot = store.snapshot();
        migrateSlotContents(snapshot);
        const mod = snapshot.mods[modContentsMatch[1]];
        if (!mod) return problem(res, 404, 'MOD_NOT_FOUND', 'Mod was not found');
        const user = auth.principal(req);
        const includePending = Boolean(can(user, 'catalog.write'));
        const url = new URL(req.url, publicBaseUrl);
        return json(res, 200, {
          modId: mod.id,
          contents: listModContents(snapshot, mod.id, {
            slotId: url.searchParams.get('slot') || '',
            includePending,
            requireReview,
            viewerId: user?.id,
            adultVerified: canViewAdult(user, { staff: includePending })
          })
        });
      }

      const contentItemMatch = pathname.match(/^\/api\/v1\/contents\/([^/]+)$/);
      if (contentItemMatch && (req.method === 'PATCH' || req.method === 'DELETE')) {
        const user = auth.principal(req);
        if (!user) return problem(res, 401, 'UNAUTHORIZED', 'Login required');
        const contentId = contentItemMatch[1];
        if (req.method === 'DELETE') {
          const result = await store.mutate((draft) => {
            migrateSlotContents(draft);
            const item = draft.contents?.[contentId];
            if (!item) throw Object.assign(new Error('Content was not found'), { code: 'NOT_FOUND' });
            if (item.uploadedBy !== user.id && !can(user, 'catalog.write')) {
              throw Object.assign(new Error('Insufficient role'), { code: 'FORBIDDEN' });
            }
            delete draft.contents[contentId];
            purgeContentRefs(draft, (_item, id) => id === contentId);
            recordAudit(draft, { actor: auditActor(req), action: 'content.delete', target: contentId, details: { modId: item.modId, slotId: item.slotId } });
            return { deleted: true, id: contentId };
          });
          return json(res, 200, result);
        }
        const body = await readJson(req, 32 * 1024);
        const result = await store.mutate((draft) => {
          migrateSlotContents(draft);
          const item = draft.contents?.[contentId];
          if (!item) throw Object.assign(new Error('Content was not found'), { code: 'NOT_FOUND' });
          if (item.uploadedBy !== user.id && !can(user, 'catalog.write')) {
            throw Object.assign(new Error('Insufficient role'), { code: 'FORBIDDEN' });
          }
          if (body.name !== undefined) {
            const name = String(body.name || '').trim().slice(0, 80);
            if (!name) throw Object.assign(new Error('Content name is required'), { code: 'VALIDATION' });
            item.name = name;
          }
          if (body.description !== undefined) item.description = String(body.description || '').trim().slice(0, 500);
          if (body.r18 !== undefined) item.r18 = Boolean(body.r18);
          item.updatedAt = now();
          recordAudit(draft, { actor: auditActor(req), action: 'content.update', target: contentId, details: { name: item.name, r18: Boolean(item.r18) } });
          return item;
        });
        return json(res, 200, result);
      }

      if (req.method === 'POST' && pathname === '/api/v1/packs') {
        if (!requirePerm(req, res, 'pack.publish')) return;
        const body = await readJson(req);
        requireFields(body, ['name', 'gameVersion', 'entries']);
        const packId = body.id || id('pack');
        if (!isSafeId(packId) || !Array.isArray(body.entries)) throw Object.assign(new Error('Invalid pack'), { code: 'VALIDATION' });
        const snapshot = store.snapshot();
        const entries = expandPackEntries(snapshot, body.entries, body.gameVersion);
        for (const entry of entries) {
          const version = snapshot.mods[entry.modId]?.versions?.[entry.version];
          if (!version) throw Object.assign(new Error(`Unknown mod version: ${entry.modId}@${entry.version}`), { code: 'VALIDATION' });
          if (version.gameVersions.length && !gameVersionMatches(version.gameVersions, body.gameVersion, version.gameVersionRange)) throw Object.assign(new Error(`${entry.modId}@${entry.version} does not declare compatibility with game ${body.gameVersion}`), { code: 'VALIDATION' });
          if (requireReview) {
            const review = snapshot.reviews?.[version.artifactSha];
            if (!review || review.status !== 'approved' || !review.licenseConfirmed) throw Object.assign(new Error(`${entry.modId}@${entry.version} is not approved for redistribution`), { code: 'VALIDATION' });
          }
          const contents = normalizeEntryContents(snapshot, entry, requireReview);
          if (contents) entry.contents = contents;
          else delete entry.contents;
        }
        const pack = await store.mutate((draft) => {
          const existing = draft.packs[packId];
          const value = { id: packId, name: body.name, gameVersion: body.gameVersion, entries, createdAt: existing?.createdAt || now(), updatedAt: now(), latestReleaseId: existing?.latestReleaseId || null };
          draft.packs[packId] = value;
          recordAudit(draft, { actor: auditActor(req), action: existing ? 'pack.update' : 'pack.create', target: packId, details: { name: body.name, gameVersion: body.gameVersion, entryCount: entries.length } });
          return value;
        });
        return json(res, 201, pack);
      }

      const releaseMatch = pathname.match(/^\/api\/v1\/packs\/([^/]+)\/releases$/);
      if (req.method === 'POST' && releaseMatch) {
        if (!requirePerm(req, res, 'pack.publish')) return;
        const snapshot = store.snapshot();
        const pack = snapshot.packs[releaseMatch[1]];
        if (!pack) return problem(res, 404, 'PACK_NOT_FOUND', 'ModPack was not found');
        const releaseNumber = Object.values(snapshot.releases).filter((item) => item.packId === pack.id).length + 1;
        const previous = activeRelease(snapshot, pack);
        const unsigned = {
          schemaVersion: 1,
          packId: pack.id,
          packVersion: releaseNumber,
          gameVersion: pack.gameVersion,
          issuedAt: now(),
          mods: expandPackEntries(snapshot, pack.entries, pack.gameVersion).map((entry) => {
            const version = snapshot.mods[entry.modId].versions[entry.version];
            normalizeEntryContents(snapshot, entry, requireReview);
            const overlays = overlaysForPackEntry(snapshot, entry, (sha) => artifactPublicUrl(sha, config, artifactBase));
            return {
              id: entry.modId,
              version: entry.version,
              required: entry.required !== false,
              containsDll: version.containsDll,
              requiresRestart: version.requiresRestart,
              installSide: normalizeInstallSide(version.installSide),
              installRoots: version.installRoots,
              size: version.artifactSize,
              sha256: version.artifactSha,
              url: artifactPublicUrl(version.artifactSha, config, artifactBase),
              ...(overlays.length ? { overlays } : {})
            };
          })
        };
        const manifest = await signing.signObject(unsigned);
        const principal = auth.principal(req);
        const body = await readJson(req, 32 * 1024).catch(() => ({}));
        const release = await store.mutate((draft) => {
          const releaseId = id('rel');
          const value = {
            id: releaseId,
            packId: pack.id,
            packVersion: releaseNumber,
            manifest,
            createdAt: now(),
            createdBy: principal?.id || 'unknown',
            reason: body.reason || null,
            diff: releaseDiff(previous?.manifest, manifest),
            previousReleaseId: previous?.id || null,
            revokedAt: null,
            revokedBy: null,
            revokeReason: null
          };
          draft.releases[releaseId] = value;
          draft.packs[pack.id].latestReleaseId = releaseId;
          recordAudit(draft, { actor: principal?.username || principal?.id, action: 'release.publish', target: releaseId, reason: body.reason, details: { packId: pack.id, packVersion: releaseNumber, diff: value.diff } });
          return value;
        });
        return json(res, 201, release);
      }

      const manifestMatch = pathname.match(/^\/api\/v1\/public\/packs\/([^/]+)\/latest$/);
      if (req.method === 'GET' && manifestMatch) {
        const snapshot = store.snapshot();
        if (snapshot.settings?.distributionPaused) return problem(res, 503, 'DISTRIBUTION_PAUSED', 'Mod distribution is paused');
        const pack = snapshot.packs[manifestMatch[1]];
        const release = pack && activeRelease(snapshot, pack);
        if (!release) return problem(res, 404, 'RELEASE_NOT_FOUND', 'No active release was found');
        return json(res, 200, release.manifest, cloudflareCacheHeaders('manifest'));
      }

      if (req.method === 'GET' && pathname === '/api/v1/public/launcher/latest') {
        const platform = normalizePlatform(url.searchParams.get('platform') || 'win32');
        const current = currentLauncher(store.snapshot(), platform);
        if (!current?.manifest) return problem(res, 404, 'LAUNCHER_NOT_FOUND', 'No launcher release was published');
        return json(res, 200, current.manifest, cloudflareCacheHeaders('manifest'));
      }

      if (req.method === 'GET' && pathname === '/api/v1/admin/launcher') {
        if (!requirePerm(req, res, 'ops.read')) return;
        return json(res, 200, { channels: store.snapshot().launcher?.channels || {} });
      }

      if (req.method === 'POST' && pathname === '/api/v1/admin/launcher') {
        if (!requirePerm(req, res, 'platform.manage')) return;
        const body = await readJson(req, 32 * 1024);
        requireFields(body, ['sha256', 'version', 'platform']);
        const platform = normalizePlatform(body.platform);
        if (!platform) return problem(res, 400, 'VALIDATION', 'Unsupported launcher platform');
        const file = path.join(objectDir, body.sha256);
        const info = await stat(file).catch(() => null);
        if (!info) return problem(res, 404, 'ARTIFACT_NOT_FOUND', 'Upload the launcher ZIP first');
        await validateLauncherZip(file);
        const principal = auth.principal(req);
        const payload = launcherManifestPayload({
          version: body.version,
          platform,
          sha256: body.sha256,
          size: info.size,
          fileName: body.fileName,
          notes: body.notes,
          minVersion: body.minVersion,
          url: launcherArtifactUrl(body.sha256, config, publicBaseUrl)
        });
        const manifest = await signing.signObject({
          ...payload,
          publishedAt: now(),
          expiresAt: new Date(Date.now() + 365 * 86400_000).toISOString()
        });
        const published = await store.mutate((draft) => {
          requireConfirm(config, draft, body, 'launcher.publish');
          draft.launcher = draft.launcher || { channels: {} };
          draft.launcher.channels = draft.launcher.channels || {};
          draft.launcher.channels[platform] = {
            version: payload.version,
            platform,
            sha256: payload.sha256,
            size: payload.size,
            fileName: payload.fileName,
            notes: payload.notes,
            publishedAt: now(),
            publishedBy: principal.username || principal.id,
            revokedAt: null,
            manifest
          };
          recordAudit(draft, { actor: principal.username || principal.id, action: 'launcher.publish', target: `${platform}:${payload.version}`, details: { sha256: payload.sha256, size: payload.size } });
          return draft.launcher.channels[platform];
        });
        await purgeCloudflare(config, [`${String(publicBaseUrl || '').replace(/\/$/, '')}/api/v1/public/launcher/latest?platform=${platform}`]);
        return json(res, 201, published);
      }

      if (req.method === 'POST' && pathname === '/api/v1/admin/launcher/revoke') {
        if (!requirePerm(req, res, 'platform.manage')) return;
        const body = await readJson(req, 32 * 1024);
        const platform = normalizePlatform(body.platform || 'win32');
        const principal = auth.principal(req);
        const result = await store.mutate((draft) => {
          requireConfirm(config, draft, body, 'launcher.revoke');
          const channel = draft.launcher?.channels?.[platform];
          if (!channel) return null;
          channel.revokedAt = now();
          recordAudit(draft, { actor: principal.username || principal.id, action: 'launcher.revoke', target: `${platform}:${channel.version}`, reason: body.reason, details: { sha256: channel.sha256 } });
          return channel;
        });
        if (!result) return problem(res, 404, 'LAUNCHER_NOT_FOUND', 'No launcher release was published');
        await purgeCloudflare(config, [`${String(publicBaseUrl || '').replace(/\/$/, '')}/api/v1/public/launcher/latest?platform=${platform}`]);
        return json(res, 200, result);
      }

      const releaseListMatch = pathname.match(/^\/api\/v1\/packs\/([^/]+)\/releases$/);
      if (req.method === 'GET' && releaseListMatch) {
        if (!requireUser(req, res)) return;
        const snapshot = store.snapshot();
        const pack = snapshot.packs[releaseListMatch[1]];
        if (!pack) return problem(res, 404, 'PACK_NOT_FOUND', 'ModPack was not found');
        const releases = Object.values(snapshot.releases).filter((item) => item.packId === pack.id).sort((a, b) => b.packVersion - a.packVersion);
        return json(res, 200, { packId: pack.id, latestReleaseId: pack.latestReleaseId, mayAffectSaves: true, releases });
      }

      const revokeMatch = pathname.match(/^\/api\/v1\/packs\/([^/]+)\/releases\/([^/]+)\/revoke$/);
      if (req.method === 'POST' && revokeMatch) {
        if (!requirePerm(req, res, 'pack.publish')) return;
        const body = await readJson(req, 32 * 1024);
        const principal = auth.principal(req);
        const result = await store.mutate((draft) => {
          requireConfirm(config, draft, body, 'release.revoke');
          const release = draft.releases[revokeMatch[2]];
          if (!release || release.packId !== revokeMatch[1]) return null;
          release.revokedAt = now();
          release.revokedBy = principal.id;
          release.revokeReason = body.reason || null;
          recordAudit(draft, { actor: principal.username || principal.id, action: 'release.revoke', target: release.id, reason: body.reason, details: { packId: release.packId, packVersion: release.packVersion } });
          return release;
        });
        if (!result) return problem(res, 404, 'RELEASE_NOT_FOUND', 'Release was not found');
        await purgeCloudflare(config, [manifestPublicUrl(revokeMatch[1], config, publicBaseUrl)]);
        return json(res, 200, result);
      }

      const rollbackMatch = pathname.match(/^\/api\/v1\/packs\/([^/]+)\/rollback$/);
      if (req.method === 'POST' && rollbackMatch) {
        if (!requirePerm(req, res, 'pack.publish')) return;
        const body = await readJson(req, 32 * 1024);
        requireFields(body, ['releaseId']);
        const principal = auth.principal(req);
        const result = await store.mutate((draft) => {
          requireConfirm(config, draft, body, 'pack.rollback');
          const pack = draft.packs[rollbackMatch[1]];
          const release = draft.releases[body.releaseId];
          if (!pack || !release || release.packId !== pack.id) return null;
          if (release.revokedAt) throw Object.assign(new Error('Cannot roll back to a revoked release'), { code: 'VALIDATION' });
          const previousId = pack.latestReleaseId;
          pack.latestReleaseId = release.id;
          pack.updatedAt = now();
          recordAudit(draft, { actor: principal.username || principal.id, action: 'pack.rollback', target: pack.id, reason: body.reason, details: { from: previousId, to: release.id, packVersion: release.packVersion, mayAffectSaves: true } });
          return { pack, release, mayAffectSaves: true };
        });
        if (!result) return problem(res, 404, 'RELEASE_NOT_FOUND', 'Rollback target was not found');
        return json(res, 200, result);
      }

      if (req.method === 'POST' && pathname === '/api/v1/servers') {
        const owner = requirePerm(req, res, 'server.create');
        if (!owner) return;
        const body = await readJson(req);
        requireFields(body, ['name', 'packId']);
        const snapshot = store.snapshot();
        if (!snapshot.packs[body.packId]) throw Object.assign(new Error('Unknown packId'), { code: 'VALIDATION' });
        const addresses = parseAddresses(body.publicAddresses, body.publicAddress);
        const serverId = id('srv');
        const token = randomBytes(32).toString('base64url');
        const pack = snapshot.packs[body.packId];
        const pluginConfig = pluginServerConfig({
          baseUrl: publicBaseUrl,
          serverId,
          token,
          gameVersion: pack.gameVersion
        });
        await store.mutate((draft) => {
          draft.servers[serverId] = {
            id: serverId,
            name: body.name,
            packId: body.packId,
            publicAddresses: addresses,
            publicAddress: addresses[0] || null,
            ownerId: owner.bootstrap ? null : owner.id,
            tokenHash: tokenHash(token),
            createdAt: now(),
            lastSeenAt: null
          };
          recordAudit(draft, { actor: owner.username || owner.id, action: 'server.create', target: serverId, details: { packId: body.packId, publicAddresses: addresses } });
        });
        return json(res, 201, { serverId, token, packId: body.packId, ...publicAddressView({ publicAddresses: addresses }), config: pluginConfig });
      }

      if (req.method === 'GET' && pathname === '/api/v1/public/servers/resolve') {
        const address = String(url.searchParams.get('address') || '').trim();
        const serverId = String(url.searchParams.get('serverId') || '').trim();
        if (!address && !serverId) return problem(res, 422, 'VALIDATION', 'serverId or address query parameter is required');
        const snapshot = store.snapshot();
        const server = resolveRegisteredServer(snapshot, { serverId, address });
        if (!server) return problem(res, 404, 'SERVER_NOT_FOUND', 'No registered server matches that id or address');
        const pack = snapshot.packs[server.packId];
        const policy = handshakePolicy(snapshot, pack, signing, { launcherUrl, publicBaseUrl });
        return json(res, 200, {
          serverId: server.id,
          packId: server.packId,
          packVersion: policy.packVersion,
          gameVersion: policy.gameVersion,
          handshake: policy,
          ...publicAddressView(server)
        });
      }

      if (req.method === 'POST' && pathname === '/api/v1/public/handshakes') {
        const body = await readJson(req, 32 * 1024);
        const address = String(body.address || '').trim();
        const requestedServerId = String(body.serverId || '').trim();
        if (!address && !requestedServerId) return problem(res, 422, 'VALIDATION', 'serverId or address is required');
        const playerIds = normalizePlayerIds(body.playerIds, body.playerId);
        const hello = sanitizeHello(body.hello);
        const snapshot = store.snapshot();
        const server = resolveRegisteredServer(snapshot, { serverId: requestedServerId, address });
        if (!server) return problem(res, 404, 'SERVER_NOT_FOUND', 'No registered server matches that id or address');
        const stored = await store.mutate((draft) => storeHandshake(draft, server.id, playerIds, hello));
        return json(res, 202, { accepted: true, serverId: server.id, expiresAt: stored.expiresAt });
      }

      const assignmentMatch = pathname.match(/^\/api\/v1\/servers\/([^/]+)\/assignment$/);
      if (req.method === 'GET' && assignmentMatch) {
        const snapshot = store.snapshot();
        const server = snapshot.servers[assignmentMatch[1]];
        if (!server || tokenHash(bearer(req)) !== server.tokenHash) return problem(res, 401, 'UNAUTHORIZED', 'Invalid server credential');
        await store.mutate((draft) => { draft.servers[server.id].lastSeenAt = now(); });
        const pack = snapshot.packs[server.packId];
        const release = pack && activeRelease(snapshot, pack);
        const policy = handshakePolicy(snapshot, pack, signing, { launcherUrl, publicBaseUrl });
        const acceptingPlayers = assignmentAcceptingPlayers(snapshot, server);
        return json(res, 200, { serverId: server.id, packId: server.packId, manifest: release?.manifest || null, handshake: policy, acceptingPlayers });
      }

      const serverPatch = pathname.match(/^\/api\/v1\/servers\/([^/]+)$/);
      if (req.method === 'PATCH' && serverPatch) {
        const principal = requireUser(req, res);
        if (!principal) return;
        const current = store.snapshot().servers[serverPatch[1]];
        if (!current) return problem(res, 404, 'SERVER_NOT_FOUND', 'Server was not found');
        if (!can(principal, 'server.manage') && current.ownerId !== principal.id) return problem(res, 403, 'FORBIDDEN', 'You can only update your own servers');
        const body = await readJson(req, 32 * 1024);
        const result = await store.mutate((draft) => {
          const server = draft.servers[serverPatch[1]];
          if (!server) return null;
          if (body.packId) {
            if (!draft.packs[body.packId]) throw Object.assign(new Error('Unknown packId'), { code: 'VALIDATION' });
            server.packId = body.packId;
          }
          if (body.publicAddresses !== undefined || body.publicAddress !== undefined) {
            applyAddresses(server, body.publicAddresses !== undefined ? body.publicAddresses : body.publicAddress, { replace: true });
          }
          if (body.name) server.name = body.name;
          server.updatedAt = now();
          recordAudit(draft, { actor: principal.username || principal.id, action: 'server.update', target: server.id, reason: body.reason, details: { packId: server.packId, ...publicAddressView(server) } });
          return { id: server.id, name: server.name, packId: server.packId, ...publicAddressView(server) };
        });
        if (!result) return problem(res, 404, 'SERVER_NOT_FOUND', 'Server was not found');
        return json(res, 200, result);
      }

      if (req.method === 'DELETE' && serverPatch) {
        const principal = requireUser(req, res);
        if (!principal) return;
        const current = store.snapshot().servers[serverPatch[1]];
        if (!current) return problem(res, 404, 'SERVER_NOT_FOUND', 'Server was not found');
        if (!can(principal, 'server.manage') && current.ownerId !== principal.id) return problem(res, 403, 'FORBIDDEN', 'You can only delete your own servers');
        const result = await store.mutate((draft) => {
          const server = draft.servers[serverPatch[1]];
          if (!server) return null;
          delete draft.servers[server.id];
          if (draft.handshakes) delete draft.handshakes[server.id];
          recordAudit(draft, { actor: principal.username || principal.id, action: 'server.delete', target: server.id, details: { packId: server.packId, name: server.name } });
          return { deleted: true, id: server.id };
        });
        if (!result) return problem(res, 404, 'SERVER_NOT_FOUND', 'Server was not found');
        return json(res, 200, result);
      }

      const addressesMatch = pathname.match(/^\/api\/v1\/servers\/([^/]+)\/addresses$/);
      if (req.method === 'PUT' && addressesMatch) {
        const snapshot = store.snapshot();
        const server = snapshot.servers[addressesMatch[1]];
        if (!server || tokenHash(bearer(req)) !== server.tokenHash) return problem(res, 401, 'UNAUTHORIZED', 'Invalid server credential');
        const body = await readJson(req, 32 * 1024);
        const updated = await store.mutate((draft) => {
          const current = draft.servers[server.id];
          current.lastSeenAt = now();
          applyAddresses(current, body.publicAddresses || body.publicAddress, { replace: false });
          return publicAddressView(current);
        });
        return json(res, 200, { serverId: server.id, ...updated });
      }

      const claimHandshakeMatch = pathname.match(/^\/api\/v1\/servers\/([^/]+)\/pending-handshake\/claim$/);
      if (req.method === 'POST' && claimHandshakeMatch) {
        const snapshot = store.snapshot();
        const server = snapshot.servers[claimHandshakeMatch[1]];
        if (!server || tokenHash(bearer(req)) !== server.tokenHash) return problem(res, 401, 'UNAUTHORIZED', 'Invalid server credential');
        const body = await readJson(req, 32 * 1024);
        const playerIds = normalizePlayerIds(body.playerIds, body.playerId);
        const hello = await store.mutate((draft) => {
          draft.servers[server.id].lastSeenAt = now();
          return claimHandshake(draft, server.id, playerIds);
        });
        if (!hello) return problem(res, 404, 'HANDSHAKE_NOT_FOUND', 'No pending handshake for that player');
        return json(res, 200, { hello });
      }

      const syncStatusMatch = pathname.match(/^\/api\/v1\/servers\/([^/]+)\/sync-status$/);
      if (req.method === 'POST' && syncStatusMatch) {
        const snapshot = store.snapshot();
        const server = snapshot.servers[syncStatusMatch[1]];
        if (!server || tokenHash(bearer(req)) !== server.tokenHash) return problem(res, 401, 'UNAUTHORIZED', 'Invalid server credential');
        const body = await readJson(req, 32 * 1024);
        requireFields(body, ['stage']);
        const status = await store.mutate((draft) => {
          const current = draft.servers[server.id];
          current.lastSeenAt = now();
          if (body.publicAddresses || body.publicAddress) applyAddresses(current, body.publicAddresses || body.publicAddress, { replace: false });
          current.sync = {
            stage: body.stage,
            ok: body.ok !== false,
            packId: body.packId || current.packId,
            packVersion: body.packVersion || null,
            message: body.message || null,
            requiresRestart: Boolean(body.requiresRestart),
            updatedAt: now()
          };
          return current.sync;
        });
        return json(res, 202, { accepted: true, sync: status });
      }

      if (req.method === 'POST' && pathname === '/api/v1/admin/distribution') {
        if (!requirePerm(req, res, 'distribution.pause')) return;
        const body = await readJson(req, 32 * 1024);
        const principal = auth.principal(req);
        const settings = await store.mutate((draft) => {
          requireConfirm(config, draft, body, body.paused ? 'distribution.pause' : 'distribution.resume');
          draft.settings.distributionPaused = Boolean(body.paused);
          draft.settings.distributionPausedAt = draft.settings.distributionPaused ? now() : null;
          draft.settings.distributionPausedBy = draft.settings.distributionPaused ? principal.id : null;
          draft.settings.distributionPausedReason = draft.settings.distributionPaused ? (body.reason || null) : null;
          recordAudit(draft, { actor: principal.username || principal.id, action: draft.settings.distributionPaused ? 'distribution.pause' : 'distribution.resume', target: 'platform', reason: body.reason });
          return draft.settings;
        });
        if (settings.distributionPaused) notify(config.webhookUrl, { type: 'distribution.pause', reason: body.reason }).catch(() => {});
        return json(res, 200, settings);
      }

      if (req.method === 'POST' && pathname === '/api/v1/diagnostics') {
        const body = await readJson(req, maxDiagnosticBytes);
        requireFields(body, ['sessionId', 'side', 'gameVersion', 'stage']);
        const event = prepareDiagnostic({ ...body, id: id('diag'), occurredAt: body.occurredAt || now(), receivedAt: now() });
        const fingerprint = await store.mutate((draft) => ingestDiagnostic(draft, event));
        const success = event.exceptionType === 'Success' || event.stage === 'successful_session' || event.stage === 'plugin_initialized';
        metricsApi.observe(success ? 'syncOk' : 'crashes');
        const crashGate = shouldBlockInstalls(store.snapshot(), { threshold: config.crashRateBlockThreshold, minSamples: config.crashRateMinSamples });
        if (crashGate.blocked) notify(config.webhookUrl, { type: 'crash-rate', ...crashGate }).catch(() => {});
        return json(res, 202, { accepted: true, eventId: event.id, fingerprint: event.fingerprint, conclusion: fingerprint.conclusion });
      }

      if (req.method === 'GET' && pathname === '/api/v1/diagnostics/summary') {
        if (!requireUser(req, res)) return;
        const fingerprints = Object.values(store.snapshot().fingerprints).sort((a, b) => b.count - a.count);
        return json(res, 200, { fingerprints });
      }

      if (req.method === 'GET' && spaAvailable() && !isSpaReserved(pathname)) {
        if (path.extname(pathname) && sendWebFile(res, pathname.slice(1))) return;
        if (!path.extname(pathname) || pathname.endsWith('.html')) return sendHtml(res, readFileSync(spaIndexPath()));
      }
      return problem(res, 404, 'NOT_FOUND', 'Route not found');
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'NOT_FOUND') return problem(res, 404, 'NOT_FOUND', error.code === 'NOT_FOUND' ? error.message : 'Requested file or object was not found');
      if (error.code === 'BODY_TOO_LARGE') return problem(res, 413, error.code, error.message);
      if (error.code === 'HASH_MISMATCH') return problem(res, 422, error.code, error.message, error.details);
      if (error.code === 'INVALID_CREDENTIALS') return problem(res, 401, error.code, error.message);
      if (error.code === 'RATE_LIMITED') return problem(res, 429, error.code, error.message);
      if (error.code === 'CONFLICT') return problem(res, 409, error.code, error.message);
      if (error.code === 'FORBIDDEN') return problem(res, 403, error.code, error.message);
      if (error.code === 'UNDERAGE') return problem(res, 403, error.code, error.message);
      if (error.code === 'INVALID_INVITE') return problem(res, 422, error.code, error.message);
      if (error.code === 'INVALID_JSON' || error.code === 'VALIDATION') return problem(res, 422, error.code, error.message, error.details);
      console.error(error);
      logger?.error?.('unhandled', { error: error.message, stack: error.stack, method: req.method, path: pathname });
      return problem(res, 500, 'INTERNAL_ERROR', 'Unexpected server error');
    }
  }

  return handler;
}
