<script setup lang="ts">
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import ToastHost from './components/ToastHost.vue';
import ConfirmHost from './components/ConfirmHost.vue';
import { t } from './i18n';
import { showToast } from './stores/toast';

const router = useRouter();

onMounted(() => {
  const url = new URL(window.location.href);
  if (url.searchParams.get('github') === 'bound') {
    showToast(t('auth.githubBound'), 'ok');
    url.searchParams.delete('github');
    const next = url.pathname === '/' ? '/account' : url.pathname;
    router.replace(next + url.search);
  }
});
</script>

<template>
  <router-view />
  <ConfirmHost />
  <ToastHost />
</template>
