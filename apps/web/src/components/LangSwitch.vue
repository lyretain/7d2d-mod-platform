<script setup lang="ts">
import { computed } from 'vue';
import { currentLang, i18n, setLang, t } from '../i18n';

const lang = computed(() => i18n.lang || currentLang());
</script>

<template>
  <div class="inline-flex overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800" role="group" :aria-label="t('lang.label')">
    <button type="button" class="min-h-11 min-w-11 px-3 text-theme-xs font-medium" :class="lang === 'zh' ? 'bg-brand-500/15 text-brand-400' : 'text-gray-400'" :aria-pressed="lang === 'zh'" @click="setLang('zh')">{{ t('langZh') }}</button>
    <button type="button" class="min-h-11 min-w-11 px-3 text-theme-xs font-medium" :class="lang === 'en' ? 'bg-brand-500/15 text-brand-400' : 'text-gray-400'" :aria-pressed="lang === 'en'" @click="setLang('en')">{{ t('langEn') }}</button>
  </div>
</template>
