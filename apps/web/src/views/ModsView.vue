<script setup lang="ts">
import { ChevronDown, ChevronRight, Plus } from 'lucide-vue-next';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, hashAndUploadZip, type UploadProgress } from '../api/client';
import ContentFileList from '../components/ContentFileList.vue';
import HierarchyItem from '../components/HierarchyItem.vue';
import HierarchyShell from '../components/HierarchyShell.vue';
import UiProgress from '../components/UiProgress.vue';
import { uploadContentZips, zipFilesFrom } from '../lib/content-upload';
import { i18n, t } from '../i18n';
import { fail, ok } from '../lib/feedback';
import { prettyBytes } from '../lib/format';
import { askConfirm } from '../stores/confirm';
import { catalog, loadMods, type ContentItem, type ModRow } from '../stores/catalog';
import { can } from '../stores/session';

type Slot = { id: string; path: string; label?: string };

const route = useRoute();
const router = useRouter();
const query = ref('');
const creating = ref(false);
const file = ref<File | null>(null);
const over = ref(false);
const dropHint = ref('');
const uploadResult = ref('');
const form = ref({
  id: '',
  name: '',
  version: '',
  artifactSha: '',
  gameVersions: '',
  generic: false,
  installRoots: '',
  containsDll: false,
  license: false,
  dependsOn: [] as string[],
  slots: [] as string[],
  extraSlot: '',
  r18: false
});
const suggestedSlots = ref<Slot[]>([]);
const reviewHint = ref('');
const uploading = ref(false);
const progress = ref({ active: false, percent: 0, label: '' });
const mod = ref<ModRow | null>(null);
const contents = ref<ContentItem[]>([]);
const newPath = ref('');
const newLabel = ref('');
const contentLicense = ref(false);
const busy = ref('');
const contentUpload = reactive({ slotId: '', name: '', description: '', r18: false });
const openVersions = ref(true);
const openSlots = reactive<Record<string, boolean>>({});

const currentId = computed(() => (creating.value ? '' : String(route.params.id || '')));
const filteredMods = computed(() => {
  const needle = query.value.trim().toLowerCase();
  if (!needle) return catalog.mods;
  return catalog.mods.filter((item) => [item.name, item.id, item.latestVersion].join(' ').toLowerCase().includes(needle));
});
const selectedSlots = computed(() => suggestedSlots.value.filter((item) => form.value.slots.includes(item.path) || form.value.slots.includes(item.id)));
const dependOptions = computed(() => catalog.mods.filter((item) => item.id && item.id !== form.value.id));
const slots = computed(() => mod.value?.contentSlots || []);
const versions = computed(() => mod.value?.versions || []);

function modHint(item: ModRow) {
  return [
    item.latestVersion || '—',
    t('mod.slotCount', { n: item.contentSlots?.length || 0 })
  ].join(' · ');
}

function itemsFor(slotId: string) {
  return contents.value.filter((item) => item.slotId === slotId);
}

function refreshHint() {
  dropHint.value = file.value ? t('mod.chosen', { name: file.value.name, size: prettyBytes(file.value.size) }) : t('mod.drop');
}

function onFile(list: FileList | null) {
  file.value = list?.[0] || null;
  refreshHint();
}

function resetForm() {
  form.value = {
    id: '',
    name: '',
    version: '',
    artifactSha: '',
    gameVersions: '',
    generic: false,
    installRoots: '',
    containsDll: false,
    license: false,
    dependsOn: [],
    slots: [],
    extraSlot: '',
    r18: false
  };
  suggestedSlots.value = [];
  file.value = null;
  uploadResult.value = t('mod.uploadIdle');
  reviewHint.value = t('mod.reviewHint');
  refreshHint();
}

