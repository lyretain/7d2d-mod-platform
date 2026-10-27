<script setup lang="ts">
import { Github } from 'lucide-vue-next';
import { computed, useAttrs } from 'vue';
import { i18n, t } from '../i18n';
import { cn } from '../lib/cn';

defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<{
  labeled?: boolean;
  size?: number;
}>(), { labeled: true, size: 16 });

const attrs = useAttrs();
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
    :class="cn('inline-flex min-h-11 min-w-0 items-center gap-1.5 text-gray-400 transition-colors duration-150 ease-out hover:text-brand-400', !props.labeled && 'min-w-11 justify-center', attrs.class)"
    :title="title"
    :aria-label="title"
  >
    <Github class="shrink-0" :size="size" aria-hidden="true" />
    <span v-if="labeled" class="truncate">{{ repoId }}</span>
  </a>
</template>
