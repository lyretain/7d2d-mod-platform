<script setup lang="ts">
import { CircleAlert, CircleCheck, TriangleAlert } from 'lucide-vue-next';
import { computed } from 'vue';
import { toast } from '../stores/toast';

const icon = computed(() => {
  if (toast.kind === 'ok') return CircleCheck;
  if (toast.kind === 'warn') return TriangleAlert;
  return CircleAlert;
});
</script>

<template>
  <div
    v-if="toast.visible"
    class="fixed top-[max(1rem,env(safe-area-inset-top))] left-1/2 z-toast flex min-h-11 w-[min(560px,calc(100%-2rem))] -translate-x-1/2 items-start gap-2 rounded-lg border bg-gray-900 px-4 py-2.5 text-sm shadow-lg"
    :class="{
      'border-success-500 text-success-500': toast.kind === 'ok',
      'border-error-500 text-error-500': toast.kind === 'err',
      'border-warning-500 text-warning-500': toast.kind === 'warn'
    }"
    role="status"
    :aria-live="toast.kind === 'err' ? 'assertive' : 'polite'"
  >
    <component :is="icon" class="mt-0.5 shrink-0" :size="16" aria-hidden="true" />
    <p class="m-0 min-w-0">{{ toast.text }}</p>
  </div>
</template>
