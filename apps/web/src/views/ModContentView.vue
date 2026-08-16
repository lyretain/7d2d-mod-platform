<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, hashAndUploadZip, type UploadProgress } from '../api/client';
import UiCard from '../components/UiCard.vue';
import UiProgress from '../components/UiProgress.vue';
import { i18n, t } from '../i18n';
import { fail, ok } from '../lib/feedback';
import { prettyBytes } from '../lib/format';
import { can } from '../stores/session';
import type { ContentItem, ModRow } from '../stores/catalog';
import R18Badge from '../components/R18Badge.vue';

type Slot = { id: string; path: string; label?: string };

const route = useRoute();
const router = useRouter();
const mod = ref<ModRow | null>(null);
const contents = ref<ContentItem[]>([]);
const newPath = ref('');
const newLabel = ref('');
const license = ref(false);
const busy = ref('');
const progress = ref({ active: false, percent: 0, label: '' });
const upload = reactive({ slotId: '', name: '', description: '', r18: false });

const slots = computed(() => mod.value?.contentSlots || []);

function itemsFor(slotId: string) {
  return contents.value.filter((item) => item.slotId === slotId);
}

async function load() {
  try {
    const id = String(route.params.id);
    const [detail, listed] = await Promise.all([
      api<ModRow>(`/api/v1/mods/${encodeURIComponent(id)}`),
      api<{ contents: ContentItem[] }>(`/api/v1/mods/${encodeURIComponent(id)}/contents`)
    ]);
    mod.value = detail;
    contents.value = listed.contents || detail.contents || [];
    if (!upload.slotId && slots.value[0]) upload.slotId = slots.value[0].id;
  } catch (error) {
    fail(error);
  }
}

async function saveSlots(next: Slot[], messageKey = 'mod.slotSaved') {
  const result = await api(`/api/v1/mods/${encodeURIComponent(String(route.params.id))}/slots`, {
    method: 'PUT',
    body: JSON.stringify({ slots: next })
  });
  if (mod.value) mod.value.contentSlots = result.contentSlots || next;
  ok(result, t(messageKey));
  await load();
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
  try {
    const result = await api(`/api/v1/mods/${encodeURIComponent(String(route.params.id))}/slots/${encodeURIComponent(slotId)}`, { method: 'DELETE' });
    if (mod.value) mod.value.contentSlots = result.contentSlots || [];
    ok(result, t('mod.slotRemoved'));
    await load();
  } catch (error) {
    fail(error);
  }
}

async function removeContent(contentId: string) {
  try {
    const result = await api(`/api/v1/contents/${encodeURIComponent(contentId)}`, { method: 'DELETE' });
    ok(result, t('content.deleted'));
    await load();
  } catch (error) {
    fail(error);
  }
}

function trackProgress(event: UploadProgress) {
  const percent = event.total ? Math.round((event.loaded / event.total) * 100) : 0;
  if (event.phase === 'hash') progress.value = { active: true, percent, label: t('mod.hashing', { percent }) };
  else if (event.phase === 'upload') progress.value = { active: true, percent, label: t('mod.uploadProgress', { percent, loaded: prettyBytes(event.loaded), total: prettyBytes(event.total) }) };
  else progress.value = { active: true, percent: 100, label: t('mod.analyzing') };
}

async function submitContent(file: File | null) {
  try {
    if (!license.value) throw new Error(t('mod.needLicense'));
    if (!file) throw new Error(t('mod.needZip'));
    const slotId = upload.slotId || slots.value[0]?.id;
    if (!slotId) throw new Error(t('mod.slotsEmpty'));
    const name = upload.name.trim() || file.name.replace(/\.zip$/i, '');
    if (!name) throw new Error(t('content.needName'));
    busy.value = slotId;
    trackProgress({ phase: 'hash', loaded: 0, total: file.size || 1 });
    const uploaded = await hashAndUploadZip(file, trackProgress);
    if (can('review.approve')) {
      await api(`/api/v1/reviews/${uploaded.hash}`, { method: 'POST', body: JSON.stringify({ status: 'approved', licenseConfirmed: true }) });
    }
    const created = await api(`/api/v1/mods/${encodeURIComponent(String(route.params.id))}/slots/${encodeURIComponent(slotId)}/contents`, {
      method: 'POST',
      body: JSON.stringify({ artifactSha: uploaded.hash, name, description: upload.description.trim(), r18: upload.r18 })
    });
    upload.name = '';
    upload.description = '';
    upload.r18 = false;
    progress.value = { active: false, percent: 100, label: '' };
    ok(created, t('content.uploaded'));
    await load();
  } catch (error) {
    progress.value.active = false;
    fail(error);
  } finally {
    busy.value = '';
  }
}

