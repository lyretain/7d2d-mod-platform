<script setup lang="ts">
import AppFooter from '../components/AppFooter.vue';
import GitHubRepoLink from '../components/GitHubRepoLink.vue';
import LangSwitch from '../components/LangSwitch.vue';
import { i18n, t } from '../i18n';

defineProps<{ title: string; lead?: string }>();
</script>

<template>
  <div class="relative flex min-h-dvh flex-col bg-gray-900" :data-lang="i18n.lang">
    <div class="flex flex-1 flex-col lg:flex-row">
      <div class="hidden flex-1 flex-col justify-center bg-white/[0.02] px-10 py-12 safe-top lg:flex">
        <LangSwitch />
        <h1 class="mt-8 text-title-sm font-medium text-brand-400">{{ t('gate.title') }}</h1>
        <p class="mt-3 max-w-prose text-gray-400">{{ t('gate.lead') }}</p>
        <ul class="mt-8 max-w-lg space-y-3">
          <li v-for="n in 4" :key="n" class="surface p-4">
            <strong class="block font-medium text-white/90">{{ t('gate.f' + n + 't') }}</strong>
            <span class="text-sm text-gray-400">{{ t('gate.f' + n + 'd') }}</span>
          </li>
        </ul>
        <div class="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2">
          <a href="/about" class="text-sm text-brand-400">{{ t('nav.about') }}</a>
          <a href="/guide" class="text-sm text-brand-400">{{ t('gate.guide') }}</a>
          <GitHubRepoLink class="text-sm" />
        </div>
      </div>
      <div class="flex flex-1 items-center justify-center px-5 py-10 safe-top">
        <div class="w-full max-w-md">
          <div class="mb-6 lg:hidden"><LangSwitch /></div>
          <h2 class="text-title-sm font-medium text-white/90">{{ title }}</h2>
          <p v-if="lead" class="mt-2 mb-6 text-sm text-gray-400">{{ lead }}</p>
          <slot />
        </div>
      </div>
    </div>
    <div class="px-6 pb-6 safe-bottom lg:px-10">
      <AppFooter />
    </div>
  </div>
</template>
