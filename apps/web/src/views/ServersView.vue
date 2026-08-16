<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../api/client';
import UiCard from '../components/UiCard.vue';
import UiTable from '../components/UiTable.vue';
import { i18n, t } from '../i18n';
import { fail, ok } from '../lib/feedback';
import { catalog, loadPacks, packOptionLabel } from '../stores/catalog';
import { can, session } from '../stores/session';

const name = ref('');
const serverId = ref('');
const packId = ref('');
const addresses = ref('');
const configText = ref('');
const configJson = ref('');
const selected = ref(-1);
const servers = ref<Record<string, unknown>[]>([]);

function pluginConfig(created: any) {
  if (created?.config) return created.config;
  const pack = catalog.packs.find((item) => item.id === created?.packId) || {};
  return {
    BaseUrl: location.origin,
    ServerId: created.serverId,
    ServerToken: created.token,
    GameVersion: pack.gameVersion || '3.10.14',
    RefreshSeconds: 60,
    HandshakeTimeoutSeconds: 15,
    AutoSync: true,
    AutoRestart: false
  };
}

function showConfig(created: any) {
  const json = JSON.stringify(pluginConfig(created), null, 2);
  configJson.value = json;
  configText.value = t('srv.configPrefix') + json;
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

async function createServer() {
  try {
    const created = await api<any>('/api/v1/servers', {
      method: 'POST',
      body: JSON.stringify({ name: name.value, packId: packId.value, publicAddresses: addresses.value })
    });
    serverId.value = created.serverId || created.config?.ServerId || '';
    showConfig(created);
    ok(created, t('srv.created'));
    await loadServers({ silent: true });
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

function canDeleteSelected() {
  const row = selected.value >= 0 ? servers.value[selected.value] : null;
  if (!row || !serverId.value) return false;
  return can('server.manage') || row.ownerId === session.user?.id;
}

async function deleteServer() {
  try {
    if (!serverId.value) throw new Error(t('srv.needSelect'));
    if (!window.confirm(t('srv.confirmDelete'))) throw new Error(t('cancelled'));
    const result = await api(`/api/v1/servers/${encodeURIComponent(serverId.value)}`, { method: 'DELETE' });
    serverId.value = '';
    name.value = '';
    packId.value = '';
    addresses.value = '';
    selected.value = -1;
    ok(result, t('srv.deleted'));
    await loadServers({ silent: true });
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

function pick(row: Record<string, unknown>, index: number) {
  selected.value = index;
  serverId.value = String(row.id || '');
  name.value = String(row.name || '');
  packId.value = String(row.packId || '');
  const list = Array.isArray(row.publicAddresses) && row.publicAddresses.length
    ? row.publicAddresses
    : (row.publicAddress ? [row.publicAddress] : []);
  addresses.value = list.join('\n');
}

onMounted(async () => {
  configText.value = t('srv.tokenIdle');
  await Promise.all([loadPacks({ silent: true }), loadServers({ silent: true })]);
});
</script>

<template>
  <div class="space-y-6" :data-lang="i18n.lang">
    <UiCard :title="t('srv.title')" :desc="t('srv.hint')">
      <label class="field">{{ t('srv.name') }}</label>
      <input v-model="name" class="input" :placeholder="t('srv.phName')">
      <div class="grid gap-3 sm:grid-cols-2">
        <div><label class="field">{{ t('srv.id') }}</label><input v-model="serverId" class="input" :placeholder="t('srv.phId')"></div>
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
      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn-primary" @click="createServer">{{ t('srv.create') }}</button>
        <button type="button" class="btn-secondary" @click="updateServer">{{ t('srv.update') }}</button>
        <button type="button" class="btn-danger" :disabled="!canDeleteSelected()" @click="deleteServer">{{ t('srv.delete') }}</button>
        <button type="button" class="btn-secondary" @click="loadServers()">{{ t('srv.refresh') }}</button>
        <button type="button" class="btn-secondary" @click="copyConfig">{{ t('srv.copy') }}</button>
      </div>
      <pre class="max-h-56 overflow-auto rounded-lg bg-gray-950 p-3 text-theme-xs text-gray-300">{{ configText }}</pre>
    </UiCard>
    <UiCard :title="t('srv.list')" :desc="t('mod.clickFill')">
      <UiTable :rows="servers" :cols="['id', 'name', 'packId', 'publicAddress', 'online', 'acceptingPlayers', 'lastSeenAt']" :selected="selected" @pick="pick" />
    </UiCard>
  </div>
</template>
