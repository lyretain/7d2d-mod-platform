export function classifyFingerprint(item) {
  const success = item.successCount || 0;
  const fail = item.failCount || item.count || 0;
  const total = success + fail;
  const rate = total ? fail / total : 0;
  if (total >= 8 && rate >= 0.7) return 'confirmed';
  if (total >= 4 && rate >= 0.4) return 'suspected';
  return 'unknown';
}

const crashStages = new Set(['unhandled_exception', 'unobserved_task', 'crash']);
const successStages = new Set(['successful_session', 'plugin_initialized', 'pack_sync_ok', 'pack_sync_current']);

function isSuccessEvent(event) {
  return event?.exceptionType === 'Success' || successStages.has(event?.stage);
}

function isCrashEvent(event) {
  return crashStages.has(event?.stage);
}

export function ingestDiagnostic(draft, event) {
  draft.diagnostics.push(event);
  if (draft.diagnostics.length > 10_000) draft.diagnostics.splice(0, draft.diagnostics.length - 10_000);
  const fingerprint = draft.fingerprints[event.fingerprint] || {
    fingerprint: event.fingerprint,
    count: 0,
    successCount: 0,
    failCount: 0,
    firstSeenAt: event.receivedAt,
    lastSeenAt: event.receivedAt,
    gameVersions: {},
    packs: {},
    mods: {},
    sampleEventId: event.id,
    conclusion: 'unknown',
    dismissed: false
  };
  const success = isSuccessEvent(event);
  fingerprint.count += 1;
  if (success) fingerprint.successCount += 1;
  else if (isCrashEvent(event)) fingerprint.failCount += 1;
  fingerprint.lastSeenAt = event.receivedAt;
  fingerprint.gameVersions[event.gameVersion] = (fingerprint.gameVersions[event.gameVersion] || 0) + 1;
  if (event.packId) fingerprint.packs[event.packId] = (fingerprint.packs[event.packId] || 0) + 1;
  for (const mod of event.mods || []) {
    const key = `${mod.id}@${mod.version}`;
    fingerprint.mods[key] = (fingerprint.mods[key] || 0) + 1;
  }
  fingerprint.conclusion = classifyFingerprint(fingerprint);
  draft.fingerprints[event.fingerprint] = fingerprint;
  return fingerprint;
}

export function compatibilityMatrix(snapshot) {
  const rows = [];
  for (const item of Object.values(snapshot.fingerprints || {})) {
    for (const [gameVersion, count] of Object.entries(item.gameVersions || {})) {
      for (const [mod, modCount] of Object.entries(item.mods || { unknown: count })) {
        rows.push({
          gameVersion,
          mod,
          events: Math.min(count, modCount),
          failCount: item.failCount || 0,
          successCount: item.successCount || 0,
          crashRate: (item.successCount + item.failCount) ? item.failCount / (item.successCount + item.failCount) : 0,
          conclusion: item.dismissed ? 'unknown' : item.conclusion
        });
      }
    }
  }
  return rows.sort((a, b) => b.crashRate - a.crashRate);
}

export function shouldBlockInstalls(snapshot, { threshold = 0.35, minSamples = 8 } = {}) {
  const events = snapshot.diagnostics || [];
  const totals = events.reduce((acc, event) => {
    if (isSuccessEvent(event)) acc.ok += 1;
    else if (isCrashEvent(event)) acc.fail += 1;
    return acc;
  }, { fail: 0, ok: 0 });
  const samples = totals.fail + totals.ok;
  const rate = samples ? totals.fail / samples : 0;
  return { blocked: samples >= minSamples && rate >= threshold, samples, rate };
}

export function pruneDiagnostics(draft, { diagnosticDays = 30, auditDays = 365 } = {}) {
  const diagnosticCutoff = Date.now() - diagnosticDays * 86400_000;
  const auditCutoff = Date.now() - auditDays * 86400_000;
  draft.diagnostics = (draft.diagnostics || []).filter((item) => Date.parse(item.receivedAt || item.occurredAt || 0) >= diagnosticCutoff);
  draft.audit = (draft.audit || []).filter((item) => Date.parse(item.at || 0) >= auditCutoff);
  return { diagnostics: draft.diagnostics.length, audit: draft.audit.length };
}
