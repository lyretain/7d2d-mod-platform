<script setup lang="ts">
import { Menu } from 'lucide-vue-next';
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api/client';
import { useSidebar } from '../composables/useSidebar';
import { i18n, t } from '../i18n';
import { clearToken } from '../stores/session';
import { showToast } from '../stores/toast';
import GitHubRepoLink from './GitHubRepoLink.vue';
import LangSwitch from './LangSwitch.vue';

const route = useRoute();
const router = useRouter();
const { toggleSidebar } = useSidebar();
const title = computed(() => {
  void i18n.lang;
  const key = String(route.meta.titleKey || '');
  return key ? t(key) : '';
});
const hint = computed(() => {
  void i18n.lang;
  const key = String(route.meta.hintKey || '');
  return key ? t(key) : '';
});

async function logout() {
  try { await api('/api/v1/auth/logout', { method: 'POST', body: '{}' }); } catch { /* ignore */ }
  clearToken();
  showToast(t('auth.logoutOk'), 'ok');
  router.push('/signin');
}
</script>

<template>
  <header class="sticky top-0 z-99999 flex w-full border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
    <div class="flex w-full items-center justify-between gap-4 px-4 py-3 md:px-6">
      <div class="flex min-w-0 items-center gap-3">
        <button type="button" class="flex size-10 items-center justify-center rounded-lg border border-gray-200 text-gray-500 dark:border-gray-800" @click="toggleSidebar">
          <Menu :size="18" />
        </button>
        <div class="min-w-0">
          <h1 class="truncate text-lg font-semibold text-gray-800 dark:text-white/90">{{ title }}</h1>
          <p v-if="hint" class="hidden truncate text-theme-xs text-gray-500 sm:block">{{ hint }}</p>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <GitHubRepoLink :labeled="false" :size="18" class="hidden sm:inline-flex" />
        <LangSwitch />
        <router-link to="/about" class="btn-secondary hidden sm:inline-flex">{{ t('nav.about') }}</router-link>
        <a href="/guide" class="btn-secondary hidden sm:inline-flex">{{ t('guide') }}</a>
        <button type="button" class="btn-secondary" @click="logout">{{ t('logout') }}</button>
      </div>
    </div>
  </header>
</template>
