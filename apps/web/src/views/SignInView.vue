<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api/client';
import AuthLayout from '../layouts/AuthLayout.vue';
import { fail, setRaw } from '../lib/feedback';
import { i18n, t } from '../i18n';
import { refreshSession, session, setToken } from '../stores/session';
import { showToast } from '../stores/toast';

const router = useRouter();
const tab = ref<'login' | 'register'>('login');
const loginUser = ref('');
const loginPassword = ref('');
const registerUser = ref('');
const registerPassword = ref('');
const registerInvite = ref('');
const busy = ref(false);

async function login() {
  try {
    busy.value = true;
    const result = await api<{ token?: string; requiresTotp?: boolean; ticket?: string }>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: loginUser.value, password: loginPassword.value })
    });
    if (result.requiresTotp) {
      const code = window.prompt(t('auth.totp'));
      const done = await api<{ token: string }>('/api/v1/auth/login/totp', {
        method: 'POST',
        body: JSON.stringify({ ticket: result.ticket, code })
      });
      setToken(done.token);
    } else if (result.token) {
      setToken(result.token);
    }
    loginPassword.value = '';
    await refreshSession();
    showToast(t('auth.loginOk'), 'ok');
    if (session.user?.role === 'community' && !session.user.githubBound) showToast(t('auth.needGithub'), 'warn');
    router.push('/workshop');
  } catch (error) {
    fail(error);
  } finally {
    busy.value = false;
  }
}

async function register() {
  try {
    busy.value = true;
    const result = await api('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username: registerUser.value,
        password: registerPassword.value,
        inviteCode: registerInvite.value || undefined
      })
    });
    loginUser.value = registerUser.value;
    registerPassword.value = '';
    registerInvite.value = '';
    setRaw(result);
    showToast(t('auth.registerOk'), 'ok');
    tab.value = 'login';
  } catch (error) {
    fail(error);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AuthLayout :title="t('gate.brand')" :lead="t('gate.brandSub')" :data-lang="i18n.lang">
    <div class="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1 dark:bg-white/5">
      <button type="button" class="rounded-lg px-3 py-2 text-theme-sm font-semibold" :class="tab === 'login' ? 'bg-white text-brand-500 dark:bg-gray-800' : 'text-gray-500'" @click="tab = 'login'">{{ t('gate.login') }}</button>
      <button type="button" class="rounded-lg px-3 py-2 text-theme-sm font-semibold" :class="tab === 'register' ? 'bg-white text-brand-500 dark:bg-gray-800' : 'text-gray-500'" @click="tab = 'register'">{{ t('gate.register') }}</button>
    </div>
    <div v-if="tab === 'login'">
      <p class="mb-4 text-sm text-gray-500">{{ t('gate.loginHint') }}</p>
      <label class="field">{{ t('gate.user') }}</label>
      <input v-model="loginUser" class="input mb-3" autocomplete="username" :placeholder="t('gate.phUser')">
      <label class="field">{{ t('gate.password') }}</label>
      <input v-model="loginPassword" class="input mb-5" type="password" autocomplete="current-password" :placeholder="t('gate.phPassword')" @keydown.enter="login">
      <button type="button" class="btn-primary w-full" :disabled="busy" @click="login">{{ t('gate.login') }}</button>
    </div>
    <div v-else>
      <h3 class="mb-1 text-base font-medium text-gray-800 dark:text-white/90">{{ t('gate.regTitle') }}</h3>
      <p class="mb-4 text-sm text-gray-500">{{ t('gate.regHint') }}</p>
      <label class="field">{{ t('gate.user') }}</label>
      <input v-model="registerUser" class="input mb-3" autocomplete="username" :placeholder="t('gate.phRegUser')">
      <label class="field">{{ t('gate.password') }}</label>
      <input v-model="registerPassword" class="input mb-3" type="password" autocomplete="new-password" :placeholder="t('gate.phRegPassword')">
      <label class="field">{{ t('gate.invite') }}</label>
      <input v-model="registerInvite" class="input mb-5" :placeholder="t('gate.phInvite')" @keydown.enter="register">
      <button type="button" class="btn-primary w-full" :disabled="busy" @click="register">{{ t('gate.join') }}</button>
    </div>
  </AuthLayout>
</template>
