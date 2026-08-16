<script setup lang="ts">
import { i18n, t } from '../i18n';
import { raw } from '../stores/raw';
</script>

<template>
  <details class="mt-6 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]" :data-lang="i18n.lang">
    <summary class="cursor-pointer font-semibold text-gray-700 dark:text-gray-300">{{ t('rawResponse') }}</summary>
    <pre class="mt-3 max-h-80 overflow-auto rounded-lg bg-gray-950 p-3 text-theme-xs text-gray-300">{{ raw.json || t('rawEmpty') }}</pre>
  </details>
</template>
