/** Combat (GDD 2.8): bonk-swings, shields, fiery darts, prayer. Toy-like, never stabby or harsh. */
import { bp, hp, lp, noise, osc, type RecipeTable } from './recipes-kit';
import type { LayerSpec } from './types';

type CombatId =
  | 'sword_whoosh'
  | 'sword_hit'
  | 'shield_clang'
  | 'perfect_block'
  | 'dart_whoosh'
  | 'prayer_swell'
  | 'shadow_squeak';

/** One voice of the prayer "aah" chord: stacked detuned saws through an open-vowel formant. */
function aah(freq: number, gain: number): LayerSpec {
  return {
    src: osc('sawtooth', freq, {
      unison: { count: 3, cents: 12 },
      vib: { rate: 5, depth: 0.12, delay: 0.3 },
    }),
    env: { a: 0.9, h: 0.4, d: 1.1 },
    gain,
    filters: [bp(800, 1.5), lp(2200)],
  };
}

export const COMBAT_RECIPES: RecipeTable<CombatId> = {
  /** Airy swish with a faint cartoon trail. */
  sword_whoosh: {
    len: 0.5,
    level: 0.38,
    variants: 3,
    poly: 3,
    vary: { pitch: 2, volume: 0.1 },
    tone: 5000,
    layers: [
      {
        src: noise('pink'),
        env: { a: 0.07, d: 0.22 },
        gain: 1,
        filters: [
          bp(500, 2.2, [
            [0.12, 2400],
            [0.3, 800],
          ]),
        ],
      },
      {
        src: noise('brown'),
        env: { a: 0.06, d: 0.2 },
        gain: 0.4,
        filters: [
          lp(300, -3, [
            [0.12, 900],
            [0.3, 300],
          ]),
        ],
      },
      {
        src: osc('sine', 600, {
          bend: [
            [0, -5],
            [0.12, 5],
            [0.3, -3],
          ],
        }),
        env: { a: 0.06, d: 0.2 },
        gain: 0.08,
      },
    ],
  },
  /** A toy "thwack": padded hit with a small ring. */
  sword_hit: {
    len: 0.7,
    level: 0.48,
    variants: 3,
    poly: 3,
    vary: { pitch: 1.5, volume: 0.1 },
    tone: 4500,
    reverb: { seconds: 0.6, decay: 3, mix: 0.12 },
    layers: [
      { src: noise('pink'), env: { a: 0.001, d: 0.05 }, gain: 0.8, filters: [bp(1400, 1.5)] },
      {
        src: osc('sine', [650, 720], { fm: { ratio: 2.4, index: 2, indexEnd: 0 } }),
        env: { a: 0.001, d: 0.3 },
        gain: 0.35,
      },
      {
        src: osc('triangle', 180, {
          bend: [
            [0, 5],
            [0.05, 0],
          ],
        }),
        env: { a: 0.001, d: 0.1 },
        gain: 0.6,
        filters: [lp(900)],
      },
      { src: osc('sine', 1760), at: 0.01, env: { a: 0.001, d: 0.1 }, gain: 0.1 },
    ],
  },
  /** Shield clang: round metal, short ring. */
  shield_clang: {
    len: 1.1,
    level: 0.42,
    variants: 2,
    poly: 2,
    vary: { pitch: 1, volume: 0.1 },
    tone: 4500,
    reverb: { seconds: 0.8, decay: 3, mix: 0.15 },
    layers: [
      {
        src: osc('sine', [400, 430], { fm: { ratio: 1.47, index: 3, indexEnd: 0.3 } }),
        env: { a: 0.001, d: 0.7 },
        gain: 0.7,
      },
      { src: osc('sine', [1080, 1180]), env: { a: 0.001, d: 0.4 }, gain: 0.22 },
      { src: noise('pink'), env: { a: 0.001, d: 0.035 }, gain: 0.6, filters: [bp(1600, 1.2)] },
      { src: noise('brown'), env: { a: 0.002, d: 0.07 }, gain: 0.5, filters: [lp(500)] },
    ],
  },
  /** Perfect block: a clear, happy bell ring with a glint. */
  perfect_block: {
    len: 1.8,
    level: 0.48,
    poly: 2,
    rate: 32000,
    reverb: { seconds: 1.4, decay: 3, mix: 0.3 },
    layers: [
      {
        src: osc('sine', 1046.5, { fm: { ratio: 3, index: 2, indexEnd: 0 } }),
        env: { a: 0.002, d: 1.3 },
        gain: 0.6,
      },
      { src: osc('sine', 2093), env: { a: 0.002, d: 0.7 }, gain: 0.25 },
      {
        src: osc('sine', 1568, { fm: { ratio: 2, index: 0.6, indexEnd: 0 } }),
        at: 0.06,
        env: { a: 0.002, d: 0.9 },
        gain: 0.3,
      },
      { src: noise('white'), env: { a: 0.001, d: 0.02 }, gain: 0.3, filters: [bp(4000, 2)] },
      {
        src: osc('sine', 3136, {
          bend: [
            [0, -5],
            [0.08, 0],
          ],
        }),
        at: 0.08,
        env: { a: 0.002, d: 0.25 },
        gain: 0.08,
      },
    ],
  },
  /** Fiery dart: a falling hiss with a soft sizzle. */
  dart_whoosh: {
    len: 0.7,
    level: 0.35,
    variants: 3,
    poly: 3,
    vary: { pitch: 2, volume: 0.1 },
    tone: 5000,
    layers: [
      { src: noise('pink'), env: { a: 0.05, d: 0.35 }, gain: 0.8, filters: [bp(3200, 3, [[0.35, 900]])] },
      {
        src: noise('white'),
        env: { a: 0.05, d: 0.3 },
        gain: 0.12,
        trem: { rate: 40, depth: 0.6 },
        filters: [hp(4000)],
      },
      {
        src: osc('sine', 880, {
          bend: [
            [0, 0],
            [0.4, -12],
          ],
        }),
        env: { a: 0.05, d: 0.35 },
        gain: 0.15,
      },
    ],
  },
  /** Warm rising choir swell (A major "aah") with a soft shimmer on top. */
  prayer_swell: {
    len: 3,
    level: 0.5,
    poly: 1,
    tone: 5000,
    reverb: { seconds: 2.2, decay: 2.5, mix: 0.4 },
    layers: [
      aah(220, 0.7),
      aah(277.18, 0.55),
      aah(329.63, 0.5),
      { src: osc('sine', 1760, { vib: { rate: 6, depth: 0.2 } }), env: { a: 0.7, h: 0.4, d: 1 }, gain: 0.12 },
      { src: osc('sine', 110), env: { a: 1, h: 0.3, d: 1 }, gain: 0.3 },
    ],
  },
  /** A shadow scatters: a silly "eep!" and a poof. */
  shadow_squeak: {
    len: 0.4,
    level: 0.32,
    variants: 3,
    poly: 3,
    vary: { pitch: 2, volume: 0.15 },
    tone: 6000,
    layers: [
      {
        src: osc('sine', [1000, 1300], {
          bend: [
            [0, -3],
            [0.07, 6],
            [0.16, -4],
          ],
          vib: { rate: 28, depth: 0.8 },
        }),
        env: { a: 0.006, d: 0.17 },
        gain: 0.8,
      },
      { src: noise('pink'), at: 0.08, env: { a: 0.01, d: 0.12 }, gain: 0.2, filters: [bp(1500, 1)] },
    ],
  },
};
