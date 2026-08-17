<script setup lang="ts">
import { ChevronDown, ChevronRight, History, Package, Plus } from 'lucide-vue-next';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api/client';
import type { UploadProgress } from '../api/client';
import ContentFileList from '../components/ContentFileList.vue';
import HierarchyItem from '../components/HierarchyItem.vue';
import HierarchyShell from '../components/HierarchyShell.vue';
import UiProgress from '../components/UiProgress.vue';
import { uploadContentZips, zipFilesFrom } from '../lib/content-upload';
import { i18n, t } from '../i18n';
import { confirmAction, fail, ok } from '../lib/feedback';
import { prettyBytes } from '../lib/format';
import { catalog, loadMods, loadPacks, type ContentItem, type ModRow, type PackRow } from '../stores/catalog';
import { ensureAdult, isAdultVerified } from '../stores/adult';
import { can } from '../stores/session';

type Slot = { id: string; path: string; label?: string };
type EntryState = {
  modId: string;
  version: string;
  required?: boolean;
  name: string;
  slots: Slot[];
  items: ContentItem[];
};
type ReleaseRow = {
  id: string;
  packVersion?: number;
  createdAt?: string;
  revokedAt?: string | null;
};

const route = useRoute();
const router = useRouter();
const query = ref('');
const creating = ref(false);
const packName = ref('');
const packGame = ref('');
const releaseReason = ref('');
const pack = ref<PackRow | null>(null);
const entries = ref<EntryState[]>([]);
const releases = ref<ReleaseRow[]>([]);
const selectedRelease = ref('');
const picked = reactive<Record<string, Record<string, string[]>>>({});
const openMods = reactive<Record<string, boolean>>({});
const openSlots = reactive<Record<string, boolean>>({});
const showAddMod = ref(false);
const addModFilter = ref('');
const license = ref(false);
const busy = ref('');
const progress = ref({ active: false, percent: 0, label: '' });
const upload = reactive({ modId: '', slotId: '', name: '', description: '', r18: false });

const writable = computed(() => can('pack.publish'));
const currentId = computed(() => (creating.value ? '' : String(route.params.id || pack.value?.id || '')));
const filteredPacks = computed(() => {
  const needle = query.value.trim().toLowerCase();
  if (!needle) return catalog.packs;
  return catalog.packs.filter((item) => [item.name, item.id, item.gameVersion].join(' ').toLowerCase().includes(needle));
});
const addModOptions = computed(() => {
  const taken = new Set(entries.value.map((entry) => entry.modId));
  const needle = addModFilter.value.trim().toLowerCase();
  const rows: Array<{ value: string; title: string; hint: string }> = [];
  for (const mod of catalog.mods) {
    if (taken.has(mod.id)) continue;
    for (const ver of mod.versions || []) {
      const value = `${mod.id}@${ver.version}`;
      const title = `${mod.name || mod.id} @ ${ver.version}`;
      const side = sideHint(ver.installSide || mod.installSide);
      const hint = [mod.id, ver.gameVersions?.length ? t('pack.gameHint', { games: ver.gameVersions.join('/') }) : '', side].filter(Boolean).join(' · ');
      if (needle && !`${title} ${hint}`.toLowerCase().includes(needle)) continue;
      rows.push({ value, title, hint });
    }
  }
  return rows;
});
const selectedCount = computed(() => Object.values(picked).reduce((sum, slots) => sum + Object.values(slots).reduce((inner, ids) => inner + ids.length, 0), 0));

function versionsOf(modId: string) {
  return catalog.mods.find((item) => item.id === modId)?.versions || [];
}

function sideHint(side?: string) {
  if (side === 'server') return t('mod.sideServer');
  if (side === 'client') return t('mod.sideClient');
  return '';
}

function entrySide(entry: EntryState) {
  const ver = versionsOf(entry.modId).find((item) => item.version === entry.version);
  return sideHint(ver?.installSide || catalog.mods.find((item) => item.id === entry.modId)?.installSide);
}

function contentCount(entry: EntryState) {
  return Object.values(picked[entry.modId] || {}).reduce((sum, ids) => sum + ids.length, 0);
}

function packHint(item: PackRow) {
  const parts = [item.gameVersion || '—', t('pack.entryCount', { n: item.entryCount || 0 })];
  if (item.packVersion != null) parts.push(`v${item.packVersion}`);
  return parts.join(' · ');
}

function packEntries() {
  return entries.value.map((entry) => {
    const cleaned: Record<string, string[]> = {};
    for (const [slotId, ids] of Object.entries(picked[entry.modId] || {})) {
      if (ids?.length) cleaned[slotId] = ids.slice();
    }
    return {
      modId: entry.modId,
      version: entry.version,
      required: entry.required !== false,
      ...(Object.keys(cleaned).length ? { contents: cleaned } : {})
    };
  });
}

