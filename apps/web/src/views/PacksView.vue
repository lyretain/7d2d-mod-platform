<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api/client';
import UiCard from '../components/UiCard.vue';
import UiTable from '../components/UiTable.vue';
import { i18n, t } from '../i18n';
import { confirmAction, fail, ok } from '../lib/feedback';
import { catalog, loadMods, loadPacks, packOptionLabel, type PackRow } from '../stores/catalog';

const router = useRouter();
const packId = ref('');
const packName = ref('');
const packGame = ref('');
const releaseReason = ref('');
const releasePackId = ref('');
const releaseId = ref('');
const selectedEntries = ref<string[]>([]);
const menuOpen = ref(false);
const selectedPack = ref(-1);
const selectedRelease = ref(-1);
const releases = ref<Record<string, unknown>[]>([]);

const options = computed(() => {
  const rows: Array<{ value: string; title: string; hint: string }> = [];
  catalog.mods.forEach((mod) => {
    (mod.versions || []).forEach((ver) => {
      rows.push({
        value: `${mod.id}@${ver.version}`,
        title: `${mod.name || mod.id} @ ${ver.version}`,
        hint: mod.id + (ver.gameVersions?.length ? ` · ${t('pack.gameHint', { games: ver.gameVersions.join('/') })}${ver.gameVersionRange === 'major' ? ` ${t('pack.generic')}` : ''}` : '')
      });
    });
  });
  return rows;
});

const toggleLabel = computed(() => {
  if (!catalog.mods.length) return t('pack.pickEmpty');
  if (!selectedEntries.value.length) return t('pack.pick');
  return selectedEntries.value.join('，');
});

function entries() {
  const existing = catalog.packs.find((item) => item.id === packId.value);
  return selectedEntries.value.map((value) => {
    const at = value.lastIndexOf('@');
    const modId = value.slice(0, at);
    const version = value.slice(at + 1);
    const prev = existing?.entries?.find((entry) => entry.modId === modId);
    return { modId, version, required: true, ...(prev?.contents ? { contents: prev.contents } : {}) };
  }).filter((entry) => entry.modId && entry.version);
}

function closeMenu(event: MouseEvent) {
  const target = event.target as HTMLElement;
  if (!target.closest('#packEntryPicker')) menuOpen.value = false;
}

function newPack() {
  packId.value = '';
  packName.value = '';
  packGame.value = '';
  selectedEntries.value = [];
  selectedPack.value = -1;
}

async function publishPack() {
  try {
    const chosen = entries();
    if (!chosen.length) throw new Error(t('pack.needMod'));
    const body: Record<string, unknown> = { name: packName.value, gameVersion: packGame.value, entries: chosen };
    if (packId.value.trim()) body.id = packId.value.trim();
    const pack = await api<{ id: string }>('/api/v1/packs', { method: 'POST', body: JSON.stringify(body) });
    packId.value = pack.id || '';
    releasePackId.value = pack.id;
    const release = await api(`/api/v1/packs/${encodeURIComponent(pack.id)}/releases`, {
      method: 'POST',
      body: JSON.stringify({ reason: releaseReason.value || 'publish' })
    });
    ok(release, t('pack.published'));
    await loadPacks({ silent: true });
    await listReleases({ silent: true });
  } catch (error) {
    fail(error);
  }
}

async function listReleases(opts?: { silent?: boolean }) {
  try {
    const data = await api<{ releases: Record<string, unknown>[]; packId?: string }>(`/api/v1/packs/${encodeURIComponent(releasePackId.value || packId.value)}/releases`);
    releases.value = data.releases || [];
    ok(data, t('pack.releasesLoaded'), opts?.silent);
  } catch (error) {
    fail(error);
  }
}

async function revokeRelease() {
  try {
    const token = await confirmAction('release.revoke', t('pack.confirmRevoke'));
    const result = await api(`/api/v1/packs/${encodeURIComponent(releasePackId.value || packId.value)}/releases/${encodeURIComponent(releaseId.value)}/revoke`, {
      method: 'POST',
      body: JSON.stringify({ reason: releaseReason.value || 'revoke', confirmToken: token })
    });
    ok(result, t('pack.revoked'));
    await listReleases({ silent: true });
  } catch (error) {
    fail(error);
  }
}

async function rollbackRelease() {
  try {
    const token = await confirmAction('pack.rollback', t('pack.confirmRollback'));
    const result = await api(`/api/v1/packs/${encodeURIComponent(releasePackId.value || packId.value)}/rollback`, {
      method: 'POST',
      body: JSON.stringify({ releaseId: releaseId.value, reason: releaseReason.value || 'rollback', confirmToken: token })
    });
    ok(result, t('pack.rolled'));
    await loadPacks({ silent: true });
  } catch (error) {
    fail(error);
  }
}

