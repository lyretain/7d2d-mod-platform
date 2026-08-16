<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, hashAndUploadZip, type UploadProgress } from '../api/client';
import UiCard from '../components/UiCard.vue';
import UiProgress from '../components/UiProgress.vue';
import UiTable from '../components/UiTable.vue';
import { i18n, t } from '../i18n';
import { fail, ok } from '../lib/feedback';
import { prettyBytes } from '../lib/format';
import { catalog, loadMods, type ModRow } from '../stores/catalog';
import { can } from '../stores/session';

const router = useRouter();
const file = ref<File | null>(null);
const over = ref(false);
const dropHint = ref('');
const uploadResult = ref('');
const selected = ref(-1);
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
const suggestedSlots = ref<Array<{ id: string; path: string; label?: string }>>([]);
const reviewHint = ref('');
const uploading = ref(false);
const progress = ref({ active: false, percent: 0, label: '' });

function refreshHint() {
  dropHint.value = file.value ? t('mod.chosen', { name: file.value.name, size: prettyBytes(file.value.size) }) : t('mod.drop');
}

function onFile(list: FileList | null) {
  file.value = list?.[0] || null;
  refreshHint();
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
    await loadMods({ silent: true });
  } catch (error) {
    fail(error);
  }
}

function pick(row: Record<string, unknown>, index: number) {
  selected.value = index;
  const mod = row as ModRow;
  form.value.id = mod.id;
  form.value.name = mod.name || '';
  if (mod.latestVersion) form.value.version = mod.latestVersion;
  const latest = mod.versions?.[0];
  if (latest) {
    form.value.artifactSha = latest.artifactSha || '';
    form.value.gameVersions = (latest.gameVersions || []).join(',');
    form.value.generic = latest.gameVersionRange === 'major';
    form.value.dependsOn = latest.dependsOn || [];
  } else {
    form.value.dependsOn = [];
  }
  form.value.slots = (mod.contentSlots || []).map((item) => item.path);
  suggestedSlots.value = mod.contentSlots || [];
  form.value.r18 = Boolean(mod.r18);
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

const selectedSlots = computed(() => suggestedSlots.value.filter((item) => form.value.slots.includes(item.path) || form.value.slots.includes(item.id)));
const dependOptions = computed(() => catalog.mods.filter((mod) => mod.id && mod.id !== form.value.id));

onMounted(() => {
  refreshHint();
  reviewHint.value = t('mod.reviewHint');
  uploadResult.value = t('mod.uploadIdle');
  loadMods({ silent: true });
});
</script>

<template>
  <div class="space-y-6" :data-lang="i18n.lang">
    <div class="grid gap-6 xl:grid-cols-2">
      <UiCard :title="t('mod.uploadTitle')" :desc="t('mod.uploadHint')">
        <label class="drop-zone" :class="{ over }" @dragenter.prevent="over = true" @dragover.prevent="over = true" @dragleave.prevent="over = false" @drop.prevent="over = false; onFile(($event as DragEvent).dataTransfer?.files || null)">
          <input type="file" accept=".zip" :disabled="uploading" @change="onFile(($event.target as HTMLInputElement).files)">
          <span>{{ dropHint }}</span>
        </label>
        <button type="button" class="btn-primary disabled:cursor-not-allowed disabled:opacity-50" :disabled="uploading" @click="upload">{{ t('mod.upload') }}</button>
        <UiProgress class="mt-3" :active="progress.active" :value="progress.percent" :label="progress.label" />
        <pre class="max-h-52 overflow-auto rounded-lg bg-gray-950 p-3 text-theme-xs text-gray-300">{{ uploadResult }}</pre>
      </UiCard>
      <UiCard :title="t('mod.registerTitle')">
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
          <label v-for="mod in dependOptions" :key="mod.id" class="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
            <input v-model="form.dependsOn" type="checkbox" :value="mod.id">
            <span>{{ mod.name || mod.id }} <span class="text-theme-xs text-gray-500">{{ mod.id }}</span></span>
          </label>
        </div>
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
        <label class="flex items-center gap-2 text-sm text-gray-500"><input v-model="form.r18" type="checkbox"><span>{{ t('r18.declareMod') }}</span></label>
        <label class="flex items-center gap-2 text-sm text-gray-500"><input v-model="form.license" type="checkbox"><span>{{ t('mod.license') }}</span></label>
        <p class="text-theme-xs text-gray-500">{{ reviewHint }}</p>
        <div class="flex flex-wrap gap-2">
          <button type="button" class="btn-primary" @click="registerMod">{{ t('mod.register') }}</button>
          <button type="button" class="btn-secondary" @click="loadMods()">{{ t('mod.refresh') }}</button>
        </div>
      </UiCard>
    </div>
    <UiCard :title="t('mod.listTitle')" :desc="t('mod.clickFill')">
      <UiTable :rows="catalog.mods as unknown as Record<string, unknown>[]" :cols="['id', 'name', 'latestVersion', 'versionCount', 'containsDll']" :selected="selected" @pick="pick" />
      <div v-if="form.id" class="mt-3">
        <button type="button" class="btn-secondary" @click="router.push(`/mods/${encodeURIComponent(form.id)}`)">{{ t('mod.manage') }} · {{ form.name || form.id }}</button>
      </div>
    </UiCard>
  </div>
</template>
