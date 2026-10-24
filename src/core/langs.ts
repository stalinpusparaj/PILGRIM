/**
 * The game's languages (DECISIONS #397): English, Tamil, four more Indian regional languages and six
 * widely spoken foreign ones. Every visible string comes from content/i18n/<code>.json by key; a key missing in a language falls back to English.
 * The Indic languages share the `lang-ta` long-script layout rules (CSS) with their own font stack
 * (`--font-tamil` is redefined per language in styles.css).
 */
export type Lang = 'en' | 'ta' | 'hi' | 'te' | 'ml' | 'kn' | 'es' | 'fr' | 'pt' | 'de' | 'id' | 'ru';
/** Settings' dropdown order: English, the Indian languages, then the others. */
export const LANGS: readonly Lang[] = ['en', 'ta', 'hi', 'te', 'ml', 'kn', 'es', 'fr', 'pt', 'de', 'id', 'ru'];
/** Scripts that use the long-script layout (`lang-ta` rules) and their own font stack. */
export const INDIC: readonly Lang[] = ['ta', 'hi', 'te', 'ml', 'kn'];

/** Each language names itself, in its own script (Settings, the title toggle). */
export const LANG_NAMES: Readonly<Record<Lang, string>> = {
  en: 'English',
  ta: 'தமிழ்',
  hi: 'हिन्दी',
  te: 'తెలుగు',
  ml: 'മലയാളം',
  kn: 'ಕನ್ನಡ',
  es: 'Español',
  fr: 'Français',
  pt: 'Português',
  de: 'Deutsch',
  id: 'Bahasa Indonesia',
  ru: 'Русский',
};

/** BCP 47 tags for speech voices. */
export const SPEECH_TAGS: Readonly<Record<Lang, string>> = {
  en: 'en-US',
  ta: 'ta-IN',
  hi: 'hi-IN',
  te: 'te-IN',
  ml: 'ml-IN',
  kn: 'kn-IN',
  es: 'es-ES',
  fr: 'fr-FR',
  pt: 'pt-BR',
  de: 'de-DE',
  id: 'id-ID',
  ru: 'ru-RU',
};

export function isLang(v: unknown): v is Lang {
  return typeof v === 'string' && (LANGS as readonly string[]).includes(v);
}

/** The first of the browser's preferred languages that the game speaks, else English. */
export function preferredLang(tags: readonly string[]): Lang {
  for (const tag of tags) {
    const code = tag.toLowerCase().split('-')[0];
    if (isLang(code)) return code;
  }
  return 'en';
}
