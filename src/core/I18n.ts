/**
 * Strings (GDD 2.14, 2.15): every visible word comes from `content/i18n/<lang>.json` by key.
 *
 * - Flat `{ "dotted.key": "text" }` tables, bundled by static import (no fetch, works offline).
 * - `{name}` placeholders are filled from `params`.
 * - Missing in Tamil → English. Missing in English → the key itself, plus one dev-only warning per key.
 * - The language is stored in Settings. `setLang()` updates <html lang> and the `lang-ta` body class (CSS
 *   switches to the Tamil font stack) and emits `lang:changed`. Changing the `lang` setting directly through
 *   Settings is followed as well.
 *
 * The module creates the `i18n` singleton, registers it as the `i18n` service and exports a bound `t()`.
 */
import { events } from './Events';
import { services } from './Services';
// Side-effect import: the settings service must be registered before the saved language is read below.
import './Settings';
import en from '../../content/i18n/en.json';
import ta from '../../content/i18n/ta.json';

export type Lang = 'en' | 'ta';
export type TranslateParams = Record<string, string | number>;

type StringTable = Readonly<Record<string, string>>;

/** Typing the imports as string tables makes a non-string value in either JSON file a compile error. */
const TABLES: Readonly<Record<Lang, StringTable>> = { en, ta };
export const LANGS: readonly Lang[] = ['en', 'ta'];
const PLACEHOLDER = /\{(\w+)\}/g;

export class I18n {
  private current: Lang;
  private readonly warnedKeys = new Set<string>();
  private readonly offSettings: () => void;

  constructor(initial: Lang = savedLang()) {
    this.current = initial;
    this.applyToDocument();
    // Keep in step when the Settings UI (or anything else) changes the `lang` setting directly.
    this.offSettings = events.on('settings:changed', ({ key }) => {
      if (key !== 'lang') return;
      const next = services.tryGet('settings')?.get('lang');
      if (next && next !== this.current) this.switchTo(next, false);
    });
  }

  get lang(): Lang {
    return this.current;
  }

  /** Assigning `lang` is the same as calling `setLang()`. */
  set lang(l: Lang) {
    this.setLang(l);
  }

  setLang(l: Lang): void {
    if (!isLang(l)) {
      console.warn(`[i18n] unknown language "${String(l)}"`);
      return;
    }
    if (l !== this.current) this.switchTo(l, true);
  }

  /** Translated text for `key` with `{name}` placeholders filled in. Unknown placeholders are left as is. */
  t(key: string, params?: TranslateParams): string {
    const text = lookup(this.current, key) ?? lookup('en', key);
    if (text === undefined) {
      this.warnMissing(key);
      return key;
    }
    return params ? fill(text, params) : text;
  }

  /** True when `key` exists in English or in the current language. */
  has(key: string): boolean {
    return lookup('en', key) !== undefined || lookup(this.current, key) !== undefined;
  }

  /** English keys that `lang` has not translated yet (they fall back to English). For tests and the F1 panel. */
  missingTranslations(lang: Lang = 'ta'): string[] {
    return Object.keys(TABLES.en).filter((key) => lookup(lang, key) === undefined);
  }

  dispose(): void {
    this.offSettings();
  }

  private switchTo(l: Lang, persist: boolean): void {
    this.current = l;
    this.applyToDocument();
    if (persist) services.tryGet('settings')?.set('lang', l);
    events.emit('lang:changed', { lang: l });
  }

  private applyToDocument(): void {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = this.current;
    document.body?.classList.toggle('lang-ta', this.current === 'ta');
  }

  private warnMissing(key: string): void {
    if (!import.meta.env.DEV || this.warnedKeys.has(key)) return;
    this.warnedKeys.add(key);
    console.warn(`[i18n] missing key "${key}"`);
  }
}

function lookup(lang: Lang, key: string): string | undefined {
  const table = TABLES[lang];
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

function fill(text: string, params: TranslateParams): string {
  return text.replace(PLACEHOLDER, (match, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : match,
  );
}

function isLang(v: unknown): v is Lang {
  return v === 'en' || v === 'ta';
}

function savedLang(): Lang {
  return services.tryGet('settings')?.get('lang') ?? 'en';
}

declare module './Services' {
  interface ServiceMap {
    i18n: I18n;
  }
}

export const i18n = new I18n();
services.register('i18n', i18n);

/** Translate `key` in the current language (bound to the `i18n` singleton). */
export function t(key: string, params?: TranslateParams): string {
  return i18n.t(key, params);
}
