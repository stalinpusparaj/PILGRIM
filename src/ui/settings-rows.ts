/**
 * What the Settings screen shows (GDD 2.14 "Settings", plus the FOV slider from GDD 2.5), as plain row specs
 * bound to src/core/Settings.ts. The widgets (settings-widgets.ts) turn them into DOM; the Controls tab has its
 * own builder (settings-controls.ts).
 *
 * Specs read and write the live settings singleton, so every change applies at once and is saved by Settings.
 * Labels are translated when the specs are built: the screen rebuilds its rows when the language changes.
 */
import { services } from '../core/Services';
import { settings, SETTINGS_RANGES, type SettingsData } from '../core/Settings';
import { t } from '../core/I18n';
import { LANGS, LANG_NAMES, type Lang } from '../core/langs';
import type { IconName } from './Svg';
import { aboutRows } from './settings-about';

/**
 * Tabs (DECISIONS #397): what a child or parent needs up front (General, Sound, Controls), the fine-tuning in
 * Advanced, and About (rate, share, feedback, the game's creators, the version).
 */
export type SettingsTab = 'general' | 'sound' | 'controls' | 'advanced' | 'about';
export const SETTINGS_TABS: readonly SettingsTab[] = ['general', 'sound', 'controls', 'advanced', 'about'];

export function isSettingsTab(v: unknown): v is SettingsTab {
  return typeof v === 'string' && (SETTINGS_TABS as readonly string[]).includes(v);
}

export type VolumeKey = 'volMaster' | 'volMusic' | 'volVoices' | 'volEffects' | 'volAmbience';

/** Settings shown as a row of option buttons (strings, booleans and the 30/60 frame cap). */
type ChoiceKey = {
  [K in keyof SettingsData]: SettingsData[K] extends string | number | boolean ? K : never;
}[keyof SettingsData];

export interface ChoiceOption {
  /** String form of the value (also the focus id suffix). */
  readonly id: string;
  readonly label: string;
  /** Language of the label when it differs from the page (each language names itself). */
  readonly lang?: Lang;
}

export interface ChoiceSpec {
  readonly kind: 'choice';
  readonly id: string;
  readonly label: string;
  readonly options: readonly ChoiceOption[];
  get(): string;
  set(id: string): void;
  /** A short explanation under the row, or null to hide it (re-read on every refresh). */
  hint?(): string | null;
}

export interface SliderSpec {
  readonly kind: 'slider';
  readonly id: string;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  get(): number;
  set(v: number): void;
  format(v: number): string;
  /** Volume rows play a short preview sound when the slider is released. */
  readonly volume?: VolumeKey;
}

export interface NoteSpec {
  readonly kind: 'note';
  readonly id: string;
  readonly label: string;
  text(): string;
}
/** A button row (About): rate, share, links, the creators. */
export interface ActionSpec {
  readonly kind: 'action';
  readonly id: string;
  readonly label: string;
  readonly icon: IconName;
  /** A grey line under the button, or null. */
  readonly hint: string | null;
  run(): void;
}
/** A dropdown (the language list: twelve options are too many for a row of buttons). */
export interface SelectSpec {
  readonly kind: 'select';
  readonly id: string;
  readonly label: string;
  readonly options: readonly ChoiceOption[];
  get(): string;
  set(id: string): void;
}
export type RowSpec = ChoiceSpec | SliderSpec | NoteSpec | ActionSpec | SelectSpec;

function choice<K extends ChoiceKey>(
  key: K,
  options: ReadonlyArray<readonly [value: SettingsData[K], label: string, lang?: Lang]>,
  hint?: () => string | null,
): ChoiceSpec {
  return {
    kind: 'choice',
    id: key,
    label: t(`ui.settings.label.${key}`),
    options: options.map(([value, label, lang]) => ({ id: String(value), label, lang })),
    get: () => String(settings.data[key]),
    set: (id) => {
      const found = options.find(([value]) => String(value) === id);
      if (found) settings.set(key, found[0]);
    },
    hint,
  };
}

type SliderKey = 'resolutionScale' | 'fov' | 'cameraSpeed' | VolumeKey;

function slider(
  key: SliderKey,
  range: { readonly min: number; readonly max: number },
  step: number,
  format: (v: number) => string,
): SliderSpec {
  return {
    kind: 'slider',
    id: key,
    label: t(`ui.settings.label.${key}`),
    min: range.min,
    max: range.max,
    step,
    get: () => settings.data[key],
    set: (v) => settings.set(key, v),
    format,
    volume: key.startsWith('vol') ? (key as VolumeKey) : undefined,
  };
}