onMounted(load);
</script>

<template>
  <div class="space-y-6" :data-lang="i18n.lang">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="text-lg font-semibold text-gray-800 dark:text-white/90">{{ mod?.name || route.params.id }}</h2>
        <p class="text-theme-xs text-gray-500">{{ mod?.id }} · {{ t('mod.slotsHint') }}</p>
      </div>
      <button type="button" class="btn-secondary" @click="router.push('/mods')">{{ t('mod.backToMods') }}</button>
    </div>
    <UiCard :title="t('mod.slotAdd')">
      <div class="grid gap-3 sm:grid-cols-2">
        <div><label class="field">{{ t('mod.slotPath') }}</label><input v-model="newPath" class="input" placeholder="Avatars"></div>
        <div><label class="field">{{ t('mod.slotLabel') }}</label><input v-model="newLabel" class="input" placeholder="Avatars"></div>
      </div>
      <button type="button" class="btn-primary mt-3" @click="addSlot">{{ t('mod.slotAdd') }}</button>
    </UiCard>
    <p v-if="!slots.length" class="text-sm text-gray-500">{{ t('mod.slotsEmpty') }}</p>
    <UiCard v-for="slot in slots" :key="slot.id" :title="slot.label || slot.path" :desc="slot.path">
      <p v-if="!itemsFor(slot.id).length" class="mb-3 text-sm text-gray-500">{{ t('content.empty') }}</p>
      <div v-for="item in itemsFor(slot.id)" :key="item.id" class="mb-2 flex items-start justify-between gap-3 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
        <div class="min-w-0">
          <strong class="block text-sm text-gray-800 dark:text-white/90">
            {{ item.name || item.id }}
            <R18Badge v-if="item.r18" class="ml-1 align-middle" />
          </strong>
          <p class="text-theme-xs text-gray-500">{{ item.description || prettyBytes(item.size || 0) }}{{ item.approved === false ? ` · ${t('content.pending')}` : '' }}</p>
        </div>
        <button type="button" class="btn-secondary shrink-0" @click="removeContent(item.id)">{{ t('content.delete') }}</button>
      </div>
      <button type="button" class="btn-secondary mt-2" @click="removeSlot(slot.id)">{{ t('mod.slotDelete') }}</button>
    </UiCard>
    <UiCard v-if="slots.length" :title="t('ws.uploadModel')" :desc="t('ws.uniqueHint')">
      <div class="grid gap-3 sm:grid-cols-2">
        <div>
          <label class="field">{{ t('mod.slots') }}</label>
          <select v-model="upload.slotId" class="input">
            <option v-for="slot in slots" :key="slot.id" :value="slot.id">{{ slot.label || slot.path }}</option>
          </select>
        </div>
        <div>
          <label class="field">{{ t('content.name') }}</label>
          <input v-model="upload.name" class="input" :placeholder="t('ws.phModelName')">
        </div>
      </div>
      <label class="field">{{ t('content.desc') }}</label>
      <textarea v-model="upload.description" class="input min-h-20" :placeholder="t('ws.phModelDesc')"></textarea>
      <label class="mb-3 mt-3 flex items-center gap-2 text-sm text-gray-500"><input v-model="upload.r18" type="checkbox"><span>{{ t('r18.declare') }}</span></label>
      <label class="mb-3 flex items-center gap-2 text-sm text-gray-500"><input v-model="license" type="checkbox"><span>{{ t('mod.license') }}</span></label>
      <label class="drop-zone mb-3">
        <input type="file" accept=".zip" :disabled="Boolean(busy)" @change="submitContent(($event.target as HTMLInputElement).files?.[0] || null)">
        <span>{{ t('mod.slotUpload') }}{{ busy ? ' …' : '' }}</span>
      </label>
      <UiProgress :active="progress.active" :value="progress.percent" :label="progress.label" />
    </UiCard>
  </div>
</template>
