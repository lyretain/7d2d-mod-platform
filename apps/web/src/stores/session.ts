import { computed, reactive } from 'vue';
import { api } from '../api/client';
import { t } from '../i18n';

export type User = {
  id?: string;
  username: string;
  role: string;
  permissions?: string[];
  githubBound?: boolean;
  adultVerified?: boolean;
};

export const session = reactive({
  ready: false,
  initialized: true,
  user: null as User | null
});

export const permissions = computed(() => new Set(session.user?.permissions || []));
export const can = (perm: string) => permissions.value.has(perm);
export const signedIn = computed(() => Boolean(session.user));

export function roleLabel(role: string) {
  return t(`role.${role}`) || role;
}

export async function refreshSession() {
  try {
    const status = await api<{ initialized?: boolean }>('/status');
    session.initialized = status.initialized !== false;
  } catch {
    session.initialized = true;
  }
  const token = localStorage.getItem('modPlatformToken');
  if (!token) {
    session.user = null;
    session.ready = true;
    return false;
  }
  try {
    const me = await api<{ user: User }>('/api/v1/auth/me');
    session.user = me.user;
    session.ready = true;
    return true;
  } catch {
    localStorage.removeItem('modPlatformToken');
    session.user = null;
    session.ready = true;
    return false;
  }
}

export function setToken(value: string) {
  localStorage.setItem('modPlatformToken', value);
}

export function clearToken() {
  localStorage.removeItem('modPlatformToken');
  session.user = null;
}
