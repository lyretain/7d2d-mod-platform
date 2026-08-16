import { reactive } from 'vue';
import { api } from '../api/client';
import { t } from '../i18n';
import { fail, ok } from '../lib/feedback';
import { session } from './session';

export const adultGate = reactive({
  open: false,
  birthYear: '',
  confirmed: false,
  busy: false
});

let waiter: ((ok: boolean) => void) | null = null;

export function isAdultVerified() {
  return Boolean(session.user?.adultVerified);
}

export function isAdultMod(mod?: { r18?: boolean; r18ContentCount?: number } | null) {
  return Boolean(mod?.r18 || (mod?.r18ContentCount || 0) > 0);
}

export function ensureAdult(): Promise<boolean> {
  if (isAdultVerified()) return Promise.resolve(true);
  adultGate.open = true;
  adultGate.birthYear = '';
  adultGate.confirmed = false;
  return new Promise((resolve) => {
    waiter = resolve;
  });
}

export function closeAdultGate(result = false) {
  adultGate.open = false;
  const done = waiter;
  waiter = null;
  done?.(result);
}

export async function submitAdultGate() {
  try {
    adultGate.busy = true;
    const result = await api<{ user: { adultVerified?: boolean } }>('/api/v1/auth/adult-confirm', {
      method: 'POST',
      body: JSON.stringify({ birthYear: Number(adultGate.birthYear), confirmed: adultGate.confirmed })
    });
    if (session.user) session.user.adultVerified = Boolean(result.user?.adultVerified);
    ok(result, t('r18.verified'));
    closeAdultGate(true);
  } catch (error) {
    fail(error);
  } finally {
    adultGate.busy = false;
  }
}
