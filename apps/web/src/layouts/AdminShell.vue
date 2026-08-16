<script setup lang="ts">
import { onMounted } from 'vue';
import R18Gate from '../components/R18Gate.vue';
import RawPanel from '../components/RawPanel.vue';
import { t } from '../i18n';
import { session } from '../stores/session';
import { showToast } from '../stores/toast';
import AdminLayout from './AdminLayout.vue';

onMounted(() => {
  if (session.user?.role === 'community' && !session.user.githubBound) showToast(t('auth.needGithub'), 'warn');
});
</script>

<template>
  <AdminLayout>
    <router-view />
    <RawPanel />
    <R18Gate />
  </AdminLayout>
</template>
