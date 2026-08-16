<script setup lang="ts">
import AppHeader from '../components/AppHeader.vue';
import AppSidebar from '../components/AppSidebar.vue';
import Backdrop from '../components/Backdrop.vue';
import { useSidebar, useSidebarProvider } from '../composables/useSidebar';

useSidebarProvider();
const { isExpanded, isHovered } = useSidebar();
</script>

<template>
  <div class="min-h-screen xl:flex">
    <AppSidebar />
    <Backdrop />
    <div class="flex-1 transition-all duration-300 ease-in-out" :class="isExpanded || isHovered ? 'lg:ml-[290px]' : 'lg:ml-[90px]'">
      <AppHeader />
      <div class="mx-auto max-w-(--breakpoint-2xl) p-4 md:p-6">
        <slot />
      </div>
    </div>
  </div>
</template>
