<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../api/client';
import UiModal from '../components/UiModal.vue';
import { i18n, localeTag, t } from '../i18n';
import { fail, ok } from '../lib/feedback';
import { prettyBytes } from '../lib/format';
import { catalog, loadMods, loadPacks, packOptionLabel, type ModRow } from '../stores/catalog';
import { can } from '../stores/session';
import { showToast } from '../stores/toast';

const query = ref('');
const game = ref('');
const dll = ref('');
const sort = ref('name');
const mods = ref<ModRow[]>([]);
const cart = ref<Array<{ modId: string; version: string; name: string; gameVersions: string[] }>>([]);
const dialogOpen = ref(false);
const dialogMode = ref<'create' | 'add'>('create');
const packName = ref('');
const packGame = ref('');
const packId = ref('');
const publish = ref(true);
let timer: ReturnType<typeof setTimeout> | undefined;

const sorted = computed(() => {
  const rows = mods.value.slice().sort((a, b) => {
    if (sort.value === 'downloads') return (b.downloads || 0) - (a.downloads || 0);
    if (sort.value === 'updated') return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
    return String(a.name || a.id).localeCompare(String(b.name || b.id), localeTag());
  });
  return rows;
});

function picked(id: string) {
  return cart.value.some((item) => item.modId === id);
}

function toggle(modId: string) {
  const existing = cart.value.findIndex((item) => item.modId === modId);
  if (existing >= 0) {
    cart.value.splice(existing, 1);
    return;
  }
  const mod = mods.value.concat(catalog.mods).find((item) => item.id === modId);
  if (!mod || !mod.latestVersion) return showToast(t('ws.noVersion'), 'warn');
  cart.value.push({
    modId: mod.id,
    version: mod.latestVersion,
    name: mod.name || mod.id,
    gameVersions: mod.gameVersions || []
  });
}

function clearCart() {
  cart.value = [];
}

function scheduleSearch() {
  clearTimeout(timer);
  timer = setTimeout(() => load({ silent: true }), 250);
}

async function load(opts?: { silent?: boolean }) {
  try {
    const params = new URLSearchParams();
    if (query.value.trim()) params.set('q', query.value.trim());
    if (game.value.trim()) params.set('gameVersion', game.value.trim());
    if (dll.value) params.set('dll', dll.value);
    const data = await api<{ mods: ModRow[] }>(`/api/v1/mods${params.toString() ? `?${params}` : ''}`);
    mods.value = data.mods || [];
    if (!opts?.silent) showToast(t('ws.loaded'), 'ok');
  } catch (error) {
    fail(error);
  }
}

function openDialog(mode: 'create' | 'add') {
  if (!cart.value.length) return showToast(t('ws.needPick'), 'warn');
  if (!can('pack.publish')) return showToast(t('ws.needAdmin'), 'warn');
  dialogMode.value = mode;
  if (mode === 'create') {
    if (!packName.value) packName.value = cart.value.map((item) => item.name).slice(0, 2).join(' + ');
    if (!packGame.value) packGame.value = game.value || cart.value[0].gameVersions[0] || '';
    publish.value = true;
  } else {
    publish.value = false;
  }
  dialogOpen.value = true;
}

