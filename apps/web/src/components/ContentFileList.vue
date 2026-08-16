<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { api } from '../api/client';
import { i18n, t } from '../i18n';
import { fail, ok } from '../lib/feedback';
import { prettyBytes } from '../lib/format';
import type { ContentItem } from '../stores/catalog';
import R18Badge from './R18Badge.vue';
import UiModal from './UiModal.vue';

const PAGE_SIZES = [10, 20, 50];

const props = withDefaults(defineProps<{
  items: ContentItem[];
  selectable?: boolean;
  selectedIds?: string[];
  editable?: boolean;
}>(), {
  selectable: false,
  selectedIds: () => [],
  editable: false
});

const emit = defineEmits<{
  toggle: [id: string];
  changed: [];
}>();

const page = ref(1);
const pageSize = ref(20);
const busy = ref('');
const editing = ref<ContentItem | null>(null);
const draft = reactive({ name: '', description: '', r18: false });

const pages = computed(() => Math.max(1, Math.ceil(props.items.length / pageSize.value) || 1));
const pageItems = computed(() => {
  const start = (page.value - 1) * pageSize.value;
  return props.items.slice(start, start + pageSize.value);
});
const from = computed(() => (props.items.length ? (page.value - 1) * pageSize.value + 1 : 0));
const to = computed(() => Math.min(page.value * pageSize.value, props.items.length));

watch(() => [props.items.length, pageSize.value], () => {
  if (page.value > pages.value) page.value = pages.value;
});

function openEdit(item: ContentItem) {
  if (item.redacted) return;
  editing.value = item;
  draft.name = item.name || '';
  draft.description = item.description || '';
  draft.r18 = Boolean(item.r18);
}

async function saveEdit() {
  const item = editing.value;
  if (!item) return;
  try {
    const name = draft.name.trim();
    if (!name) throw new Error(t('content.needName'));
    busy.value = item.id;
    await api(`/api/v1/contents/${encodeURIComponent(item.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ name, description: draft.description.trim(), r18: draft.r18 })
    });
    editing.value = null;
    ok({ id: item.id }, t('content.edited'));
    emit('changed');
  } catch (error) {
    fail(error);
  } finally {
    busy.value = '';
  }
}

async function removeItem(item: ContentItem) {
  if (!window.confirm(t('content.deleteConfirm'))) return;
  try {
    busy.value = item.id;
    await api(`/api/v1/contents/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
    ok({ id: item.id }, t('content.deleted'));
    emit('changed');
  } catch (error) {
    fail(error);
  } finally {
    busy.value = '';
  }
}

function displayName(item: ContentItem) {
  return item.redacted ? t('r18.hiddenName') : (item.name || item.id);
}

function displayMeta(item: ContentItem) {
  if (item.redacted) return t('r18.hidden');
  const bits = [item.description || prettyBytes(item.size || 0)];
  if (item.approved === false) bits.push(t('content.pending'));
  return bits.join(' · ');
}
</script>

<template>
  <div :data-lang="i18n.lang">
    <p v-if="!items.length" class="mb-3 text-sm text-gray-500">{{ t('content.empty') }}</p>
    <div
      v-for="item in pageItems"
      :key="item.id"
      class="mb-2 flex items-start gap-3 rounded-lg border border-gray-200 p-3 dark:border-gray-800"
    >
      <input
        v-if="selectable"
        type="checkbox"
        class="mt-5"
        :checked="selectedIds.includes(item.id)"
        :disabled="Boolean(busy)"
        @change="emit('toggle', item.id)"
      >
      <div
        class="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 text-center text-[10px] leading-tight text-gray-400 dark:border-gray-700 dark:bg-white/3"
        :title="item.previewPath ? t('content.previewPath', { path: item.previewPath }) : t('content.previewLater')"
      >
        {{ item.previewPath ? t('content.hasPreview') : t('content.noPreview') }}
      </div>
      <div class="min-w-0 flex-1">
        <strong class="block text-sm text-gray-800 dark:text-white/90">
          {{ displayName(item) }}
          <R18Badge v-if="item.r18" class="ml-1 align-middle" />
        </strong>
        <p class="text-theme-xs text-gray-500">{{ displayMeta(item) }}</p>
        <p v-if="item.readmePath && !item.redacted" class="mt-1 text-theme-xs text-gray-400" :title="t('content.readmeLater')">
          {{ t('content.hasReadme') }} · {{ item.readmePath.split('/').pop() }}
        </p>
      </div>
      <div v-if="editable" class="flex shrink-0 flex-col gap-2 sm:flex-row">
        <button type="button" class="btn-secondary" :disabled="Boolean(busy) || item.redacted" @click="openEdit(item)">{{ t('content.edit') }}</button>
        <button type="button" class="btn-secondary" :disabled="Boolean(busy)" @click="removeItem(item)">{{ t('content.delete') }}</button>
      </div>
    </div>
    <div v-if="items.length" class="mt-3 flex flex-wrap items-center justify-between gap-2 text-theme-xs text-gray-500">
      <span>{{ t('content.pageRange', { from, to, total: items.length }) }}</span>
      <div class="flex flex-wrap items-center gap-2">
        <label class="flex items-center gap-1">
          <span>{{ t('content.pageSize') }}</span>
          <select v-model.number="pageSize" class="input w-auto py-1">
            <option v-for="size in PAGE_SIZES" :key="size" :value="size">{{ size }}</option>
          </select>
        </label>
        <button type="button" class="btn-secondary py-1" :disabled="page <= 1" @click="page -= 1">{{ t('content.prev') }}</button>
        <span>{{ page }} / {{ pages }}</span>
        <button type="button" class="btn-secondary py-1" :disabled="page >= pages" @click="page += 1">{{ t('content.next') }}</button>
      </div>
    </div>
    <UiModal :open="Boolean(editing)" :title="t('content.edit')" :hint="t('content.editHint')" @close="editing = null">
      <label class="field">{{ t('content.name') }}</label>
      <input v-model="draft.name" class="input" :placeholder="t('ws.phModelName')">
      <label class="field">{{ t('content.desc') }}</label>
      <textarea v-model="draft.description" class="input min-h-20" :placeholder="t('ws.phModelDesc')"></textarea>
      <label class="mb-3 mt-3 flex items-center gap-2 text-sm text-gray-500"><input v-model="draft.r18" type="checkbox"><span>{{ t('r18.declare') }}</span></label>
      <p v-if="editing?.previewPath" class="mb-2 text-theme-xs text-gray-400">{{ t('content.previewPath', { path: editing.previewPath }) }} · {{ t('content.previewLater') }}</p>
      <p v-else class="mb-2 text-theme-xs text-gray-400">{{ t('content.previewLater') }}</p>
      <p v-if="editing?.readmePath" class="mb-3 text-theme-xs text-gray-400">{{ t('content.readmePath', { path: editing.readmePath }) }} · {{ t('content.readmeLater') }}</p>
      <p v-else class="mb-3 text-theme-xs text-gray-400">{{ t('content.readmeLater') }}</p>
      <div class="flex justify-end gap-2">
        <button type="button" class="btn-secondary" @click="editing = null">{{ t('cancel') }}</button>
        <button type="button" class="btn-primary" :disabled="Boolean(busy)" @click="saveEdit">{{ t('content.save') }}</button>
      </div>
    </UiModal>
  </div>
</template>
