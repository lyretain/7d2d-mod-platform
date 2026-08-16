<script setup lang="ts">
import { computed } from 'vue';
import { currentLang, i18n, setLang, t } from '../i18n';

const lang = computed(() => i18n.lang || currentLang());
</script>

<template>
  <div class="inline-flex overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800">
    <button type="button" class="px-2.5 py-1.5 text-theme-xs font-semibold" :class="lang === 'zh' ? 'bg-brand-500/15 text-brand-500' : 'text-gray-500 dark:text-gray-400'" @click="setLang('zh')">{{ t('langZh') }}</button>
    <button type="button" class="px-2.5 py-1.5 text-theme-xs font-semibold" :class="lang === 'en' ? 'bg-brand-500/15 text-brand-500' : 'text-gray-500 dark:text-gray-400'" @click="setLang('en')">{{ t('langEn') }}</button>
  </div>
</template>