async function hydrateEntry(modId: string, version: string, required: boolean | undefined, contents?: Record<string, string[]>) {
  const mod = catalog.mods.find((item) => item.id === modId) || await api<ModRow>(`/api/v1/mods/${encodeURIComponent(modId)}`);
  const listed = (mod.contentSlots || []).length
    ? await api<{ contents: ContentItem[] }>(`/api/v1/mods/${encodeURIComponent(modId)}/contents`)
    : { contents: [] as ContentItem[] };
  picked[modId] = {};
  for (const slot of mod.contentSlots || []) {
    picked[modId][slot.id] = (contents?.[slot.id] || []).slice();
    openSlots[`${modId}:${slot.id}`] = Boolean(contents?.[slot.id]?.length);
  }
  openMods[modId] = Boolean(mod.contentSlots?.length);
  return {
    modId,
    version,
    required,
    name: mod.name || modId,
    slots: mod.contentSlots || [],
    items: listed.contents || []
  } as EntryState;
}

async function loadPack(id: string) {
  const detail = await api<{ pack: PackRow }>(`/api/v1/packs/${encodeURIComponent(id)}`);
  pack.value = detail.pack;
  packName.value = detail.pack.name || '';
  packGame.value = detail.pack.gameVersion || '';
  const next: EntryState[] = [];
  for (const entry of detail.pack.entries || []) {
    next.push(await hydrateEntry(entry.modId, entry.version, entry.required, entry.contents));
  }
  entries.value = next;
  const listed = await api<{ releases: ReleaseRow[] }>(`/api/v1/packs/${encodeURIComponent(id)}/releases`);
  releases.value = listed.releases || [];
  selectedRelease.value = detail.pack.latestReleaseId || releases.value.find((item) => !item.revokedAt)?.id || '';
  const firstSlot = next.find((entry) => entry.slots.length);
  if (firstSlot) {
    upload.modId = firstSlot.modId;
    upload.slotId = firstSlot.slots[0]?.id || '';
  }
}

async function selectPack(id: string) {
  creating.value = false;
  showAddMod.value = false;
  if (route.params.id !== id) await router.push(`/packs/${encodeURIComponent(id)}`);
  else await loadPack(id);
}

function startCreate() {
  creating.value = true;
  pack.value = null;
  packName.value = '';
  packGame.value = '3.10.14';
  entries.value = [];
  releases.value = [];
  selectedRelease.value = '';
  showAddMod.value = true;
  if (route.params.id) router.push('/packs');
}

async function addMod(value: string) {
  const at = value.lastIndexOf('@');
  const modId = value.slice(0, at);
  const version = value.slice(at + 1);
  if (!modId || entries.value.some((entry) => entry.modId === modId)) return;
  entries.value.push(await hydrateEntry(modId, version, true));
  showAddMod.value = false;
  addModFilter.value = '';
}

function removeMod(modId: string) {
  entries.value = entries.value.filter((entry) => entry.modId !== modId);
  delete picked[modId];
}

async function toggle(modId: string, slotId: string, contentId: string) {
  const entry = entries.value.find((item) => item.modId === modId);
  const item = entry?.items.find((row) => row.id === contentId);
  if (item?.r18 && !isAdultVerified()) {
    if (!await ensureAdult()) return;
    await loadPack(currentId.value);
  }
  picked[modId] = picked[modId] || {};
  const current = picked[modId][slotId] || [];
  picked[modId][slotId] = current.includes(contentId) ? current.filter((id) => id !== contentId) : current.concat(contentId);
}

function trackBatch(state: { index: number; total: number; file: File; event: UploadProgress }) {
  const percent = state.event.total ? Math.round((state.event.loaded / state.event.total) * 100) : 0;
  const prefix = t('content.batchItem', { current: state.index + 1, total: state.total, name: state.file.name });
  let phase = t('mod.analyzing');
  if (state.event.phase === 'hash') phase = t('mod.hashing', { percent });
  else if (state.event.phase === 'upload') phase = t('mod.uploadProgress', { percent, loaded: prettyBytes(state.event.loaded), total: prettyBytes(state.event.total) });
  progress.value = { active: true, percent, label: `${prefix} · ${phase}` };
}

