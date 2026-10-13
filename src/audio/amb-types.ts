/**
 * Ambience data types (GDD 2.13 "Ambience per zone"). A bed is a few looping layers (seeded noise through filters,
 * procedural texture loops, quiet tones) with slow LFO wobbles, plus randomly timed one-shot events (a frog, a
 * bird, a far bell). The same recipe also drives positional emitters (`spot` items only).
 */
import type { Rng } from '../gen/rng';
import type { NoiseColor } from './Synth';
import type { Shot } from './amb-shot';

/** Procedural loops rendered once per Ambience (src/audio/amb-textures.ts). */
export type TextureId = 'crackleA' | 'crackleB' | 'patter' | 'crickets' | 'murmurA' | 'murmurB';

/** What beds, emitters and one-shots share. Implemented by Ambience. */
export interface AmbHost {
  readonly ctx: AudioContext;
  /** Cached seeded noise loop (Synth.noiseBuffer). */
  noise(color: NoiseColor): AudioBuffer;
  /** Cached procedural texture loop; resolves once rendered (never rejects). */
  texture(id: TextureId): Promise<AudioBuffer>;
  /** Reverb send (the engine's shared convolver), or null for a dry ambience. */
  readonly space: AudioNode | null;
  /** StereoPannerNode is available. */
  readonly stereo: boolean;
}

/** Builds one event into `s`, starting at ctx time `t`; returns the time at which it is silent. */
export type AmbEventFn = (s: Shot, t: number, r: Rng) => number;

/** Slow sine wobble: `rate` Hz, `depth` as a fraction of the layer gain (swell) or in Hz (wander). */
export interface Lfo {
  rate: number;
  depth: number;
}

export interface FilterDef {
  type: BiquadFilterType;
  freq: number;
  q?: number;
}

interface LayerBase {
  gain: number;
  /** Fixed stereo position in the bed, -1..1 (ignored by positional emitters). */
  pan?: number;
  /** Filters in order, source first. */
  filters?: readonly FilterDef[];
  /** Gain wobbles (gusts, swells); each depth is a fraction of `gain`. */
  swell?: readonly Lfo[];
  /** Wobble of the first filter's frequency (depth in Hz). */
  wander?: Lfo;
  /** Part of the positional (emitter) version. When no item of a bed sets it, emitters use everything. */
  spot?: boolean;
}

export interface NoiseLayer extends LayerBase {
  kind: 'noise';
  color: NoiseColor;
  rate?: number;
}

export interface TextureLayer extends LayerBase {
  kind: 'texture';
  tex: TextureId;
  /** Playback rate (a second cricket a little lower, say). */
  rate?: number;
}

export interface ToneLayer extends LayerBase {
  kind: 'tone';
  wave: OscillatorType;
  freq: number;
  detune?: number;
}

export type LayerDef = NoiseLayer | TextureLayer | ToneLayer;

export interface EventDef {
  fn: AmbEventFn;
  /** Seconds between events, [min, max]. */
  every: readonly [number, number];
  /** Event level (each event varies 70-100 % of this). */
  gain: number;
  /** Stereo placement in the bed: 'random' each time, or 'fixed' per generator (a bird in its tree). */
  pan?: 'random' | 'fixed';
  /** Stereo width for `pan`, 0..1 (default 0.7). */
  spread?: number;
  /** Distance low-pass in Hz for the bed version (far bells, a fiddle across the fair). */
  far?: number;
  /** Reverb send 0..1 for the bed version. */
  send?: number;
  spot?: boolean;
}

export interface BedDef {
  /** Level of the zone bed. */
  gain: number;
  /** Level of a positional emitter of this kind. */
  spotGain: number;
  /** Emitter reference distance in metres (full level inside it). */
  ref: number;
  /** Emitter reach in metres: it starts within this distance of the listener and stops a bit beyond it. */
  reach: number;
  layers: readonly LayerDef[];
  events: readonly EventDef[];
}
