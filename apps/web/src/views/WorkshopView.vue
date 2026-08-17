<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api/client';
import HierarchyShell from '../components/HierarchyShell.vue';
import UiModal from '../components/UiModal.vue';
import WorkshopModView from './WorkshopModView.vue';
import { i18n, localeTag, t } from '../i18n';
import { fail, ok } from '../lib/feedback';
import { prettyBytes } from '../lib/format';
import { catalog, loadMods, loadPacks, packOptionLabel, type ModRow } from '../stores/catalog';
import { can } from '../stores/session';
import { ensureAdult, isAdultMod, isAdultVerified } from '../stores/adult';
import { showToast } from '../stores/toast';
import R18Badge from '../components/R18Badge.vue';

const route = useRoute();
const router = useRouter();
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
const r18Filter = ref('all');
let timer: ReturnType<typeof setTimeout> | undefined;
const currentId = computed(() => String(route.params.id || ''));

const sorted = computed(() => {
  const rows = mods.value.filter((mod) => {
    const adult = isAdultMod(mod);
    if (r18Filter.value === 'hide' && adult) return false;
    if (r18Filter.value === 'only' && !adult) return false;
    return true;
  }).slice().sort((a, b) => {
    if (sort.value === 'downloads') return (b.downloads || 0) - (a.downloads || 0);
    if (sort.value === 'updated') return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
    return String(a.name || a.id).localeCompare(String(b.name || b.id), localeTag());
  });
  return rows;
});

function picked(id: string) {
  return cart.value.some((item) => item.modId === id);
}

function addToCart(modId: string) {
  if (cart.value.some((item) => item.modId === modId)) return;
  const mod = mods.value.concat(catalog.mods).find((item) => item.id === modId);
  if (!mod || !mod.latestVersion) return;
  for (const depId of mod.dependsOn || []) addToCart(depId);
  if (cart.value.some((item) => item.modId === modId)) return;
  cart.value.push({
    modId: mod.id,
    version: mod.latestVersion,
    name: mod.name || mod.id,
    gameVersions: mod.gameVersions || []
  });
}

async function toggle(modId: string) {
  const existing = cart.value.findIndex((item) => item.modId === modId);
  if (existing >= 0) {
    cart.value.splice(existing, 1);
    return;
  }
  const mod = mods.value.concat(catalog.mods).find((item) => item.id === modId);
  if (!mod || !mod.latestVersion) return showToast(t('ws.noVersion'), 'warn');
  if (isAdultMod(mod) && !isAdultVerified()) {
    if (!await ensureAdult()) return;
    await load({ silent: true });
  }
  addToCart(modId);
}

