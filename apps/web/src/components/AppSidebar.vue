<script setup lang="ts">
import { Boxes, CircleHelp, LayoutGrid, Package, Server, Settings, Store, UserRound } from 'lucide-vue-next';
import { computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useSidebar } from '../composables/useSidebar';
import { i18n, t } from '../i18n';
import { can, roleLabel, session } from '../stores/session';
import GitHubRepoLink from './GitHubRepoLink.vue';

const route = useRoute();
const { isExpanded, isHovered, isMobileOpen, setIsHovered, toggleMobileSidebar } = useSidebar();
const wide = computed(() => isExpanded.value || isHovered.value || isMobileOpen.value);

const items = computed(() => {
  void i18n.lang;
  return [
    { path: '/workshop', name: t('nav.workshop'), icon: Store, show: true },
    { path: '/mods', name: t('nav.mods'), icon: Package, show: can('catalog.write') },
    { path: '/packs', name: t('nav.packs'), icon: Boxes, show: true },
    { path: '/servers', name: t('nav.servers'), icon: Server, show: true },
    { path: '/ops', name: t('nav.ops'), icon: Settings, show: can('ops.read') },
    { path: '/account', name: t('nav.account'), icon: UserRound, show: true },
    { path: '/about', name: t('nav.about'), icon: CircleHelp, show: true }
  ].filter((item) => item.show);
});

function active(path: string) {
  return route.path === path || (path !== '/' && route.path.startsWith(`${path}/`));
}

function follow(path: string) {
  if (isMobileOpen.value && (route.path === path || route.path.startsWith(`${path}/`))) toggleMobileSidebar();
}

watch(() => route.path, () => {
  if (isMobileOpen.value) toggleMobileSidebar();
});
</script>

<template>
  <aside
    id="app-sidebar"
    class="fixed top-0 left-0 z-drawer flex h-dvh flex-col border-r border-gray-800 bg-gray-900 px-3 text-gray-100 transition-transform duration-150 ease-out safe-top safe-bottom motion-reduce:transition-none"
    :class="[
      wide ? 'w-72' : 'w-72 lg:w-20',
      isMobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
    ]"
    @mouseenter="!isExpanded && setIsHovered(true)"
    @mouseleave="setIsHovered(false)"
  >
    <div class="flex py-6" :class="wide ? 'justify-start px-2' : 'lg:justify-center'">
      <router-link to="/workshop" class="min-w-0" :aria-label="t('nav.brand')">
        <div v-if="wide">
          <strong class="block text-lg font-medium text-brand-400">{{ t('nav.brand') }}</strong>
          <span class="text-theme-xs text-gray-400">{{ t('nav.sub') }}</span>
        </div>
        <LayoutGrid v-else class="text-brand-400" :size="24" aria-hidden="true" />
      </router-link>
    </div>
    <nav class="no-scrollbar flex-1 overflow-y-auto" :aria-label="t('nav.primary')">
      <ul class="flex flex-col gap-1">
        <li v-for="item in items" :key="item.path">
          <router-link
            :to="item.path"
            class="menu-item group"
            :class="[active(item.path) ? 'menu-item-active' : 'menu-item-inactive', wide ? '' : 'lg:justify-center lg:px-0']"
            :aria-current="active(item.path) ? 'page' : undefined"
            :aria-label="item.name"
            @click="follow(item.path)"
          >
            <component :is="item.icon" class="size-5 shrink-0" :stroke-width="active(item.path) ? 2 : 1.5" :class="active(item.path) ? 'menu-item-icon-active' : 'menu-item-icon-inactive'" aria-hidden="true" />
            <span v-if="wide" class="truncate">{{ item.name }}</span>
          </router-link>
        </li>
      </ul>
    </nav>
    <div class="mb-3" :class="wide ? '' : 'lg:flex lg:justify-center'">
      <GitHubRepoLink :labeled="wide" class="text-theme-xs" />
    </div>
    <div v-if="wide && session.user" class="mb-4 rounded-xl border border-gray-800 p-3 text-theme-xs text-gray-400">
      <p class="m-0 truncate">{{ session.user.username }}</p>
      <p class="m-0 truncate">{{ roleLabel(session.user.role) }}</p>
    </div>
  </aside>
</template>