async function submitContents(list: FileList | null, input?: HTMLInputElement, modId?: string, slotId?: string) {
  try {
    if (!license.value) throw new Error(t('mod.needLicense'));
    const files = zipFilesFrom(list);
    if (!files.length) throw new Error(t('mod.needZip'));
    const entry = entries.value.find((item) => item.modId === (modId || upload.modId)) || entries.value.find((item) => item.slots.length);
    const slot = slotId || upload.slotId || entry?.slots[0]?.id;
    if (!entry || !slot) throw new Error(t('mod.slotsEmpty'));
    busy.value = `${entry.modId}:${slot}`;
    const result = await uploadContentZips({
      files,
      modId: entry.modId,
      slotId: slot,
      name: upload.name,
      description: upload.description,
      r18: upload.r18,
      onProgress: trackBatch
    });
    upload.name = '';
    upload.description = '';
    upload.r18 = false;
    progress.value = { active: false, percent: 100, label: '' };
    if (!result.created.length) throw new Error(result.errors.map((item) => t('content.batchFail', { name: item.name, error: item.message })).join('\n') || t('mod.needZip'));
    ok(result.created, result.errors.length ? t('content.batchPartial', { ok: result.created.length, fail: result.errors.length }) : t('content.uploadedN', { n: result.created.length }));
    if (currentId.value) await loadPack(currentId.value);
    for (const item of result.created) toggle(entry.modId, slot, item.id);
  } catch (error) {
    progress.value.active = false;
    fail(error);
  } finally {
    busy.value = '';
    if (input) input.value = '';
  }
}

async function save(publish = false) {
  try {
    const chosen = packEntries();
    if (!chosen.length) throw new Error(t('pack.needMod'));
    const body: Record<string, unknown> = { name: packName.value, gameVersion: packGame.value, entries: chosen };
    if (currentId.value) body.id = currentId.value;
    const saved = await api<PackRow>('/api/v1/packs', { method: 'POST', body: JSON.stringify(body) });
    pack.value = saved;
    creating.value = false;
    if (publish) {
      const release = await api(`/api/v1/packs/${encodeURIComponent(saved.id)}/releases`, {
        method: 'POST',
        body: JSON.stringify({ reason: releaseReason.value || 'publish' })
      });
      ok(release, t('pack.published'));
    } else {
      ok(saved, t('content.saved'));
    }
    await loadPacks({ silent: true });
    await selectPack(saved.id);
  } catch (error) {
    fail(error);
  }
}

async function revokeRelease() {
  try {
    if (!currentId.value || !selectedRelease.value) return;
    const token = await confirmAction('release.revoke', t('pack.confirmRevoke'));
    const result = await api(`/api/v1/packs/${encodeURIComponent(currentId.value)}/releases/${encodeURIComponent(selectedRelease.value)}/revoke`, {
      method: 'POST',
      body: JSON.stringify({ reason: releaseReason.value || 'revoke', confirmToken: token })
    });
    ok(result, t('pack.revoked'));
    await loadPack(currentId.value);
    await loadPacks({ silent: true });
  } catch (error) {
    fail(error);
  }
}

async function rollbackRelease() {
  try {
    if (!currentId.value || !selectedRelease.value) return;
    const token = await confirmAction('pack.rollback', t('pack.confirmRollback'));
    const result = await api(`/api/v1/packs/${encodeURIComponent(currentId.value)}/rollback`, {
      method: 'POST',
      body: JSON.stringify({ releaseId: selectedRelease.value, reason: releaseReason.value || 'rollback', confirmToken: token })
    });
    ok(result, t('pack.rolled'));
    await loadPacks({ silent: true });
    await loadPack(currentId.value);
  } catch (error) {
    fail(error);
  }
}

watch(() => route.params.id, async (id) => {
  if (!id) {
    if (!creating.value) {
      pack.value = null;
      entries.value = [];
      releases.value = [];
    }
    return;
  }
  creating.value = false;
  try {
    await loadPack(String(id));
  } catch (error) {
    fail(error);
  }
});

onMounted(async () => {
  await Promise.all([loadMods({ silent: true }), loadPacks({ silent: true })]);
  const id = String(route.params.id || '');
  if (id) {
    try { await loadPack(id); } catch (error) { fail(error); }
  }
});
</script>

