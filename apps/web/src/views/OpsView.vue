<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../api/client';
import UiCard from '../components/UiCard.vue';
import UiTable from '../components/UiTable.vue';
import { i18n, t } from '../i18n';
import { confirmAction, fail, ok } from '../lib/feedback';
import { prettyBytes } from '../lib/format';
import { can } from '../stores/session';

const stats = ref({ downloads: '—', bytes: '—', mods: '—', packs: '—', servers: '—', users: '—' });
const tableTitle = ref('');
const rows = ref<Record<string, unknown>[]>([]);
const cols = ref<string[]>([]);
const auditAction = ref('');
const reviewSha = ref('');
const launcherVersion = ref('');
const launcherPlatform = ref('win32');
const launcherSha = ref('');
const launcherNotes = ref('');
const launcherStatus = ref('');

function setTable(nextRows: unknown, nextCols: string[], title: string) {
  rows.value = Array.isArray(nextRows) ? nextRows as Record<string, unknown>[] : [];
  cols.value = nextCols;
  tableTitle.value = title;
}

async function loadStats(opts?: { silent?: boolean }) {
  try {
    const data = await api<any>('/api/v1/admin/stats');
    stats.value = {
      downloads: String(data.downloads ?? '—'),
      bytes: prettyBytes(data.bytes || 0),
      mods: String(data.mods ?? '—'),
      packs: String(data.packs ?? '—'),
      servers: String(data.servers ?? '—'),
      users: String(data.users ?? '—')
    };
    if (data.topArtifacts) setTable(data.topArtifacts, ['sha256', 'count'], t('ops.hot'));
    ok(data, t('ops.loadedStats'), opts?.silent);
  } catch (error) {
    fail(error);
  }
}

async function loadReviews() {
  try {
    const data = await api<{ reviews: Record<string, unknown>[] }>('/api/v1/reviews');
    setTable(data.reviews, ['sha256', 'fileName', 'status', 'size', 'createdAt'], t('ops.reviews'));
    ok(data, t('ops.loadedReviews'));
  } catch (error) {
    fail(error);
  }
}

async function loadMatrix() {
  try {
    const data = await api<{ rows: Record<string, unknown>[]; block?: { blocked?: boolean } }>('/api/v1/diagnostics/matrix');
    setTable(data.rows, ['gameVersion', 'mod', 'events', 'failCount', 'successCount', 'crashRate', 'conclusion'], data.block?.blocked ? t('ops.matrixBlocked') : t('ops.matrix'));
    ok(data, t('ops.loadedMatrix'));
  } catch (error) {
    fail(error);
  }
}

async function loadUsers() {
  try {
    const data = await api<{ users: Record<string, unknown>[] }>('/api/v1/users');
    setTable(data.users, ['username', 'role', 'totpEnabled', 'disabledAt', 'createdAt'], t('ops.usersTitle'));
    ok(data, t('ops.loadedUsers'));
  } catch (error) {
    fail(error);
  }
}

async function loadSessions() {
  try {
    const data = await api<{ sessions: Record<string, unknown>[] }>('/api/v1/sessions');
    setTable(data.sessions, ['userId', 'createdAt', 'expiresAt'], t('ops.sessionsTitle'));
    ok(data, t('ops.loadedSessions'));
  } catch (error) {
    fail(error);
  }
}

async function loadState() {
  try {
    const data = await api('/api/v1/admin/state');
    setTable([], [], t('ops.stateTitle'));
    ok(data, t('ops.loadedState'));
  } catch (error) {
    fail(error);
  }
}

async function loadAudit() {
  try {
    const data = await api<{ audit: Record<string, unknown>[] }>(`/api/v1/admin/audit${auditAction.value ? `?action=${encodeURIComponent(auditAction.value)}` : ''}`);
    setTable(data.audit, ['at', 'actor', 'action', 'target'], t('ops.audit'));
    ok(data, t('ops.loadedAudit'));
  } catch (error) {
    fail(error);
  }
}

function launcherStatusText(channels: Record<string, any>) {
  const items = Object.values(channels || {}).filter((item) => !item.revokedAt);
  if (!items.length) return t('ln.none');
  return items.map((item) => t('ln.current', { platform: item.platform, version: item.version })).join(' · ');
}

async function loadLauncher(opts?: { silent?: boolean }) {
  try {
    const data = await api<{ channels?: Record<string, any> }>('/api/v1/admin/launcher');
    launcherStatus.value = launcherStatusText(data.channels || {});
    const current = data.channels?.[launcherPlatform.value];
    if (current && !current.revokedAt) {
      if (!launcherVersion.value) launcherVersion.value = current.version || '';
      if (!launcherSha.value) launcherSha.value = current.sha256 || '';
    }
    if (!opts?.silent) ok(data, t('ln.loaded'));
  } catch (error) {
    if (!opts?.silent) fail(error);
  }
}

async function publishLauncher() {
  try {
    const token = await confirmAction('launcher.publish', t('ln.confirmPublish'));
    const result = await api('/api/v1/admin/launcher', {
      method: 'POST',
      body: JSON.stringify({
        sha256: launcherSha.value.trim(),
        version: launcherVersion.value.trim(),
        platform: launcherPlatform.value,
        notes: launcherNotes.value.trim() || undefined,
        confirmToken: token
      })
    });
    ok(result, t('ln.published'));
    await loadLauncher({ silent: true });
  } catch (error) {
    fail(error);
  }
}

