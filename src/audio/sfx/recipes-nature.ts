/** Weather and creatures: soft thunder, frogs, sheep, snores, town bells, birds. */
import { bell, bp, hp, lp, noise, osc, pk, type RecipeTable } from './recipes-kit';

type NatureId = 'thunder' | 'frog_croak' | 'sheep_baa' | 'snore' | 'bells' | 'bird_chirp';

const CROAK = { count: 2, every: [0.16, 0.2], step: [2, 3], sync: 'croak' } as const;

export const NATURE_RECIPES: RecipeTable<NatureId> = {
  /** A far-off rolling rumble that swells in. No crack, nothing sharp. */
  thunder: {
    len: 5,
    level: 0.55,
    variants: 2,
    poly: 1,
    tone: 700,
    reverb: { seconds: 2.5, decay: 2, mix: 0.35 },
    layers: [
      {
        src: noise('brown'),
        env: { a: 0.45, h: 0.8, d: 2.6 },
        gain: 1,
        trem: { rate: [2.5, 4.5], depth: 0.45 },
        filters: [
          lp(150, -3, [
            [0.6, 380],
            [3.5, 160],
          ]),
        ],
      },
      {
        src: noise('brown'),
        at: 0.3,
        env: { a: 0.15, d: [0.5, 0.8] },
        gain: 0.6,
        filters: [lp(260)],
        repeat: { count: [3, 4], every: [0.35, 0.7], fade: 0.75 },
      },
      {
        src: osc('sine', 38, {
          bend: [
            [0, 2],
            [3, -2],
          ],
        }),
        env: { a: 0.5, h: 0.5, d: 2 },
        gain: 0.35,
      },
    ],
  },
  /** "Rib-bit": two throaty pulse-train croaks, the second a little higher. */
  frog_croak: {
    len: 0.6,
    level: 0.38,
    variants: 4,
    poly: 3,
    vary: { pitch: 3, volume: 0.2 },
    tone: 3500,
    layers: [
      {
        src: osc('sawtooth', [95, 120], {
          bend: [
            [0, -1],
            [0.1, 2],
          ],
        }),
        env: { a: 0.01, h: 0.04, d: 0.08 },
        gain: 1,
        trem: { rate: [30, 40], depth: 1 },
        filters: [bp(700, 3), lp(1800)],
        repeat: CROAK,
      },
      {
        src: osc('sine', [180, 220]),
        env: { a: 0.01, h: 0.04, d: 0.08 },
        gain: 0.3,
        trem: { rate: 35, depth: 0.8 },
        repeat: CROAK,
      },
    ],
  },
  /** A wobbly, friendly "baa". */
  sheep_baa: {
    len: 1,
    level: 0.42,
    variants: 3,
    poly: 2,
    vary: { pitch: 2, volume: 0.15 },
    tone: 3000,
    layers: [
      {
        src: osc('sawtooth', [240, 290], {
          unison: { count: 2, cents: 6 },
          bend: [
            [0, -3],
            [0.08, 0],
            [0.6, -1.5],
          ],
          vib: { rate: [6, 8], depth: 0.5 },
        }),
        env: { a: 0.05, h: 0.3, d: 0.35 },
        gain: 1,
        trem: { rate: [8, 10], depth: 0.4 },
        filters: [bp(850, 1.3), pk(1250, 3, 8), lp(2400)],
      },
      { src: noise('pink'), env: { a: 0.05, h: 0.2, d: 0.3 }, gain: 0.05, filters: [bp(2500, 2)] },
    ],
  },
  /** Cartoon snore: a rattly inhale, then a "pfeeew" with a tiny whistle. */
  snore: {
    len: 3,
    level: 0.3,
    variants: 2,
    poly: 1,
    tone: 3000,
    layers: [
      {
        src: osc('sawtooth', [52, 60]),
        env: { a: 0.6, h: 0.3, d: 0.35 },
        gain: 0.8,
        trem: { rate: [22, 28], depth: 0.85 },
        filters: [bp(350, 2), lp(900)],
      },
      { src: noise('pink'), env: { a: 0.6, h: 0.3, d: 0.35 }, gain: 0.4, filters: [bp(500, 1.5)] },
      {
        src: noise('pink'),
        at: 1.4,
        env: { a: 0.12, h: 0.2, d: 0.7 },
        gain: 0.45,
        filters: [bp(1800, 1), hp(700)],
      },
      {
        src: osc('sine', 1300, {
          bend: [
            [0, 0],
            [0.9, -5],
          ],
        }),
        at: 1.45,
        env: { a: 0.1, h: 0.2, d: 0.6 },
        gain: 0.12,
      },
    ],
  },
  /** Town bells: ding, dong, dang (G, E, C), warm and roomy. */
  bells: {
    len: 4,
    level: 0.45,
    poly: 1,
    tone: 6000,
    reverb: { seconds: 2.5, decay: 2.5, mix: 0.35 },
    layers: [...bell(783.99, 0, 0.8, 2.2), ...bell(659.26, 0.45, 0.8, 2.2), ...bell(523.25, 0.9, 0.85, 2.6)],
  },
  /** A small bird: two to four quick chirps. */
  bird_chirp: {
    len: 0.6,
    level: 0.28,
    variants: 4,
    poly: 3,
    vary: { pitch: 2, volume: 0.2 },
    rate: 32000,
    tone: 9000,
    layers: [
      {
        src: osc('sine', [2600, 3200], {
          bend: [
            [0, -4],
            [0.035, 4],
            [0.06, -1],
          ],
        }),
        env: { a: 0.004, d: [0.05, 0.07] },
        gain: 0.8,
        repeat: { count: [2, 4], every: [0.08, 0.12], step: [-2, 2], fade: 0.9 },
      },
    ],
  },
};
