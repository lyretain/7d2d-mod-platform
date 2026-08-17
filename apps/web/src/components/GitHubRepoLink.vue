<script setup lang="ts">
import { Github } from 'lucide-vue-next';
import { computed } from 'vue';
import { i18n, t } from '../i18n';

withDefaults(defineProps<{
  labeled?: boolean;
  size?: number;
}>(), { labeled: true, size: 16 });

const repoUrl = 'https://github.com/lyretain/7d2d-mod-platform';
const repoId = 'lyretain/7d2d-mod-platform';

const title = computed(() => {
  void i18n.lang;
  return t('footer.github');
});
</script>

<template>
  <a
    :href="repoUrl"
    target="_blank"
    rel="noreferrer"
    class="inline-flex min-w-0 items-center gap-1.5 text-gray-500 transition hover:text-brand-500 dark:text-gray-400"
    :title="title"
    :aria-label="title"
  >
    <Github class="shrink-0" :size="size" />
    <span v-if="labeled" class="truncate">{{ repoId }}</span>
  </a>
</template>