async function submitDialog() {
  try {
    const entries = cart.value.map((item) => ({ modId: item.modId, version: item.version, required: true }));
    if (!entries.length) throw new Error(t('ws.needPick'));
    let pack;
    if (dialogMode.value === 'create') {
      if (!packName.value.trim() || !packGame.value.trim()) throw new Error(t('ws.needNameGame'));
      pack = await api<{ id: string; name?: string; gameVersion?: string }>('/api/v1/packs', {
        method: 'POST',
        body: JSON.stringify({ name: packName.value.trim(), gameVersion: packGame.value.trim(), entries })
      });
    } else {
      const current = catalog.packs.find((item) => item.id === packId.value);
      if (!current) throw new Error(t('ws.needPack'));
      const merged = new Map((current.entries || []).map((entry) => [entry.modId, entry]));
      entries.forEach((entry) => merged.set(entry.modId, entry));
      pack = await api<{ id: string; name?: string; gameVersion?: string }>('/api/v1/packs', {
        method: 'POST',
        body: JSON.stringify({ id: current.id, name: current.name, gameVersion: current.gameVersion, entries: [...merged.values()] })
      });
    }
    if (publish.value) {
      const release = await api(`/api/v1/packs/${encodeURIComponent(pack.id)}/releases`, {
        method: 'POST',
        body: JSON.stringify({ reason: dialogMode.value === 'create' ? 'workshop.create' : 'workshop.add' })
      });
      ok(release, dialogMode.value === 'create' ? t('ws.createdPublished') : t('ws.addedPublished'));
    } else {
      ok(pack, dialogMode.value === 'create' ? t('ws.createdDraft') : t('ws.addedDraft'));
    }
    dialogOpen.value = false;
    clearCart();
    await loadPacks({ silent: true });
  } catch (error) {
    fail(error);
  }
}

onMounted(async () => {
  await Promise.all([loadMods({ silent: true }), loadPacks({ silent: true }), load({ silent: true })]);
});
</script>

