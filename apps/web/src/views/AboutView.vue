<script setup lang="ts">
import { Download } from 'lucide-vue-next';
import { computed, onMounted, ref } from 'vue';
import { api } from '../api/client';
import AppFooter from '../components/AppFooter.vue';
import LangSwitch from '../components/LangSwitch.vue';
import UiCard from '../components/UiCard.vue';
import { i18n, t } from '../i18n';
import AdminLayout from '../layouts/AdminLayout.vue';
import { prettyBytes } from '../lib/format';
import { session } from '../stores/session';

type PluginDownload = {
  id: string;
  name: string;
  root: string;
  installSide: string;
  version: string;
  sha256: string;
  size: number;
  url?: string | null;
  fileName?: string;
  gameVersions?: string[];
};

type PlatformDownloads = {
  gameVersion?: string | null;
  plugins?: PluginDownload[];
  launcher?: {
    version: string;
    platform: string;
    sha256: string;
    size: number;
    fileName?: string;
    url?: string | null;
  } | null;
};

const payload = ref<PlatformDownloads>({ plugins: [], launcher: null });
const loaded = ref(false);

const client = computed(() => payload.value.plugins?.find((item) => item.id === 'mod-platform-client') || null);
const server = computed(() => payload.value.plugins?.find((item) => item.id === 'mod-platform-server') || null);
const gameLabel = computed(() => {
  void i18n.lang;
  return t('about.game', { v: payload.value.gameVersion || '3.10.14' });
});

onMounted(async () => {
  try {
    payload.value = await api<PlatformDownloads>('/api/v1/public/platform');
  } catch {
    payload.value = { plugins: [], launcher: null };
  } finally {
    loaded.value = true;
  }
});

function shaLabel(value?: string) {
  const hash = String(value || '');
  if (hash.length < 16) return '';
  return `${hash.slice(0, 12)}…${hash.slice(-8)}`;
}
</script>

<template>
  <component :is="session.user ? AdminLayout : 'div'" :class="session.user ? '' : 'min-h-screen bg-white dark:bg-gray-900'">
    <div v-if="!session.user" class="border-b border-gray-200 px-4 py-3 dark:border-gray-800 md:px-8">
      <div class="mx-auto flex max-w-5xl items-center justify-between gap-3">
        <router-link to="/about" class="min-w-0">
          <strong class="block text-lg text-brand-500">{{ t('nav.brand') }}</strong>
          <span class="text-theme-xs text-gray-500">{{ t('nav.sub') }}</span>
        </router-link>
        <div class="flex items-center gap-2">
          <LangSwitch />
          <a href="/guide" class="btn-secondary hidden sm:inline-flex">{{ t('guide') }}</a>
          <router-link to="/signin" class="btn-primary">{{ t('about.signin') }}</router-link>
        </div>
      </div>
    </div>

    <div class="mx-auto flex w-full max-w-5xl flex-col gap-6" :class="session.user ? '' : 'px-4 py-8 md:px-8'">
      <section>
        <p class="text-sm text-brand-500">{{ gameLabel }}</p>
        <h2 class="mt-1 text-title-sm font-semibold text-gray-800 dark:text-white/90">{{ t('page.about.title') }}</h2>
        <p class="mt-2 max-w-3xl text-sm text-gray-500 dark:text-gray-400">{{ t('about.lead') }}</p>
      </section>

      <UiCard :title="t('about.downloads')" :desc="t('about.downloadsHint')">
        <div class="grid gap-4 md:grid-cols-3">
          <article v-for="card in [
            { key: 'client', item: client, title: t('about.client'), path: t('about.clientPath') },
            { key: 'server', item: server, title: t('about.server'), path: t('about.serverPath') },
            { key: 'launcher', item: payload.launcher, title: t('about.launcher'), path: t('about.launcherHint') }
          ]" :key="card.key" class="flex flex-col rounded-xl border border-gray-200 p-4 dark:border-gray-800">
            <h3 class="font-medium text-gray-800 dark:text-white/90">{{ card.title }}</h3>
            <p v-if="card.item?.version" class="mt-1 text-sm text-gray-500">{{ t('about.version', { v: card.item.version }) }} · {{ prettyBytes(card.item.size) }}</p>
            <p v-else class="mt-1 text-sm text-gray-500">{{ loaded ? t('about.unavailable') : '…' }}</p>
            <p class="mt-3 flex-1 text-sm text-gray-500 dark:text-gray-400">{{ card.path }}</p>
            <p v-if="card.item?.sha256" class="mt-2 truncate font-mono text-theme-xs text-gray-400" :title="card.item.sha256">{{ t('about.sha') }} {{ shaLabel(card.item.sha256) }}</p>
            <a v-if="card.item?.url" :href="card.item.url" class="btn-primary mt-4">
              <Download :size="16" />
              {{ t('about.download') }}
            </a>
            <span v-else class="btn-secondary mt-4 cursor-not-allowed opacity-60">{{ t('about.download') }}</span>
          </article>
        </div>
      </UiCard>

      <UiCard :title="t('about.flow')">
        <div class="grid gap-6 md:grid-cols-2">
          <ol class="space-y-3">
            <li class="text-sm font-semibold text-gray-800 dark:text-white/90">{{ t('about.playerTitle') }}</li>
            <li v-for="n in 3" :key="'p' + n" class="text-sm text-gray-500 dark:text-gray-400">{{ n }}. {{ t('about.player' + n) }}</li>
          </ol>
          <ol class="space-y-3">
            <li class="text-sm font-semibold text-gray-800 dark:text-white/90">{{ t('about.hostTitle') }}</li>
            <li v-for="n in 4" :key="'h' + n" class="text-sm text-gray-500 dark:text-gray-400">{{ n }}. {{ t('about.host' + n) }}</li>
          </ol>
        </div>
        <div class="rounded-xl bg-gray-50 p-4 dark:bg-white/[0.03]">
          <p class="text-sm font-semibold text-gray-800 dark:text-white/90">{{ t('about.notesTitle') }}</p>
          <ul class="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-500 dark:text-gray-400">
            <li v-for="n in 3" :key="'n' + n">{{ t('about.note' + n) }}</li>
          </ul>
        </div>
        <div class="flex flex-wrap gap-2">
          <a href="/guide" class="btn-primary">{{ t('about.guide') }}</a>
          <router-link v-if="session.user" to="/workshop" class="btn-secondary">{{ t('about.home') }}</router-link>
          <router-link v-else to="/signin" class="btn-secondary">{{ t('about.signin') }}</router-link>
        </div>
      </UiCard>

      <AppFooter v-if="!session.user" />
    </div>
  </component>
</template>
