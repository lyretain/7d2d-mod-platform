import { reactive } from 'vue';

type ConfirmOpts = {
  title: string;
  hint?: string;
  confirmLabel?: string;
};

export const confirmDialog = reactive({
  open: false,
  title: '',
  hint: '',
  confirmLabel: '',
  resolve: null as ((ok: boolean) => void) | null
});

export function askConfirm(opts: ConfirmOpts) {
  if (confirmDialog.resolve) confirmDialog.resolve(false);
  confirmDialog.title = opts.title;
  confirmDialog.hint = opts.hint || '';
  confirmDialog.confirmLabel = opts.confirmLabel || '';
  confirmDialog.open = true;
  return new Promise<boolean>((resolve) => {
    confirmDialog.resolve = resolve;
  });
}

export function settleConfirm(ok: boolean) {
  const resolve = confirmDialog.resolve;
  confirmDialog.open = false;
  confirmDialog.resolve = null;
  resolve?.(ok);
}
