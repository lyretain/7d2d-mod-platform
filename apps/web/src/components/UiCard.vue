<script setup lang="ts">
defineProps<{ title?: string; desc?: string; danger?: boolean }>();
</script>

<template>
  <section
    class="surface"
    :class="danger ? 'border-error-500/40' : ''"
  >
    <header v-if="title || $slots.head" class="flex items-start justify-between gap-3 px-4 py-5 sm:px-6">
      <div class="min-w-0">
        <h3 v-if="title" class="text-base font-medium text-gray-800 wrap-anywhere dark:text-white/90">{{ title }}</h3>
        <p v-if="desc" class="mt-1 text-sm text-gray-400 wrap-anywhere">{{ desc }}</p>
        <slot name="head" />
      </div>
      <slot name="actions" />
    </header>
    <div class="min-w-0 space-y-4 p-4 sm:p-6" :class="title || $slots.head ? 'border-t border-gray-800' : ''">
      <slot />
    </div>
  </section>
</template>