async function openDetails(mod: ModRow) {
  if (isAdultMod(mod) && !isAdultVerified()) {
    if (!await ensureAdult()) return;
    await load({ silent: true });
  }
  await router.push(`/workshop/${encodeURIComponent(mod.id)}`);
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

function cartHasSlots() {
  return cart.value.some((item) => {
    const mod = mods.value.concat(catalog.mods).find((row) => row.id === item.modId);
    return Boolean(mod?.contentSlots?.length);
  });
}

function openDialog(mode: 'create' | 'add') {
  if (!cart.value.length) return showToast(t('ws.needPick'), 'warn');
  if (!can('pack.publish')) return showToast(t('ws.needAdmin'), 'warn');
  dialogMode.value = mode;
  if (mode === 'create') {
    if (!packName.value) packName.value = cart.value.map((item) => item.name).slice(0, 2).join(' + ');
    if (!packGame.value) packGame.value = game.value || cart.value[0].gameVersions[0] || '';
    publish.value = !cartHasSlots();
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
      entries.forEach((entry) => {
        const prev = merged.get(entry.modId);
        merged.set(entry.modId, { ...entry, contents: prev?.contents });
      });
      pack = await api<{ id: string; name?: string; gameVersion?: string }>('/api/v1/packs', {
        method: 'POST',
        body: JSON.stringify({ id: current.id, name: current.name, gameVersion: current.gameVersion, entries: [...merged.values()] })
      });
    }
    const goPick = cartHasSlots();
    if (publish.value && !goPick) {
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
    if (goPick) await router.push(`/packs/${encodeURIComponent(pack.id)}`);
  } catch (error) {
    fail(error);
  }
}

onMounted(async () => {
  await Promise.all([loadMods({ silent: true }), loadPacks({ silent: true }), load({ silent: true })]);
});
</script>

<template>
  <div class="pb-28" :data-lang="i18n.lang">
    <HierarchyShell :empty="!currentId" :empty-text="t('ws.emptySelect')">
      <template #toolbar>
        <input v-model="query" class="input" :placeholder="t('ws.phSearch')" @input="scheduleSearch">
        <button type="button" class="btn-secondary shrink-0 px-3" @click="load()">{{ t('refresh') }}</button>
      </template>
      <template #list>
        <div class="mb-2 grid grid-cols-2 gap-2 px-1">
          <div>
            <label class="field">{{ t('ws.game') }}</label>
            <input v-model="game" class="input" :placeholder="t('ws.phGame')" @input="scheduleSearch">
          </div>
          <div>
            <label class="field">{{ t('ws.type') }}</label>
            <select v-model="dll" class="input" @change="load({ silent: true })">
              <option value="">{{ t('ws.all') }}</option>
              <option value="yes">{{ t('ws.dllYes') }}</option>
              <option value="no">{{ t('ws.dllNo') }}</option>
            </select>
          </div>
          <div>
            <label class="field">{{ t('ws.sort') }}</label>
            <select v-model="sort" class="input">
              <option value="name">{{ t('ws.sortName') }}</option>
              <option value="downloads">{{ t('ws.sortDownloads') }}</option>
              <option value="updated">{{ t('ws.sortUpdated') }}</option>
            </select>
          </div>
          <div>
            <label class="field">{{ t('r18.filter') }}</label>
            <select v-model="r18Filter" class="input">
              <option value="all">{{ t('ws.all') }}</option>
              <option value="hide">{{ t('r18.hide') }}</option>
              <option value="only">{{ t('r18.only') }}</option>
            </select>
          </div>
        </div>
        <p class="px-3 pb-2 text-theme-xs text-gray-500">{{ sorted.length ? t('ws.found', { n: sorted.length }) : t('ws.none') }}</p>
        <p v-if="!sorted.length" class="px-3 py-8 text-center text-sm text-gray-500">{{ t('ws.noneMods') }}</p>
        <div v-for="mod in sorted" :key="mod.id" class="mb-1 flex items-stretch rounded-xl" :class="currentId === mod.id ? 'bg-brand-50 dark:bg-brand-500/10' : 'hover:bg-gray-50 dark:hover:bg-white/5'">
          <button type="button" class="min-w-0 flex-1 px-3 py-2.5 text-left" @click="openDetails(mod)">
            <span class="flex items-center gap-2 truncate text-sm font-medium text-gray-800 dark:text-white/90">
              {{ mod.name || mod.id }}
              <R18Badge v-if="isAdultMod(mod)" />
            </span>
            <span class="text-theme-xs text-gray-500">
              v{{ mod.latestVersion || '—' }}
              · {{ prettyBytes(mod.artifactSize || 0) }}
              <template v-if="mod.contentSlots?.length"> · {{ t('ws.slotCount', { n: Object.values(mod.contentCounts || {}).reduce((sum, n) => sum + n, 0) }) }}</template>
            </span>
          </button>
          <button type="button" class="shrink-0 px-3 text-theme-xs" :class="picked(mod.id) ? 'text-brand-500' : 'text-gray-400'" @click.stop="toggle(mod.id)">
            {{ picked(mod.id) ? t('ws.remove') : t('ws.add') }}
          </button>
        </div>
      </template>
      <WorkshopModView v-if="currentId" :key="currentId" />
    </HierarchyShell>
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
        <input v-model="publish" type="checkbox" :disabled="cartHasSlots()">
        <span>{{ cartHasSlots() ? t('content.pickHint') : t('ws.dlgPublish') }}</span>
      </label>
      <div class="flex gap-2">
        <button type="button" class="btn-secondary flex-1" @click="dialogOpen = false">{{ t('cancel') }}</button>
        <button type="button" class="btn-primary flex-1" @click="submitDialog">{{ t('confirm') }}</button>
      </div>
    </UiModal>
  </div>
</template>
