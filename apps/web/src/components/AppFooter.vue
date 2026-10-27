<script setup lang="ts">
import { computed } from 'vue';
import { i18n, t } from '../i18n';
import GitHubRepoLink from './GitHubRepoLink.vue';

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
    class="text-theme-xs text-gray-400"
    :class="compact
      ? 'space-y-1'
      : 'flex flex-col gap-2 border-t border-gray-800 pt-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between'"
  >
    <p class="m-0">{{ copyright }}</p>
    <GitHubRepoLink />
    <p class="m-0 whitespace-nowrap">
      {{ sponsor }}
      <a href="https://aicocloud.com/" target="_blank" rel="noreferrer" class="text-brand-400 hover:underline">AICOCLOUD</a>
    </p>
  </footer>
</template>