function fillForm(row: ModRow) {
  form.value.id = row.id;
  form.value.name = row.name || '';
  if (row.latestVersion) form.value.version = row.latestVersion;
  const latest = row.versions?.[0];
  if (latest) {
    form.value.artifactSha = latest.artifactSha || '';
    form.value.gameVersions = (latest.gameVersions || []).join(',');
    form.value.generic = latest.gameVersionRange === 'major';
    form.value.dependsOn = latest.dependsOn || [];
  } else {
    form.value.dependsOn = [];
  }
  form.value.slots = (row.contentSlots || []).map((item) => item.path);
  suggestedSlots.value = row.contentSlots || [];
  form.value.r18 = Boolean(row.r18);
}

function applyVersion(ver: NonNullable<ModRow['versions']>[number]) {
  form.value.version = ver.version;
  form.value.artifactSha = ver.artifactSha || '';
  form.value.gameVersions = (ver.gameVersions || []).join(',');
  form.value.generic = ver.gameVersionRange === 'major';
  form.value.dependsOn = ver.dependsOn || [];
}

function trackProgress(event: UploadProgress) {
  const percent = event.total ? Math.round((event.loaded / event.total) * 100) : 0;
  if (event.phase === 'hash') progress.value = { active: true, percent, label: t('mod.hashing', { percent }) };
  else if (event.phase === 'upload') progress.value = { active: true, percent, label: t('mod.uploadProgress', { percent, loaded: prettyBytes(event.loaded), total: prettyBytes(event.total) }) };
  else progress.value = { active: true, percent: 100, label: t('mod.analyzing') };
}

async function upload() {
  try {
    if (!file.value) throw new Error(t('mod.needZip'));
    uploading.value = true;
    uploadResult.value = t('mod.uploading', { name: file.value.name });
    trackProgress({ phase: 'hash', loaded: 0, total: file.value.size || 1 });
    const result = await hashAndUploadZip(file.value, trackProgress);
    form.value.artifactSha = result.hash;
    const analysis = result.review?.analysis;
    if (analysis) {
      if (analysis.roots?.length && !form.value.installRoots) form.value.installRoots = analysis.roots.join(',');
      if (analysis.containsDll) form.value.containsDll = true;
      if (analysis.suggestedSlots?.length) {
        suggestedSlots.value = analysis.suggestedSlots;
        if (!form.value.slots.length) form.value.slots = analysis.suggestedSlots.map((item: { path: string }) => item.path);
      }
      if (analysis.modInfo) {
        if (!form.value.id && analysis.modInfo.name) form.value.id = String(analysis.modInfo.name).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-|-$/g, '').slice(0, 64);
        if (!form.value.name && (analysis.modInfo.displayName || analysis.modInfo.name)) form.value.name = analysis.modInfo.displayName || analysis.modInfo.name;
        if (!form.value.version && analysis.modInfo.version) form.value.version = analysis.modInfo.version;
      }
    }
    const status = result.review?.status || t('mod.uploaded');
    const nextKey = status === 'pending' ? 'mod.pendingHint' : 'mod.readyHint';
    reviewHint.value = t(nextKey);
    uploadResult.value = t('mod.uploadResult', { hash: result.hash, status, size: prettyBytes(result.size), next: t(nextKey) });
    progress.value = { active: false, percent: 100, label: '' };
    ok(result, t('mod.uploadOk'));
  } catch (error) {
    progress.value.active = false;
    uploadResult.value = error instanceof Error ? error.message : String(error);
    fail(error);
  } finally {
    uploading.value = false;
  }
}

async function registerMod() {
  try {
    if (!form.value.license) throw new Error(t('mod.needLicense'));
    if (can('review.approve') && form.value.artifactSha) {
      await api(`/api/v1/reviews/${form.value.artifactSha}`, {
        method: 'POST',
        body: JSON.stringify({ status: 'approved', licenseConfirmed: true })
      });
    }
    const result = await api('/api/v1/mods', {
      method: 'POST',
      body: JSON.stringify({
        id: form.value.id,
        name: form.value.name,
        version: form.value.version,
        artifactSha: form.value.artifactSha,
        gameVersions: form.value.gameVersions.split(',').map((item) => item.trim()).filter(Boolean),
        gameVersionRange: form.value.generic ? 'major' : 'exact',
        installRoots: form.value.installRoots.split(',').map((item) => item.trim()).filter(Boolean),
        containsDll: form.value.containsDll,
        requiresRestart: form.value.containsDll,
        dependsOn: form.value.dependsOn,
        contentSlots: selectedSlots.value,
        r18: form.value.r18
      })
    });
    ok(result, t('mod.registered'));
    creating.value = false;
    await loadMods({ silent: true });
    await selectMod(form.value.id);
  } catch (error) {
    fail(error);
  }
}

