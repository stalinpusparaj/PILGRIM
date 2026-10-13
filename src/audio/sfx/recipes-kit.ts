/** Small builders that keep the recipe tables short. They only return plain recipe data (types.ts). */
import type {
  FilterSpec,
  LayerSpec,
  NoiseColor,
  NoiseSrc,
  Num,
  OscSrc,
  Points,
  SfxRecipe,
  Wave,
} from './types';
import type { SfxId } from '../types';

/** A typed slice of the recipe table (each recipes-*.ts file exports one). */
export type RecipeTable<K extends SfxId> = Record<K, SfxRecipe>;

type OscOpts = Omit<OscSrc, 'type' | 'wave' | 'freq'>;

export function osc(wave: Wave, freq: Num, o: OscOpts = {}): OscSrc {
  return { type: 'osc', wave, freq, ...o };
}

export function noise(color: NoiseColor): NoiseSrc {
  return { type: 'noise', color };
}

/** Low-pass; q in dB (-3 = flat). */
export function lp(freq: Num, q: Num = -3, sweep?: Points): FilterSpec {
  return sweep ? { type: 'lowpass', freq, q, sweep } : { type: 'lowpass', freq, q };
}

/** High-pass; q in dB (-3 = flat). */
export function hp(freq: Num, q: Num = -3): FilterSpec {
  return { type: 'highpass', freq, q };
}

/** Band-pass; q = bandwidth Q (higher = narrower, more vocal/resonant). */
export function bp(freq: Num, q: Num = 1, sweep?: Points): FilterSpec {
  return sweep ? { type: 'bandpass', freq, q, sweep } : { type: 'bandpass', freq, q };
}

/** Peaking boost/cut (formants). */
export function pk(freq: Num, q: Num, gain: number): FilterSpec {
  return { type: 'peaking', freq, q, gain };
}

/** A soft FM chime: sine carrier with a decaying 3:1 modulator plus a quiet octave partial. */
export function chime(
  freq: number,
  at: number,
  gain: number,
  decay: number,
  ratio = 3,
  index = 1.2,
): LayerSpec[] {
  return [
    {
      src: osc('sine', freq, { fm: { ratio, index, indexEnd: 0 } }),
      at,
      env: { a: 0.003, d: decay },
      gain,
    },
    { src: osc('sine', freq * 2), at, env: { a: 0.003, d: decay * 0.4 }, gain: gain * 0.28 },
  ];
}

/**
 * A struck bell: hum, prime, tierce, quint and nominal partials (approximate tuned-bell ratios), each with its
 * own decay, plus a soft strike. `freq` is the strike note (the nominal).
 */
export function bell(freq: number, at: number, gain: number, decay: number): LayerSpec[] {
  const partials: ReadonlyArray<readonly [ratio: number, level: number, life: number]> = [
    [0.5, 0.45, 1],
    [1, 0.4, 0.7],
    [1.2, 0.22, 0.55],
    [1.5, 0.16, 0.45],
    [2, 0.6, 0.5],
    [2.66, 0.12, 0.25],
  ];
  const out: LayerSpec[] = partials.map(([ratio, level, life]) => ({
    src: osc('sine', (freq / 2) * ratio),
    at,
    env: { a: 0.004, d: decay * life },
    gain: gain * level,
  }));
  out.push({
    src: noise('pink'),
    at,
    env: { a: 0.001, d: 0.03 },
    gain: gain * 0.15,
    filters: [bp(freq * 2, 2)],
  });
  return out;
}
