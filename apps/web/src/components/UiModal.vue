<script setup lang="ts">
import { nextTick, onBeforeUnmount, useId, watch, ref } from 'vue';

const props = defineProps<{ open: boolean; title: string; hint?: string }>();
const emit = defineEmits<{ close: [] }>();

const panel = ref<HTMLElement | null>(null);
const titleId = useId();
const hintId = useId();
let previous: HTMLElement | null = null;

function focusable() {
  if (!panel.value) return [] as HTMLElement[];
  return [...panel.value.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )].filter((el) => el.tabIndex !== -1 && !el.hasAttribute('disabled'));
}

function onKey(event: KeyboardEvent) {
  if (!props.open) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    emit('close');
    return;
  }
  if (event.key !== 'Tab') return;
  const items = focusable();
  if (!items.length) {
    event.preventDefault();
    panel.value?.focus();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !panel.value?.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

watch(() => props.open, async (open) => {
  if (open) {
    previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    await nextTick();
    const items = focusable();
    (items[0] || panel.value)?.focus();
  } else {
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey);
    previous?.focus();
    previous = null;
  }
});

onBeforeUnmount(() => {
  document.body.style.overflow = '';
  document.removeEventListener('keydown', onKey);
});
</script>

<template>
  <div v-if="open" class="fixed inset-0 z-modal flex items-end justify-center bg-gray-950/80 p-4 safe-top safe-bottom sm:items-center sm:p-5" @click.self="emit('close')">
    <div
      ref="panel"
      class="surface w-full max-w-md p-5 shadow-lg"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      :aria-labelledby="titleId"
      :aria-describedby="hint ? hintId : undefined"
      @click.stop
    >
      <h2 :id="titleId" class="text-lg font-medium text-gray-800 dark:text-white/90">{{ title }}</h2>
      <p v-if="hint" :id="hintId" class="mt-1 mb-4 text-sm text-gray-500">{{ hint }}</p>
      <slot />
    </div>
  </div>
</template>
