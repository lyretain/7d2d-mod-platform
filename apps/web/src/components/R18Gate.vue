<script setup lang="ts">
import { i18n, t } from '../i18n';
import { adultGate, closeAdultGate, submitAdultGate } from '../stores/adult';
import UiModal from './UiModal.vue';
</script>

<template>
  <UiModal :open="adultGate.open" :title="t('r18.title')" :hint="t('r18.hint')" @close="closeAdultGate(false)">
    <div :data-lang="i18n.lang">
      <label class="block">
        <span class="field">{{ t('r18.birthYear') }}</span>
        <input v-model="adultGate.birthYear" class="input" inputmode="numeric" maxlength="4" autocomplete="bday-year" placeholder="1990">
      </label>
      <label class="mt-3 flex items-center gap-2 text-sm text-gray-400">
        <input v-model="adultGate.confirmed" type="checkbox" class="size-4">
        <span>{{ t('r18.confirmAge') }}</span>
      </label>
      <div class="mt-4 flex gap-3">
        <button type="button" class="btn-secondary flex-1" @click="closeAdultGate(false)">{{ t('cancel') }}</button>
        <button type="button" class="btn-primary flex-1" :disabled="adultGate.busy" @click="submitAdultGate">{{ t('r18.enter') }}</button>
      </div>
    </div>
  </UiModal>
</template>
