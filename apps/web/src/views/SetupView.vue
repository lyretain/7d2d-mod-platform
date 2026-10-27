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
const formError = ref('');

async function submit() {
  try {
    if (password.value !== password2.value) throw new Error(t('setup.mismatch'));
    busy.value = true;
    formError.value = '';
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
    formError.value = fail(message === 'Invalid setup token' ? t('setup.badToken') : message === 'Platform is already initialized' ? t('setup.already') : error);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AuthLayout :title="t('setup.brand')" :lead="t('setup.sub')" :data-lang="i18n.lang">
    <p class="mb-2 text-theme-xs text-gray-400">{{ t('setup.steps') }}</p>
    <p class="mb-5 text-sm text-gray-400">{{ t('setup.hint') }}</p>
    <label class="mb-3 block">
      <span class="field">{{ t('setup.token') }}</span>
      <input v-model="token" class="input" type="password" :placeholder="t('setup.phToken')" :aria-invalid="Boolean(formError)">
    </label>
    <label class="mb-3 block">
      <span class="field">{{ t('setup.user') }}</span>
      <input v-model="username" class="input" autocomplete="username" :placeholder="t('setup.phUser')" :aria-invalid="Boolean(formError)">
    </label>
    <label class="mb-3 block">
      <span class="field">{{ t('setup.password') }}</span>
      <input v-model="password" class="input" type="password" autocomplete="new-password" :placeholder="t('setup.phPassword')" :aria-invalid="Boolean(formError)">
    </label>
    <label class="mb-4 block">
      <span class="field">{{ t('setup.password2') }}</span>
      <input v-model="password2" class="input" type="password" autocomplete="new-password" :placeholder="t('setup.phPassword2')" :aria-invalid="Boolean(formError)" @keydown.enter="submit">
    </label>
    <p v-if="formError" class="mb-3 text-sm text-error-500" role="alert">{{ formError }}</p>
    <button type="button" class="btn-primary w-full" :disabled="busy" @click="submit">{{ t('setup.submit') }}</button>
  </AuthLayout>
</template>
