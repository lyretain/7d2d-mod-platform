<script setup lang="ts">
import { i18n, t } from '../i18n';
import { adultGate, closeAdultGate, submitAdultGate } from '../stores/adult';
</script>

<template>
  <div v-if="adultGate.open" class="fixed inset-0 z-99999 flex items-center justify-center bg-gray-950/80 p-5" :data-lang="i18n.lang" @click.self="closeAdultGate(false)">
    <div class="w-full max-w-md rounded-2xl border border-rose-500/40 bg-white p-5 dark:border-rose-500/30 dark:bg-gray-900">
      <h2 class="text-lg font-semibold text-gray-800 dark:text-white/90">{{ t('r18.title') }}</h2>
      <p class="mt-1 mb-4 text-sm text-gray-500">{{ t('r18.hint') }}</p>
      <label class="field">{{ t('r18.birthYear') }}</label>
      <input v-model="adultGate.birthYear" class="input mb-3" inputmode="numeric" maxlength="4" placeholder="1990">
      <label class="mb-4 flex items-start gap-2 text-sm text-gray-500">
        <input v-model="adultGate.confirmed" type="checkbox" class="mt-1">
        <span>{{ t('r18.confirmAge') }}</span>
      </label>
      <div class="flex gap-2">
        <button type="button" class="btn-secondary flex-1" @click="closeAdultGate(false)">{{ t('cancel') }}</button>
        <button type="button" class="btn-primary flex-1" :disabled="adultGate.busy" @click="submitAdultGate">{{ t('r18.enter') }}</button>
      </div>
    </div>
  </div>
</template>