function pickPack(row: Record<string, unknown>, index: number) {
  selectedPack.value = index;
  const pack = row as PackRow;
  packId.value = pack.id;
  packName.value = pack.name || '';
  packGame.value = pack.gameVersion || '';
  selectedEntries.value = (pack.entries || []).map((entry) => `${entry.modId}@${entry.version}`);
  releasePackId.value = pack.id;
  if (pack.latestReleaseId) releaseId.value = pack.latestReleaseId;
}

function pickRelease(row: Record<string, unknown>, index: number) {
  selectedRelease.value = index;
  releaseId.value = String(row.id || '');
}

onMounted(async () => {
  document.addEventListener('click', closeMenu);
  await Promise.all([loadMods({ silent: true }), loadPacks({ silent: true })]);
});
onUnmounted(() => document.removeEventListener('click', closeMenu));
</script>

<template>
  <div class="space-y-6" :data-lang="i18n.lang">
    <UiCard :title="t('pack.createTitle')">
      <p class="text-sm text-gray-500">
        {{ t('pack.createHint') }}
        <router-link to="/workshop" class="text-brand-500">{{ t('pack.toWorkshop') }}</router-link>
      </p>
      <div class="grid gap-3 sm:grid-cols-2">
        <div><label class="field">{{ t('pack.id') }}</label><input v-model="packId" class="input" readonly :placeholder="t('pack.phId')"></div>
        <div><label class="field">{{ t('pack.name') }}</label><input v-model="packName" class="input" :placeholder="t('pack.phName')"></div>
      </div>
      <label class="field">{{ t('pack.game') }}</label>
      <input v-model="packGame" class="input" placeholder="3.1.0">
      <label class="field">{{ t('pack.mods') }}</label>
      <div id="packEntryPicker" class="relative mb-3">
        <button type="button" class="input text-left" @click="menuOpen = !menuOpen">{{ toggleLabel }}</button>
        <div v-if="menuOpen" class="picker-menu">
          <p v-if="!options.length" class="px-3 py-4 text-center text-sm text-gray-500">{{ t('pack.none') }}</p>
          <label v-for="opt in options" :key="opt.value" class="flex cursor-pointer items-start gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-white/5">
            <input v-model="selectedEntries" type="checkbox" :value="opt.value" class="mt-1">
            <span>
              <strong class="block text-sm text-gray-800 dark:text-white/90">{{ opt.title }}</strong>
              <span class="text-theme-xs text-gray-500">{{ opt.hint }}</span>
            </span>
          </label>
        </div>
      </div>
      <label class="field">{{ t('pack.reason') }}</label>
      <input v-model="releaseReason" class="input" :placeholder="t('pack.phReason')">
      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn-primary" @click="publishPack">{{ t('pack.publish') }}</button>
        <button v-if="packId" type="button" class="btn-secondary" @click="router.push(`/packs/${encodeURIComponent(packId)}/contents`)">{{ t('pack.contentsLink') }}</button>
        <button type="button" class="btn-secondary" @click="newPack">{{ t('pack.new') }}</button>
        <button type="button" class="btn-secondary" @click="loadPacks()">{{ t('pack.refresh') }}</button>
      </div>
    </UiCard>
    <UiCard :title="t('pack.revokeTitle')" :desc="t('pack.revokeHint')" danger>
      <div class="grid gap-3 sm:grid-cols-2">
        <div>
          <label class="field">{{ t('srv.pack') }}</label>
          <select v-model="releasePackId" class="input">
            <option value="">{{ t('pack.select') }}</option>
            <option v-for="pack in catalog.packs" :key="pack.id" :value="pack.id">{{ packOptionLabel(pack) }}</option>
          </select>
        </div>
        <div><label class="field">{{ t('pack.releaseId') }}</label><input v-model="releaseId" class="input" placeholder="rel_..."></div>
      </div>
      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn-secondary" @click="listReleases()">{{ t('pack.listReleases') }}</button>
        <button type="button" class="btn-danger" @click="revokeRelease">{{ t('pack.revoke') }}</button>
        <button type="button" class="btn-danger" @click="rollbackRelease">{{ t('pack.rollback') }}</button>
      </div>
    </UiCard>
    <div class="grid gap-6 xl:grid-cols-2">
      <UiCard :title="t('pack.dir')" :desc="t('mod.clickFill')">
        <UiTable :rows="catalog.packs as unknown as Record<string, unknown>[]" :cols="['id', 'name', 'gameVersion', 'entryCount', 'packVersion', 'latestReleaseId']" :selected="selectedPack" @pick="pickPack" />
      </UiCard>
      <UiCard :title="t('pack.release')" :desc="t('pack.releaseHint')">
        <UiTable :rows="releases" :cols="['id', 'packVersion', 'createdAt', 'revokedAt']" :selected="selectedRelease" @pick="pickRelease" />
      </UiCard>
    </div>
  </div>
</template>
