import { reactive } from 'vue';

export const toast = reactive({
  text: '',
  kind: 'ok' as 'ok' | 'err' | 'warn',
  visible: false
});

let timer: ReturnType<typeof setTimeout> | undefined;

export function showToast(text: string, kind: 'ok' | 'err' | 'warn' = 'ok') {
  toast.text = text;
  toast.kind = kind;
  toast.visible = Boolean(text);
  clearTimeout(timer);
  if (text) timer = setTimeout(() => { toast.visible = false; }, 5000);
}
