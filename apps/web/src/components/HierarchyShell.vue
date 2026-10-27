<script setup lang="ts">
defineProps<{
  empty?: boolean;
  emptyText?: string;
}>();
</script>

<template>
  <div class="flex min-h-[70vh] flex-col gap-4 lg:flex-row">
    <aside class="surface flex w-full shrink-0 flex-col lg:w-80">
      <div v-if="$slots.toolbar" class="flex items-center gap-3 border-b border-gray-800 p-4">
        <slot name="toolbar" />
      </div>
      <div class="no-scrollbar flex-1 overflow-y-auto p-2">
        <slot name="list" />
      </div>
      <div v-if="$slots.footer" class="border-t border-gray-800 p-3">
        <slot name="footer" />
      </div>
    </aside>
    <section class="min-w-0 flex-1 space-y-4">
      <div v-if="empty" class="flex h-full min-h-80 items-center justify-center rounded-xl border border-dashed border-gray-800 px-6 text-center text-sm text-gray-400">
        {{ emptyText }}
      </div>
      <slot v-else />
    </section>
  </div>
</template>
