<script setup lang="ts">
defineProps<{ title?: string; desc?: string; danger?: boolean }>();
</script>

<template>
  <section
    class="rounded-2xl border bg-white dark:bg-white/[0.03]"
    :class="danger ? 'border-error-500/30 dark:border-error-500/20' : 'border-gray-200 dark:border-gray-800'"
  >
    <header v-if="title || $slots.head" class="flex items-start justify-between gap-3 px-6 py-5">
      <div>
        <h3 v-if="title" class="text-base font-medium text-gray-800 dark:text-white/90">{{ title }}</h3>
        <p v-if="desc" class="mt-1 text-sm text-gray-500 dark:text-gray-400">{{ desc }}</p>
        <slot name="head" />
      </div>
      <slot name="actions" />
    </header>
    <div class="space-y-4 p-4 sm:p-6" :class="title || $slots.head ? 'border-t border-gray-100 dark:border-gray-800' : ''">
      <slot />
    </div>
  </section>
</template>
