<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, hashAndUploadZip, type UploadProgress } from '../api/client';
import UiCard from '../components/UiCard.vue';
import UiModal from '../components/UiModal.vue';
import UiProgress from '../components/UiProgress.vue';
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
    const created = await api<ContentItem>(`/api/v1/mods/${encodeURIComponent(String(route.params.id))}/slots/${encodeURIComponent(slotId)}/contents`, {
      method: 'POST',
      body: JSON.stringify({ artifactSha: uploaded.hash, name, description: upload.description.trim(), r18: upload.r18 })
    });
    upload.name = '';
    upload.description = '';
    upload.r18 = false;
    progress.value = { active: false, percent: 100, label: '' };
    ok(created, t('content.uploaded'));
    await load();
    toggleContent(slotId, created.id);
  } catch (error) {
    progress.value.active = false;
    fail(error);
  } finally {
    busy.value = '';
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
      <p v-if="!itemsFor(slot.id).length" class="mb-3 text-sm text-gray-500">{{ t('content.empty') }}</p>
      <label v-for="item in itemsFor(slot.id)" :key="item.id" class="mb-2 flex cursor-pointer items-start gap-2 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
        <input type="checkbox" class="mt-1" :checked="(picked[slot.id] || []).includes(item.id)" @change="toggleContent(slot.id, item.id)">
        <span class="min-w-0">
          <strong class="block text-sm text-gray-800 dark:text-white/90">
            {{ item.redacted ? t('r18.hiddenName') : (item.name || item.id) }}
            <R18Badge v-if="item.r18" class="ml-1 align-middle" />
          </strong>
          <span class="text-theme-xs text-gray-500">{{ item.redacted ? t('r18.hidden') : (item.description || prettyBytes(item.size || 0)) }}{{ item.approved === false ? ` · ${t('content.pending')}` : '' }}</span>
        </span>
      </label>
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
