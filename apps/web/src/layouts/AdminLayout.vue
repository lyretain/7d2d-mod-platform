<script setup lang="ts">
import AppFooter from '../components/AppFooter.vue';
import AppHeader from '../components/AppHeader.vue';
import AppSidebar from '../components/AppSidebar.vue';
import Backdrop from '../components/Backdrop.vue';
import { useSidebarProvider } from '../composables/useSidebar';

const { isExpanded, isHovered } = useSidebarProvider();
</script>

<template>
  <div class="min-h-dvh xl:flex">
    <AppSidebar />
    <Backdrop />
    <div class="flex min-h-dvh flex-1 flex-col" :class="isExpanded || isHovered ? 'lg:ml-72' : 'lg:ml-20'">
      <AppHeader />
      <div class="mx-auto flex w-full max-w-(--breakpoint-2xl) flex-1 flex-col px-4 py-6 md:px-6">
        <div class="flex-1">
          <slot />
        </div>
        <AppFooter class="mt-8" />
      </div>
    </div>
  </div>
</template>
