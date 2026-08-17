<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api/client';
import HierarchyItem from '../components/HierarchyItem.vue';
import HierarchyShell from '../components/HierarchyShell.vue';
import UiTable from '../components/UiTable.vue';
import { i18n, t } from '../i18n';
import { confirmAction, fail, ok } from '../lib/feedback';
import { prettyBytes } from '../lib/format';
import { can } from '../stores/session';

const route = useRoute();
const router = useRouter();
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
const pauseReason = ref('');
const paused = ref(false);

const section = computed(() => String(route.params.section || 'overview'));
const sections = computed(() => [
  { id: 'overview', title: t('ops.navOverview'), hint: t('ops.stats') },
  ...(can('distribution.pause') ? [{ id: 'pause', title: t('ops.navPause'), hint: paused.value ? t('srv.pauseOn') : t('srv.pauseOff') }] : []),
  { id: 'reviews', title: t('ops.navReviews'), hint: t('ops.reviews') },
  { id: 'matrix', title: t('ops.navMatrix'), hint: t('ops.matrix') },
  { id: 'users', title: t('ops.navUsers'), hint: t('ops.usersTitle') },
  { id: 'sessions', title: t('ops.navSessions'), hint: t('ops.sessionsTitle') },
  { id: 'audit', title: t('ops.navAudit'), hint: t('ops.audit') },
  ...(can('platform.manage') ? [{ id: 'launcher', title: t('ops.navLauncher'), hint: t('ln.title') }] : [])
]);

function setTable(nextRows: unknown, nextCols: string[], title: string) {
  rows.value = Array.isArray(nextRows) ? nextRows as Record<string, unknown>[] : [];
  cols.value = nextCols;
  tableTitle.value = title;
}

