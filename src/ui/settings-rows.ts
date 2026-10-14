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

export type SettingsTab = 'graphics' | 'gameplay' | 'audio' | 'text' | 'controls';
export const SETTINGS_TABS: readonly SettingsTab[] = ['graphics', 'gameplay', 'audio', 'text', 'controls'];

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
  /** Language of the label when it differs from the page (the "தமிழ்" option). */
  readonly lang?: 'en' | 'ta';
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

export type RowSpec = ChoiceSpec | SliderSpec;

function choice<K extends ChoiceKey>(
  key: K,
  options: ReadonlyArray<readonly [value: SettingsData[K], label: string, lang?: 'en' | 'ta']>,
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

export function graphicsRows(): RowSpec[] {
  return [
    choice(
      'quality',
      (['low', 'medium', 'high', 'auto'] as const).map(
        (q) => [q, t(`ui.settings.option.quality.${q}`)] as const,
      ),
      qualityHint,
    ),
    slider('resolutionScale', SETTINGS_RANGES.resolutionScale, 0.05, percent),
    onOff('shadows', shadowsHint),
    choice('frameCap', [
      [30, t('ui.settings.option.frameCap.30')],
      [60, t('ui.settings.option.frameCap.60')],
    ]),
  ];
}

export function gameplayRows(): RowSpec[] {
  return [
    choice('difficulty', [
      ['easy', t('ui.settings.option.difficulty.easy')],
      ['normal', t('ui.settings.option.difficulty.normal')],
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

export function audioRows(): RowSpec[] {
  const keys: VolumeKey[] = ['volMaster', 'volMusic', 'volVoices', 'volEffects', 'volAmbience'];
  return keys.map((key) => slider(key, SETTINGS_RANGES.volume, 0.05, percent));
}

export function textRows(): RowSpec[] {
  return [
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
    // Each language names itself, in its own script.
    choice('lang', [
      ['en', t('ui.settings.option.lang.en'), 'en'],
      ['ta', t('ui.settings.option.lang.ta'), 'ta'],
    ]),
  ];
}

export function rowsFor(tab: Exclude<SettingsTab, 'controls'>): RowSpec[] {
  switch (tab) {
    case 'graphics':
      return graphicsRows();
    case 'gameplay':
      return gameplayRows();
    case 'audio':
      return audioRows();
    case 'text':
      return textRows();
  }
}