const percent = (v: number): string => t('ui.settings.value.percent', { pct: Math.round(v * 100) });
const degrees = (v: number): string => t('ui.settings.value.degrees', { deg: Math.round(v) });
const multiplier = (v: number): string =>
  t('ui.settings.value.multiplier', { x: String(Math.round(v * 100) / 100) });

function onOff(
  key: 'shadows' | 'invertY' | 'reduceMotion' | 'timedPrompts' | 'hints',
  hint?: () => string | null,
) {
  return choice(
    key,
    [
      [false, t('ui.settings.option.off')],
      [true, t('ui.settings.option.on')],
    ],
    hint,
  );
}

/** "Auto picked Medium." while Quality is on Auto and the benchmark has chosen a level. */
function qualityHint(): string | null {
  const quality = services.tryGet('quality');
  if (settings.data.quality !== 'auto' || !quality) return null;
  return t('ui.settings.hint.qualityAuto', { level: t(`ui.settings.option.quality.${quality.level}`) });
}

/** Low quality never draws shadows (GDD 2.11), whatever the Shadows switch says. */
function shadowsHint(): string | null {
  const level = services.tryGet('quality')?.level ?? settings.data.quality;
  return level === 'low' ? t('ui.settings.hint.shadowsLow') : null;
}

/** General: what a child or parent changes first. */
export function generalRows(): RowSpec[] {
  return [
    // A dropdown where each language names itself, in its own script.
    {
      kind: 'select',
      id: 'lang',
      label: t('ui.settings.label.lang'),
      options: LANGS.map((l) => ({ id: l, label: LANG_NAMES[l], lang: l })),
      get: () => settings.data.lang,
      set: (id) => {
        const l = LANGS.find((x) => x === id);
        if (l) settings.set('lang', l);
      },
    } satisfies SelectSpec,
    choice(
      'textSize',
      (['M', 'L', 'XL'] as const).map((v) => [v, t(`ui.settings.option.textSize.${v}`)] as const),
    ),
    choice(
      'textSpeed',
      (['slow', 'normal', 'instant'] as const).map(
        (v) => [v, t(`ui.settings.option.textSpeed.${v}`)] as const,
      ),
    ),
    choice('difficulty', [
      ['easy', t('ui.settings.option.difficulty.easy')],
      ['normal', t('ui.settings.option.difficulty.normal')],
    ]),
    choice(
      'movementPace',
      (['slow', 'normal', 'fast'] as const).map(
        (pace) => [pace, t(`ui.settings.option.movementPace.${pace}`)] as const,
      ),
      () => t('ui.settings.hint.movementPace'),
    ),
    choice(
      'voiceMode',
      (['spoken', 'classic', 'off'] as const).map(
        (v) => [v, t(`ui.settings.option.voiceMode.${v}`)] as const,
      ),
    ),
    choice('voiceGuidance', [
      [true, t('ui.settings.option.on')],
      [false, t('ui.settings.option.off')],
    ]),
  ];
}

export function soundRows(): RowSpec[] {
  const keys: VolumeKey[] = ['volMaster', 'volMusic', 'volVoices', 'volEffects', 'volAmbience'];
  return keys.map((key) => slider(key, SETTINGS_RANGES.volume, 0.05, percent));
}

/** Advanced: picture and camera fine-tuning, for older players and parents. */
export function advancedRows(): RowSpec[] {
  return [
    choice(
      'quality',
      (['low', 'medium', 'high', 'auto'] as const).map(
        (q) => [q, t(`ui.settings.option.quality.${q}`)] as const,
      ),
      qualityHint,
    ),
    onOff('shadows', shadowsHint),
    slider('resolutionScale', SETTINGS_RANGES.resolutionScale, 0.05, percent),
    choice('frameCap', [
      [30, t('ui.settings.option.frameCap.30')],
      [60, t('ui.settings.option.frameCap.60')],
    ]),
    choice(
      'autoCamera',
      (['default', 'on', 'off'] as const).map((v) => [v, t(`ui.settings.option.autoCamera.${v}`)] as const),
      () => (settings.data.autoCamera === 'default' ? t('ui.settings.hint.autoCamera') : null),
    ),
    slider('cameraSpeed', SETTINGS_RANGES.cameraSpeed, 0.05, multiplier),
    slider('fov', SETTINGS_RANGES.fov, 1, degrees),
    onOff('invertY'),
    onOff('reduceMotion'),
    onOff('timedPrompts'),
    onOff('hints'),
  ];
}

export function rowsFor(tab: Exclude<SettingsTab, 'controls'>): RowSpec[] {
  switch (tab) {
    case 'general':
      return generalRows();
    case 'sound':
      return soundRows();
    case 'advanced':
      return advancedRows();
    case 'about':
      return aboutRows();
  }
}
