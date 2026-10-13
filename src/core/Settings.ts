/**
 * Player settings (GDD 2.14 "Settings", GDD 2.15 "Storage").
 *
 * Stored as one JSON object in localStorage under `pilgrim.settings.v1`. Every storage access is wrapped in
 * try/catch (private mode, blocked site data and full quotas all throw), so the game always runs on sane
 * values. Loaded data is validated field by field: wrong types and unknown enum values fall back to the
 * default, numbers are clamped to their range, and unknown fields are dropped.
 *
 * The module creates the `settings` singleton and registers it as the `settings` service on import.
 */
import { events } from './Events';
import { services } from './Services';
import type { Action } from './Input';
import type { QualitySetting } from './Quality';

export interface SettingsData {
  quality: QualitySetting;
  resolutionScale: number;
  shadows: boolean;
  frameCap: 30 | 60;
  difficulty: 'easy' | 'normal';
  /** 'default' = on for touch, off for keyboard/mouse and gamepad (GDD 2.5). */
  autoCamera: 'default' | 'on' | 'off';
  cameraSpeed: number;
  invertY: boolean;
  reduceMotion: boolean;
  timedPrompts: boolean;
  hints: boolean;
  fov: number;
  volMaster: number;
  volMusic: number;
  volVoices: number;
  volEffects: number;
  volAmbience: number;
  textSize: 'M' | 'L' | 'XL';
  textSpeed: 'slow' | 'normal' | 'instant';
  lang: 'en' | 'ta';
  /** Only the player's overrides; the defaults live in Input (DEFAULT_BINDINGS). */
  bindings: Partial<Record<Action, string[]>>;
}

export const SETTINGS_STORAGE_KEY = 'pilgrim.settings.v1';

/** Clamp ranges for the numeric settings. */
export const SETTINGS_RANGES = {
  resolutionScale: { min: 0.5, max: 1 },
  fov: { min: 45, max: 75 },
  cameraSpeed: { min: 0.25, max: 3 },
  volume: { min: 0, max: 1 },
} as const;

/** Most codes one action may hold (primary + alternates). */
const MAX_CODES_PER_ACTION = 4;
const CODE_PATTERN = /^[A-Za-z0-9_]{1,32}$/;

export const DEFAULT_SETTINGS: SettingsData = deepFreeze({
  quality: 'auto',
  resolutionScale: 1,
  shadows: true,
  frameCap: 60,
  difficulty: 'easy',
  autoCamera: 'default',
  cameraSpeed: 1,
  invertY: false,
  reduceMotion: false,
  timedPrompts: true,
  hints: true,
  fov: 55,
  volMaster: 1,
  volMusic: 0.8,
  volVoices: 0.8,
  volEffects: 0.8,
  volAmbience: 0.8,
  textSize: 'M',
  textSpeed: 'normal',
  lang: 'en',
  bindings: {},
});

// ---------------------------------------------------------------------------------------------- validation

type Validator<T> = (value: unknown, fallback: T) => T;

/**
 * Allowed values per enum, written as records so the compiler checks they list every member of the union
 * (a missing or extra key is a type error when Input.ts / Quality.ts change).
 */
const QUALITY_VALUES: Record<QualitySetting, true> = { low: true, medium: true, high: true, auto: true };
const ACTION_VALUES: Record<Action, true> = {
  moveForward: true,
  moveBack: true,
  moveLeft: true,
  moveRight: true,
  run: true,
  jump: true,
  use: true,
  pray: true,
  sword: true,
  shield: true,
  satchel: true,
  pause: true,
  skip: true,
  choice1: true,
  choice2: true,
  choice3: true,
  debug: true,
};

function oneOf<T extends string>(allowed: Record<T, true>): Validator<T> {
  return (v, fallback) => (typeof v === 'string' && Object.hasOwn(allowed, v) ? (v as T) : fallback);
}

