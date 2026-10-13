/**
 * Ambience recipes for places people made (src/audio/amb-beds.ts has the full table): the town, the fair, a
 * candle-lit room, a dungeon, and the Valley's low wind. Levels sit well under dialogue and music; `spot` marks
 * what a positional emitter of that kind plays (town bells and carts, the fair crowd, a candle, dungeon drips).
 */
import type { BedDef } from './amb-types';
import { bell, creak, drip, tink, whoosh } from './amb-events';
import { fiddle, laugh } from './amb-creatures';

/** Town bell notes (F4, G4, A4): warm, never shrill. */
const TOWN_BELLS: readonly number[] = [349.23, 392, 440];

export const town: BedDef = {
  gain: 1,
  spotGain: 1,
  ref: 10,
  reach: 110,
  layers: [
    { kind: 'texture', tex: 'murmurA', gain: 0.3, filters: [{ type: 'lowpass', freq: 1600 }], pan: -0.25 },
    {
      kind: 'noise',
      color: 'brown',
      gain: 0.07,
      filters: [{ type: 'lowpass', freq: 500 }],
      swell: [{ rate: 0.05, depth: 0.35 }],
    },
  ],
  events: [
    {
      fn: bell(TOWN_BELLS, [2, 4]),
      every: [16, 30],
      gain: 0.5,
      far: 2400,
      send: 0.5,
      pan: 'fixed',
      spread: 0.6,
      spot: true,
    },
    { fn: creak, every: [6, 14], gain: 0.5, far: 3500, pan: 'random', spread: 0.8, spot: true },
    { fn: tink, every: [8, 18], gain: 0.12, far: 3000, send: 0.3, pan: 'fixed', spread: 0.7 },
  ],
};

export const fair: BedDef = {
  gain: 1,
  spotGain: 1,
  ref: 8,
  reach: 70,
  layers: [
    {
      kind: 'texture',
      tex: 'murmurA',
      gain: 0.3,
      pan: -0.3,
      filters: [{ type: 'lowpass', freq: 2600 }],
      spot: true,
    },
    { kind: 'texture', tex: 'murmurB', gain: 0.26, pan: 0.3, filters: [{ type: 'lowpass', freq: 2200 }] },
    { kind: 'noise', color: 'pink', gain: 0.04, filters: [{ type: 'lowpass', freq: 900 }] },
  ],
  events: [
    { fn: laugh, every: [2.5, 7], gain: 0.2, far: 3500, pan: 'random', spread: 0.8, spot: true },
    { fn: fiddle, every: [6, 14], gain: 0.16, far: 2600, send: 0.4, pan: 'fixed', spread: 0.6 },
    { fn: laugh, every: [4, 9], gain: 0.12, far: 2200, pan: 'random', spread: 0.9 },
  ],
};

export const candle: BedDef = {
  gain: 1,
  spotGain: 1,
  ref: 1.2,
  reach: 14,
  layers: [
    { kind: 'texture', tex: 'crackleA', gain: 0.4, pan: -0.1, filters: [{ type: 'highpass', freq: 900 }] },
    { kind: 'texture', tex: 'crackleB', gain: 0.3, pan: 0.15, filters: [{ type: 'highpass', freq: 600 }] },
    {
      kind: 'noise',
      color: 'brown',
      gain: 0.03,
      filters: [{ type: 'lowpass', freq: 260 }],
      swell: [
        { rate: 0.31, depth: 0.4 },
        { rate: 0.8, depth: 0.2 },
      ],
    },
  ],
  events: [],
};

export const dungeon: BedDef = {
  gain: 1,
  spotGain: 1,
  ref: 3,
  reach: 30,
  layers: [
    {
      kind: 'noise',
      color: 'brown',
      gain: 0.12,
      filters: [{ type: 'lowpass', freq: 140 }],
      swell: [{ rate: 0.03, depth: 0.2 }],
    },
    {
      kind: 'noise',
      color: 'pink',
      gain: 0.025,
      filters: [{ type: 'bandpass', freq: 420, q: 0.8 }],
      swell: [{ rate: 0.05, depth: 0.3 }],
    },
    { kind: 'tone', wave: 'sine', freq: 55, gain: 0.02 },
    { kind: 'tone', wave: 'triangle', freq: 82.5, detune: 4, gain: 0.01 },
  ],
  events: [
    { fn: drip(900, 1400), every: [1.6, 4.5], gain: 0.22, send: 0.8, pan: 'fixed', spread: 0.6, spot: true },
    { fn: drip(1300, 1900), every: [2.5, 6], gain: 0.15, send: 0.8, pan: 'fixed', spread: 0.8, spot: true },
  ],
};

export const valley: BedDef = {
  gain: 1,
  spotGain: 1,
  ref: 6,
  reach: 50,
  layers: [
    {
      kind: 'noise',
      color: 'brown',
      gain: 0.16,
      filters: [{ type: 'lowpass', freq: 240 }],
      swell: [
        { rate: 0.035, depth: 0.5 },
        { rate: 0.09, depth: 0.2 },
      ],
    },
    {
      kind: 'noise',
      color: 'brown',
      gain: 0.12,
      filters: [{ type: 'bandpass', freq: 160, q: 1.5 }],
      wander: { rate: 0.05, depth: 50 },
      swell: [{ rate: 0.06, depth: 0.4 }],
    },
    {
      kind: 'noise',
      color: 'pink',
      gain: 0.035,
      filters: [{ type: 'bandpass', freq: 520, q: 1.2 }],
      wander: { rate: 0.04, depth: 120 },
      swell: [{ rate: 0.05, depth: 0.6 }],
    },
  ],
  events: [{ fn: whoosh, every: [8, 16], gain: 0.2, far: 1500, send: 0.5, pan: 'random', spread: 0.9 }],
};
