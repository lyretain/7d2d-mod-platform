<script setup lang="ts">
import { t } from '../i18n';
import { confirmDialog, settleConfirm } from '../stores/confirm';
import UiModal from './UiModal.vue';
</script>

<template>
  <UiModal :open="confirmDialog.open" :title="confirmDialog.title" :hint="confirmDialog.hint" @close="settleConfirm(false)">
    <div class="flex justify-end gap-2">
      <button type="button" class="btn-secondary" @click="settleConfirm(false)">{{ t('cancel') }}</button>
      <button type="button" class="btn-danger" @click="settleConfirm(true)">{{ confirmDialog.confirmLabel || t('confirm') }}</button>
    </div>
  </UiModal>
</template>