function addExtraSlot() {
  const pathName = form.value.extraSlot.trim();
  if (!pathName) return;
  if (!suggestedSlots.value.some((item) => item.path === pathName || item.id === pathName.toLocaleLowerCase('en-US'))) {
    suggestedSlots.value = suggestedSlots.value.concat([{ id: pathName.toLocaleLowerCase('en-US'), path: pathName, label: pathName }]);
  }
  if (!form.value.slots.includes(pathName)) form.value.slots = form.value.slots.concat(pathName);
  form.value.extraSlot = '';
}

async function loadDetail(id: string) {
  const [detail, listed] = await Promise.all([
    api<ModRow>(`/api/v1/mods/${encodeURIComponent(id)}`),
    api<{ contents: ContentItem[] }>(`/api/v1/mods/${encodeURIComponent(id)}/contents`)
  ]);
  mod.value = detail;
  contents.value = listed.contents || detail.contents || [];
  fillForm(detail);
  if (!contentUpload.slotId && slots.value[0]) contentUpload.slotId = slots.value[0].id;
  for (const slot of slots.value) {
    if (openSlots[slot.id] == null) openSlots[slot.id] = true;
  }
}

async function selectMod(id: string) {
  creating.value = false;
  if (route.params.id !== id) await router.push(`/mods/${encodeURIComponent(id)}`);
  else await loadDetail(id);
}

function startCreate() {
  creating.value = true;
  mod.value = null;
  contents.value = [];
  resetForm();
  if (route.params.id) router.push('/mods');
}

async function saveSlots(next: Slot[], messageKey = 'mod.slotSaved') {
  const result = await api(`/api/v1/mods/${encodeURIComponent(currentId.value)}/slots`, {
    method: 'PUT',
    body: JSON.stringify({ slots: next })
  });
  if (mod.value) mod.value.contentSlots = result.contentSlots || next;
  ok(result, t(messageKey));
  await loadDetail(currentId.value);
  await loadMods({ silent: true });
}

async function addSlot() {
  try {
    const pathName = newPath.value.trim();
    if (!pathName) return;
    const next = slots.value.concat([{ id: pathName.toLocaleLowerCase('en-US'), path: pathName, label: newLabel.value.trim() || pathName }]);
    await saveSlots(next);
    newPath.value = '';
    newLabel.value = '';
  } catch (error) {
    fail(error);
  }
}

async function removeSlot(slotId: string) {
  const slot = slots.value.find((item) => item.id === slotId);
  const name = slot?.label || slot?.path || slotId;
  if (!await askConfirm({
    title: t('mod.slotDelete'),
    hint: t('mod.slotDeleteConfirm', { name }),
    confirmLabel: t('content.deleteAgain')
  })) return;
  try {
    const result = await api(`/api/v1/mods/${encodeURIComponent(currentId.value)}/slots/${encodeURIComponent(slotId)}`, { method: 'DELETE' });
    if (mod.value) mod.value.contentSlots = result.contentSlots || [];
    ok(result, t('mod.slotRemoved'));
    await loadDetail(currentId.value);
    await loadMods({ silent: true });
  } catch (error) {
    fail(error);
  }
}

function trackBatch(state: { index: number; total: number; file: File; event: UploadProgress }) {
  const percent = state.event.total ? Math.round((state.event.loaded / state.event.total) * 100) : 0;
  const prefix = t('content.batchItem', { current: state.index + 1, total: state.total, name: state.file.name });
  let phase = t('mod.analyzing');
  if (state.event.phase === 'hash') phase = t('mod.hashing', { percent });
  else if (state.event.phase === 'upload') phase = t('mod.uploadProgress', { percent, loaded: prettyBytes(state.event.loaded), total: prettyBytes(state.event.total) });
  progress.value = { active: true, percent, label: `${prefix} · ${phase}` };
}

