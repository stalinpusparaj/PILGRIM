/**
 * SFX recipe language (GDD 2.13 "SFX recipes: parameter objects, generated on load").
 *
 * A recipe is plain data: layers of oscillators or noise, each with an envelope, optional pitch bends, vibrato,
 * FM, tremolo, a filter chain with sweeps, soft saturation and repeats (rolls, rattles, knocks). The renderer
 * (render.ts) turns each recipe into an AudioBuffer once, on load, in an OfflineAudioContext.
 *
 * Every `Num` may be a fixed number or a `[min, max]` range. Ranges are drawn from the recipe's own seeded Rng
 * at render time, separately for every repeat and every variant, so rolls and variants never sound identical but
 * the same seed always renders the same sound.
 */

import type { Vec3 } from '../types';

/** A fixed value, or a `[min, max]` range drawn per render instance from a seeded Rng. */
export type Num = number | readonly [number, number];

export type Wave = 'sine' | 'triangle' | 'square' | 'sawtooth';
export type NoiseColor = 'white' | 'pink' | 'brown';

/** Time/value automation points: `[seconds from the layer start, value]`. Smooth ramps between points. */
export type Points = ReadonlyArray<readonly [number, Num]>;

/**
 * Amplitude envelope (seconds). 0 -> peak over `a`, hold `h`, then decay over `d` towards `s` x peak. With a
 * sustain (`s` > 0) the level then releases to silence over `r`. The layer lasts a + h + d + r.
 */
export interface EnvSpec {
  a: Num;
  h?: Num;
  d: Num;
  /** Sustain level 0..1 relative to the peak (default 0: the decay ends in silence). */
  s?: number;
  /** Release time after the decay when `s` > 0 (default 0.05). */
  r?: Num;
  /** Decay shape: 'exp' (natural, default) or 'lin'. */
  curve?: 'exp' | 'lin';
}

/** Oscillator source. Several oscillators share the envelope when `unison` is given. */
export interface OscSrc {
  type: 'osc';
  wave: Wave;
  /** Base frequency in Hz. */
  freq: Num;
  /** Pitch envelope in semitones relative to `freq` (exponential glides between points). */
  bend?: Points;
  /** Vibrato: `rate` Hz, `depth` semitones; `delay` before it starts, `fade` = seconds for the depth to die away. */
  vib?: { rate: Num; depth: Num; delay?: number; fade?: number };
  /** FM: a sine (or `wave`) modulator at freq x ratio; index = peak deviation / modulator frequency. */
  fm?: { ratio: Num; index: Num; indexEnd?: Num; wave?: Wave };
  /** Stacked detuned copies (choir/roar thickness): `count` oscillators spread over +-`cents`. */
  unison?: { count: number; cents: number };
}

/** Seeded noise source (looped buffer, random start offset per instance). */
export interface NoiseSrc {
  type: 'noise';
  color: NoiseColor;
}

export type FilterKind = 'lowpass' | 'highpass' | 'bandpass' | 'peaking' | 'notch' | 'lowshelf' | 'highshelf';

export interface FilterSpec {
  type: FilterKind;
  /** Cutoff/centre in Hz. */
  freq: Num;
  /** Web Audio Q: resonance in dB for low/high-pass (-3 = flat Butterworth), bandwidth Q for band-pass/peaking/notch. */
  q?: Num;
  /** dB, for peaking and shelf filters. */
  gain?: number;
  /** Frequency sweep `[seconds, Hz]` (exponential between points). */
  sweep?: Points;
}

/** Repeat a layer (knocks, rattles, bounces, twinkles). Every hit re-draws the layer's ranges. */
export interface RepeatSpec {
  /** Total number of hits, including the first. */
  count: Num;
  /** Seconds between hits (re-drawn per gap). */
  every: Num;
  /** Gain multiplier per hit (0.8 = each hit softer). Default 1. */
  fade?: number;
  /** Semitones added per hit (cumulative). Default 0. */
  step?: Num;
  /** Layers with the same key share their hit pattern (count, gaps and steps), e.g. a knuckle and its click. */
  sync?: string;
}

export interface LayerSpec {
  src: OscSrc | NoiseSrc;
  /** Start offset in seconds. Default 0. */
  at?: Num;
  env: EnvSpec;
  /** Peak level of this layer before the recipe is normalised. Default 1. */
  gain?: Num;
  /** Filters in series. */
  filters?: readonly FilterSpec[];
  /** Soft tanh saturation drive (1 = clean, 2-4 = warm grit). Default none. */
  drive?: number;
  /** Amplitude tremolo: `rate` Hz, `depth` 0..1. */
  trem?: { rate: Num; depth: number };
  repeat?: RepeatSpec;
}

export interface SfxRecipe {
  /** Rendered length in seconds, tails included (trailing silence is trimmed after rendering). */
  len: number;
  layers: readonly LayerSpec[];
  /** Playback level 0..1 after peak normalisation to -6 dBFS (the mix balance between sounds). Default 0.6. */
  level?: number;
  /** How many variants to render with different seeds (one is picked per play, never the same twice). */
  variants?: number;
  /** Max simultaneous plays of this id; the oldest is stolen with a short fade. Default 3. */
  poly?: number;
  /** Random per-play variation: pitch +- semitones, volume +- fraction. */
  vary?: { pitch?: number; volume?: number };
  /**
   * Musical scale in semitones (e.g. [0, 4, 7]): the `pitch` play option snaps to its nearest note in any octave,
   * so the effect is always in tune; stepPitch(id, n) gives the n-th note (continuing by octaves).
   */
  steps?: readonly number[];
  /** Feedback echo on the whole recipe. */
  echo?: { time: number; feedback: number; mix: number; tone?: number };
  /** Generated reverb impulse (seeded noise with an exponential decay). */
  reverb?: { seconds: number; decay: number; mix: number };
  /** Final low-pass in Hz to keep the sound soft. Default 9000 (clamped below Nyquist). */
  tone?: number;
  /** Render sample rate. Default 24000; bright chimes use 32000. */
  rate?: number;
}

/** Options for one play (the `sfx` event payload minus the id). */
export interface SfxPlayOptions {
  /** World position for 3D panning (metres, same space as the listener). */
  at?: Vec3;
  /** Volume multiplier 0..1 (default 1; never louder than the recipe level). */
  volume?: number;
  /**
   * Playback-rate multiplier, 1 = as designed (2 = an octave up), clamped to 0.25..4. Recipes with `steps` snap it
   * to their scale (see stepPitch for joy_note / rope_snap). Default 1.
   */
  pitch?: number;
}
