<script setup lang="ts">
defineProps<{
  value: number;
  label?: string;
  active?: boolean;
}>();
</script>

<template>
  <div v-if="active" class="space-y-1">
    <div class="flex justify-between gap-3 text-theme-xs text-gray-500">
      <span class="truncate">{{ label }}</span>
      <span class="shrink-0">{{ Math.round(Math.min(100, Math.max(0, value))) }}%</span>
    </div>
    <div class="h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-white/10">
      <div class="h-full rounded-full bg-brand-500 transition-[width] duration-150" :style="{ width: Math.min(100, Math.max(0, value)) + '%' }" />
    </div>
  </div>
</template>
