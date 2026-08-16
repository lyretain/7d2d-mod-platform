<script setup lang="ts">
import AppFooter from '../components/AppFooter.vue';
import AppHeader from '../components/AppHeader.vue';
import AppSidebar from '../components/AppSidebar.vue';
import Backdrop from '../components/Backdrop.vue';
import { useSidebarProvider } from '../composables/useSidebar';

const { isExpanded, isHovered } = useSidebarProvider();
</script>

<template>
  <div class="min-h-screen xl:flex">
    <AppSidebar />
    <Backdrop />
    <div class="flex min-h-screen flex-1 flex-col transition-all duration-300 ease-in-out" :class="isExpanded || isHovered ? 'lg:ml-[290px]' : 'lg:ml-[90px]'">
      <AppHeader />
      <div class="mx-auto flex w-full max-w-(--breakpoint-2xl) flex-1 flex-col p-4 md:p-6">
        <div class="flex-1">
          <slot />
        </div>
        <AppFooter class="mt-8" />
      </div>
    </div>
  </div>
</template>
