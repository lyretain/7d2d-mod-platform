/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<object, object, unknown>;
  export default component;
}

interface Window {
  I18N?: {
    t: (key: string, vars?: Record<string, string | number>) => string;
    currentLang: () => 'zh' | 'en';
    zh: Record<string, string>;
    en: Record<string, string>;
  };
}
