import { createContext, useContext } from 'react';
import { cs } from './locales/cs.ts';
import { de } from './locales/de.ts';
import { en } from './locales/en.ts';
import { es } from './locales/es.ts';
import { fr } from './locales/fr.ts';
import { it } from './locales/it.ts';
import { pl } from './locales/pl.ts';
import { pt } from './locales/pt.ts';
import { ru } from './locales/ru.ts';
import { uk, type Dict, type Key } from './locales/uk.ts';

export type { Key } from './locales/uk.ts';

export type Lang = 'uk' | 'en' | 'pt' | 'es' | 'fr' | 'it' | 'de' | 'cs' | 'pl' | 'ru';

/** Languages in the picker, each in its own name. */
export const LANGS: { code: Lang; label: string; locale: string }[] = [
  { code: 'uk', label: 'Українська', locale: 'uk-UA' },
  { code: 'en', label: 'English', locale: 'en-GB' },
  { code: 'pt', label: 'Português', locale: 'pt-PT' },
  { code: 'es', label: 'Español', locale: 'es-ES' },
  { code: 'fr', label: 'Français', locale: 'fr-FR' },
  { code: 'it', label: 'Italiano', locale: 'it-IT' },
  { code: 'de', label: 'Deutsch', locale: 'de-DE' },
  { code: 'cs', label: 'Čeština', locale: 'cs-CZ' },
  { code: 'pl', label: 'Polski', locale: 'pl-PL' },
  { code: 'ru', label: 'Русский', locale: 'ru-RU' },
];

export const DICTS: Record<Lang, Dict> = { uk, en, pt, es, fr, it, de, cs, pl, ru };

const isLang = (code: string): code is Lang => code in DICTS;

/**
 * The first of the browser's preferred languages that we support, so a German
 * phone opens in German, a Ukrainian one in Ukrainian and so on. English
 * otherwise.
 */
export function detectLang(preferred?: readonly string[]): Lang {
  const langs =
    preferred ??
    (typeof navigator === 'undefined' ? [] : (navigator.languages ?? [navigator.language]));
  for (const l of langs) {
    const code = l.slice(0, 2).toLowerCase();
    if (isLang(code)) return code;
  }
  return 'en';
}

export interface I18n {
  lang: Lang;
  locale: string;
  t: (key: Key, params?: Record<string, string | number>) => string;
  /** Plural-aware: picks the form for `n` (also passed as `{n}`). */
  tn: (key: Key, n: number, params?: Record<string, string | number>) => string;
}

export function makeI18n(lang: Lang): I18n {
  const dict = DICTS[lang];
  const locale = LANGS.find((l) => l.code === lang)!.locale;
  const plural = new Intl.PluralRules(locale);
  const fill = (s: string, params: Record<string, string | number> = {}) =>
    s.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`));
  return {
    lang,
    locale,
    t: (key, params) => {
      const e = dict[key] ?? uk[key];
      return fill(typeof e === 'string' ? e : e.other, params);
    },
    tn: (key, n, params) => {
      const e = dict[key] ?? uk[key];
      const form = typeof e === 'string' ? e : (e[plural.select(n)] ?? e.other);
      return fill(form, { n, ...params });
    },
  };
}

export const I18nContext = createContext<I18n>(makeI18n('en'));
export const useI18n = () => useContext(I18nContext);
