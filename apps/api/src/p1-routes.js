import { analyzeZipFile, scanFile } from './analyze.js';
import { filterAudit, issueConfirm, listModContents, listMods, listPacks, listServers, packDetail, platformStats } from './catalog.js';
import { artifactPublicUrl, purgeCloudflare } from './cloudflare.js';
import { compatibilityMatrix, pruneDiagnostics, shouldBlockInstalls } from './compatibility.js';
import { notify } from './alerts.js';
import { referencedHashes } from './objects.js';
import { recordAudit } from './protocol.js';
import { json, now, problem, readJson, requireFields } from './util.js';
import { can, canViewAdult, denyReason } from './roles.js';

export async function handleP1(req, res, ctx) {
  const { pathname, store, auth, signing, objects, metrics, config, requireReview = false } = ctx;
  const principal = () => auth.principal(req);
  const requirePerm = (permission) => {
    const user = principal();
    const reason = denyReason(user, permission);
    if (!reason) return user;
    problem(res, user ? 403 : 401, user ? 'FORBIDDEN' : 'UNAUTHORIZED', reason === 'GitHub binding required' ? 'Community admins must bind GitHub first' : (user ? 'Insufficient role' : 'Login required'));
    return null;
  };
  const requireAdmin = () => requirePerm('platform.manage');
  const requireUser = () => {
    const user = principal();
    if (user) return user;
    problem(res, 401, 'UNAUTHORIZED', 'Login required');
    return null;
  };

  if (req.method === 'GET' && pathname === '/health/live') return json(res, 200, { status: 'live', time: now() }), true;
  if (req.method === 'GET' && pathname === '/health/ready') {
    const [database, objectStore, signer] = await Promise.all([
      store.ready ? store.ready() : { ok: true, driver: 'json' },
      objects.ready(),
      signing.ready()
    ]);
    const ok = database.ok && objectStore.ok && signer.ok;
    return json(res, ok ? 200 : 503, { status: ok ? 'ready' : 'degraded', database, objectStore, signer }), true;
  }
  if (req.method === 'GET' && pathname === '/metrics') {
    if (!requireUser()) return true;
    return json(res, 200, metrics.snapshot()), true;
  }
  if (req.method === 'GET' && pathname === '/status') {
    const snapshot = store.snapshot();
    return json(res, 200, {
      status: snapshot.maintenance?.enabled ? 'maintenance' : 'ok',
      message: snapshot.maintenance?.message || null,
      distributionPaused: Boolean(snapshot.settings?.distributionPaused),
      initialized: Object.keys(snapshot.users || {}).length > 0
    }), true;
  }

  if (req.method === 'POST' && pathname === '/api/v1/auth/login/totp') {
    const body = await readJson(req, 32 * 1024);
    requireFields(body, ['ticket', 'code']);
    return json(res, 200, await auth.completeTotp(body.ticket, body.code)), true;
  }
  if (req.method === 'POST' && pathname === '/api/v1/auth/password/reset') {
    const body = await readJson(req, 32 * 1024);
    requireFields(body, ['token', 'password']);
    return json(res, 200, await auth.consumePasswordReset(body.token, body.password)), true;
  }
  if (req.method === 'GET' && pathname === '/api/v1/users') {
    if (!requirePerm('users.manage')) return true;
    return json(res, 200, { users: await auth.listUsers() }), true;
  }
  const userMatch = pathname.match(/^\/api\/v1\/users\/([^/]+)$/);
  if (req.method === 'PATCH' && userMatch) {
    if (!requirePerm('users.manage')) return true;
    const body = await readJson(req, 32 * 1024);
    const actor = principal().username;
    let result = null;
    if (body.disabled !== undefined) result = await auth.setUserDisabled(userMatch[1], Boolean(body.disabled), actor);
    if (body.role) result = await auth.setUserRole(userMatch[1], body.role, actor);
    if (!result) return problem(res, 404, 'USER_NOT_FOUND', 'User was not found'), true;
    return json(res, 200, result), true;
  }
  if (req.method === 'POST' && pathname === '/api/v1/auth/password') {
    const user = requireUser();
    if (!user) return true;
    const body = await readJson(req, 32 * 1024);
    requireFields(body, ['currentPassword', 'password']);
    return json(res, 200, await auth.changePassword(user.id, body.currentPassword, body.password)), true;
  }
  const userReset = pathname.match(/^\/api\/v1\/users\/([^/]+)\/reset$/);
  if (req.method === 'POST' && userReset) {
    if (!requirePerm('users.manage')) return true;
    return json(res, 201, await auth.createPasswordReset(userReset[1], principal().username)), true;
  }
  if (req.method === 'GET' && pathname === '/api/v1/sessions') {
    const user = requireUser();
    if (!user) return true;
    return json(res, 200, { sessions: auth.listSessions(can(user, 'users.manage') ? undefined : user.id) }), true;
  }
  const sessionMatch = pathname.match(/^\/api\/v1\/sessions\/([^/]+)$/);
  if (req.method === 'DELETE' && sessionMatch) {
    if (!requireUser()) return true;
    return json(res, 200, { revoked: await auth.revokeSession(sessionMatch[1], principal().username) }), true;
  }
  const userSessions = pathname.match(/^\/api\/v1\/users\/([^/]+)\/sessions$/);
  if (req.method === 'DELETE' && userSessions) {
    if (!requirePerm('users.manage')) return true;
    return json(res, 200, await auth.revokeUserSessions(userSessions[1], principal().username)), true;
  }
  if (req.method === 'POST' && pathname === '/api/v1/auth/totp/setup') {
    const user = requireUser();
    if (!user) return true;
    return json(res, 201, await auth.enableTotp(user.id)), true;
  }
  if (req.method === 'POST' && pathname === '/api/v1/auth/totp/confirm') {
    const user = requireUser();
    if (!user) return true;
    const body = await readJson(req, 32 * 1024);
    requireFields(body, ['code']);
    return json(res, 200, await auth.confirmTotp(user.id, body.code)), true;
  }

  if (req.method === 'GET' && pathname === '/api/v1/reviews') {
    if (!requireUser()) return true;
    return json(res, 200, { reviews: Object.values(store.snapshot().reviews || {}) }), true;
  }
  const reviewMatch = pathname.match(/^\/api\/v1\/reviews\/([a-f0-9]{64})$/);
  if (req.method === 'POST' && reviewMatch) {
    if (!requirePerm('review.approve')) return true;
    const body = await readJson(req, 32 * 1024);
    const result = await store.mutate((draft) => {
      const review = draft.reviews[reviewMatch[1]];
      if (!review) return null;
      review.status = body.status || 'approved';
      review.licenseConfirmed = Boolean(body.licenseConfirmed);
      review.license = body.license || review.license;
      review.source = body.source || review.source;
      review.author = body.author || review.author;
      review.reviewedBy = principal().id;
      review.reviewedAt = now();
      recordAudit(draft, { actor: principal().username, action: 'review.update', target: review.sha256, details: { status: review.status } });
      return review;
    });
    if (!result) return problem(res, 404, 'REVIEW_NOT_FOUND', 'Review was not found'), true;
    return json(res, 200, result), true;
  }
  if (req.method === 'POST' && pathname === '/api/v1/bans') {
    if (!requireAdmin()) return true;
    const body = await readJson(req, 32 * 1024);
    requireFields(body, ['sha256']);
    const result = await store.mutate((draft) => {
      draft.bannedHashes[body.sha256] = { sha256: body.sha256, reason: body.reason || null, createdAt: now(), createdBy: principal().id };
      recordAudit(draft, { actor: principal().username, action: 'hash.ban', target: body.sha256, reason: body.reason });
      return draft.bannedHashes[body.sha256];
    });
    await purgeCloudflare(config, [artifactPublicUrl(body.sha256, config, config.cdnBaseUrl || config.publicBaseUrl)]);
    return json(res, 201, result), true;
  }
  if (req.method === 'POST' && pathname === '/api/v1/admin/gc') {
    if (!requireAdmin()) return true;
    const snapshot = store.snapshot();
    const referenced = referencedHashes(snapshot);
    const local = await objects.listLocal();
    const removed = [];
    for (const sha of local) {
      if (!referenced.has(sha)) {
        await objects.remove(sha);
        removed.push(sha);
      }
    }
    const pruned = await store.mutate((draft) => {
      const value = pruneDiagnostics(draft, { diagnosticDays: config.diagnosticRetentionDays, auditDays: config.auditRetentionDays });
      recordAudit(draft, { actor: principal().username, action: 'admin.gc', details: { removedCount: removed.length, diagnostics: value.diagnostics, audit: value.audit } });
      return value;
    });
    if (removed.length) await purgeCloudflare(config, removed.map((sha) => artifactPublicUrl(sha, config, config.cdnBaseUrl || config.publicBaseUrl)));
    return json(res, 200, { removed, ...pruned, consistent: removed.length === 0 }), true;
  }
  if (req.method === 'GET' && pathname === '/api/v1/diagnostics/matrix') {
    if (!requireUser()) return true;
    return json(res, 200, { rows: compatibilityMatrix(store.snapshot()), block: shouldBlockInstalls(store.snapshot(), { threshold: config.crashRateBlockThreshold, minSamples: config.crashRateMinSamples }) }), true;
  }
  const dismiss = pathname.match(/^\/api\/v1\/diagnostics\/fingerprints\/([^/]+)\/dismiss$/);
  if (req.method === 'POST' && dismiss) {
    if (!requireAdmin()) return true;
    const result = await store.mutate((draft) => {
      const item = draft.fingerprints[dismiss[1]];
      if (!item) return null;
      item.dismissed = true;
      item.conclusion = 'unknown';
      recordAudit(draft, { actor: principal().username, action: 'diagnostic.dismiss', target: item.id || dismiss[1] });
      return item;
    });
    if (!result) return problem(res, 404, 'NOT_FOUND', 'Fingerprint was not found'), true;
    return json(res, 200, result), true;
  }
  if (req.method === 'DELETE' && pathname === '/api/v1/diagnostics') {
    const user = requireUser();
    if (!user) return true;
    const body = await readJson(req, 32 * 1024);
    await store.mutate((draft) => {
      draft.diagnostics = (draft.diagnostics || []).filter((item) => body.sessionId ? item.sessionId !== body.sessionId : item.id !== body.eventId);
      recordAudit(draft, { actor: user.username, action: 'diagnostic.delete', details: { sessionId: body.sessionId || null, eventId: body.eventId || null } });
    });
    return json(res, 200, { deleted: true }), true;
  }
  if (req.method === 'POST' && pathname === '/api/v1/admin/webhooks') {
    if (!requireAdmin()) return true;
    const body = await readJson(req, 32 * 1024);
    requireFields(body, ['url']);
    const hook = await store.mutate((draft) => {
      const value = { id: `hook_${Date.now()}`, url: body.url, createdAt: now() };
      draft.webhooks.push(value);
      recordAudit(draft, { actor: principal().username, action: 'webhook.create', target: value.id });
      return value;
    });
    return json(res, 201, hook), true;
  }
  if (req.method === 'POST' && pathname === '/api/v1/admin/maintenance') {
    if (!requireAdmin()) return true;
    const body = await readJson(req, 32 * 1024);
    const maintenance = await store.mutate((draft) => {
      draft.maintenance = { enabled: Boolean(body.enabled), message: body.message || null };
      recordAudit(draft, { actor: principal().username, action: 'maintenance', target: 'platform', details: draft.maintenance });
      return draft.maintenance;
    });
    return json(res, 200, maintenance), true;
  }
  if (req.method === 'POST' && pathname === '/api/v1/admin/signing/rotate') {
    if (!requireAdmin()) return true;
    const rotated = await signing.rotateLocal();
    await store.mutate((draft) => {
      recordAudit(draft, { actor: principal().username, action: 'signing.rotate', target: rotated.keyId || 'local' });
    });
    return json(res, 200, rotated), true;
  }
  if (req.method === 'POST' && pathname === '/api/v1/admin/alerts/test') {
    if (!requireAdmin()) return true;
    await store.mutate((draft) => {
      recordAudit(draft, { actor: principal().username, action: 'admin.alert_test', target: 'platform' });
    });
    return json(res, 200, await notify(config.webhookUrl, { type: 'test', message: 'Alert channel is reachable' })), true;
  }
  if (req.method === 'GET' && pathname === '/api/v1/mods') {
    if (!requireUser()) return true;
    const url = new URL(req.url, 'http://localhost');
    const user = principal();
    return json(res, 200, { mods: listMods(store.snapshot(), url.searchParams.get('q'), { gameVersion: url.searchParams.get('gameVersion'), dll: url.searchParams.get('dll'), requireReview, adultVerified: canViewAdult(user) }) }), true;
  }
  const modMatch = pathname.match(/^\/api\/v1\/mods\/([^/]+)$/);
  if (req.method === 'GET' && modMatch) {
    if (!requireUser()) return true;
    const snapshot = store.snapshot();
    const user = principal();
    const adultVerified = canViewAdult(user);
    const mods = listMods(snapshot, '', { requireReview, adultVerified }).filter((item) => item.id === modMatch[1]);
    if (!mods[0]) return problem(res, 404, 'MOD_NOT_FOUND', 'Mod was not found'), true;
    return json(res, 200, {
      ...mods[0],
      contents: listModContents(snapshot, mods[0].id, {
        includePending: Boolean(can(user, 'catalog.write')),
        requireReview,
        viewerId: user?.id,
        adultVerified: canViewAdult(user, { staff: can(user, 'catalog.write') })
      })
    }), true;
  }
  if (req.method === 'GET' && pathname === '/api/v1/packs') {
    if (!requireUser()) return true;
    return json(res, 200, { packs: listPacks(store.snapshot()) }), true;
  }
  const packMatch = pathname.match(/^\/api\/v1\/packs\/([^/]+)$/);
  if (req.method === 'GET' && packMatch) {
    if (!requireUser()) return true;
    const detail = packDetail(store.snapshot(), packMatch[1]);
    if (!detail) return problem(res, 404, 'PACK_NOT_FOUND', 'ModPack was not found'), true;
    return json(res, 200, detail), true;
  }
  if (req.method === 'GET' && pathname === '/api/v1/servers') {
    if (!requireUser()) return true;
    return json(res, 200, { servers: listServers(store.snapshot()) }), true;
  }
  if (req.method === 'GET' && pathname === '/api/v1/admin/stats') {
    if (!requireUser()) return true;
    return json(res, 200, platformStats(store.snapshot())), true;
  }
  if (req.method === 'GET' && pathname === '/api/v1/admin/audit') {
    if (!requireUser()) return true;
    const url = new URL(req.url, 'http://localhost');
    return json(res, 200, { audit: filterAudit(store.snapshot(), { action: url.searchParams.get('action'), actor: url.searchParams.get('actor'), from: url.searchParams.get('from'), to: url.searchParams.get('to'), limit: url.searchParams.get('limit') }) }), true;
  }
  if (req.method === 'POST' && pathname === '/api/v1/admin/confirm') {
    const body = await readJson(req, 32 * 1024);
    requireFields(body, ['action']);
    const confirmPerm = body.action === 'distribution.pause' || body.action === 'distribution.resume'
      ? 'distribution.pause'
      : 'platform.manage';
    if (!requirePerm(confirmPerm)) return true;
    const issued = await store.mutate((draft) => {
      const value = issueConfirm(draft, { action: body.action, actor: principal().username });
      recordAudit(draft, { actor: principal().username, action: 'admin.confirm', details: { action: body.action } });
      return value;
    });
    return json(res, 201, issued), true;
  }
  if (req.method === 'POST' && pathname === '/api/v1/admin/cdn/purge') {
    if (!requireAdmin()) return true;
    const body = await readJson(req, 32 * 1024);
    const result = await purgeCloudflare(config, body.urls || []);
    await store.mutate((draft) => {
      recordAudit(draft, { actor: principal().username, action: 'cdn.purge', details: { urlCount: (body.urls || []).length } });
    });
    return json(res, 200, result), true;
  }
  if (req.method === 'POST' && pathname === '/api/v1/artifacts/analyze') {
    if (!requireAdmin()) return true;
    const body = await readJson(req, 32 * 1024);
    requireFields(body, ['sha256']);
    const analysis = await analyzeZipFile(`${objects.localDir}/${body.sha256}`, body.fileName);
    const scan = config.production ? await scanFile(`${objects.localDir}/${body.sha256}`) : { skipped: true, ok: true };
    return json(res, 200, { analysis, scan }), true;
  }
  return false;
}
