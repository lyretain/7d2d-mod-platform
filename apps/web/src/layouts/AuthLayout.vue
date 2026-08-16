<script setup lang="ts">
import AppFooter from '../components/AppFooter.vue';
import LangSwitch from '../components/LangSwitch.vue';
import { i18n, t } from '../i18n';

defineProps<{ title: string; lead?: string }>();
</script>

<template>
  <div class="relative flex min-h-screen flex-col bg-white dark:bg-gray-900" :data-lang="i18n.lang">
    <div class="flex flex-1 flex-col lg:flex-row">
      <div class="hidden flex-1 flex-col justify-center bg-gray-50 px-10 py-12 dark:bg-white/[0.02] lg:flex">
        <LangSwitch />
        <h1 class="mt-8 text-title-sm font-semibold text-brand-500">{{ t('gate.title') }}</h1>
        <p class="mt-3 max-w-lg text-gray-500 dark:text-gray-400">{{ t('gate.lead') }}</p>
        <ul class="mt-8 max-w-lg space-y-3">
          <li v-for="n in 4" :key="n" class="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
            <strong class="block text-gray-800 dark:text-white/90">{{ t('gate.f' + n + 't') }}</strong>
            <span class="text-sm text-gray-500">{{ t('gate.f' + n + 'd') }}</span>
          </li>
        </ul>
        <a href="/guide" class="mt-8 text-sm text-brand-500">{{ t('gate.guide') }}</a>
      </div>
      <div class="flex flex-1 items-center justify-center px-5 py-10">
        <div class="w-full max-w-md">
          <div class="mb-6 lg:hidden"><LangSwitch /></div>
          <h2 class="text-title-sm font-semibold text-gray-800 dark:text-white/90">{{ title }}</h2>
          <p v-if="lead" class="mt-2 mb-6 text-sm text-gray-500">{{ lead }}</p>
          <slot />
        </div>
      </div>
    </div>
    <div class="px-6 pb-6 lg:px-10">
      <AppFooter />
    </div>
  </div>
</template>
