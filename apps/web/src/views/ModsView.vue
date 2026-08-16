<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, uploadZip } from '../api/client';
import UiCard from '../components/UiCard.vue';
import UiTable from '../components/UiTable.vue';
import { i18n, t } from '../i18n';
import { fail, ok } from '../lib/feedback';
import { prettyBytes, sha256Hex } from '../lib/format';
import { catalog, loadMods, type ModRow } from '../stores/catalog';
import { can } from '../stores/session';

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
  license: false
});
const reviewHint = ref('');

function refreshHint() {
  dropHint.value = file.value ? t('mod.chosen', { name: file.value.name, size: prettyBytes(file.value.size) }) : t('mod.drop');
}

function onFile(list: FileList | null) {
  file.value = list?.[0] || null;
  refreshHint();
}

async function upload() {
  try {
    if (!file.value) throw new Error(t('mod.needZip'));
    uploadResult.value = t('mod.uploading', { name: file.value.name });
    const bytes = await file.value.arrayBuffer();
    const hash = await sha256Hex(bytes);
    const result = await uploadZip(hash, file.value);
    form.value.artifactSha = hash;
    const analysis = result.review?.analysis;
    if (analysis) {
      if (analysis.roots?.length && !form.value.installRoots) form.value.installRoots = analysis.roots.join(',');
      if (analysis.containsDll) form.value.containsDll = true;
      if (analysis.modInfo) {
        if (!form.value.id && analysis.modInfo.name) form.value.id = String(analysis.modInfo.name).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-|-$/g, '').slice(0, 64);
        if (!form.value.name && (analysis.modInfo.displayName || analysis.modInfo.name)) form.value.name = analysis.modInfo.displayName || analysis.modInfo.name;
        if (!form.value.version && analysis.modInfo.version) form.value.version = analysis.modInfo.version;
      }
    }
    const status = result.review?.status || t('mod.uploaded');
    const nextKey = status === 'pending' ? 'mod.pendingHint' : 'mod.readyHint';
    reviewHint.value = t(nextKey);
    uploadResult.value = t('mod.uploadResult', { hash, status, size: prettyBytes(result.size), next: t(nextKey) });
    ok(result, t('mod.uploadOk'));
  } catch (error) {
    uploadResult.value = error instanceof Error ? error.message : String(error);
    fail(error);
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
        requiresRestart: form.value.containsDll
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
  }
}

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
          <input type="file" accept=".zip" @change="onFile(($event.target as HTMLInputElement).files)">
          <span>{{ dropHint }}</span>
        </label>
        <button type="button" class="btn-primary" @click="upload">{{ t('mod.upload') }}</button>
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
    </UiCard>
  </div>
</template>
