import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, readFileSync } from 'node:fs';
import { mkdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { prepareDiagnostic } from './diagnostics.js';
import { createAuthService } from './auth.js';
import { activeRelease, handshakePolicy, recordAudit, releaseDiff } from './protocol.js';
import { bearer, decodeHeaderFileName, id, isSafeId, json, now, problem, readJson, requireFields } from './util.js';
import { analyzeZipFile, scanFile } from './analyze.js';
import { ingestDiagnostic, shouldBlockInstalls } from './compatibility.js';
import { handleP1 } from './p1-routes.js';
import { consumeRateLimit, inspectRequest, routeLimit, securityHeaders } from './security.js';
import { notify } from './alerts.js';
import { pluginServerConfig, recordDownload, requireConfirm } from './catalog.js';
import { gameVersionMatches } from './game-version.js';
import { artifactPublicUrl, cloudflareCacheHeaders, manifestPublicUrl, purgeCloudflare } from './cloudflare.js';
import { can, denyReason, describePrincipal } from './roles.js';
import { exchangeGithubCode, githubAuthorizeUrl } from './github.js';
import { renderUserGuide } from './guide.js';
import { claimHandshake, normalizePlayerIds, sanitizeHello, storeHandshake } from './handshakes.js';

const ADMIN_HTML_V2 = readFileSync(new URL('./admin.html', import.meta.url), 'utf8');

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
      if (await handleP1(req, res, { pathname, store, auth, signing, objects: objects || { localDir: objectDir, ready: async () => ({ ok: true, driver: 'local' }), listLocal: async () => [], remove: async () => {} }, metrics: metricsApi, config })) return;
      if (req.method === 'GET' && pathname === '/') {
        const body = Buffer.from(ADMIN_HTML_V2);
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': body.length, 'x-content-type-options': 'nosniff' });
        return res.end(body);
      }
      if (req.method === 'GET' && (pathname === '/guide' || pathname === '/docs/user')) {
        const markdown = readFileSync(new URL('../../../docs/USER.zh-CN.md', import.meta.url), 'utf8');
        const body = Buffer.from(renderUserGuide(markdown));
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
        if (!await auth.revokeInvite(revokeInviteMatch[1])) return problem(res, 404, 'INVITE_NOT_FOUND', 'Invitation was not found');
        return json(res, 200, { revoked: true });
      }

      if (req.method === 'GET' && pathname === '/api/v1/admin/state') {
        if (!requireUser(req, res)) return;
        const state = store.snapshot();
        state.diagnostics = state.diagnostics.slice(-20);
        state.audit = (state.audit || []).slice(-30);
        for (const server of Object.values(state.servers)) delete server.tokenHash;
        for (const user of Object.values(state.users)) delete user.passwordHash;
        for (const invite of Object.values(state.invites)) delete invite.codeHash;
        state.sessions = { activeCount: Object.values(state.sessions).filter((session) => Date.parse(session.expiresAt) > Date.now()).length };
        delete state.handshakes;
        return json(res, 200, state);
      }

      const artifactMatch = pathname.match(/^\/api\/v1\/artifacts\/([a-f0-9]{64})$/);
      if (req.method === 'PUT' && artifactMatch) {
        if (!requirePerm(req, res, 'catalog.write')) return;
        const expected = artifactMatch[1];
        await mkdir(objectDir, { recursive: true });
        const target = path.join(objectDir, expected);
        if (store.snapshot().bannedHashes?.[expected]) return problem(res, 409, 'HASH_BANNED', 'This artifact hash is banned');
        const received = await receiveArtifact(req, target, expected, maxArtifactBytes);
        if (objects?.put) await objects.put(expected, target, received.size);
        const fileName = decodeHeaderFileName(req.headers['x-file-name']);
        const analysis = await analyzeZipFile(target, fileName);
        const scan = config.production ? await scanFile(target) : { skipped: true, ok: true };
        const highRisk = analysis.findings.some((item) => item.severity === 'high') || scan.ok === false;
        const review = await store.mutate((draft) => {
          draft.reviews = draft.reviews || {};
          const value = {
            sha256: expected,
            fileName,
            size: received.size,
            status: highRisk || analysis.containsDll ? 'pending' : 'approved',
            licenseConfirmed: false,
            analysis,
            scan,
            createdAt: now()
          };
          draft.reviews[expected] = value;
          return value;
        });
        return json(res, 201, { sha256: expected, size: received.size, fileName, review });
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
            author: body.author || analysis?.modInfo?.author || null,
            description: body.description || analysis?.modInfo?.description || null,
            sbom: analysis?.sbom || null,
            createdAt: now()
          };
          draft.mods[body.id] = mod;
          return mod;
        });
        return json(res, 201, result);
      }

      if (req.method === 'POST' && pathname === '/api/v1/packs') {
        if (!requirePerm(req, res, 'pack.publish')) return;
        const body = await readJson(req);
        requireFields(body, ['name', 'gameVersion', 'entries']);
        const packId = body.id || id('pack');
        if (!isSafeId(packId) || !Array.isArray(body.entries)) throw Object.assign(new Error('Invalid pack'), { code: 'VALIDATION' });
        const snapshot = store.snapshot();
        for (const entry of body.entries) {
          const version = snapshot.mods[entry.modId]?.versions?.[entry.version];
          if (!version) throw Object.assign(new Error(`Unknown mod version: ${entry.modId}@${entry.version}`), { code: 'VALIDATION' });
          if (version.gameVersions.length && !gameVersionMatches(version.gameVersions, body.gameVersion, version.gameVersionRange)) throw Object.assign(new Error(`${entry.modId}@${entry.version} does not declare compatibility with game ${body.gameVersion}`), { code: 'VALIDATION' });
          if (requireReview) {
            const review = snapshot.reviews?.[version.artifactSha];
            if (!review || review.status !== 'approved' || !review.licenseConfirmed) throw Object.assign(new Error(`${entry.modId}@${entry.version} is not approved for redistribution`), { code: 'VALIDATION' });
          }
        }
        const pack = await store.mutate((draft) => {
          const existing = draft.packs[packId];
          const value = { id: packId, name: body.name, gameVersion: body.gameVersion, entries: body.entries, createdAt: existing?.createdAt || now(), updatedAt: now(), latestReleaseId: existing?.latestReleaseId || null };
          draft.packs[packId] = value;
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
          mods: pack.entries.map((entry) => {
            const version = snapshot.mods[entry.modId].versions[entry.version];
            return {
              id: entry.modId,
              version: entry.version,
              required: entry.required !== false,
              containsDll: version.containsDll,
              requiresRestart: version.requiresRestart,
              installRoots: version.installRoots,
              size: version.artifactSize,
              sha256: version.artifactSha,
              url: artifactPublicUrl(version.artifactSha, config, artifactBase)
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
        const publicAddress = String(body.publicAddress || '').trim();
        if (!can(owner, 'server.manage') && !publicAddress) throw Object.assign(new Error('publicAddress is required'), { code: 'VALIDATION' });
        if (publicAddress && Object.values(snapshot.servers).some((item) => String(item.publicAddress || '').trim().toLocaleLowerCase('en-US') === publicAddress.toLocaleLowerCase('en-US'))) {
          throw Object.assign(new Error('That public address is already registered'), { code: 'CONFLICT' });
        }
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
            publicAddress: publicAddress || null,
            ownerId: owner.bootstrap ? null : owner.id,
            tokenHash: tokenHash(token),
            createdAt: now(),
            lastSeenAt: null
          };
          recordAudit(draft, { actor: owner.username || owner.id, action: 'server.create', target: serverId, details: { packId: body.packId, publicAddress: publicAddress || null } });
        });
        return json(res, 201, { serverId, token, packId: body.packId, publicAddress: publicAddress || null, config: pluginConfig });
      }

      if (req.method === 'GET' && pathname === '/api/v1/public/servers/resolve') {
        const address = String(url.searchParams.get('address') || '').trim().toLocaleLowerCase('en-US');
        if (!address) return problem(res, 422, 'VALIDATION', 'address query parameter is required');
        const snapshot = store.snapshot();
        const server = Object.values(snapshot.servers).find((item) => String(item.publicAddress || '').trim().toLocaleLowerCase('en-US') === address);
        if (!server) return problem(res, 404, 'SERVER_NOT_FOUND', 'No registered server uses that public address');
        const pack = snapshot.packs[server.packId];
        const policy = handshakePolicy(snapshot, pack, signing, { launcherUrl, publicBaseUrl });
        return json(res, 200, {
          serverId: server.id,
          packId: server.packId,
          packVersion: policy.packVersion,
          gameVersion: policy.gameVersion,
          handshake: policy
        });
      }

      if (req.method === 'POST' && pathname === '/api/v1/public/handshakes') {
        const body = await readJson(req, 32 * 1024);
        const address = String(body.address || '').trim().toLocaleLowerCase('en-US');
        if (!address) return problem(res, 422, 'VALIDATION', 'address is required');
        const playerIds = normalizePlayerIds(body.playerIds, body.playerId);
        const hello = sanitizeHello(body.hello);
        const snapshot = store.snapshot();
        const server = Object.values(snapshot.servers).find((item) => String(item.publicAddress || '').trim().toLocaleLowerCase('en-US') === address);
        if (!server) return problem(res, 404, 'SERVER_NOT_FOUND', 'No registered server uses that public address');
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
        const acceptingPlayers = Boolean(release) && !policy.distributionPaused && server.sync?.ok !== false;
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
          if (body.publicAddress !== undefined) server.publicAddress = body.publicAddress || null;
          if (body.name) server.name = body.name;
          server.updatedAt = now();
          recordAudit(draft, { actor: principal.username || principal.id, action: 'server.update', target: server.id, reason: body.reason, details: { packId: server.packId, publicAddress: server.publicAddress } });
          return { id: server.id, name: server.name, packId: server.packId, publicAddress: server.publicAddress };
        });
        if (!result) return problem(res, 404, 'SERVER_NOT_FOUND', 'Server was not found');
        return json(res, 200, result);
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
        if (!requirePerm(req, res, 'platform.manage')) return;
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

      return problem(res, 404, 'NOT_FOUND', 'Route not found');
    } catch (error) {
      if (error.code === 'ENOENT') return problem(res, 404, 'NOT_FOUND', 'Requested file or object was not found');
      if (error.code === 'BODY_TOO_LARGE') return problem(res, 413, error.code, error.message);
      if (error.code === 'HASH_MISMATCH') return problem(res, 422, error.code, error.message, error.details);
      if (error.code === 'INVALID_CREDENTIALS') return problem(res, 401, error.code, error.message);
      if (error.code === 'RATE_LIMITED') return problem(res, 429, error.code, error.message);
      if (error.code === 'CONFLICT') return problem(res, 409, error.code, error.message);
      if (error.code === 'FORBIDDEN') return problem(res, 403, error.code, error.message);
      if (error.code === 'INVALID_INVITE') return problem(res, 422, error.code, error.message);
      if (error.code === 'INVALID_JSON' || error.code === 'VALIDATION') return problem(res, 422, error.code, error.message, error.details);
      console.error(error);
      logger?.error?.('unhandled', { error: error.message, stack: error.stack, method: req.method, path: pathname });
      return problem(res, 500, 'INTERNAL_ERROR', 'Unexpected server error');
    }
  }

  return handler;
}
