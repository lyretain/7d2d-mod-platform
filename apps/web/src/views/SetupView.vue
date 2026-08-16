<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api/client';
import AuthLayout from '../layouts/AuthLayout.vue';
import { fail } from '../lib/feedback';
import { i18n, t } from '../i18n';
import { refreshSession, setToken } from '../stores/session';
import { showToast } from '../stores/toast';

const router = useRouter();
const token = ref('');
const username = ref('');
const password = ref('');
const password2 = ref('');
const busy = ref(false);

async function submit() {
  try {
    if (password.value !== password2.value) throw new Error(t('setup.mismatch'));
    busy.value = true;
    await api('/api/v1/setup', {
      method: 'POST',
      headers: { authorization: `Bearer ${token.value}` },
      body: JSON.stringify({ token: token.value, username: username.value, password: password.value })
    });
    const login = await api<{ token: string }>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: username.value, password: password.value })
    });
    setToken(login.token);
    token.value = '';
    password.value = '';
    password2.value = '';
    await refreshSession();
    showToast(t('setup.done'), 'ok');
    router.push('/workshop');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(message === 'Invalid setup token' ? t('setup.badToken') : message === 'Platform is already initialized' ? t('setup.already') : error);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AuthLayout :title="t('setup.brand')" :lead="t('setup.sub')" :data-lang="i18n.lang">
    <p class="mb-2 text-theme-xs text-brand-500">{{ t('setup.steps') }}</p>
    <p class="mb-5 text-sm text-gray-500">{{ t('setup.hint') }}</p>
    <label class="field">{{ t('setup.token') }}</label>
    <input v-model="token" class="input mb-3" type="password" :placeholder="t('setup.phToken')">
    <label class="field">{{ t('setup.user') }}</label>
    <input v-model="username" class="input mb-3" autocomplete="username" :placeholder="t('setup.phUser')">
    <label class="field">{{ t('setup.password') }}</label>
    <input v-model="password" class="input mb-3" type="password" autocomplete="new-password" :placeholder="t('setup.phPassword')">
    <label class="field">{{ t('setup.password2') }}</label>
    <input v-model="password2" class="input mb-5" type="password" autocomplete="new-password" :placeholder="t('setup.phPassword2')" @keydown.enter="submit">
    <button type="button" class="btn-primary w-full" :disabled="busy" @click="submit">{{ t('setup.submit') }}</button>
  </AuthLayout>
</template>
