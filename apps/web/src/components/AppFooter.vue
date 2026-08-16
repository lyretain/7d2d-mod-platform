<script setup lang="ts">
import { computed } from 'vue';
import { i18n, t } from '../i18n';

withDefaults(defineProps<{ compact?: boolean }>(), { compact: false });

const copyright = computed(() => {
  void i18n.lang;
  return t('footer.copyright');
});
const sponsor = computed(() => {
  void i18n.lang;
  return t('footer.sponsor');
});
</script>

<template>
  <footer
    class="text-theme-xs text-gray-500 dark:text-gray-400"
    :class="compact
      ? 'space-y-1'
      : 'flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-gray-200 pt-4 dark:border-gray-800'"
  >
    <p class="m-0">{{ copyright }}</p>
    <p class="m-0">
      {{ sponsor }}
      <a href="https://aicocloud.com/" target="_blank" rel="noreferrer" class="text-brand-500 hover:underline">AICOCLOUD</a>
    </p>
  </footer>
</template>
