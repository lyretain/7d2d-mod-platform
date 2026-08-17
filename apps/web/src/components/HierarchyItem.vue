<script setup lang="ts">
defineProps<{
  title: string;
  hint?: string;
  active?: boolean;
}>();
</script>

<template>
  <button
    type="button"
    class="mb-1 flex w-full flex-col rounded-xl px-3 py-2.5 text-left transition"
    :class="active ? 'bg-brand-50 dark:bg-brand-500/10' : 'hover:bg-gray-50 dark:hover:bg-white/5'"
  >
    <span class="truncate text-sm font-medium text-gray-800 dark:text-white/90">{{ title }}</span>
    <span v-if="hint" class="text-theme-xs text-gray-500">{{ hint }}</span>
  </button>
</template>
