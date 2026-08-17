<script setup lang="ts">
import { Plus } from 'lucide-vue-next';
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api/client';
import HierarchyItem from '../components/HierarchyItem.vue';
import HierarchyShell from '../components/HierarchyShell.vue';
import { i18n, t } from '../i18n';
import { fail, ok } from '../lib/feedback';
import { catalog, loadPacks, packOptionLabel } from '../stores/catalog';
import { can, session } from '../stores/session';

const route = useRoute();
const router = useRouter();
const query = ref('');
const creating = ref(false);
const name = ref('');
const serverId = ref('');
const packId = ref('');
const addresses = ref('');
const configText = ref('');
const configJson = ref('');
const configServerId = ref('');
const servers = ref<Record<string, unknown>[]>([]);

const currentId = computed(() => (creating.value ? '' : String(route.params.id || '')));
const current = computed(() => servers.value.find((item) => String(item.id) === currentId.value) || null);
const filteredServers = computed(() => {
  const needle = query.value.trim().toLowerCase();
  if (!needle) return servers.value;
  return servers.value.filter((item) => [item.id, item.name, item.packId, item.publicAddress].join(' ').toLowerCase().includes(needle));
});

function serverHint(row: Record<string, unknown>) {
  const pack = String(row.packId || '—');
  const status = row.online ? t('srv.online') : t('srv.offline');
  return `${pack} · ${status}`;
}

function pluginConfig(created: any) {
  if (created?.config) return created.config;
  const pack = catalog.packs.find((item) => item.id === created?.packId) || {};
  return {
    BaseUrl: location.origin,
    ServerId: created.serverId,
    ServerToken: created.token,
    GameVersion: pack.gameVersion || '3.10.14',
    RefreshSeconds: 60,
    HandshakeTimeoutSeconds: 180,
    AutoSync: true,
    AutoRestart: false
  };
}

function showConfig(created: any) {
  const json = JSON.stringify(pluginConfig(created), null, 2);
  configJson.value = json;
  configText.value = t('srv.configPrefix') + json;
  configServerId.value = String(created?.serverId || created?.config?.ServerId || serverId.value || '');
}

function resetForm() {
  name.value = '';
  serverId.value = '';
  packId.value = '';
  addresses.value = '';
  configJson.value = '';
  configServerId.value = '';
  configText.value = t('srv.tokenIdle');
}

function fillForm(row: Record<string, unknown>) {
  serverId.value = String(row.id || '');
  name.value = String(row.name || '');
  packId.value = String(row.packId || '');
  const list = Array.isArray(row.publicAddresses) && row.publicAddresses.length
    ? row.publicAddresses
    : (row.publicAddress ? [row.publicAddress] : []);
  addresses.value = list.join('\n');
  if (configServerId.value !== String(row.id || '')) {
    configJson.value = '';
    configText.value = t('srv.tokenIdle');
  }
}

async function loadServers(opts?: { silent?: boolean }) {
  try {
    const data = await api<{ servers: Record<string, unknown>[] }>('/api/v1/servers');
    servers.value = data.servers || [];
    ok(data, t('srv.loaded'), opts?.silent);
  } catch (error) {
    fail(error);
  }
}

async function selectServer(id: string) {
  creating.value = false;
  if (route.params.id !== id) await router.push(`/servers/${encodeURIComponent(id)}`);
  else {
    const row = servers.value.find((item) => String(item.id) === id);
    if (row) fillForm(row);
  }
}

function startCreate() {
  creating.value = true;
  resetForm();
  if (route.params.id) router.push('/servers');
}

async function createServer() {
  try {
    const created = await api<any>('/api/v1/servers', {
      method: 'POST',
      body: JSON.stringify({ name: name.value, packId: packId.value, publicAddresses: addresses.value })
    });
    const id = created.serverId || created.config?.ServerId || '';
    serverId.value = id;
    showConfig(created);
    ok(created, t('srv.created'));
    creating.value = false;
    await loadServers({ silent: true });
    if (id) await selectServer(id);
  } catch (error) {
    fail(error);
  }
}

async function updateServer() {
  try {
    const result = await api(`/api/v1/servers/${encodeURIComponent(serverId.value)}`, {
      method: 'PATCH',
      body: JSON.stringify({ packId: packId.value || undefined, publicAddresses: addresses.value })
    });
    ok(result, t('srv.updated'));
    await loadServers({ silent: true });
  } catch (error) {
    fail(error);
  }
}

function canManageSelected() {
  const row = current.value;
  if (!row || !serverId.value) return false;
  return can('server.manage') || row.ownerId === session.user?.id;
}

