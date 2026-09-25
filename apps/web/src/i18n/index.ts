import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { useEffect, useState } from 'react';
import en from './locales/en.json';

export const SUPPORTED_LANGUAGES = ['en', 'bn'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

const STORAGE_KEY = 'ca.language';

function initialLanguage(): Language {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'en' || stored === 'bn') return stored;
  } catch {
    /* storage unavailable */
  }
  return 'en';
}

// English ships in the main bundle (it is also the fallback); other languages
// are separate chunks loaded on first use (spec §44 "lazy loading").
const LOADERS: Record<Exclude<Language, 'en'>, () => Promise<{ default: Record<string, unknown> }>> = {
  bn: () => import('./locales/bn.json'),
};

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en } },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false }, // React already escapes output
  returnNull: false,
});

i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = lng;
  try {
    localStorage.setItem(STORAGE_KEY, lng);
  } catch {
    /* ignore */
  }
});
document.documentElement.lang = i18n.language;

/** Loads a language's translations if they are not in memory yet. */
export async function ensureLanguage(lng: Language): Promise<void> {
  if (lng === 'en' || i18n.hasResourceBundle(lng, 'translation')) return;
  const mod = await LOADERS[lng]();
  i18n.addResourceBundle(lng, 'translation', mod.default, true, true);
}

export function setLanguage(lng: Language) {
  void ensureLanguage(lng).then(() => i18n.changeLanguage(lng));
}

/** Resolves once the user's saved language is ready, so the first render is not in the wrong language. */
export const i18nReady: Promise<unknown> = (() => {
  const lng = initialLanguage();
  return lng === 'en' ? Promise.resolve() : ensureLanguage(lng).then(() => i18n.changeLanguage(lng)).catch(() => undefined);
})();

/** True once `lng` is loaded — for views that render in a fixed language (e.g. printed prescriptions). */
export function useLanguageReady(lng: Language): boolean {
  const [ready, setReady] = useState(() => lng === 'en' || i18n.hasResourceBundle(lng, 'translation'));
  useEffect(() => {
    let alive = true;
    if (!ready) void ensureLanguage(lng).then(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, [lng, ready]);
  return ready;
}

export default i18n;
