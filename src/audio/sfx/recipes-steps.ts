/** Footsteps per surface, jump and land: short, quiet, four variants each so walking never machine-guns. */
import { bp, hp, lp, noise, osc, type RecipeTable } from './recipes-kit';

type StepId =
  'step_dirt' | 'step_stone' | 'step_mud' | 'step_wood' | 'step_grass' | 'step_water' | 'jump' | 'land';

const STEP = { variants: 4, poly: 3, vary: { pitch: 1.5, volume: 0.25 } } as const;

export const STEP_RECIPES: RecipeTable<StepId> = {
  /** Soft earthy thud with a little grit. */
  step_dirt: {
    ...STEP,
    len: 0.3,
    level: 0.26,
    tone: 5000,
    layers: [
      {
        src: osc('sine', [85, 105], {
          bend: [
            [0, 3],
            [0.05, 0],
          ],
        }),
        env: { a: 0.002, d: [0.06, 0.08] },
        gain: 0.7,
      },
      { src: noise('brown'), env: { a: 0.003, d: [0.07, 0.1] }, gain: 0.9, filters: [lp([700, 1000])] },
      {
        src: noise('white'),
        env: { a: 0.002, d: 0.03 },
        gain: 0.12,
        filters: [bp([2500, 3500], 1.2)],
        repeat: { count: [2, 3], every: [0.012, 0.025], fade: 0.6 },
      },
    ],
  },
  /** Leafy swish over a soft press. */
  step_grass: {
    ...STEP,
    len: 0.3,
    level: 0.22,
    tone: 6500,
    layers: [
      {
        src: noise('pink'),
        env: { a: [0.008, 0.015], d: [0.1, 0.14] },
        gain: 0.55,
        filters: [bp([1800, 2600], 0.9), hp(600)],
      },
      { src: noise('brown'), env: { a: 0.002, d: 0.06 }, gain: 0.6, filters: [lp(350)] },
      {
        src: noise('white'),
        env: { a: 0.002, d: 0.02 },
        gain: 0.12,
        filters: [bp([3500, 4500], 2)],
        repeat: { count: [2, 4], every: [0.015, 0.03], fade: 0.7 },
      },
    ],
  },
  /** Light tap with a pebbly click. */
  step_stone: {
    ...STEP,
    len: 0.25,
    level: 0.24,
    tone: 5500,
    layers: [
      {
        src: osc('sine', [210, 250], {
          bend: [
            [0, 2],
            [0.03, 0],
          ],
        }),
        env: { a: 0.001, d: 0.05 },
        gain: 0.45,
      },
      {
        src: noise('white'),
        env: { a: 0.001, d: [0.025, 0.035] },
        gain: 0.6,
        filters: [bp([1800, 2400], 1.5)],
      },
      { src: noise('brown'), env: { a: 0.002, d: 0.05 }, gain: 0.5, filters: [lp(500)] },
      {
        src: noise('white'),
        env: { a: 0.001, d: 0.012 },
        gain: 0.1,
        filters: [hp(3000)],
        at: 0.015,
        repeat: { count: [1, 3], every: [0.02, 0.04], fade: 0.5 },
      },
    ],
  },
  /** Hollow boardwalk knock. */
  step_wood: {
    ...STEP,
    len: 0.3,
    level: 0.27,
    tone: 4500,
    layers: [
      {
        src: osc('triangle', [150, 175], {
          bend: [
            [0, 3],
            [0.04, 0],
          ],
        }),
        env: { a: 0.001, d: [0.09, 0.12] },
        gain: 0.9,
        filters: [bp(320, 2.5)],
      },
      { src: osc('sine', [300, 340]), env: { a: 0.001, d: 0.05 }, gain: 0.25 },
      { src: noise('pink'), env: { a: 0.001, d: 0.02 }, gain: 0.5, filters: [bp([1000, 1300], 2)] },
    ],
  },
  /** Squelch: a resonant wah through soft noise, a dull thud and a tiny bubble pop. */
  step_mud: {
    ...STEP,
    len: 0.35,
    level: 0.27,
    tone: 3500,
    layers: [
      {
        src: noise('pink'),
        env: { a: 0.01, h: 0.03, d: 0.1 },
        gain: 1,
        filters: [
          bp(350, 5, [
            [0.06, [800, 1000]],
            [0.14, 450],
          ]),
        ],
      },
      {
        src: osc('sine', [80, 95], {
          bend: [
            [0, 2],
            [0.06, -2],
          ],
        }),
        env: { a: 0.004, d: 0.08 },
        gain: 0.5,
      },
      {
        src: osc('sine', [400, 550], {
          bend: [
            [0, 0],
            [0.03, 7],
          ],
        }),
        at: [0.07, 0.11],
        env: { a: 0.002, d: 0.035 },
        gain: 0.18,
      },
    ],
  },
  /** Shallow splash with a plip. */
  step_water: {
    ...STEP,
    len: 0.35,
    level: 0.25,
    tone: 6000,
    layers: [
      {
        src: noise('white'),
        env: { a: 0.004, d: [0.12, 0.16] },
        gain: 0.7,
        filters: [bp([900, 1100], 1.2, [[0.1, 2600]]), hp(400)],
      },
      { src: noise('brown'), env: { a: 0.002, d: 0.05 }, gain: 0.5, filters: [lp(600)] },
      {
        src: osc('sine', [700, 1000], {
          bend: [
            [0, 0],
            [0.04, 9],
          ],
        }),
        at: [0.03, 0.07],
        env: { a: 0.002, d: 0.04 },
        gain: 0.2,
        repeat: { count: [1, 2], every: [0.03, 0.06], step: [2, 5] },
      },
    ],
  },
  /** A soft rising "hup" with a little air. */
  jump: {
    len: 0.3,
    level: 0.28,
    variants: 3,
    poly: 2,
    vary: { pitch: 1, volume: 0.15 },
    tone: 5000,
    layers: [
      {
        src: osc('sine', [280, 320], {
          bend: [
            [0, -2],
            [0.12, 6],
          ],
        }),
        env: { a: 0.006, d: 0.13 },
        gain: 0.45,
        filters: [lp(2000)],
      },
      { src: noise('pink'), env: { a: 0.02, d: 0.1 }, gain: 0.4, filters: [bp(700, 1.2, [[0.12, 1800]])] },
    ],
  },
  /** Soft thump and a puff of dust. */
  land: {
    len: 0.35,
    level: 0.32,
    variants: 3,
    poly: 2,
    vary: { pitch: 1.5, volume: 0.15 },
    tone: 4000,
    layers: [
      { src: noise('brown'), env: { a: 0.003, d: 0.12 }, gain: 0.9, filters: [lp(500)] },
      {
        src: osc('sine', [95, 110], {
          bend: [
            [0, 3],
            [0.08, -1],
          ],
        }),
        env: { a: 0.003, d: 0.1 },
        gain: 0.6,
      },
      { src: noise('pink'), env: { a: 0.01, d: 0.15 }, gain: 0.18, filters: [bp(1800, 0.8)] },
    ],
  },
};
