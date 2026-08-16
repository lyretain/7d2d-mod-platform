import { friendlyError } from '../api/client';
import { t } from '../i18n';
import { raw } from '../stores/raw';
import { showToast } from '../stores/toast';

export function setRaw(value: unknown) {
  raw.json = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

export function fail(error: unknown) {
  const message = friendlyError(error instanceof Error ? error.message : String(error));
  setRaw(message);
  showToast(message, message === t('cancelled') ? 'warn' : 'err');
}

export function ok(data: unknown, message?: string, silent?: boolean) {
  setRaw(data);
  if (!silent) showToast(message || t('okUpdated'), 'ok');
}

export async function confirmAction(action: string, message: string) {
  if (!window.confirm(message)) throw new Error(t('cancelled'));
  const { api } = await import('../api/client');
  const result = await api<{ token: string }>('/api/v1/admin/confirm', { method: 'POST', body: JSON.stringify({ action }) });
  return result.token;
}
