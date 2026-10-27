<script setup lang="ts">
import { i18n, t } from '../i18n';
import { raw } from '../stores/raw';
</script>

<template>
  <details class="surface mt-6 p-4" :data-lang="i18n.lang">
    <summary class="cursor-pointer font-medium text-gray-300">{{ t('rawResponse') }}</summary>
    <pre class="tech-block mt-3 max-h-80">{{ raw.json || t('rawEmpty') }}</pre>
  </details>
</template>
