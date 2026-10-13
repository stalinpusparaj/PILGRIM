/** Places underfoot and at hand: the gate lock, the net, mud and water. */
import { bp, lp, noise, osc, type RecipeTable } from './recipes-kit';

type PlaceId = 'gate_grind' | 'net_drop' | 'mud_slurp' | 'splash';

export const PLACE_RECIPES: RecipeTable<PlaceId> = {
  /** Gate lock: a ratcheting grind that ends in a solid (but soft) clunk. */
  gate_grind: {
    len: 1.4,
    level: 0.38,
    variants: 2,
    poly: 1,
    tone: 3500,
    layers: [
      {
        src: osc('sawtooth', [50, 58], {
          bend: [
            [0, 0],
            [0.7, 3],
          ],
        }),
        env: { a: 0.08, h: 0.45, d: 0.2 },
        gain: 1,
        trem: { rate: [26, 32], depth: 0.9 },
        filters: [bp(650, 2.5, [[0.7, 1050]])],
      },
      {
        src: noise('pink'),
        env: { a: 0.08, h: 0.45, d: 0.2 },
        gain: 0.4,
        trem: { rate: 13, depth: 0.6 },
        filters: [bp(1500, 3)],
      },
      {
        src: osc('sine', 130, {
          bend: [
            [0, 4],
            [0.05, 0],
          ],
        }),
        at: 0.8,
        env: { a: 0.003, d: 0.15 },
        gain: 0.4,
      },
      { src: noise('brown'), at: 0.8, env: { a: 0.003, d: 0.08 }, gain: 0.35, filters: [lp(700)] },
      {
        src: osc('sine', 900, { fm: { ratio: 2.4, index: 1.5, indexEnd: 0 } }),
        at: 0.8,
        env: { a: 0.002, d: 0.2 },
        gain: 0.1,
      },
    ],
  },
  /** A rope net whooshes down and flops over. */
  net_drop: {
    len: 1,
    level: 0.42,
    variants: 2,
    poly: 1,
    tone: 3000,
    layers: [
      {
        src: noise('pink'),
        env: { a: 0.08, d: 0.25 },
        gain: 0.6,
        filters: [
          bp(600, 1.2, [
            [0.15, 1400],
            [0.3, 500],
          ]),
        ],
      },
      { src: noise('brown'), at: 0.28, env: { a: 0.005, d: 0.22 }, gain: 1, filters: [lp(600)] },
      {
        src: noise('pink'),
        at: 0.3,
        env: { a: 0.002, d: 0.04 },
        gain: 0.35,
        filters: [bp(1100, 2)],
        repeat: { count: [3, 5], every: [0.03, 0.06], fade: 0.8 },
      },
      {
        src: osc('sine', 85, {
          bend: [
            [0, 3],
            [0.05, 0],
          ],
        }),
        at: 0.28,
        env: { a: 0.004, d: 0.12 },
        gain: 0.45,
      },
    ],
  },
  /** Squelchy slurp: a rising resonant suck with bubble pops. */
  mud_slurp: {
    len: 0.9,
    level: 0.45,
    variants: 3,
    poly: 2,
    vary: { pitch: 1.5, volume: 0.1 },
    tone: 3500,
    layers: [
      {
        src: noise('pink'),
        env: { a: 0.04, h: 0.18, d: 0.18 },
        gain: 1,
        filters: [
          bp(250, 6, [
            [0.18, 500],
            [0.38, 1300],
          ]),
          lp(2000),
        ],
      },
      {
        src: osc('sine', 150, {
          bend: [
            [0, 0],
            [0.2, 4],
            [0.38, 14],
          ],
        }),
        env: { a: 0.05, h: 0.15, d: 0.18 },
        gain: 0.3,
        trem: { rate: 18, depth: 0.5 },
        filters: [lp(1200)],
      },
      {
        src: osc('sine', [350, 550], {
          bend: [
            [0, 0],
            [0.025, 8],
          ],
        }),
        at: [0.3, 0.38],
        env: { a: 0.002, d: 0.035 },
        gain: 0.3,
        repeat: { count: [2, 3], every: [0.04, 0.08], step: [2, 4] },
      },
    ],
  },
  /** Splash: spray, body and droplets. */
  splash: {
    len: 1,
    level: 0.48,
    variants: 3,
    poly: 3,
    vary: { pitch: 1.5, volume: 0.1 },
    tone: 6500,
    layers: [
      { src: noise('white'), env: { a: 0.006, d: 0.45 }, gain: 0.7, filters: [bp(2800, 0.8, [[0.4, 900]])] },
      { src: noise('brown'), env: { a: 0.004, d: 0.2 }, gain: 0.8, filters: [lp(500)] },
      {
        src: osc('sine', [700, 1500], {
          bend: [
            [0, 0],
            [0.02, 8],
          ],
        }),
        at: [0.12, 0.18],
        env: { a: 0.002, d: 0.035 },
        gain: 0.2,
        repeat: { count: [4, 6], every: [0.04, 0.1], fade: 0.8 },
      },
      {
        src: osc('sine', 180, {
          bend: [
            [0, 6],
            [0.08, 0],
          ],
        }),
        env: { a: 0.003, d: 0.1 },
        gain: 0.3,
      },
    ],
  },
};
