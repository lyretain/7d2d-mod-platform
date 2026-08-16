<script setup lang="ts">
import { Boxes, LayoutGrid, Package, Server, Settings, Store, UserRound } from 'lucide-vue-next';
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useSidebar } from '../composables/useSidebar';
import { i18n, t } from '../i18n';
import { can, roleLabel, session } from '../stores/session';

const route = useRoute();
const { isExpanded, isHovered, isMobileOpen, setIsHovered } = useSidebar();
const wide = computed(() => isExpanded.value || isHovered.value || isMobileOpen.value);

const items = computed(() => {
  void i18n.lang;
  return [
    { path: '/workshop', name: t('nav.workshop'), icon: Store, show: true },
    { path: '/mods', name: t('nav.mods'), icon: Package, show: can('catalog.write') },
    { path: '/packs', name: t('nav.packs'), icon: Boxes, show: true },
    { path: '/servers', name: t('nav.servers'), icon: Server, show: true },
    { path: '/ops', name: t('nav.ops'), icon: Settings, show: can('ops.read') },
    { path: '/account', name: t('nav.account'), icon: UserRound, show: true }
  ].filter((item) => item.show);
});

function active(path: string) {
  return route.path === path;
}
</script>

<template>
  <aside
    class="fixed top-0 left-0 z-99999 mt-0 flex h-screen flex-col border-r border-gray-200 bg-white px-5 text-gray-900 transition-all duration-300 dark:border-gray-800 dark:bg-gray-900"
    :class="{
      'lg:w-[290px]': wide,
      'lg:w-[90px]': !wide,
      'w-[290px] translate-x-0': isMobileOpen,
      '-translate-x-full': !isMobileOpen,
      'lg:translate-x-0': true
    }"
    @mouseenter="!isExpanded && setIsHovered(true)"
    @mouseleave="setIsHovered(false)"
  >
    <div class="flex py-8" :class="wide ? 'justify-start' : 'lg:justify-center'">
      <router-link to="/workshop" class="min-w-0">
        <div v-if="wide">
          <strong class="block text-lg text-brand-500">{{ t('nav.brand') }}</strong>
          <span class="text-theme-xs text-gray-500">{{ t('nav.sub') }}</span>
        </div>
        <LayoutGrid v-else class="text-brand-500" :size="28" />
      </router-link>
    </div>
    <nav class="no-scrollbar flex-1 overflow-y-auto">
      <ul class="flex flex-col gap-2">
        <li v-for="item in items" :key="item.path">
          <router-link :to="item.path" class="menu-item group" :class="active(item.path) ? 'menu-item-active' : 'menu-item-inactive'">
            <component :is="item.icon" class="size-5 shrink-0" :class="active(item.path) ? 'menu-item-icon-active' : 'menu-item-icon-inactive'" />
            <span v-if="wide" class="menu-item-text">{{ item.name }}</span>
          </router-link>
        </li>
      </ul>
    </nav>
    <div v-if="wide && session.user" class="mb-6 rounded-xl border border-gray-200 p-3 text-theme-xs text-gray-500 dark:border-gray-800">
      {{ session.user.username }} · {{ roleLabel(session.user.role) }}
    </div>
  </aside>
</template>
