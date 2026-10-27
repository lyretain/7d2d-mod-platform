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
const formError = ref('');

async function login() {
  try {
    busy.value = true;
    formError.value = '';
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
    formError.value = fail(error);
  } finally {
    busy.value = false;
  }
}

async function register() {
  try {
    busy.value = true;
    formError.value = '';
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
    formError.value = fail(error);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AuthLayout :title="t('gate.brand')" :lead="t('gate.brandSub')" :data-lang="i18n.lang">
    <div class="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-white/5 p-1" role="tablist" :aria-label="t('gate.brand')">
      <button type="button" class="min-h-11 rounded-lg px-3 text-sm font-medium" role="tab" :aria-selected="tab === 'login'" :class="tab === 'login' ? 'bg-gray-800 text-brand-400' : 'text-gray-400'" @click="tab = 'login'">{{ t('gate.login') }}</button>
      <button type="button" class="min-h-11 rounded-lg px-3 text-sm font-medium" role="tab" :aria-selected="tab === 'register'" :class="tab === 'register' ? 'bg-gray-800 text-brand-400' : 'text-gray-400'" @click="tab = 'register'">{{ t('gate.register') }}</button>
    </div>
    <div v-if="tab === 'login'">
      <p class="mb-4 text-sm text-gray-400">{{ t('gate.loginHint') }}</p>
      <label class="mb-3 block">
        <span class="field">{{ t('gate.user') }}</span>
        <input v-model="loginUser" class="input" autocomplete="username" :placeholder="t('gate.phUser')" :aria-invalid="Boolean(formError)">
      </label>
      <label class="mb-4 block">
        <span class="field">{{ t('gate.password') }}</span>
        <input v-model="loginPassword" class="input" type="password" autocomplete="current-password" :placeholder="t('gate.phPassword')" :aria-invalid="Boolean(formError)" @keydown.enter="login">
      </label>
      <p v-if="formError" class="mb-3 text-sm text-error-500" role="alert">{{ formError }}</p>
      <button type="button" class="btn-primary w-full" :disabled="busy" @click="login">{{ t('gate.login') }}</button>
    </div>
    <div v-else>
      <h3 class="mb-1 text-base font-medium text-white/90">{{ t('gate.regTitle') }}</h3>
      <p class="mb-4 text-sm text-gray-400">{{ t('gate.regHint') }}</p>
      <label class="mb-3 block">
        <span class="field">{{ t('gate.user') }}</span>
        <input v-model="registerUser" class="input" autocomplete="username" :placeholder="t('gate.phRegUser')" :aria-invalid="Boolean(formError)">
      </label>
      <label class="mb-3 block">
        <span class="field">{{ t('gate.password') }}</span>
        <input v-model="registerPassword" class="input" type="password" autocomplete="new-password" :placeholder="t('gate.phRegPassword')" :aria-invalid="Boolean(formError)">
      </label>
      <label class="mb-4 block">
        <span class="field">{{ t('gate.invite') }}</span>
        <input v-model="registerInvite" class="input" :placeholder="t('gate.phInvite')" :aria-invalid="Boolean(formError)" @keydown.enter="register">
      </label>
      <p v-if="formError" class="mb-3 text-sm text-error-500" role="alert">{{ formError }}</p>
      <button type="button" class="btn-primary w-full" :disabled="busy" @click="register">{{ t('gate.join') }}</button>
    </div>
  </AuthLayout>
</template>
