/**
 * Ambience recipes for the outdoors (src/audio/amb-beds.ts has the full table): bog, hills, wind, river,
 * birdsong, rain, night and meadow. Levels sit well under dialogue and music; `spot` marks what a positional
 * emitter of that kind plays (bog frogs, birds in a tree, a bee patch, crickets).
 */
import type { BedDef } from './amb-types';
import { bubbles, drip, whoosh } from './amb-events';
import { bee, bird, frog, owl } from './amb-creatures';

export const bog: BedDef = {
  gain: 1,
  spotGain: 1.2,
  ref: 4,
  reach: 40,
  layers: [
    {
      kind: 'noise',
      color: 'white',
      gain: 0.045,
      filters: [
        { type: 'highpass', freq: 2000 },
        { type: 'lowpass', freq: 6500 },
      ],
      swell: [{ rate: 0.09, depth: 0.3 }],
    },
    { kind: 'texture', tex: 'patter', gain: 0.08, filters: [{ type: 'lowpass', freq: 4000 }] },
    {
      kind: 'noise',
      color: 'brown',
      gain: 0.07,
      filters: [{ type: 'lowpass', freq: 220 }],
      swell: [{ rate: 0.04, depth: 0.3 }],
    },
  ],
  events: [
    { fn: bubbles(140, 260, 4, 900), every: [1.2, 3.5], gain: 0.35, pan: 'random', spread: 0.7, spot: true },
    { fn: frog(110, 150), every: [2.5, 6], gain: 0.45, pan: 'fixed', spread: 0.6, spot: true },
    { fn: frog(150, 200), every: [3, 7], gain: 0.4, pan: 'fixed', spread: 0.8, spot: true },
    { fn: frog(80, 100), every: [8, 16], gain: 0.45, pan: 'fixed', spread: 0.5 },
  ],
};

export const hills: BedDef = {
  gain: 1,
  spotGain: 1,
  ref: 6,
  reach: 50,
  layers: [
    {
      kind: 'noise',
      color: 'brown',
      gain: 0.3,
      filters: [{ type: 'bandpass', freq: 450, q: 0.7 }],
      wander: { rate: 0.07, depth: 200 },
      swell: [
        { rate: 0.05, depth: 0.45 },
        { rate: 0.13, depth: 0.2 },
      ],
    },
    {
      kind: 'noise',
      color: 'pink',
      gain: 0.025,
      filters: [{ type: 'highpass', freq: 2500 }],
      swell: [{ rate: 0.09, depth: 0.4 }],
    },
  ],
  events: [
    { fn: bird('tweet', 3200), every: [4, 10], gain: 0.14, pan: 'fixed', spot: true },
    { fn: bird('whistle', 2400), every: [6, 14], gain: 0.12, pan: 'fixed', spot: true },
    { fn: bird('cheep', 3800), every: [5, 12], gain: 0.07, pan: 'random' },
  ],
};

export const wind: BedDef = {
  gain: 1,
  spotGain: 1,
  ref: 6,
  reach: 50,
  layers: [
    {
      kind: 'noise',
      color: 'brown',
      gain: 0.4,
      pan: -0.3,
      filters: [{ type: 'bandpass', freq: 380, q: 0.8 }],
      wander: { rate: 0.06, depth: 220 },
      swell: [
        { rate: 0.045, depth: 0.5 },
        { rate: 0.11, depth: 0.25 },
      ],
    },
    {
      kind: 'noise',
      color: 'pink',
      gain: 0.06,
      pan: 0.3,
      filters: [{ type: 'bandpass', freq: 900, q: 1.2 }],
      wander: { rate: 0.09, depth: 400 },
      swell: [{ rate: 0.07, depth: 0.6 }],
    },
  ],
  events: [{ fn: whoosh, every: [7, 15], gain: 0.22, pan: 'random', spread: 0.8 }],
};

