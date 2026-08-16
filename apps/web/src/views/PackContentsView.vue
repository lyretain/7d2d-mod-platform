<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, hashAndUploadZip, type UploadProgress } from '../api/client';
import UiCard from '../components/UiCard.vue';
import UiProgress from '../components/UiProgress.vue';
import { i18n, t } from '../i18n';
import { fail, ok } from '../lib/feedback';
import { prettyBytes } from '../lib/format';
import { catalog, loadMods, type ContentItem, type ModRow, type PackRow } from '../stores/catalog';
import { can } from '../stores/session';
import { ensureAdult, isAdultVerified } from '../stores/adult';
import R18Badge from '../components/R18Badge.vue';

type Slot = { id: string; path: string; label?: string };
type EntryState = {
  modId: string;
  version: string;
  required?: boolean;
  name: string;
  slots: Slot[];
  items: ContentItem[];
};

const route = useRoute();
const router = useRouter();
const pack = ref<PackRow | null>(null);
const entries = ref<EntryState[]>([]);
const picked = reactive<Record<string, Record<string, string[]>>>({});
const license = ref(false);
const busy = ref('');
const progress = ref({ active: false, percent: 0, label: '' });
const upload = reactive({ modId: '', slotId: '', name: '', description: '', r18: false });

const slotted = computed(() => entries.value.filter((entry) => entry.slots.length));

function itemsFor(entry: EntryState, slotId: string) {
  return entry.items.filter((item) => item.slotId === slotId);
}

async function toggle(modId: string, slotId: string, contentId: string) {
  const entry = entries.value.find((item) => item.modId === modId);
  const item = entry?.items.find((row) => row.id === contentId);
  if (item?.r18 && !isAdultVerified()) {
    if (!await ensureAdult()) return;
    await load();
  }
  picked[modId] = picked[modId] || {};
  const current = picked[modId][slotId] || [];
  picked[modId][slotId] = current.includes(contentId) ? current.filter((id) => id !== contentId) : current.concat(contentId);
}