async function submitContents(list: FileList | null, input?: HTMLInputElement, slotId?: string) {
  try {
    if (!contentLicense.value) throw new Error(t('mod.needLicense'));
    const files = zipFilesFrom(list);
    if (!files.length) throw new Error(t('mod.needZip'));
    const target = slotId || contentUpload.slotId || slots.value[0]?.id;
    if (!target) throw new Error(t('mod.slotsEmpty'));
    busy.value = target;
    const result = await uploadContentZips({
      files,
      modId: currentId.value,
      slotId: target,
      name: contentUpload.name,
      description: contentUpload.description,
      r18: contentUpload.r18,
      onProgress: trackBatch
    });
    contentUpload.name = '';
    contentUpload.description = '';
    contentUpload.r18 = false;
    progress.value = { active: false, percent: 100, label: '' };
    if (!result.created.length) throw new Error(result.errors.map((item) => t('content.batchFail', { name: item.name, error: item.message })).join('\n') || t('mod.needZip'));
    ok(result.created, result.errors.length ? t('content.batchPartial', { ok: result.created.length, fail: result.errors.length }) : t('content.uploadedN', { n: result.created.length }));
    await loadDetail(currentId.value);
  } catch (error) {
    progress.value.active = false;
    fail(error);
  } finally {
    busy.value = '';
    if (input) input.value = '';
  }
}

watch(() => route.params.id, async (id) => {
  if (!id) {
    if (!creating.value) {
      mod.value = null;
      contents.value = [];
    }
    return;
  }
  creating.value = false;
  try {
    await loadDetail(String(id));
  } catch (error) {
    fail(error);
  }
});

onMounted(async () => {
  refreshHint();
  reviewHint.value = t('mod.reviewHint');
  uploadResult.value = t('mod.uploadIdle');
  await loadMods({ silent: true });
  const id = String(route.params.id || '');
  if (id) {
    try { await loadDetail(id); } catch (error) { fail(error); }
  }
});
</script>

