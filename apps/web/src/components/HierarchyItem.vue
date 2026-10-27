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
    class="mb-1 flex min-h-11 w-full flex-col justify-center rounded-lg px-3 py-2 text-left"
    :class="active ? 'bg-brand-500/10' : 'hover:bg-white/5'"
    :aria-current="active ? 'true' : undefined"
  >
    <span class="truncate text-sm font-medium text-white/90">{{ title }}</span>
    <span v-if="hint" class="truncate text-theme-xs text-gray-400">{{ hint }}</span>
  </button>
</template>