function packEntries() {
  return (pack.value?.entries || []).map((entry) => {
    const contents = picked[entry.modId];
    const cleaned: Record<string, string[]> = {};
    for (const [slotId, ids] of Object.entries(contents || {})) {
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

async function load() {
  try {
    const id = String(route.params.id);
    const detail = await api<{ pack: PackRow }>(`/api/v1/packs/${encodeURIComponent(id)}`);
    pack.value = detail.pack;
    const next: EntryState[] = [];
    for (const entry of detail.pack.entries || []) {
      const mod = catalog.mods.find((item) => item.id === entry.modId) || await api<ModRow>(`/api/v1/mods/${encodeURIComponent(entry.modId)}`);
      const listed = (mod.contentSlots || []).length
        ? await api<{ contents: ContentItem[] }>(`/api/v1/mods/${encodeURIComponent(entry.modId)}/contents`)
        : { contents: [] as ContentItem[] };
      next.push({
        modId: entry.modId,
        version: entry.version,
        required: entry.required,
        name: mod.name || entry.modId,
        slots: mod.contentSlots || [],
        items: listed.contents || []
      });
      picked[entry.modId] = {};
      for (const slot of mod.contentSlots || []) {
        picked[entry.modId][slot.id] = (entry.contents?.[slot.id] || []).slice();
      }
    }
    entries.value = next;
    const first = next.find((entry) => entry.slots.length);
    if (first && !upload.modId) {
      upload.modId = first.modId;
      upload.slotId = first.slots[0]?.id || '';
    }
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
    const entry = entries.value.find((item) => item.modId === upload.modId) || slotted.value[0];
    const slotId = upload.slotId || entry?.slots[0]?.id;
    if (!entry || !slotId) throw new Error(t('mod.slotsEmpty'));
    const name = upload.name.trim() || file.name.replace(/\.zip$/i, '');
    if (!name) throw new Error(t('content.needName'));
    busy.value = `${entry.modId}:${slotId}`;
    trackProgress({ phase: 'hash', loaded: 0, total: file.size || 1 });
    const uploaded = await hashAndUploadZip(file, trackProgress);
    if (can('review.approve')) {
      await api(`/api/v1/reviews/${uploaded.hash}`, { method: 'POST', body: JSON.stringify({ status: 'approved', licenseConfirmed: true }) });
    }
    const created = await api<ContentItem>(`/api/v1/mods/${encodeURIComponent(entry.modId)}/slots/${encodeURIComponent(slotId)}/contents`, {
      method: 'POST',
      body: JSON.stringify({ artifactSha: uploaded.hash, name, description: upload.description.trim(), r18: upload.r18 })
    });
    upload.name = '';
    upload.description = '';
    upload.r18 = false;
    progress.value = { active: false, percent: 100, label: '' };
    ok(created, t('content.uploaded'));
    await load();
    toggle(entry.modId, slotId, created.id);
  } catch (error) {
    progress.value.active = false;
    fail(error);
  } finally {
    busy.value = '';
  }
}

async function save(publish = false) {
  try {
    if (!pack.value) return;
    const saved = await api<PackRow>('/api/v1/packs', {
      method: 'POST',
      body: JSON.stringify({
        id: pack.value.id,
        name: pack.value.name,
        gameVersion: pack.value.gameVersion,
        entries: packEntries()
      })
    });
    pack.value = saved;
    if (publish) {
      const release = await api(`/api/v1/packs/${encodeURIComponent(saved.id)}/releases`, { method: 'POST', body: JSON.stringify({ reason: 'pack.contents' }) });
      ok(release, t('pack.published'));
    } else {
      ok(saved, t('content.saved'));
    }
  } catch (error) {
    fail(error);
  }
}

onMounted(async () => {
  await loadMods({ silent: true });
  await load();
});
</script>

<template>
  <div class="space-y-6" :data-lang="i18n.lang">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="text-lg font-semibold text-gray-800 dark:text-white/90">{{ pack?.name || route.params.id }}</h2>
        <p class="text-theme-xs text-gray-500">{{ t('content.pickHint') }}</p>
      </div>
      <button type="button" class="btn-secondary" @click="router.push('/packs')">{{ t('pack.back') }}</button>
    </div>
    <p v-if="!slotted.length" class="text-sm text-gray-500">{{ t('content.nonePicked') }}</p>
    <UiCard v-for="entry in slotted" :key="entry.modId" :title="entry.name" :desc="entry.modId">
      <div v-for="slot in entry.slots" :key="slot.id" class="mb-4 last:mb-0">
        <h3 class="mb-2 text-sm font-medium text-gray-800 dark:text-white/90">{{ slot.label || slot.path }}</h3>
        <p v-if="!itemsFor(entry, slot.id).length" class="text-theme-xs text-gray-500">{{ t('content.empty') }}</p>
        <label v-for="item in itemsFor(entry, slot.id)" :key="item.id" class="mb-2 flex cursor-pointer items-start gap-2 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
          <input type="checkbox" class="mt-1" :checked="(picked[entry.modId]?.[slot.id] || []).includes(item.id)" @change="toggle(entry.modId, slot.id, item.id)">
          <span class="min-w-0">
          <strong class="block text-sm text-gray-800 dark:text-white/90">
            {{ item.redacted ? t('r18.hiddenName') : (item.name || item.id) }}
            <R18Badge v-if="item.r18" class="ml-1 align-middle" />
          </strong>
          <span class="text-theme-xs text-gray-500">{{ item.redacted ? t('r18.hidden') : (item.description || prettyBytes(item.size || 0)) }}{{ item.approved === false ? ` · ${t('content.pending')}` : '' }}</span>
          </span>
        </label>
      </div>
    </UiCard>
    <UiCard v-if="slotted.length" :title="t('ws.uploadModel')" :desc="t('ws.uniqueHint')">
      <div class="grid gap-3 sm:grid-cols-2">
        <div>
          <label class="field">{{ t('mod.name') }}</label>
          <select v-model="upload.modId" class="input" @change="upload.slotId = slotted.find((item) => item.modId === upload.modId)?.slots[0]?.id || ''">
            <option v-for="entry in slotted" :key="entry.modId" :value="entry.modId">{{ entry.name }}</option>
          </select>
        </div>
        <div>
          <label class="field">{{ t('mod.slots') }}</label>
          <select v-model="upload.slotId" class="input">
            <option v-for="slot in (slotted.find((item) => item.modId === upload.modId)?.slots || [])" :key="slot.id" :value="slot.id">{{ slot.label || slot.path }}</option>
          </select>
        </div>
      </div>
      <label class="field">{{ t('content.name') }}</label>
      <input v-model="upload.name" class="input" :placeholder="t('ws.phModelName')">
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
    <div class="flex flex-wrap gap-2">
      <button type="button" class="btn-secondary" @click="save(false)">{{ t('content.saveDraft') }}</button>
      <button type="button" class="btn-primary" @click="save(true)">{{ t('content.publish') }}</button>
    </div>
  </div>
</template>
