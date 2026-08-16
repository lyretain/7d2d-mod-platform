<script setup lang="ts">
import { i18n, t } from '../i18n';
import { fmt } from '../lib/format';

defineProps<{
  rows: Record<string, unknown>[];
  cols: string[];
  selected?: number;
}>();

const emit = defineEmits<{ pick: [row: Record<string, unknown>, index: number] }>();
</script>

<template>
  <div class="overflow-auto rounded-xl border border-gray-200 dark:border-gray-800">
    <p v-if="!rows.length" class="px-4 py-8 text-center text-sm text-gray-500">{{ t('empty') }}</p>
    <table v-else class="w-full text-left text-theme-sm">
      <thead class="bg-gray-50 text-gray-500 dark:bg-white/3 dark:text-gray-400">
        <tr>
          <th v-for="col in cols" :key="col + i18n.lang" class="whitespace-nowrap px-3 py-2.5 font-semibold">{{ t('col.' + col) }}</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(row, index) in rows"
          :key="index"
          class="cursor-pointer border-t border-gray-100 dark:border-gray-800"
          :class="selected === index ? 'bg-brand-500/10' : 'hover:bg-gray-50 dark:hover:bg-white/5'"
          @click="emit('pick', row, index)"
        >
          <td v-for="col in cols" :key="col" class="whitespace-nowrap px-3 py-2.5 text-gray-700 dark:text-gray-300">
            {{ fmt(col, row[col], t('yes'), t('no')) }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
