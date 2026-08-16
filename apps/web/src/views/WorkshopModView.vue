<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api/client';
import { uploadContentZips, zipFilesFrom } from '../lib/content-upload';
import type { UploadProgress } from '../api/client';
import UiCard from '../components/UiCard.vue';
import UiModal from '../components/UiModal.vue';
import UiProgress from '../components/UiProgress.vue';
import ContentFileList from '../components/ContentFileList.vue';
import { i18n, t } from '../i18n';
import { fail, ok } from '../lib/feedback';
import { prettyBytes } from '../lib/format';
import { catalog, loadPacks, type ContentItem, type ModRow } from '../stores/catalog';
import { can } from '../stores/session';
import { ensureAdult, isAdultMod, isAdultVerified } from '../stores/adult';
import { showToast } from '../stores/toast';
import R18Badge from '../components/R18Badge.vue';

const route = useRoute();
const router = useRouter();
const mod = ref<ModRow | null>(null);
const contents = ref<ContentItem[]>([]);
const picked = reactive<Record<string, string[]>>({});
const license = ref(false);
const busy = ref('');
const progress = ref({ active: false, percent: 0, label: '' });
const upload = reactive({ slotId: '', name: '', description: '', r18: false });
const dialogOpen = ref(false);
const dialogMode = ref<'create' | 'add'>('create');
const packName = ref('');
const packGame = ref('');
const packId = ref('');

const slots = computed(() => mod.value?.contentSlots || []);
const slotTotal = computed(() => Object.values(mod.value?.contentCounts || {}).reduce((sum, n) => sum + n, 0));

function itemsFor(slotId: string) {
  return contents.value.filter((item) => item.slotId === slotId);
}

async function toggleContent(slotId: string, contentId: string) {
  const item = contents.value.find((row) => row.id === contentId);
  if (item?.r18 && !isAdultVerified()) {
    if (!await ensureAdult()) return;
    await load();
  }
  const current = picked[slotId] || [];
  picked[slotId] = current.includes(contentId) ? current.filter((id) => id !== contentId) : current.concat(contentId);
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
    for (const item of result.created) toggleContent(slotId, item.id);
  } catch (error) {
    progress.value.active = false;
    fail(error);
  } finally {
    busy.value = '';
    if (input) input.value = '';
  }
}

function selectedContents() {
  const out: Record<string, string[]> = {};
  for (const [slotId, ids] of Object.entries(picked)) {
    if (ids?.length) out[slotId] = ids.slice();
  }
  return Object.keys(out).length ? out : undefined;
}

function openDialog(mode: 'create' | 'add') {
  if (!can('pack.publish')) return showToast(t('ws.needAdmin'), 'warn');
  if (!mod.value?.latestVersion) return showToast(t('ws.noVersion'), 'warn');
  dialogMode.value = mode;
  if (mode === 'create') {
    if (!packName.value) packName.value = mod.value.name || mod.value.id;
    if (!packGame.value) packGame.value = (mod.value.gameVersions || [])[0] || '';
  }
  dialogOpen.value = true;
}

async function submitDialog() {
  try {
    if (!mod.value?.latestVersion) throw new Error(t('ws.noVersion'));
    const entry = { modId: mod.value.id, version: mod.value.latestVersion, required: true, contents: selectedContents() };
    let pack;
    if (dialogMode.value === 'create') {
      if (!packName.value.trim() || !packGame.value.trim()) throw new Error(t('ws.needNameGame'));
      pack = await api<{ id: string }>('/api/v1/packs', {
        method: 'POST',
        body: JSON.stringify({ name: packName.value.trim(), gameVersion: packGame.value.trim(), entries: [entry] })
      });
    } else {
      const current = catalog.packs.find((item) => item.id === packId.value);
      if (!current) throw new Error(t('ws.needPack'));
      const merged = new Map((current.entries || []).map((item) => [item.modId, item]));
      merged.set(entry.modId, { ...merged.get(entry.modId), ...entry });
      pack = await api<{ id: string }>('/api/v1/packs', {
        method: 'POST',
        body: JSON.stringify({ id: current.id, name: current.name, gameVersion: current.gameVersion, entries: [...merged.values()] })
      });
    }
    dialogOpen.value = false;
    await loadPacks({ silent: true });
    ok(pack, t('ws.createdPick'));
    await router.push(`/packs/${encodeURIComponent(pack.id)}/contents`);
  } catch (error) {
    fail(error);
  }
}

onMounted(async () => {
  await Promise.all([loadPacks({ silent: true }), load()]);
  if (isAdultMod(mod.value) && !isAdultVerified()) {
    if (!await ensureAdult()) {
      await router.push('/workshop');
      return;
    }
    await load();
  }
});
</script>

<template>
  <div class="space-y-6" :data-lang="i18n.lang">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="text-lg font-semibold text-gray-800 dark:text-white/90">
          {{ mod?.name || route.params.id }}
          <R18Badge v-if="isAdultMod(mod)" class="ml-2 align-middle" />
        </h2>
        <p class="text-theme-xs text-gray-500">{{ mod?.author || t('ws.unknownAuthor') }} · v{{ mod?.latestVersion || '—' }} · {{ prettyBytes(mod?.artifactSize || 0) }}</p>
      </div>
      <button type="button" class="btn-secondary" @click="router.push('/workshop')">{{ t('ws.backWorkshop') }}</button>
    </div>
    <UiCard :title="t('ws.about')">
      <p class="text-sm text-gray-600 dark:text-gray-300">{{ mod?.redacted ? t('r18.hidden') : (mod?.description || t('ws.noDesc')) }}</p>
      <p v-if="slotTotal" class="mt-2 text-theme-xs text-gray-500">{{ t('ws.slotCount', { n: slotTotal }) }}</p>
    </UiCard>
    <p v-if="!slots.length" class="text-sm text-gray-500">{{ t('mod.slotsEmpty') }}</p>
    <UiCard v-for="slot in slots" :key="slot.id" :title="slot.label || slot.path" :desc="slot.path">
      <ContentFileList
        :items="itemsFor(slot.id)"
        selectable
        :selected-ids="picked[slot.id] || []"
        @toggle="toggleContent(slot.id, $event)"
      />
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
        <span>{{ t('ws.submitContent') }}{{ busy ? ' …' : '' }}</span>
      </label>
      <UiProgress :active="progress.active" :value="progress.percent" :label="progress.label" />
    </UiCard>
    <div v-if="can('pack.publish') && slots.length" class="flex flex-wrap gap-2">
      <button type="button" class="btn-primary" @click="openDialog('create')">{{ t('ws.joinAndPick') }}</button>
      <button type="button" class="btn-secondary" @click="openDialog('add')">{{ t('ws.addExisting') }}</button>
    </div>
    <UiModal
      :open="dialogOpen"
      :title="dialogMode === 'create' ? t('ws.dlgCreate') : t('ws.dlgAdd')"
      :hint="t('content.pickHint')"
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
          <option v-for="pack in catalog.packs" :key="pack.id" :value="pack.id">{{ pack.name || pack.id }}</option>
        </select>
      </div>
      <div class="flex gap-2">
        <button type="button" class="btn-secondary flex-1" @click="dialogOpen = false">{{ t('cancel') }}</button>
        <button type="button" class="btn-primary flex-1" @click="submitDialog">{{ t('confirm') }}</button>
      </div>
    </UiModal>
  </div>
</template>
