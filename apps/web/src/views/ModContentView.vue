<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api/client';
import { uploadContentZips, zipFilesFrom } from '../lib/content-upload';
import type { UploadProgress } from '../api/client';
import UiCard from '../components/UiCard.vue';
import UiProgress from '../components/UiProgress.vue';
import ContentFileList from '../components/ContentFileList.vue';
import { i18n, t } from '../i18n';
import { fail, ok } from '../lib/feedback';
import { prettyBytes } from '../lib/format';
import { askConfirm } from '../stores/confirm';
import type { ContentItem, ModRow } from '../stores/catalog';

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
  const slot = slots.value.find((item) => item.id === slotId);
  const name = slot?.label || slot?.path || slotId;
  if (!await askConfirm({
    title: t('mod.slotDelete'),
    hint: t('mod.slotDeleteConfirm', { name }),
    confirmLabel: t('content.deleteAgain')
  })) return;
  try {
    const result = await api(`/api/v1/mods/${encodeURIComponent(String(route.params.id))}/slots/${encodeURIComponent(slotId)}`, { method: 'DELETE' });
    if (mod.value) mod.value.contentSlots = result.contentSlots || [];
    ok(result, t('mod.slotRemoved'));
    await load();
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

async function submitContents(list: FileList | null, input?: HTMLInputElement) {
  try {
    if (!license.value) throw new Error(t('mod.needLicense'));
    const files = zipFilesFrom(list);
    if (!files.length) throw new Error(t('mod.needZip'));
    const slotId = upload.slotId || slots.value[0]?.id;
    if (!slotId) throw new Error(t('mod.slotsEmpty'));
    busy.value = slotId;
    const result = await uploadContentZips({
      files,
      modId: String(route.params.id),
      slotId,
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
    await load();
  } catch (error) {
    progress.value.active = false;
    fail(error);
  } finally {
    busy.value = '';
    if (input) input.value = '';
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
      <ContentFileList :items="itemsFor(slot.id)" editable @changed="load" />
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
      <p class="mb-3 text-theme-xs text-gray-500">{{ t('content.batchHint') }}</p>
      <label class="drop-zone mb-3">
        <input type="file" accept=".zip" multiple :disabled="Boolean(busy)" @change="submitContents(($event.target as HTMLInputElement).files, $event.target as HTMLInputElement)">
        <span>{{ t('mod.slotUpload') }}{{ busy ? ' …' : '' }}</span>
      </label>
      <UiProgress :active="progress.active" :value="progress.percent" :label="progress.label" />
    </UiCard>
  </div>
</template>