function selectSection(id: string) {
  if (id === 'overview') {
    if (route.params.section) router.push('/ops');
    return;
  }
  if (route.params.section !== id) router.push(`/ops/${id}`);
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

async function loadPauseState() {
  try {
    const status = await api<{ distributionPaused?: boolean }>('/status');
    paused.value = Boolean(status.distributionPaused);
  } catch {
    /* keep last known */
  }
}

async function pause(next: boolean) {
  try {
    const token = await confirmAction(next ? 'distribution.pause' : 'distribution.resume', next ? t('srv.confirmPause') : t('srv.confirmResume'));
    const result = await api('/api/v1/admin/distribution', {
      method: 'POST',
      body: JSON.stringify({ paused: next, reason: pauseReason.value || undefined, confirmToken: token })
    });
    ok(result, next ? t('srv.paused') : t('srv.resumed'));
    await loadPauseState();
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

async function loadSection(id: string) {
  if (id === 'overview') await loadStats({ silent: true });
  else if (id === 'reviews') await loadReviews();
  else if (id === 'matrix') await loadMatrix();
  else if (id === 'users') await loadUsers();
  else if (id === 'sessions') await loadSessions();
  else if (id === 'audit') await loadAudit();
  else if (id === 'launcher' && can('platform.manage')) await loadLauncher({ silent: true });
}

watch(section, (id) => {
  loadSection(id);
}, { immediate: true });

onMounted(async () => {
  tableTitle.value = t('ops.data');
  launcherStatus.value = t('ln.none');
  await Promise.all([
    loadPauseState(),
    can('platform.manage') ? loadLauncher({ silent: true }) : Promise.resolve()
  ]);
});
</script>

<template>
  <div :data-lang="i18n.lang">
    <HierarchyShell>
      <template #list>
        <HierarchyItem
          v-for="item in sections"
          :key="item.id"
          :title="item.title"
          :hint="item.hint"
          :active="section === item.id"
          @click="selectSection(item.id)"
        />
      </template>

      <div v-if="section === 'overview'" class="grid grid-cols-2 gap-3 md:grid-cols-3">
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

      <div v-if="section === 'overview'" class="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
        <p class="mb-3 text-theme-xs font-medium uppercase tracking-wide text-gray-400">{{ tableTitle || t('ops.hot') }}</p>
        <UiTable :rows="rows" :cols="cols.length ? cols : ['id']" @pick="pickRow" />
        <p v-if="!rows.length" class="text-sm text-gray-500">{{ t('ops.pickOp') }}</p>
        <button type="button" class="btn-secondary mt-3" @click="loadState">{{ t('ops.state') }}</button>
      </div>

      <div v-if="section === 'pause' && can('distribution.pause')" class="rounded-2xl border border-error-500/30 bg-white p-5 dark:border-error-500/20 dark:bg-white/[0.03]">
        <p class="mb-3 text-theme-xs font-medium uppercase tracking-wide text-gray-400">{{ t('ops.navPause') }}</p>
        <p class="mb-3 text-sm text-gray-500">{{ t('srv.pauseHint') }}</p>
        <p class="rounded-lg px-3 py-2 text-sm" :class="paused ? 'bg-error-500/10 text-error-500' : 'bg-success-500/10 text-success-500'">
          {{ paused ? t('srv.pauseOn') : t('srv.pauseOff') }}
        </p>
        <label class="field">{{ t('srv.pauseReason') }}</label>
        <input v-model="pauseReason" class="input" :placeholder="t('srv.phReason')">
        <div class="mt-3 flex flex-wrap gap-2">
          <button type="button" class="btn-danger" @click="pause(true)">{{ t('srv.pause') }}</button>
          <button type="button" class="btn-ok" @click="pause(false)">{{ t('srv.resume') }}</button>
        </div>
      </div>

      <div v-if="section === 'reviews'" class="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
        <p class="mb-3 text-theme-xs font-medium uppercase tracking-wide text-gray-400">{{ t('ops.navReviews') }}</p>
        <label class="field">{{ t('ops.reviewSha') }}</label>
        <input v-model="reviewSha" class="input" :placeholder="t('ops.phSha')">
        <div class="mt-3 flex flex-wrap gap-2">
          <button type="button" class="btn-secondary" @click="loadReviews">{{ t('ops.reviews') }}</button>
          <button type="button" class="btn-ok" @click="approveReview">{{ t('ops.approve') }}</button>
        </div>
        <p class="mt-3 text-theme-xs text-gray-500">{{ t('ops.pickSha') }}</p>
        <UiTable class="mt-3" :rows="rows" :cols="cols.length ? cols : ['id']" @pick="pickRow" />
      </div>

      <div v-if="section === 'matrix'" class="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
        <p class="mb-3 text-theme-xs font-medium uppercase tracking-wide text-gray-400">{{ tableTitle || t('ops.navMatrix') }}</p>
        <button type="button" class="btn-secondary mb-3" @click="loadMatrix">{{ t('ops.matrix') }}</button>
        <UiTable :rows="rows" :cols="cols.length ? cols : ['id']" @pick="pickRow" />
      </div>

      <div v-if="section === 'users'" class="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
        <p class="mb-3 text-theme-xs font-medium uppercase tracking-wide text-gray-400">{{ t('ops.navUsers') }}</p>
        <button type="button" class="btn-secondary mb-3" @click="loadUsers">{{ t('ops.users') }}</button>
        <UiTable :rows="rows" :cols="cols.length ? cols : ['id']" />
      </div>

      <div v-if="section === 'sessions'" class="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
        <p class="mb-3 text-theme-xs font-medium uppercase tracking-wide text-gray-400">{{ t('ops.navSessions') }}</p>
        <button type="button" class="btn-secondary mb-3" @click="loadSessions">{{ t('ops.sessions') }}</button>
        <UiTable :rows="rows" :cols="cols.length ? cols : ['id']" />
      </div>

      <div v-if="section === 'audit'" class="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
        <p class="mb-3 text-theme-xs font-medium uppercase tracking-wide text-gray-400">{{ t('ops.navAudit') }}</p>
        <label class="field">{{ t('ops.auditAction') }}</label>
        <input v-model="auditAction" class="input mb-3" :placeholder="t('ops.phAction')">
        <button type="button" class="btn-secondary mb-3" @click="loadAudit">{{ t('ops.queryAudit') }}</button>
        <UiTable :rows="rows" :cols="cols.length ? cols : ['id']" />
      </div>

      <div v-if="section === 'launcher' && can('platform.manage')" class="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
        <p class="mb-3 text-theme-xs font-medium uppercase tracking-wide text-gray-400">{{ t('ops.navLauncher') }}</p>
        <p class="mb-3 text-sm text-gray-500">{{ t('ln.hint') }}</p>
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
        <div class="mt-3 flex flex-wrap gap-2">
          <button type="button" class="btn-secondary" @click="loadLauncher()">{{ t('ln.refresh') }}</button>
          <button type="button" class="btn-primary" @click="publishLauncher">{{ t('ln.publish') }}</button>
          <button type="button" class="btn-secondary" @click="revokeLauncher">{{ t('ln.revoke') }}</button>
        </div>
      </div>
    </HierarchyShell>
  </div>
</template>
