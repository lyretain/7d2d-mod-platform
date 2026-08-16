<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../api/client';
import UiCard from '../components/UiCard.vue';
import { i18n, t } from '../i18n';
import { fail, ok, setRaw } from '../lib/feedback';
import { refreshSession, session } from '../stores/session';
import { ensureAdult, isAdultVerified } from '../stores/adult';
import { showToast } from '../stores/toast';

const activateCode = ref('');
const bootstrapToken = ref('');
const inviteRole = ref('community');
const inviteUses = ref(1);
const inviteHours = ref(168);
const inviteResult = ref('');

async function activateDeveloper() {
  try {
    const result = await api('/api/v1/auth/activate', {
      method: 'POST',
      body: JSON.stringify({ inviteCode: activateCode.value })
    });
    activateCode.value = '';
    ok(result, t('auth.activated'));
    await refreshSession();
  } catch (error) {
    fail(error);
  }
}

async function bindGithub() {
  try {
    const token = localStorage.getItem('modPlatformToken') || '';
    const response = await fetch('/api/v1/auth/github', { headers: { authorization: `Bearer ${token}` } });
    if (response.status === 503) {
      const login = window.prompt(t('auth.githubUser'));
      if (!login) throw new Error(t('cancelled'));
      const result = await api('/api/v1/auth/github/bind', { method: 'POST', body: JSON.stringify({ id: login, login }) });
      ok(result, t('auth.githubBound'));
      await refreshSession();
      return;
    }
    if (response.redirected || response.status === 302) {
      window.location.href = response.url;
      return;
    }
    window.location.href = '/api/v1/auth/github';
  } catch (error) {
    fail(error);
  }
}

async function createInvite() {
  try {
    if (!bootstrapToken.value.trim() && !localStorage.getItem('modPlatformToken')) {
      throw new Error(t('auth.inviteNeedLogin'));
    }
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const token = bootstrapToken.value.trim() || localStorage.getItem('modPlatformToken') || '';
    if (token) headers.authorization = `Bearer ${token}`;
    const result = await api<{ code: string; invite: unknown }>('/api/v1/invites', {
      method: 'POST',
      headers,
      body: JSON.stringify({ role: inviteRole.value, maxUses: Number(inviteUses.value), expiresInHours: Number(inviteHours.value) })
    });
    const json = JSON.stringify(result.invite, null, 2);
    inviteResult.value = t('auth.inviteOnce', { code: result.code, json });
    setRaw(result);
    showToast(t('auth.inviteCreated'), 'ok');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const text = message === 'Login required' ? t('auth.loginRequired') : message === 'Administrator role required' ? t('auth.notAdmin') : message;
    inviteResult.value = text;
    fail(text);
  }
}

onMounted(() => {
  inviteResult.value = t('account.inviteOnce');
});
</script>

<template>
  <div class="space-y-6" :data-lang="i18n.lang">
    <UiCard :title="t('r18.accountTitle')" :desc="t('r18.accountHint')">
      <p class="mb-3 text-sm text-gray-600 dark:text-gray-300">{{ isAdultVerified() ? t('r18.verified') : t('r18.notVerified') }}</p>
      <button v-if="!session.user?.adultVerified" type="button" class="btn-primary" @click="ensureAdult()">{{ t('r18.enter') }}</button>
    </UiCard>
    <UiCard :title="t('account.title')" :desc="t('account.hint')">
      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn-secondary" @click="bindGithub">{{ t('account.bindGithub') }}</button>
      </div>
      <label class="field">{{ t('account.devCode') }}</label>
      <input v-model="activateCode" class="input" :placeholder="t('account.phActivate')">
      <button type="button" class="btn-secondary" @click="activateDeveloper">{{ t('account.activate') }}</button>
    </UiCard>
    <UiCard :title="t('account.createInvite')" :desc="t('account.inviteHint')">
      <label class="field">{{ t('account.bootstrap') }}</label>
      <input v-model="bootstrapToken" class="input" type="password" :placeholder="t('account.phBootstrap')">
      <div class="grid gap-3 sm:grid-cols-3">
        <div>
          <label class="field">{{ t('account.role') }}</label>
          <select v-model="inviteRole" class="input">
            <option value="community">{{ t('account.roleCommunity') }}</option>
            <option value="developer">{{ t('account.roleDeveloper') }}</option>
          </select>
        </div>
        <div><label class="field">{{ t('account.uses') }}</label><input v-model.number="inviteUses" class="input" type="number" min="1" max="100"></div>
        <div><label class="field">{{ t('account.hours') }}</label><input v-model.number="inviteHours" class="input" type="number" min="1" max="8760"></div>
      </div>
      <button type="button" class="btn-primary" @click="createInvite">{{ t('account.createInvite') }}</button>
      <pre class="max-h-56 overflow-auto rounded-lg bg-gray-950 p-3 text-theme-xs text-gray-300">{{ inviteResult }}</pre>
    </UiCard>
  </div>
</template>