async function revokeLauncher() {
  try {
    const token = await confirmAction('launcher.revoke', t('ln.confirmRevoke'));
    const result = await api('/api/v1/admin/launcher/revoke', {
      method: 'POST',
      body: JSON.stringify({ platform: launcherPlatform.value, confirmToken: token })
    });
    ok(result, t('ln.revoked'));
    await loadLauncher({ silent: true });
  } catch (error) {
    fail(error);
  }
}

async function approveReview() {
  try {
    const result = await api(`/api/v1/reviews/${reviewSha.value}`, {
      method: 'POST',
      body: JSON.stringify({ status: 'approved', licenseConfirmed: true })
    });
    ok(result, t('ops.approved'));
    await loadReviews();
  } catch (error) {
    fail(error);
  }
}

function pickRow(row: Record<string, unknown>) {
  if (row.sha256) {
    reviewSha.value = String(row.sha256);
    launcherSha.value = String(row.sha256);
  }
}

onMounted(async () => {
  tableTitle.value = t('ops.data');
  launcherStatus.value = t('ln.none');
  await Promise.all([loadStats({ silent: true }), can('platform.manage') ? loadLauncher({ silent: true }) : Promise.resolve()]);
});
</script>

<template>
  <div class="space-y-6" :data-lang="i18n.lang">
    <div class="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <div v-for="item in [
        { value: stats.downloads, label: t('ops.downloads') },
        { value: stats.bytes, label: t('ops.bytes') },
        { value: stats.mods, label: t('nav.mods') },
        { value: stats.packs, label: t('nav.packs') },
        { value: stats.servers, label: t('nav.servers') },
        { value: stats.users, label: t('ops.usersTitle') }
      ]" :key="item.label" class="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]">
        <b class="block text-2xl text-brand-500">{{ item.value }}</b>
        <span class="text-theme-xs text-gray-500">{{ item.label }}</span>
      </div>
    </div>
    <div class="grid gap-6 xl:grid-cols-2">
      <UiCard :title="t('ops.quick')">
        <div class="flex flex-wrap gap-2">
          <button type="button" class="btn-secondary" @click="loadReviews">{{ t('ops.reviews') }}</button>
          <button type="button" class="btn-secondary" @click="loadMatrix">{{ t('ops.matrix') }}</button>
          <button type="button" class="btn-secondary" @click="loadStats()">{{ t('ops.stats') }}</button>
          <button type="button" class="btn-secondary" @click="loadUsers">{{ t('ops.users') }}</button>
          <button type="button" class="btn-secondary" @click="loadSessions">{{ t('ops.sessions') }}</button>
          <button type="button" class="btn-secondary" @click="loadState">{{ t('ops.state') }}</button>
        </div>
      </UiCard>
      <UiCard v-if="can('platform.manage')" :title="t('ln.title')" :desc="t('ln.hint')">
        <p class="text-sm text-gray-500">{{ launcherStatus }}</p>
        <div class="grid gap-3 sm:grid-cols-2">
          <div><label class="field">{{ t('ln.version') }}</label><input v-model="launcherVersion" class="input" placeholder="0.3.1"></div>
          <div>
            <label class="field">{{ t('ln.platform') }}</label>
            <select v-model="launcherPlatform" class="input">
              <option value="win32">win32</option>
              <option value="linux">linux</option>
              <option value="darwin">darwin</option>
            </select>
          </div>
        </div>
        <label class="field">{{ t('ln.sha') }}</label>
        <input v-model="launcherSha" class="input" :placeholder="t('ln.phSha')">
        <label class="field">{{ t('ln.notes') }}</label>
        <input v-model="launcherNotes" class="input" :placeholder="t('ln.phNotes')">
        <div class="flex flex-wrap gap-2">
          <button type="button" class="btn-secondary" @click="loadLauncher()">{{ t('ln.refresh') }}</button>
          <button type="button" class="btn-primary" @click="publishLauncher">{{ t('ln.publish') }}</button>
          <button type="button" class="btn-secondary" @click="revokeLauncher">{{ t('ln.revoke') }}</button>
        </div>
      </UiCard>
    </div>
    <UiCard :title="t('ops.auditTitle')">
      <div class="grid gap-3 sm:grid-cols-2">
        <div><label class="field">{{ t('ops.auditAction') }}</label><input v-model="auditAction" class="input" :placeholder="t('ops.phAction')"></div>
        <div><label class="field">{{ t('ops.reviewSha') }}</label><input v-model="reviewSha" class="input" :placeholder="t('ops.phSha')"></div>
      </div>
      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn-secondary" @click="loadAudit">{{ t('ops.queryAudit') }}</button>
        <button type="button" class="btn-ok" @click="approveReview">{{ t('ops.approve') }}</button>
      </div>
    </UiCard>
    <UiCard :title="tableTitle || t('ops.data')" :desc="t('ops.pickSha')">
      <UiTable :rows="rows" :cols="cols.length ? cols : ['id']" @pick="pickRow" />
      <p v-if="!rows.length" class="text-sm text-gray-500">{{ t('ops.pickOp') }}</p>
    </UiCard>
  </div>
</template>
