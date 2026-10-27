<script setup lang="ts">
import { t } from '../i18n';
import { useSidebar } from '../composables/useSidebar';

const { isMobileOpen, toggleMobileSidebar } = useSidebar();
</script>

<template>
  <button
    v-if="isMobileOpen"
    type="button"
    class="fixed inset-0 z-overlay bg-gray-950/80 lg:hidden"
    :aria-label="t('nav.closeMenu')"
    @click="toggleMobileSidebar"
  />
</template>
