<script setup lang="ts">
defineProps<{ open: boolean; title: string; hint?: string }>();
const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <div v-if="open" class="fixed inset-0 z-99999 flex items-center justify-center bg-gray-950/70 p-5" @click.self="emit('close')">
    <div class="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
      <h2 class="text-lg font-semibold text-gray-800 dark:text-white/90">{{ title }}</h2>
      <p v-if="hint" class="mt-1 mb-4 text-sm text-gray-500">{{ hint }}</p>
      <slot />
    </div>
  </div>
</template>
