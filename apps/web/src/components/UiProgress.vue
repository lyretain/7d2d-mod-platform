<script setup lang="ts">
const props = defineProps<{
  value: number;
  label?: string;
  active?: boolean;
}>();

function clamped() {
  return Math.round(Math.min(100, Math.max(0, props.value)));
}
</script>

<template>
  <div v-if="active" class="space-y-1">
    <div class="flex justify-between gap-3 text-theme-xs text-gray-400 tabular-nums">
      <span class="min-w-0 truncate">{{ label }}</span>
      <span class="shrink-0">{{ clamped() }}%</span>
    </div>
    <div
      class="h-2 overflow-hidden rounded-full bg-white/10"
      role="progressbar"
      :aria-valuenow="clamped()"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-label="label"
    >
      <div class="h-full rounded-full bg-brand-500" :style="{ width: clamped() + '%' }" />
    </div>
  </div>
</template>
