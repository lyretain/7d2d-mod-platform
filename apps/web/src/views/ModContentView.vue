<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, uploadZip } from '../api/client';
import UiCard from '../components/UiCard.vue';
import { i18n, t } from '../i18n';
import { fail, ok } from '../lib/feedback';
import { prettyBytes, sha256Hex } from '../lib/format';
import { can } from '../stores/session';
import type { ModRow } from '../stores/catalog';

type Slot = { id: string; path: string; label?: string };
type SlotContent = { sha256?: string; size?: number; fileName?: string };

const route = useRoute();
const router = useRouter();
const mod = ref<ModRow | null>(null);
const newPath = ref('');
const newLabel = ref('');
const license = ref(false);
const busy = ref('');

const slots = computed(() => mod.value?.contentSlots || []);
const contents = computed(() => (mod.value?.slotContents || {}) as Record<string, SlotContent>);

async function load() {
  try {
    mod.value = await api<ModRow>(`/api/v1/mods/${encodeURIComponent(String(route.params.id))}`);
  } catch (error) {
    fail(error);
  }
}

async function saveSlots(next: Slot[], messageKey = 'mod.slotSaved') {
  const result = await api(`/api/v1/mods/${encodeURIComponent(String(route.params.id))}/slots`, {
    method: 'PUT',
    body: JSON.stringify({ slots: next })
  });
  if (mod.value) {
    mod.value.contentSlots = result.contentSlots || next;
    mod.value.slotContents = result.slotContents || mod.value.slotContents;
  }
  ok(result, t(messageKey));
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
    if (mod.value) {
      mod.value.contentSlots = result.contentSlots || [];
      mod.value.slotContents = result.slotContents || {};
    }
    ok(result, t('mod.slotRemoved'));
  } catch (error) {
    fail(error);
  }
}

async function attach(slot: Slot, file: File | null, clear = false) {
  try {
    if (!clear && !license.value) throw new Error(t('mod.needLicense'));
    busy.value = slot.id;
    let artifactSha = '';
    if (!clear) {
      if (!file) throw new Error(t('mod.needZip'));
      const hash = await sha256Hex(await file.arrayBuffer());
      await uploadZip(hash, file);
      if (can('review.approve')) {
        await api(`/api/v1/reviews/${hash}`, { method: 'POST', body: JSON.stringify({ status: 'approved', licenseConfirmed: true }) });
      }
      artifactSha = hash;
    }
    const result = await api(`/api/v1/mods/${encodeURIComponent(String(route.params.id))}/slots/${encodeURIComponent(slot.id)}`, {
      method: 'POST',
      body: JSON.stringify({ artifactSha: artifactSha || undefined })
    });
    await load();
    ok(result, t(clear ? 'mod.slotCleared' : 'mod.slotAttached'));
  } catch (error) {
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
      <p class="mb-3 text-theme-xs text-gray-500">
        <template v-if="contents[slot.id]?.sha256">{{ t('mod.slotCurrent', { name: contents[slot.id].fileName || contents[slot.id].sha256?.slice(0, 10) + '…', size: prettyBytes(contents[slot.id].size || 0) }) }}</template>
        <template v-else>{{ t('mod.slotNone') }}</template>
      </p>
      <label class="mb-3 flex items-center gap-2 text-sm text-gray-500"><input v-model="license" type="checkbox"><span>{{ t('mod.license') }}</span></label>
      <label class="drop-zone mb-3">
        <input type="file" accept=".zip" @change="attach(slot, ($event.target as HTMLInputElement).files?.[0] || null)">
        <span>{{ t('mod.slotUpload') }}{{ busy === slot.id ? ' …' : '' }}</span>
      </label>
      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn-secondary" @click="attach(slot, null, true)">{{ t('mod.slotClear') }}</button>
        <button type="button" class="btn-secondary" @click="removeSlot(slot.id)">{{ t('mod.slotDelete') }}</button>
      </div>
    </UiCard>
  </div>
</template>
