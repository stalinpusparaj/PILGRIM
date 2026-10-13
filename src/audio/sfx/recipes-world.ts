/** World interactions: knocks, arrows, bonks, stars, the lions, chains and cages. Cartoony and soft. */
import { bp, lp, noise, osc, pk, type RecipeTable } from './recipes-kit';

type WorldId =
  'knock' | 'arrow_whistle' | 'arrow_thunk' | 'bonk' | 'stars' | 'lion_roar' | 'chain_rattle' | 'cage_clank';

const KNOCKS = { count: 3, every: [0.15, 0.19], fade: 0.92, sync: 'knock' } as const;
const ROAR_BEND = [
  [0, -4],
  [0.25, 2],
  [0.9, 0],
  [1.4, -5],
] as const;

export const WORLD_RECIPES: RecipeTable<WorldId> = {
  /** Three friendly knocks on a wooden gate. */
  knock: {
    len: 0.8,
    level: 0.5,
    variants: 2,
    poly: 2,
    vary: { pitch: 1, volume: 0.1 },
    tone: 4000,
    layers: [
      {
        src: osc('triangle', [165, 180], {
          bend: [
            [0, 4],
            [0.02, 0],
          ],
        }),
        env: { a: 0.001, d: [0.07, 0.09] },
        gain: 1,
        filters: [bp(300, 2)],
        repeat: KNOCKS,
      },
      {
        src: noise('pink'),
        env: { a: 0.001, d: 0.025 },
        gain: 0.6,
        filters: [bp([800, 1000], 2)],
        repeat: KNOCKS,
      },
      { src: osc('sine', 95), env: { a: 0.002, d: 0.12 }, gain: 0.35, repeat: KNOCKS },
    ],
  },
  /** Falling cartoon whistle that fades in (a warning, never a shriek). */
  arrow_whistle: {
    len: 1.2,
    level: 0.3,
    variants: 2,
    poly: 3,
    vary: { pitch: 1 },
    tone: 5000,
    layers: [
      {
        src: osc('sine', [1500, 1700], {
          bend: [
            [0, 0],
            [1, -10],
          ],
          vib: { rate: 6, depth: 0.15 },
        }),
        env: { a: 0.3, h: 0.4, d: 0.3 },
        gain: 0.6,
      },
      {
        src: noise('pink'),
        env: { a: 0.3, h: 0.4, d: 0.3 },
        gain: 0.35,
        filters: [bp(2600, 5, [[1, 1500]])],
      },
    ],
  },
  /** Arrow lands in the ground: a thunk and a wobbling shaft. */
  arrow_thunk: {
    len: 0.6,
    level: 0.45,
    variants: 3,
    poly: 4,
    vary: { pitch: 1.5, volume: 0.15 },
    tone: 3500,
    layers: [
      {
        src: osc('sine', [140, 170], {
          bend: [
            [0, 5],
            [0.05, 0],
          ],
        }),
        env: { a: 0.002, d: 0.1 },
        gain: 0.8,
      },
      { src: noise('brown'), env: { a: 0.002, d: 0.06 }, gain: 0.8, filters: [lp(900)] },
      {
        src: osc('triangle', [260, 300], { vib: { rate: [22, 28], depth: 1.2, fade: 0.3 } }),
        env: { a: 0.005, d: 0.3 },
        gain: 0.22,
        filters: [lp(1500)],
      },
    ],
  },
  /** Comic hollow coconut "bonk" with a pitch drop. */
  bonk: {
    len: 0.7,
    level: 0.55,
    variants: 2,
    poly: 2,
    vary: { pitch: 1, volume: 0.1 },
    tone: 4000,
    reverb: { seconds: 0.5, decay: 3, mix: 0.1 },
    layers: [
      {
        src: osc('triangle', 440, {
          bend: [
            [0, 5],
            [0.03, 0],
            [0.25, -4],
          ],
        }),
        env: { a: 0.001, d: 0.28 },
        gain: 1,
        filters: [bp(650, 1.4)],
      },
      {
        src: osc('sine', 1010, {
          bend: [
            [0, 3],
            [0.03, 0],
          ],
        }),
        env: { a: 0.001, d: 0.12 },
        gain: 0.25,
      },
      { src: noise('pink'), env: { a: 0.001, d: 0.03 }, gain: 0.5, filters: [bp(1200, 3)] },
      {
        src: osc('sine', 220, {
          bend: [
            [0, 5],
            [0.03, 0],
            [0.25, -4],
          ],
        }),
        env: { a: 0.001, d: 0.2 },
        gain: 0.4,
      },
    ],
  },
  /** Twinkling stars circling a bonked head. */
  stars: {
    len: 1.4,
    level: 0.32,
    variants: 2,
    poly: 2,
    rate: 32000,
    reverb: { seconds: 1, decay: 3, mix: 0.3 },
    layers: [
      {
        src: osc('sine', 1568, { fm: { ratio: 3.5, index: 0.8, indexEnd: 0 } }),
        env: { a: 0.002, d: [0.18, 0.25] },
        gain: 0.5,
        repeat: { count: 6, every: [0.08, 0.11], fade: 0.88, step: [-4, 6] },
      },
      {
        src: osc('triangle', 3136, { vib: { rate: 9, depth: 0.4 } }),
        env: { a: 0.15, h: 0.3, d: 0.5 },
        gain: 0.08,
        trem: { rate: 12, depth: 0.7 },
      },
    ],
  },
  /** Big, round cartoon "RAWR": swells in, opens like a vowel, never screams. */
  lion_roar: {
    len: 2,
    level: 0.65,
    variants: 2,
    poly: 1,
    vary: { pitch: 1, volume: 0.1 },
    tone: 2600,
    reverb: { seconds: 1.2, decay: 3, mix: 0.2 },
    layers: [
      {
        src: osc('sawtooth', [88, 96], {
          unison: { count: 3, cents: 18 },
          bend: ROAR_BEND,
          vib: { rate: 6, depth: 0.4 },
        }),
        env: { a: 0.18, h: 0.5, d: 0.75 },
        gain: 1,
        drive: 2.2,
        trem: { rate: [24, 30], depth: 0.35 },
        filters: [
          lp(500, 2, [
            [0.3, 1500],
            [0.9, 1100],
            [1.4, 450],
          ]),
          pk(750, 1.2, 6),
        ],
      },
      {
        src: noise('pink'),
        env: { a: 0.2, h: 0.4, d: 0.7 },
        gain: 0.35,
        filters: [
          bp(700, 0.8, [
            [0.3, 1300],
            [1.4, 600],
          ]),
        ],
      },
      {
        src: osc('sine', 46, {
          bend: [
            [0, -2],
            [0.3, 1],
            [1.4, -3],
          ],
        }),
        env: { a: 0.2, h: 0.5, d: 0.6 },
        gain: 0.4,
      },
    ],
  },
  /** Light jingle of chain links. */
  chain_rattle: {
    len: 1,
    level: 0.32,
    variants: 3,
    poly: 2,
    vary: { pitch: 1, volume: 0.15 },
    rate: 32000,
    tone: 7000,
    layers: [
      {
        src: osc('sine', [1700, 2600], { fm: { ratio: 1.41, index: 2, indexEnd: 0 } }),
        env: { a: 0.001, d: [0.05, 0.09] },
        gain: 0.5,
        repeat: { count: [8, 12], every: [0.03, 0.075], fade: 0.93 },
      },
      {
        src: noise('white'),
        env: { a: 0.001, d: 0.012 },
        gain: 0.25,
        filters: [bp(5000, 1)],
        repeat: { count: [8, 12], every: [0.03, 0.075], fade: 0.93 },
      },
      {
        src: osc('triangle', 240),
        env: { a: 0.002, d: 0.06 },
        gain: 0.2,
        filters: [bp(300, 3)],
        repeat: { count: [2, 3], every: [0.15, 0.25] },
      },
    ],
  },
  /** Cage bars clank: a soft metallic FM ring over a dull hit. */
  cage_clank: {
    len: 1.2,
    level: 0.42,
    variants: 2,
    poly: 2,
    vary: { pitch: 1.5, volume: 0.1 },
    tone: 4500,
    reverb: { seconds: 0.8, decay: 3, mix: 0.15 },
    layers: [
      {
        src: osc('sine', [290, 320], { fm: { ratio: 2.76, index: 3, indexEnd: 0.2 } }),
        env: { a: 0.001, d: 0.7 },
        gain: 0.7,
      },
      { src: osc('sine', [780, 860]), env: { a: 0.001, d: 0.35 }, gain: 0.25 },
      { src: noise('pink'), env: { a: 0.001, d: 0.03 }, gain: 0.5, filters: [bp(1800, 1.5)] },
      { src: noise('brown'), env: { a: 0.002, d: 0.06 }, gain: 0.4, filters: [lp(400)] },
    ],
  },
};
