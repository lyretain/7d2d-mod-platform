<script setup lang="ts">
import { i18n, t } from '../i18n';
import { fmt } from '../lib/format';

defineProps<{
  rows: Record<string, unknown>[];
  cols: string[];
  selected?: number;
}>();

const emit = defineEmits<{ pick: [row: Record<string, unknown>, index: number] }>();

function onKey(event: KeyboardEvent, row: Record<string, unknown>, index: number) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  emit('pick', row, index);
}
</script>

<template>
  <div class="overflow-auto rounded-xl border border-gray-800">
    <p v-if="!rows.length" class="px-4 py-8 text-center text-sm text-gray-400">{{ t('empty') }}</p>
    <table v-else class="w-full text-left text-sm tabular-nums">
      <thead class="bg-white/3 text-gray-400">
        <tr>
          <th v-for="col in cols" :key="col + i18n.lang" scope="col" class="px-3 py-2.5 font-medium whitespace-nowrap">{{ t('col.' + col) }}</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(row, index) in rows"
          :key="index"
          class="cursor-pointer border-t border-gray-800"
          :class="selected === index ? 'bg-brand-500/10' : 'hover:bg-white/5'"
          tabindex="0"
          :aria-selected="selected === index"
          @click="emit('pick', row, index)"
          @keydown="onKey($event, row, index)"
        >
          <td v-for="col in cols" :key="col" class="px-3 py-2.5 whitespace-nowrap text-gray-300">
            {{ fmt(col, row[col], t('yes'), t('no')) }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
