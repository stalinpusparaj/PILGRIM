/** UI: tiny, pleasant, quiet. */
import { chime, osc, type RecipeTable } from './recipes-kit';

type UiId = 'ui_click' | 'ui_open' | 'ui_close' | 'ui_toast' | 'ui_choice';

export const UI_RECIPES: RecipeTable<UiId> = {
  /** Soft wooden tick. */
  ui_click: {
    len: 0.12,
    level: 0.22,
    poly: 4,
    vary: { pitch: 0.5 },
    tone: 7000,
    layers: [
      {
        src: osc('sine', 1250, {
          bend: [
            [0, 2],
            [0.02, 0],
          ],
        }),
        env: { a: 0.001, d: 0.035 },
        gain: 0.7,
      },
      { src: osc('triangle', 600), env: { a: 0.001, d: 0.02 }, gain: 0.3 },
    ],
  },
  /** Rising "boop" with a little sparkle. */
  ui_open: {
    len: 0.4,
    level: 0.26,
    poly: 2,
    tone: 6000,
    layers: [
      {
        src: osc('sine', 520, {
          bend: [
            [0, 0],
            [0.09, 7],
          ],
        }),
        env: { a: 0.004, h: 0.04, d: 0.15 },
        gain: 0.7,
      },
      { src: osc('triangle', 1560), at: 0.06, env: { a: 0.002, d: 0.12 }, gain: 0.12 },
    ],
  },
  /** Falling "boop". */
  ui_close: {
    len: 0.35,
    level: 0.24,
    poly: 2,
    tone: 5000,
    layers: [
      {
        src: osc('sine', 780, {
          bend: [
            [0, 0],
            [0.09, -7],
          ],
        }),
        env: { a: 0.004, h: 0.03, d: 0.13 },
        gain: 0.7,
      },
      {
        src: osc('triangle', 390, {
          bend: [
            [0, 0],
            [0.09, -7],
          ],
        }),
        env: { a: 0.004, d: 0.1 },
        gain: 0.2,
      },
    ],
  },
  /** Gentle "ding-ding" up a fourth. */
  ui_toast: {
    len: 1,
    level: 0.3,
    poly: 2,
    rate: 32000,
    tone: 8000,
    reverb: { seconds: 0.9, decay: 3, mix: 0.2 },
    layers: [...chime(1318.51, 0, 0.6, 0.5, 2, 0.8), ...chime(1760, 0.09, 0.6, 0.7, 2, 0.8)],
  },
  /** Soft marimba-like confirm. */
  ui_choice: {
    len: 0.4,
    level: 0.26,
    poly: 3,
    tone: 6000,
    layers: [
      {
        src: osc('sine', 880, { fm: { ratio: 4, index: 1.2, indexEnd: 0 } }),
        env: { a: 0.002, d: 0.22 },
        gain: 0.7,
      },
      { src: osc('sine', 440), env: { a: 0.002, d: 0.15 }, gain: 0.3 },
    ],
  },
};
