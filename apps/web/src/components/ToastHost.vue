<script setup lang="ts">
import { toast } from '../stores/toast';
</script>

<template>
  <div
    v-if="toast.visible"
    class="fixed top-4 left-1/2 z-99999 min-w-60 max-w-[min(560px,calc(100%-32px))] -translate-x-1/2 rounded-lg border px-4 py-2.5 text-theme-sm shadow-theme-lg"
    :class="{
      'border-success-500 bg-success-500/10 text-success-500': toast.kind === 'ok',
      'border-error-500 bg-error-500/10 text-error-500': toast.kind === 'err',
      'border-warning-500 bg-warning-500/10 text-warning-500': toast.kind === 'warn'
    }"
  >
    {{ toast.text }}
  </div>
</template>