<template>
  <div :data-lang="i18n.lang">
    <HierarchyShell :empty="!creating && !currentId" :empty-text="t('pack.emptySelect')">
      <template #toolbar>
        <input v-model="query" class="input" :placeholder="t('pack.search')">
        <button v-if="writable" type="button" class="btn-primary shrink-0 px-3" :title="t('pack.new')" @click="startCreate">
          <Plus :size="16" />
        </button>
      </template>
      <template #list>
        <p v-if="!filteredPacks.length" class="px-3 py-8 text-center text-sm text-gray-500">{{ t('pack.nonePacks') }}</p>
        <HierarchyItem
          v-for="item in filteredPacks"
          :key="item.id"
          :title="item.name || item.id"
          :hint="packHint(item)"
          :active="!creating && currentId === item.id"
          @click="selectPack(item.id)"
        />
      </template>
        <div class="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
          <p class="mb-3 text-theme-xs font-medium uppercase tracking-wide text-gray-400">{{ creating ? t('pack.creating') : t('pack.levelPack') }}</p>
          <div class="grid gap-3 sm:grid-cols-2">
            <div>
              <label class="field">{{ t('pack.name') }}</label>
              <input v-model="packName" class="input" :disabled="!writable" :placeholder="t('pack.phName')">
            </div>
            <div>
              <label class="field">{{ t('pack.game') }}</label>
              <input v-model="packGame" class="input" :disabled="!writable" placeholder="3.10.14">
            </div>
          </div>
          <p v-if="pack?.id" class="mt-2 truncate text-theme-xs text-gray-400">{{ pack.id }}</p>
        </div>

        <div class="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
          <header class="flex items-center justify-between gap-3 px-5 py-4">
            <div>
              <p class="text-theme-xs font-medium uppercase tracking-wide text-gray-400">{{ t('pack.levelMods') }}</p>
              <h3 class="text-base font-medium text-gray-800 dark:text-white/90">
                {{ t('pack.entryCount', { n: entries.length }) }}
                <span v-if="selectedCount" class="text-theme-xs font-normal text-gray-500"> · {{ t('pack.overlayCount', { n: selectedCount }) }}</span>
              </h3>
            </div>
            <button v-if="writable" type="button" class="btn-secondary" @click="showAddMod = !showAddMod">{{ t('pack.addMod') }}</button>
          </header>
          <div v-if="showAddMod && writable" class="border-t border-gray-100 px-5 py-4 dark:border-gray-800">
            <input v-model="addModFilter" class="input mb-2" :placeholder="t('pack.pick')">
            <p v-if="!addModOptions.length" class="py-4 text-center text-sm text-gray-500">{{ t('pack.none') }}</p>
            <button
              v-for="opt in addModOptions"
              :key="opt.value"
              type="button"
              class="mb-1 flex w-full flex-col rounded-lg px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-white/5"
              @click="addMod(opt.value)"
            >
              <strong class="text-sm text-gray-800 dark:text-white/90">{{ opt.title }}</strong>
              <span class="text-theme-xs text-gray-500">{{ opt.hint }}</span>
            </button>
          </div>
          <p v-if="!entries.length" class="border-t border-gray-100 px-5 py-8 text-center text-sm text-gray-500 dark:border-gray-800">{{ t('pack.needMod') }}</p>
          <ul v-else class="divide-y divide-gray-100 border-t border-gray-100 dark:divide-gray-800 dark:border-gray-800">
            <li v-for="entry in entries" :key="entry.modId" class="px-3 py-2 sm:px-5">
              <div class="flex items-start gap-2">
                <button type="button" class="mt-1 text-gray-400" @click="openMods[entry.modId] = !openMods[entry.modId]">
                  <ChevronDown v-if="openMods[entry.modId]" :size="16" />
                  <ChevronRight v-else :size="16" />
                </button>
                <Package class="mt-1 shrink-0 text-gray-400" :size="16" />
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <button type="button" class="truncate text-sm font-medium text-gray-800 dark:text-white/90" @click="openMods[entry.modId] = !openMods[entry.modId]">
                      {{ entry.name }}
                    </button>
                    <select v-if="writable" v-model="entry.version" class="input !w-auto py-1 text-theme-xs">
                      <option v-for="ver in versionsOf(entry.modId)" :key="ver.version" :value="ver.version">{{ ver.version }}</option>
                    </select>
                    <span v-else class="text-theme-xs text-gray-500">@ {{ entry.version }}</span>
                    <span v-if="entrySide(entry)" class="text-theme-xs text-gray-400">{{ entrySide(entry) }}</span>
                    <span v-if="entry.slots.length" class="text-theme-xs text-gray-400">{{ t('pack.overlayCount', { n: contentCount(entry) }) }}</span>
                    <button v-if="writable" type="button" class="ml-auto text-theme-xs text-error-500" @click="removeMod(entry.modId)">{{ t('pack.removeMod') }}</button>
                  </div>
                  <p class="text-theme-xs text-gray-400">{{ entry.modId }}</p>
                </div>
              </div>
              <div v-if="openMods[entry.modId]" class="ml-8 mt-3 space-y-4 border-l border-gray-100 pl-4 dark:border-gray-800">
                <p v-if="!entry.slots.length" class="text-theme-xs text-gray-500">{{ t('pack.frameworkOnly') }}</p>
                <div v-for="slot in entry.slots" :key="slot.id">
                  <button type="button" class="mb-2 flex items-center gap-1 text-sm font-medium text-gray-700 dark:text-white/80" @click="openSlots[`${entry.modId}:${slot.id}`] = !openSlots[`${entry.modId}:${slot.id}`]">
                    <ChevronDown v-if="openSlots[`${entry.modId}:${slot.id}`]" :size="14" />
                    <ChevronRight v-else :size="14" />
                    {{ slot.label || slot.path }}
                    <span class="font-normal text-gray-400">{{ t('pack.overlayCount', { n: (picked[entry.modId]?.[slot.id] || []).length }) }}</span>
                  </button>
                  <div v-if="openSlots[`${entry.modId}:${slot.id}`]" class="space-y-3">
                    <ContentFileList
                      :items="entry.items.filter((item) => item.slotId === slot.id)"
                      :selectable="writable"
                      :selected-ids="picked[entry.modId]?.[slot.id] || []"
                      @toggle="toggle(entry.modId, slot.id, $event)"
                      @changed="currentId && loadPack(currentId)"
                    />
                    <template v-if="writable">
                      <label class="mb-1 flex items-center gap-2 text-theme-xs text-gray-500"><input v-model="license" type="checkbox"><span>{{ t('mod.license') }}</span></label>
                      <label class="drop-zone !min-h-20">
                        <input type="file" accept=".zip" multiple :disabled="Boolean(busy)" @change="submitContents(($event.target as HTMLInputElement).files, $event.target as HTMLInputElement, entry.modId, slot.id)">
                        <span>{{ t('ws.submitContent') }}{{ busy === `${entry.modId}:${slot.id}` ? ' …' : '' }}</span>
                      </label>
                    </template>
                  </div>
                </div>
              </div>
            </li>
          </ul>
        </div>

        <div v-if="!creating" class="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
          <header class="px-5 py-4">
            <p class="text-theme-xs font-medium uppercase tracking-wide text-gray-400">{{ t('pack.levelReleases') }}</p>
            <h3 class="flex items-center gap-2 text-base font-medium text-gray-800 dark:text-white/90">
              <History :size="16" class="text-gray-400" />
              {{ t('pack.release') }}
            </h3>
          </header>
          <p v-if="!releases.length" class="border-t border-gray-100 px-5 py-8 text-center text-sm text-gray-500 dark:border-gray-800">{{ t('pack.noReleases') }}</p>
          <ul v-else class="divide-y divide-gray-100 border-t border-gray-100 dark:divide-gray-800 dark:border-gray-800">
            <li v-for="row in releases" :key="row.id">
              <button
                type="button"
                class="flex w-full items-center justify-between gap-3 px-5 py-3 text-left"
                :class="selectedRelease === row.id ? 'bg-brand-50 dark:bg-brand-500/10' : 'hover:bg-gray-50 dark:hover:bg-white/5'"
                @click="selectedRelease = row.id"
              >
                <span>
                  <strong class="text-sm text-gray-800 dark:text-white/90">v{{ row.packVersion }}</strong>
                  <span class="ml-2 text-theme-xs text-gray-400">{{ row.id }}</span>
                </span>
                <span class="text-theme-xs" :class="row.revokedAt ? 'text-error-500' : 'text-success-600'">
                  {{ row.revokedAt ? t('pack.revoked') : (pack?.latestReleaseId === row.id ? t('pack.active') : t('pack.release')) }}
                </span>
              </button>
            </li>
          </ul>
        </div>

        <div v-if="writable" class="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
          <label class="field">{{ t('pack.reason') }}</label>
          <input v-model="releaseReason" class="input mb-3" :placeholder="t('pack.phReason')">
          <UiProgress :active="progress.active" :value="progress.percent" :label="progress.label" />
          <div class="mt-3 flex flex-wrap gap-2">
            <button type="button" class="btn-secondary" @click="save(false)">{{ t('content.saveDraft') }}</button>
            <button type="button" class="btn-primary" @click="save(true)">{{ creating ? t('pack.publish') : t('content.publish') }}</button>
            <button v-if="!creating && selectedRelease" type="button" class="btn-danger" @click="revokeRelease">{{ t('pack.revoke') }}</button>
            <button v-if="!creating && selectedRelease" type="button" class="btn-danger" @click="rollbackRelease">{{ t('pack.rollback') }}</button>
          </div>
        </div>
    </HierarchyShell>
  </div>
</template>