<template>
  <div class="space-y-4 pb-28" :data-lang="i18n.lang">
    <div class="flex flex-wrap items-end gap-3">
      <div class="min-w-56 flex-1">
        <label class="field">{{ t('ws.search') }}</label>
        <input v-model="query" class="input" :placeholder="t('ws.phSearch')" @input="scheduleSearch">
      </div>
      <div class="w-40">
        <label class="field">{{ t('ws.game') }}</label>
        <input v-model="game" class="input" :placeholder="t('ws.phGame')" @input="scheduleSearch">
      </div>
      <div class="w-36">
        <label class="field">{{ t('ws.type') }}</label>
        <select v-model="dll" class="input" @change="load({ silent: true })">
          <option value="">{{ t('ws.all') }}</option>
          <option value="yes">{{ t('ws.dllYes') }}</option>
          <option value="no">{{ t('ws.dllNo') }}</option>
        </select>
      </div>
      <div class="w-36">
        <label class="field">{{ t('ws.sort') }}</label>
        <select v-model="sort" class="input">
          <option value="name">{{ t('ws.sortName') }}</option>
          <option value="downloads">{{ t('ws.sortDownloads') }}</option>
          <option value="updated">{{ t('ws.sortUpdated') }}</option>
        </select>
      </div>
      <button type="button" class="btn-secondary" @click="load()">{{ t('refresh') }}</button>
    </div>
    <p class="text-sm text-gray-500">{{ sorted.length ? t('ws.found', { n: sorted.length }) : t('ws.none') }}</p>
    <p v-if="!sorted.length" class="rounded-2xl border border-gray-200 px-4 py-10 text-center text-sm text-gray-500 dark:border-gray-800">{{ t('ws.noneHint') }}</p>
    <div v-else class="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
      <article v-for="mod in sorted" :key="mod.id" class="mod-card" :class="{ picked: picked(mod.id) }">
        <div class="mb-3 flex h-16 items-center justify-center rounded-lg bg-linear-to-br from-brand-500/20 to-gray-800 text-lg font-bold text-brand-500">
          {{ (mod.name || mod.id).slice(0, 2).toUpperCase() }}
        </div>
        <h3 class="text-base font-medium text-gray-800 dark:text-white/90">{{ mod.name || mod.id }}</h3>
        <p class="mb-2 text-theme-xs text-gray-500">{{ mod.author || t('ws.unknownAuthor') }} · v{{ mod.latestVersion || '—' }} · {{ prettyBytes(mod.artifactSize || 0) }}</p>
        <p class="mb-3 line-clamp-3 flex-1 text-sm text-gray-600 dark:text-gray-300">{{ mod.description || t('ws.noDesc') }}</p>
        <div class="mb-3 flex flex-wrap gap-1.5">
          <span class="rounded-full bg-gray-100 px-2 py-0.5 text-theme-xs text-gray-500 dark:bg-white/5">{{ (mod.gameVersions || []).join(' / ') || t('ws.noGame') }}</span>
          <span v-if="mod.containsDll" class="rounded-full bg-brand-500/15 px-2 py-0.5 text-theme-xs text-brand-500">{{ t('ws.hasDll') }}</span>
          <span v-if="mod.downloads" class="rounded-full bg-gray-100 px-2 py-0.5 text-theme-xs text-gray-500 dark:bg-white/5">{{ t('ws.downloads', { n: mod.downloads }) }}</span>
        </div>
        <button type="button" class="mt-auto" :class="picked(mod.id) ? 'btn-secondary' : 'btn-ok'" @click="toggle(mod.id)">
          {{ picked(mod.id) ? t('ws.remove') : t('ws.add') }}
        </button>
      </article>
    </div>
    <div class="sticky bottom-4 z-20 flex flex-col gap-3 rounded-2xl border border-brand-500/40 bg-white/95 p-4 shadow-theme-lg backdrop-blur dark:bg-gray-900/95 sm:flex-row sm:items-center sm:justify-between">
      <div class="min-w-0">
        <strong class="text-sm text-gray-800 dark:text-white/90">{{ cart.length ? t('ws.picked', { n: cart.length }) : t('ws.nonePicked') }}</strong>
        <div class="mt-2 flex flex-wrap gap-1.5">
          <span v-if="!cart.length" class="text-theme-xs text-gray-500">{{ t('ws.pickHint') }}</span>
          <span v-for="item in cart" :key="item.modId" class="chip">
            {{ item.name }}
            <button type="button" class="text-gray-500" @click="toggle(item.modId)">×</button>
          </span>
        </div>
      </div>
      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn-secondary" @click="clearCart">{{ t('ws.clear') }}</button>
        <button type="button" class="btn-secondary" @click="openDialog('add')">{{ t('ws.addExisting') }}</button>
        <button type="button" class="btn-primary" @click="openDialog('create')">{{ t('ws.createNew') }}</button>
      </div>
    </div>
    <UiModal
      :open="dialogOpen"
      :title="dialogMode === 'create' ? t('ws.dlgCreate') : t('ws.dlgAdd')"
      :hint="dialogMode === 'create' ? t('ws.dlgCreateHint', { n: cart.length }) : t('ws.dlgAddHint')"
      @close="dialogOpen = false"
    >
      <div v-if="dialogMode === 'create'">
        <label class="field">{{ t('ws.dlgName') }}</label>
        <input v-model="packName" class="input mb-3" :placeholder="t('ws.phName')">
        <label class="field">{{ t('ws.dlgGame') }}</label>
        <input v-model="packGame" class="input mb-3" placeholder="3.1.0">
      </div>
      <div v-else>
        <label class="field">{{ t('ws.dlgPack') }}</label>
        <select v-model="packId" class="input mb-3">
          <option value="">{{ t('pack.select') }}</option>
          <option v-for="pack in catalog.packs" :key="pack.id" :value="pack.id">{{ packOptionLabel(pack) }}</option>
        </select>
      </div>
      <label class="mb-4 flex items-center gap-2 text-sm text-gray-500">
        <input v-model="publish" type="checkbox">
        <span>{{ t('ws.dlgPublish') }}</span>
      </label>
      <div class="flex gap-2">
        <button type="button" class="btn-secondary flex-1" @click="dialogOpen = false">{{ t('cancel') }}</button>
        <button type="button" class="btn-primary flex-1" @click="submitDialog">{{ t('confirm') }}</button>
      </div>
    </UiModal>
  </div>
</template>