export const river: BedDef = {
  gain: 1,
  spotGain: 1,
  ref: 6,
  reach: 60,
  layers: [
    {
      kind: 'noise',
      color: 'pink',
      gain: 0.42,
      filters: [{ type: 'bandpass', freq: 550, q: 0.6 }],
      wander: { rate: 0.13, depth: 160 },
      swell: [
        { rate: 0.21, depth: 0.15 },
        { rate: 0.07, depth: 0.1 },
      ],
    },
    {
      kind: 'noise',
      color: 'white',
      gain: 0.06,
      pan: 0.2,
      filters: [
        { type: 'highpass', freq: 2600 },
        { type: 'lowpass', freq: 6000 },
      ],
      swell: [
        { rate: 0.37, depth: 0.3 },
        { rate: 0.23, depth: 0.2 },
      ],
    },
    {
      kind: 'noise',
      color: 'brown',
      gain: 0.1,
      filters: [{ type: 'lowpass', freq: 200 }],
      swell: [{ rate: 0.05, depth: 0.2 }],
    },
  ],
  events: [{ fn: bubbles(350, 800, 5, 2600), every: [0.7, 2.2], gain: 0.1, pan: 'random', spread: 0.6 }],
};

export const birdsong: BedDef = {
  gain: 1,
  spotGain: 1.2,
  ref: 4,
  reach: 45,
  layers: [
    {
      kind: 'noise',
      color: 'pink',
      gain: 0.04,
      filters: [{ type: 'highpass', freq: 2500 }],
      swell: [{ rate: 0.08, depth: 0.3 }],
    },
  ],
  events: [
    { fn: bird('warble', 2800), every: [3, 8], gain: 0.18, pan: 'fixed', spot: true },
    { fn: bird('tweet', 3600), every: [2.5, 6], gain: 0.15, pan: 'fixed', spot: true },
    { fn: bird('trill', 3000), every: [5, 11], gain: 0.13, pan: 'fixed', spot: true },
    { fn: bird('whistle', 2200), every: [6, 13], gain: 0.14, pan: 'fixed' },
    { fn: bird('cheep', 4200), every: [3, 7], gain: 0.1, pan: 'random' },
  ],
};

export const rain: BedDef = {
  gain: 1,
  spotGain: 1,
  ref: 6,
  reach: 40,
  layers: [
    {
      kind: 'noise',
      color: 'white',
      gain: 0.08,
      filters: [
        { type: 'highpass', freq: 900 },
        { type: 'lowpass', freq: 7500 },
      ],
      swell: [{ rate: 0.08, depth: 0.2 }],
    },
    { kind: 'texture', tex: 'patter', gain: 0.14, filters: [{ type: 'lowpass', freq: 6000 }] },
    {
      kind: 'noise',
      color: 'brown',
      gain: 0.07,
      filters: [{ type: 'lowpass', freq: 300 }],
      swell: [{ rate: 0.05, depth: 0.25 }],
    },
  ],
  events: [{ fn: drip(1800, 2600), every: [0.5, 1.6], gain: 0.05, pan: 'random', spread: 0.9 }],
};

export const night: BedDef = {
  gain: 1,
  spotGain: 1,
  ref: 4,
  reach: 35,
  layers: [
    {
      kind: 'texture',
      tex: 'crickets',
      gain: 0.14,
      pan: -0.35,
      filters: [{ type: 'highpass', freq: 2500 }],
      spot: true,
    },
    {
      kind: 'texture',
      tex: 'crickets',
      gain: 0.1,
      pan: 0.4,
      rate: 0.93,
      filters: [{ type: 'highpass', freq: 2500 }],
    },
    {
      kind: 'noise',
      color: 'brown',
      gain: 0.04,
      filters: [{ type: 'lowpass', freq: 300 }],
      swell: [{ rate: 0.04, depth: 0.4 }],
    },
  ],
  events: [{ fn: owl, every: [18, 40], gain: 0.25, far: 1600, send: 0.4, pan: 'fixed', spread: 0.7 }],
};

export const meadow: BedDef = {
  gain: 1,
  spotGain: 1,
  ref: 4,
  reach: 40,
  layers: [
    {
      kind: 'noise',
      color: 'pink',
      gain: 0.07,
      filters: [{ type: 'bandpass', freq: 700, q: 0.5 }],
      swell: [{ rate: 0.07, depth: 0.5 }],
    },
  ],
  events: [
    { fn: bee, every: [5, 11], gain: 0.24, pan: 'random', spread: 0.8, spot: true },
    { fn: bird('tweet', 3400), every: [3, 8], gain: 0.14, pan: 'fixed' },
    { fn: bird('warble', 3000), every: [5, 12], gain: 0.14, pan: 'fixed' },
    { fn: bird('cheep', 4000), every: [4, 9], gain: 0.09, pan: 'random' },
  ],
};
