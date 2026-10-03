import { describe, expect, it } from 'vitest';
import { DICTS, detectLang, LANGS, makeI18n, type Lang } from './i18n.ts';
import { uk, type Entry, type Key } from './locales/uk.ts';

const placeholders = (e: Entry) =>
  [
    ...new Set((typeof e === 'string' ? [e] : Object.values(e)).join(' ').match(/\{\w+\}/g) ?? []),
  ].sort();

describe('translations', () => {
  const keys = Object.keys(uk) as Key[];

  it.each(LANGS.map((l) => l.code))('%s has every key with the same placeholders', (lang) => {
    const dict = DICTS[lang as Lang];
    for (const key of keys) {
      const entry = dict[key];
      expect(entry, key).toBeDefined();
      expect(typeof entry === 'string' ? entry : entry.other, key).not.toBe('');
      expect(placeholders(entry), `${lang}:${key}`).toEqual(placeholders(uk[key]));
    }
  });

  it.each(LANGS.map((l) => [l.code, l.locale]))(
    '%s has the plural forms its grammar needs',
    (lang, locale) => {
      const rules = new Intl.PluralRules(locale);
      const needed = new Set([0, 1, 2, 3, 5, 11, 21, 22, 25, 101].map((n) => rules.select(n)));
      for (const key of keys) {
        const entry = DICTS[lang as Lang][key];
        if (typeof entry === 'string') continue;
        for (const form of needed) {
          expect(
            entry[form] ?? (form === 'other' ? entry.other : undefined),
            `${lang}:${key}:${form}`,
          ).toBeDefined();
        }
      }
    },
  );

  it('picks plural forms correctly', () => {
    expect(makeI18n('uk').tn('it.transfers', 2)).toBe('2 пересадки');
    expect(makeI18n('ru').tn('detail.stops', 5)).toBe('5 остановок');
    expect(makeI18n('pl').tn('detail.stops', 22)).toBe('22 przystanki');
    expect(makeI18n('cs').tn('it.transfers', 3)).toBe('3 přestupy');
    expect(makeI18n('de').tn('it.transfers', 1)).toBe('1 Umstieg');
    expect(makeI18n('fr').tn('it.transfers', 1)).toBe('1 correspondance');
    expect(makeI18n('fr').tn('it.transfers', 2)).toBe('2 correspondances');
  });
});

describe('detectLang', () => {
  it('opens in the first supported browser language', () => {
    expect(detectLang(['de-AT', 'en'])).toBe('de');
    expect(detectLang(['uk-UA'])).toBe('uk');
    expect(detectLang(['ru-RU', 'uk'])).toBe('ru');
    expect(detectLang(['fr-FR', 'es-ES'])).toBe('fr');
    expect(detectLang(['fr-CA'])).toBe('fr');
    expect(detectLang(['nl-NL', 'es-ES'])).toBe('es');
    expect(detectLang(['ja-JP'])).toBe('en');
    expect(detectLang([])).toBe('en');
  });
});
