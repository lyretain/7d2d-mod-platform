import { reactive } from 'vue';

export const i18n = reactive({
  lang: (typeof localStorage !== 'undefined' && (localStorage.getItem('modPlatformLang') === 'en' ? 'en' : localStorage.getItem('modPlatformLang') === 'zh' ? 'zh' : '')) || ''
});

export function t(key: string, vars?: Record<string, string | number>) {
  return window.I18N?.t(key, vars) || key;
}

export function currentLang() {
  return window.I18N?.currentLang() || 'zh';
}

export function setLang(lang: 'zh' | 'en') {
  localStorage.setItem('modPlatformLang', lang);
  i18n.lang = lang;
  document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
  document.title = t('docTitle');
}

export function localeTag() {
  return currentLang() === 'en' ? 'en' : 'zh-CN';
}

if (typeof document !== 'undefined') {
  document.documentElement.lang = currentLang() === 'en' ? 'en' : 'zh-CN';
  document.title = t('docTitle');
  i18n.lang = currentLang();
}