function range(min: number, max: number): Validator<number> {
  return (v, fallback) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

const bool: Validator<boolean> = (v, fallback) => (typeof v === 'boolean' ? v : fallback);

const frameCap: Validator<30 | 60> = (v, fallback) => (v === 30 || v === 60 ? v : fallback);

/**
 * Keeps known actions with 1..4 distinct, well-formed codes. Returns a frozen object. Input never stores an
 * empty list (rebinding refuses to leave an action keyless), so dropping one only repairs damaged data.
 */
const bindings: Validator<SettingsData['bindings']> = (v, fallback) => {
  if (!isRecord(v)) return fallback;
  const out: SettingsData['bindings'] = {};
  for (const action of Object.keys(ACTION_VALUES) as Action[]) {
    const codes = v[action];
    if (!Array.isArray(codes)) continue;
    const clean = [...new Set(codes.filter(isCode))].slice(0, MAX_CODES_PER_ACTION);
    if (clean.length > 0) out[action] = clean;
  }
  return deepFreeze(out);
};

const VOLUME = range(SETTINGS_RANGES.volume.min, SETTINGS_RANGES.volume.max);

/** One validator per field. The mapped type makes a missing field a compile error. */
const VALIDATORS: { [K in keyof SettingsData]: Validator<SettingsData[K]> } = {
  quality: oneOf(QUALITY_VALUES),
  resolutionScale: range(SETTINGS_RANGES.resolutionScale.min, SETTINGS_RANGES.resolutionScale.max),
  shadows: bool,
  frameCap,
  difficulty: oneOf({ easy: true, normal: true }),
  autoCamera: oneOf({ default: true, on: true, off: true }),
  cameraSpeed: range(SETTINGS_RANGES.cameraSpeed.min, SETTINGS_RANGES.cameraSpeed.max),
  invertY: bool,
  reduceMotion: bool,
  timedPrompts: bool,
  hints: bool,
  fov: range(SETTINGS_RANGES.fov.min, SETTINGS_RANGES.fov.max),
  volMaster: VOLUME,
  volMusic: VOLUME,
  volVoices: VOLUME,
  volEffects: VOLUME,
  volAmbience: VOLUME,
  textSize: oneOf({ M: true, L: true, XL: true }),
  textSpeed: oneOf({ slow: true, normal: true, instant: true }),
  lang: oneOf({ en: true, ta: true }),
  bindings,
};

const FIELDS = Object.keys(VALIDATORS) as Array<keyof SettingsData>;

function validateField<K extends keyof SettingsData>(key: K, value: unknown, fallback: SettingsData[K]) {
  return VALIDATORS[key](value, fallback);
}

function assignField<K extends keyof SettingsData>(
  target: SettingsData,
  key: K,
  raw: Record<string, unknown>,
) {
  target[key] = validateField(key, raw[key], target[key]);
}

/** Builds a complete, valid settings object from untrusted data. Unknown fields are dropped. */
export function sanitizeSettings(raw: unknown): SettingsData {
  const out: SettingsData = { ...DEFAULT_SETTINGS };
  const src = isRecord(raw) ? raw : {};
  for (const key of FIELDS) assignField(out, key, src);
  return out;
}

// ------------------------------------------------------------------------------------------------- service

export class Settings {
  private current: SettingsData;
  private readonly storage: Storage | null;
  private warned = false;

  /** `storage` is injectable for tests; null keeps settings in memory only. */
  constructor(storage: Storage | null = defaultStorage()) {
    this.storage = storage;
    const stored = this.read();
    this.current = sanitizeSettings(stored);
    // First launch: follow the browser's language until the player picks one.
    if (stored === null) this.current.lang = browserLang();
  }

  /** Live, read-only view of all settings (no copy; cheap to read every frame). */
  get data(): Readonly<SettingsData> {
    return this.current;
  }

  /** Object values (bindings) are returned as a copy, so callers may edit and `set()` them back. */
  get<K extends keyof SettingsData>(k: K): SettingsData[K] {
    const v = this.current[k];
    return isRecord(v) ? structuredClone(v) : v;
  }

  /** Validates (clamps numbers, rejects bad enum values), persists and emits `settings:changed`. */
  set<K extends keyof SettingsData>(k: K, v: SettingsData[K]): void {
    const prev = this.current[k];
    const next = validateField(k, v, prev);
    // Clamping numbers is expected; anything else that validation changed is a caller bug.
    if (import.meta.env.DEV && typeof v !== 'number' && !sameValue(v, next)) {
      console.warn(`[settings] invalid value for "${k}" was corrected`, v);
    }
    if (sameValue(prev, next)) return;
    this.current[k] = next;
    this.persist();
    events.emit('settings:changed', { key: k });
  }

  /** Back to defaults. The language is kept: a reset should never leave a child unable to read the menu. */
  reset(): void {
    const prev = this.current;
    this.current = { ...DEFAULT_SETTINGS, lang: prev.lang };
    this.persist();
    for (const key of FIELDS) {
      if (!sameValue(prev[key], this.current[key])) events.emit('settings:changed', { key });
    }
  }

  /** Parsed stored JSON, or null when nothing is stored or it cannot be read. */
  private read(): unknown {
    try {
      const text = this.storage?.getItem(SETTINGS_STORAGE_KEY) ?? null;
      return text === null ? null : (JSON.parse(text) as unknown);
    } catch (err) {
      this.warnOnce('could not read saved settings; using defaults', err);
      return null;
    }
  }

  private persist(): void {
    try {
      this.storage?.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(this.current));
    } catch (err) {
      this.warnOnce('could not save settings; changes last until the page is closed', err);
    }
  }

  private warnOnce(message: string, err: unknown): void {
    if (this.warned) return;
    this.warned = true;
    console.warn(`[settings] ${message}`, err);
  }
}

// ------------------------------------------------------------------------------------------------- helpers

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isCode(v: unknown): v is string {
  return typeof v === 'string' && CODE_PATTERN.test(v);
}

/** Structural equality for settings values (primitives, string arrays, bindings); key order is ignored. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => sameValue(x, b[i]));
  }
  if (isRecord(a) && isRecord(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length && keys.every((k) => Object.hasOwn(b, k) && sameValue(a[k], b[k]))
    );
  }
  return false;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** `window.localStorage` itself can throw (SecurityError) when site data is blocked. */
function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** First preference that is English or Tamil wins; anything else means English. */
function browserLang(): SettingsData['lang'] {
  try {
    const prefs = navigator.languages?.length ? navigator.languages : [navigator.language];
    for (const tag of prefs) {
      if (/^ta\b/i.test(tag)) return 'ta';
      if (/^en\b/i.test(tag)) return 'en';
    }
  } catch {
    // navigator is missing outside the browser; fall through.
  }
  return DEFAULT_SETTINGS.lang;
}

declare module './Services' {
  interface ServiceMap {
    settings: Settings;
  }
}

export const settings = new Settings();
services.register('settings', settings);