<template>
  <div :data-lang="i18n.lang">
    <HierarchyShell :empty="!creating && !currentId" :empty-text="t('mod.emptySelect')">
      <template #toolbar>
        <input v-model="query" class="input" :placeholder="t('mod.search')">
        <button type="button" class="btn-primary shrink-0 px-3" :title="t('mod.new')" @click="startCreate">
          <Plus :size="16" />
        </button>
      </template>
      <template #list>
        <p v-if="!filteredMods.length" class="px-3 py-8 text-center text-sm text-gray-500">{{ t('mod.noneMods') }}</p>
        <HierarchyItem
          v-for="item in filteredMods"
          :key="item.id"
          :title="item.name || item.id"
          :hint="modHint(item)"
          :active="!creating && currentId === item.id"
          @click="selectMod(item.id)"
        />
      </template>

      <div class="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
        <p class="mb-3 text-theme-xs font-medium uppercase tracking-wide text-gray-400">{{ creating ? t('mod.creating') : t('mod.levelMod') }}</p>
        <label class="drop-zone mb-3" :class="{ over }" @dragenter.prevent="over = true" @dragover.prevent="over = true" @dragleave.prevent="over = false" @drop.prevent="over = false; onFile(($event as DragEvent).dataTransfer?.files || null)">
          <input type="file" accept=".zip" :disabled="uploading" @change="onFile(($event.target as HTMLInputElement).files)">
          <span>{{ dropHint }}</span>
        </label>
        <button type="button" class="btn-primary mb-3 disabled:cursor-not-allowed disabled:opacity-50" :disabled="uploading" @click="upload">{{ t('mod.upload') }}</button>
        <UiProgress class="mb-3" :active="progress.active && !busy" :value="progress.percent" :label="progress.label" />
        <pre class="mb-4 max-h-40 overflow-auto rounded-lg bg-gray-950 p-3 text-theme-xs text-gray-300">{{ uploadResult }}</pre>
        <div class="grid gap-3 sm:grid-cols-2">
          <div><label class="field">{{ t('mod.id') }}</label><input v-model="form.id" class="input" placeholder="example-vehicles"></div>
          <div><label class="field">{{ t('mod.name') }}</label><input v-model="form.name" class="input" placeholder="Example Vehicles"></div>
          <div><label class="field">{{ t('mod.version') }}</label><input v-model="form.version" class="input" placeholder="1.0.0"></div>
          <div><label class="field">{{ t('mod.sha') }}</label><input v-model="form.artifactSha" class="input" :placeholder="t('mod.phSha')"></div>
        </div>
        <label class="field">{{ t('mod.game') }}</label>
        <input v-model="form.gameVersions" class="input" :placeholder="t('mod.phGames')">
        <label class="flex items-start gap-2 text-sm text-gray-500"><input v-model="form.generic" type="checkbox" class="mt-1"><span>{{ t('mod.generic') }}</span></label>
        <label class="field">{{ t('mod.roots') }}</label>
        <input v-model="form.installRoots" class="input" :placeholder="t('mod.phRoots')">
        <label class="flex items-center gap-2 text-sm text-gray-500"><input v-model="form.containsDll" type="checkbox"><span>{{ t('mod.containsDll') }}</span></label>
        <label class="field">{{ t('mod.depends') }}</label>
        <p class="text-theme-xs text-gray-500">{{ t('mod.dependsHint') }}</p>
        <div class="max-h-40 space-y-2 overflow-auto rounded-lg border border-gray-200 p-3 dark:border-gray-800">
          <p v-if="!dependOptions.length" class="text-theme-xs text-gray-500">{{ t('mod.dependsEmpty') }}</p>
          <label v-for="dep in dependOptions" :key="dep.id" class="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
            <input v-model="form.dependsOn" type="checkbox" :value="dep.id">
            <span>{{ dep.name || dep.id }} <span class="text-theme-xs text-gray-500">{{ dep.id }}</span></span>
          </label>
        </div>
        <template v-if="creating">
          <label class="field">{{ t('mod.slots') }}</label>
          <p class="text-theme-xs text-gray-500">{{ t('mod.slotsHint') }}</p>
          <div class="max-h-40 space-y-2 overflow-auto rounded-lg border border-gray-200 p-3 dark:border-gray-800">
            <p v-if="!suggestedSlots.length" class="text-theme-xs text-gray-500">{{ t('mod.slotsEmpty') }}</p>
            <label v-for="slot in suggestedSlots" :key="slot.id || slot.path" class="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
              <input v-model="form.slots" type="checkbox" :value="slot.path">
              <span>{{ slot.label || slot.path }} <span class="text-theme-xs text-gray-500">{{ slot.path }}</span></span>
            </label>
          </div>
          <div class="flex gap-2">
            <input v-model="form.extraSlot" class="input" :placeholder="t('mod.slotPath')">
            <button type="button" class="btn-secondary shrink-0" @click="addExtraSlot">{{ t('mod.slotAdd') }}</button>
          </div>
        </template>
        <label class="flex items-center gap-2 text-sm text-gray-500"><input v-model="form.r18" type="checkbox"><span>{{ t('r18.declareMod') }}</span></label>
        <label class="flex items-center gap-2 text-sm text-gray-500"><input v-model="form.license" type="checkbox"><span>{{ t('mod.license') }}</span></label>
        <p class="text-theme-xs text-gray-500">{{ reviewHint }}</p>
        <div class="mt-3 flex flex-wrap gap-2">
          <button type="button" class="btn-primary" @click="registerMod">{{ t('mod.register') }}</button>
          <button type="button" class="btn-secondary" @click="loadMods()">{{ t('mod.refresh') }}</button>
        </div>
      </div>

      <div v-if="!creating && mod" class="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        <header class="flex items-center justify-between gap-3 px-5 py-4">
          <div>
            <p class="text-theme-xs font-medium uppercase tracking-wide text-gray-400">{{ t('mod.levelVersions') }}</p>
            <h3 class="text-base font-medium text-gray-800 dark:text-white/90">{{ t('mod.versionCount', { n: versions.length }) }}</h3>
          </div>
          <button type="button" class="text-gray-400" @click="openVersions = !openVersions">
            <ChevronDown v-if="openVersions" :size="16" />
            <ChevronRight v-else :size="16" />
          </button>
        </header>
        <ul v-if="openVersions" class="divide-y divide-gray-100 border-t border-gray-100 dark:divide-gray-800 dark:border-gray-800">
          <li v-if="!versions.length" class="px-5 py-8 text-center text-sm text-gray-500">{{ t('ws.noVersion') }}</li>
          <li v-for="ver in versions" :key="ver.version">
            <button type="button" class="flex w-full items-center justify-between gap-3 px-5 py-3 text-left hover:bg-gray-50 dark:hover:bg-white/5" @click="applyVersion(ver)">
              <span>
                <strong class="text-sm text-gray-800 dark:text-white/90">{{ ver.version }}</strong>
                <span class="ml-2 text-theme-xs text-gray-400">{{ (ver.gameVersions || []).join(' / ') || '—' }}</span>
              </span>
              <span v-if="ver.version === mod.latestVersion" class="text-theme-xs text-success-600">{{ t('pack.active') }}</span>
            </button>
          </li>
        </ul>
      </div>

      <div v-if="!creating && mod" class="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        <header class="px-5 py-4">
          <p class="text-theme-xs font-medium uppercase tracking-wide text-gray-400">{{ t('mod.levelSlots') }}</p>
          <h3 class="text-base font-medium text-gray-800 dark:text-white/90">{{ t('mod.slotCount', { n: slots.length }) }}</h3>
        </header>
        <div class="space-y-4 border-t border-gray-100 px-5 py-4 dark:border-gray-800">
          <div class="grid gap-3 sm:grid-cols-2">
            <div><label class="field">{{ t('mod.slotPath') }}</label><input v-model="newPath" class="input" placeholder="Avatars"></div>
            <div><label class="field">{{ t('mod.slotLabel') }}</label><input v-model="newLabel" class="input" placeholder="Avatars"></div>
          </div>
          <button type="button" class="btn-secondary" @click="addSlot">{{ t('mod.slotAdd') }}</button>
          <p v-if="!slots.length" class="py-4 text-center text-sm text-gray-500">{{ t('mod.slotsEmpty') }}</p>
          <div v-for="slot in slots" :key="slot.id">
            <button type="button" class="mb-2 flex items-center gap-1 text-sm font-medium text-gray-700 dark:text-white/80" @click="openSlots[slot.id] = !openSlots[slot.id]">
              <ChevronDown v-if="openSlots[slot.id]" :size="14" />
              <ChevronRight v-else :size="14" />
              {{ slot.label || slot.path }}
              <span class="font-normal text-gray-400">{{ slot.path }}</span>
            </button>
            <div v-if="openSlots[slot.id]" class="ml-5 space-y-3">
              <ContentFileList :items="itemsFor(slot.id)" editable @changed="loadDetail(currentId)" />
              <label class="flex items-center gap-2 text-theme-xs text-gray-500"><input v-model="contentLicense" type="checkbox"><span>{{ t('mod.license') }}</span></label>
              <label class="drop-zone !min-h-20">
                <input type="file" accept=".zip" multiple :disabled="Boolean(busy)" @change="submitContents(($event.target as HTMLInputElement).files, $event.target as HTMLInputElement, slot.id)">
                <span>{{ t('mod.slotUpload') }}{{ busy === slot.id ? ' …' : '' }}</span>
              </label>
              <button type="button" class="btn-secondary" @click="removeSlot(slot.id)">{{ t('mod.slotDelete') }}</button>
            </div>
          </div>
          <UiProgress :active="progress.active && Boolean(busy)" :value="progress.percent" :label="progress.label" />
        </div>
      </div>
    </HierarchyShell>
  </div>
</template>
