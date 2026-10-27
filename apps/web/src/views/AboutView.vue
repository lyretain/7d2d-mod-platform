<script setup lang="ts">
import { Download } from 'lucide-vue-next';
import { computed, onMounted, ref } from 'vue';
import { api } from '../api/client';
import AppFooter from '../components/AppFooter.vue';
import GitHubRepoLink from '../components/GitHubRepoLink.vue';
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
  return t('about.game', { v: payload.value.gameVersion || '3.2.0' });
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

type CopyPart = { text: string; code: boolean };

// Windows install paths have no spaces, so mark them for code styling and hard wrapping.
const INSTALL_PATH_RE = /(?:%[A-Za-z0-9_]+%|[A-Za-z]:|[A-Za-z0-9_.-]+)?(?:\\[^\s\\]+)+\\?/g;

function installCopyParts(value: string): CopyPart[] {
  const text = String(value || '');
  const parts: CopyPart[] = [];
  let last = 0;
  for (const match of text.matchAll(INSTALL_PATH_RE)) {
    const index = match.index ?? 0;
    if (index > last) parts.push({ text: text.slice(last, index), code: false });
    if (match[0]) parts.push({ text: match[0], code: true });
    last = index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), code: false });
  return parts.length ? parts : [{ text, code: false }];
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
          <GitHubRepoLink :labeled="false" :size="18" />
          <LangSwitch />
          <a href="/guide" class="btn-secondary hidden sm:inline-flex">{{ t('guide') }}</a>
          <router-link to="/signin" class="btn-primary">{{ t('about.signin') }}</router-link>
        </div>
      </div>
    </div>

    <div class="mx-auto flex w-full min-w-0 max-w-5xl flex-col gap-6" :class="session.user ? '' : 'px-4 py-8 md:px-8'">
      <section>
        <p class="text-sm text-brand-500">{{ gameLabel }}</p>
        <h2 class="mt-1 text-title-sm font-semibold text-gray-800 dark:text-white/90">{{ t('page.about.title') }}</h2>
        <p class="mt-2 max-w-3xl text-sm text-gray-500 dark:text-gray-400">{{ t('about.lead') }}</p>
      </section>

      <UiCard :title="t('about.downloads')" :desc="t('about.downloadsHint')">
        <div class="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-3">
          <article v-for="card in [
            { key: 'client', item: client, title: t('about.client'), path: t('about.clientPath') },
            { key: 'server', item: server, title: t('about.server'), path: t('about.serverPath') },
            { key: 'launcher', item: payload.launcher, title: t('about.launcher'), path: t('about.launcherHint') }
          ]" :key="card.key" class="flex min-w-0 flex-col overflow-hidden rounded-xl border border-gray-200 p-4 dark:border-gray-800">
            <h3 class="min-w-0 font-medium text-gray-800 wrap-anywhere dark:text-white/90">{{ card.title }}</h3>
            <p v-if="card.item?.version" class="mt-1 min-w-0 text-sm text-gray-500 wrap-anywhere">{{ t('about.version', { v: card.item.version }) }} · {{ prettyBytes(card.item.size) }}</p>
            <p v-else class="mt-1 min-w-0 text-sm text-gray-500 wrap-anywhere">{{ loaded ? t('about.unavailable') : '…' }}</p>
            <p class="mt-3 min-w-0 flex-1 text-sm text-gray-500 wrap-anywhere dark:text-gray-400">
              <template v-for="(part, index) in installCopyParts(card.path)" :key="`${card.key}-${index}`">
                <code v-if="part.code" class="box-decoration-clone break-all rounded bg-gray-100 px-1 py-0.5 font-mono text-[0.92em] text-gray-800 wrap-anywhere dark:bg-white/10 dark:text-gray-200">{{ part.text }}</code><span v-else>{{ part.text }}</span>
              </template>
            </p>
            <p v-if="card.item?.sha256" class="mt-2 flex min-w-0 max-w-full items-baseline gap-1 font-mono text-theme-xs text-gray-400" :title="card.item.sha256">
              <span class="shrink-0">{{ t('about.sha') }}</span>
              <span class="min-w-0 break-all wrap-anywhere">{{ shaLabel(card.item.sha256) }}</span>
            </p>
            <a v-if="card.item?.url" :href="card.item.url" class="btn-primary mt-4 min-w-0 max-w-full whitespace-normal">
              <Download :size="16" class="shrink-0" />
              <span class="min-w-0 wrap-anywhere">{{ t('about.download') }}</span>
            </a>
            <span v-else class="btn-secondary mt-4 min-w-0 max-w-full cursor-not-allowed whitespace-normal opacity-60">
              <span class="min-w-0 wrap-anywhere">{{ t('about.download') }}</span>
            </span>
          </article>
        </div>
        <p class="text-sm text-gray-500">
          <a href="https://github.com/lyretain/7d2d-mod-platform/releases/latest" target="_blank" rel="noreferrer" class="text-brand-500 hover:underline">{{ t('about.githubReleases') }}</a>
        </p>
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