async function resetServerToken() {
  try {
    if (!serverId.value) throw new Error(t('srv.needSelect'));
    if (!window.confirm(t('srv.confirmReset'))) throw new Error(t('cancelled'));
    const result = await api<any>(`/api/v1/servers/${encodeURIComponent(serverId.value)}/reset-token`, { method: 'POST' });
    showConfig(result);
    ok(result, t('srv.tokenReset'));
  } catch (error) {
    fail(error);
  }
}

async function deleteServer() {
  try {
    if (!serverId.value) throw new Error(t('srv.needSelect'));
    if (!window.confirm(t('srv.confirmDelete'))) throw new Error(t('cancelled'));
    const result = await api(`/api/v1/servers/${encodeURIComponent(serverId.value)}`, { method: 'DELETE' });
    ok(result, t('srv.deleted'));
    creating.value = false;
    resetForm();
    await loadServers({ silent: true });
    await router.push('/servers');
  } catch (error) {
    fail(error);
  }
}

async function copyConfig() {
  if (!configJson.value) return fail(t('srv.noCopy'));
  try {
    await navigator.clipboard.writeText(configJson.value);
    ok({ copied: true }, t('srv.copied'));
  } catch (error) {
    fail(error instanceof Error ? error.message : t('srv.copyFail'));
  }
}

watch(() => route.params.id, (id) => {
  if (!id) {
    if (!creating.value) resetForm();
    return;
  }
  creating.value = false;
  const row = servers.value.find((item) => String(item.id) === String(id));
  if (row) fillForm(row);
});

onMounted(async () => {
  configText.value = t('srv.tokenIdle');
  await Promise.all([loadPacks({ silent: true }), loadServers({ silent: true })]);
  const id = String(route.params.id || '');
  const row = id ? servers.value.find((item) => String(item.id) === id) : null;
  if (row) fillForm(row);
});
</script>

<template>
  <div :data-lang="i18n.lang">
    <HierarchyShell :empty="!creating && !currentId" :empty-text="t('srv.emptySelect')">
      <template #toolbar>
        <input v-model="query" class="input" :placeholder="t('srv.search')">
        <button type="button" class="btn-primary shrink-0 px-3" :title="t('srv.new')" @click="startCreate">
          <Plus :size="16" />
        </button>
      </template>
      <template #list>
        <p v-if="!filteredServers.length" class="px-3 py-8 text-center text-sm text-gray-500">{{ t('srv.noneServers') }}</p>
        <HierarchyItem
          v-for="item in filteredServers"
          :key="String(item.id)"
          :title="String(item.name || item.id)"
          :hint="serverHint(item)"
          :active="!creating && currentId === String(item.id)"
          @click="selectServer(String(item.id))"
        />
      </template>

      <div class="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
        <p class="mb-3 text-theme-xs font-medium uppercase tracking-wide text-gray-400">{{ creating ? t('srv.creating') : t('srv.levelServer') }}</p>
        <label class="field">{{ t('srv.name') }}</label>
        <input v-model="name" class="input" :placeholder="t('srv.phName')">
        <div class="grid gap-3 sm:grid-cols-2">
          <div><label class="field">{{ t('srv.id') }}</label><input v-model="serverId" class="input" :disabled="!creating" :placeholder="t('srv.phId')"></div>
          <div>
            <label class="field">{{ t('srv.pack') }}</label>
            <select v-model="packId" class="input">
              <option value="">{{ t('pack.selectPublished') }}</option>
              <option v-for="pack in catalog.packs" :key="pack.id" :value="pack.id">{{ packOptionLabel(pack) }}</option>
            </select>
          </div>
        </div>
        <label class="field">{{ t('srv.addresses') }}</label>
        <textarea v-model="addresses" class="input min-h-24" :placeholder="t('srv.phAddr')"></textarea>
        <p class="text-theme-xs text-gray-500">{{ t('srv.addrHint') }}</p>
        <div class="mt-3 flex flex-wrap gap-2">
          <button v-if="creating" type="button" class="btn-primary" @click="createServer">{{ t('srv.create') }}</button>
          <button v-else type="button" class="btn-secondary" @click="updateServer">{{ t('srv.update') }}</button>
          <button v-if="!creating" type="button" class="btn-secondary" :disabled="!canManageSelected()" @click="resetServerToken">{{ t('srv.resetToken') }}</button>
          <button v-if="!creating" type="button" class="btn-danger" :disabled="!canManageSelected()" @click="deleteServer">{{ t('srv.delete') }}</button>
          <button type="button" class="btn-secondary" @click="loadServers()">{{ t('srv.refresh') }}</button>
          <button type="button" class="btn-secondary" @click="copyConfig">{{ t('srv.copy') }}</button>
        </div>
        <pre class="mt-4 max-h-56 overflow-auto rounded-lg bg-gray-950 p-3 text-theme-xs text-gray-300">{{ configText }}</pre>
      </div>
    </HierarchyShell>
  </div>
</template>
