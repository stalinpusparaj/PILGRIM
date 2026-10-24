/**
 * What each chapter's diorama shows (Diorama.ts, DECISIONS #396): its palette and a few landmark props from the
 * prop kit, placed on a little hill with the Way winding through. Coordinates are diorama space (metres, the
 * camera looks down -Z from +Z), not level coordinates: these are picture compositions, not worlds.
 */
import type { PaletteId } from './palette';

/** [prop type, x, z, rotY, scale, params?] */
export type DioramaProp = [string, number, number, number, number, Record<string, number | string | boolean>?];

export interface DioramaRecipe {
  palette: PaletteId;
  seed: number;
  props: DioramaProp[];
  /** A glowing light far away (the horizon light, the Celestial City), as [x, y, z, radius, palette accent]. */
  glow?: [number, number, number, number, string];
  /** Hill colours lean on this ground key (default 'mid'). */
  ground?: 'low' | 'mid' | 'high';
}

export const DIORAMAS: Record<number, DioramaRecipe> = {
  1: {
    palette: 'city', seed: 101,
    props: [['house_a', -6, -4, 0.4, 0.9], ['house_b', -9.5, -9, 0.2, 0.9], ['house_c', 6.5, -6, -0.5, 0.9],
      ['house_a', 9, -12, -0.3, 0.8], ['wall', -3, -15, 0, 1], ['gate', 2.5, -15, 0, 1], ['barrel', 3.5, 1, 0, 1]],
    glow: [10, 7, -60, 1.6, 'horizonLight'],
  },
  2: {
    palette: 'slough', seed: 202,
    props: [['reeds', -4, 2, 0, 2.4], ['reeds', 5, 0, 1, 2.6], ['reeds', -7, -6, 2, 2.2], ['reeds', 7, -8, 0.5, 2.4], ['reeds', -2, -10, 1, 2], ['reeds', 3, -14, 2, 2.2],
      ['rock', -2.5, 5, 0, 0.8], ['tree_dead', -10, -14, 0.3, 1.1], ['lily', 2.5, 3, 0, 1]],
    ground: 'low',
  },
  3: {
    palette: 'wrongHill', seed: 303,
    props: [['mountain_peak', 12, -50, 0, 0.32], ['tree_round', -7, -5, 0, 1], ['tree_round', -10, -10, 0, 0.9],
      ['house_b', 12, -12, -0.6, 0.7], ['sign', 3, 2, -0.4, 1], ['bush', -4, 3, 0, 1]],
  },
  4: {
    palette: 'wicketGate', seed: 404,
    props: [['wall', -6, -8, 0, 1.2], ['wicket_gate', 0, -8, 0, 1.2], ['wall', 6, -8, 0, 1.2],
      ['castle_tower', -11, -30, 0, 0.45], ['rock', 4, 1, 0, 1], ['rock', -4, -2, 1, 0.8]],
  },
  5: {
    palette: 'interpreter', seed: 505,
    props: [['house_c', 0, -9, 0, 1.2], ['lamp', -3.5, -2, 0, 1], ['lamp', 3.5, -2, 0, 1], ['bush', -7, -5, 0, 1],
      ['bush', 7, -6, 0, 1], ['bench', -5, 2, 0.6, 1]],
  },
  6: {
    palette: 'cross', seed: 606,
    props: [['cross', 0, -11, 0, 1.4], ['tomb', 5, -5, -0.5, 1], ['wall', -5, -2, 0.25, 0.9], ['wall', 5, 2, -0.25, 0.9],
      ['flower', -2, 3, 0, 1.2], ['flower', 3, 4, 0, 1.2]],
  },
  7: {
    palette: 'hill', seed: 707,
    props: [['palace_tower', 3, -20, 0, 1.4], ['palace_tower', -3, -22, 0, 1.1], ['arbour', -6, -4, 0.6, 1],
      ['tree_cone', 7, -6, 0, 1], ['tree_cone', -10, -10, 0, 1.1], ['well', 4, 2, 0, 0.9]],
  },
  8: {
    palette: 'humiliation', seed: 808,
    props: [['rock', -5, -4, 0, 1.6], ['rock', 6, -7, 1, 2], ['rock', 2, 2, 2, 0.9], ['tree_dead', -9, -12, 0.4, 1.1],
      ['mountain_peak', 0, -52, 0, 0.3]],
    ground: 'low',
  },
  9: {
    palette: 'shadow', seed: 909,
    props: [['tree_dead', -6, -4, 0.5, 1.2], ['tree_dead', 7, -8, 2, 1.1], ['rock', 3, 1, 0, 1], ['lamp', -2.5, 2, 0, 1]],
    glow: [-6, 4, -40, 1.2, 'embers'],
  },
  10: {
    palette: 'vanity', seed: 1010,
    props: [['stall', -5.5, -5, 0.4, 1], ['stall', 5.5, -5, -0.4, 1], ['stall', 0, -11, 0, 1], ['flag', -8, -10, 0, 1.2],
      ['flag', 8, -10, 0, 1.2], ['barrel', 3, 1, 0, 1], ['crate', -3, 2, 0.3, 1]],
  },
  11: {
    palette: 'doubting', seed: 1111,
    props: [['castle_tower', -3, -24, 0, 0.55], ['castle_tower', 4, -26, 0, 0.48], ['stile', 0, 1, 0, 1],
      ['tree_dead', -9, -6, 0.2, 1], ['fence', 6, -2, -0.2, 1]],
  },
  12: {
    palette: 'delectable', seed: 1212,
    props: [['mountain_peak', -10, -52, 0, 0.3], ['mountain_peak', 12, -56, 0, 0.26], ['tree_fruit', -6, -5, 0, 1],
      ['tree_fruit', 7, -7, 0, 1], ['vine_row', 0, -12, 0, 1], ['bush', 4, 2, 0, 1]],
  },
  13: {
    palette: 'river', seed: 1313,
    props: [['palace_tower', 0, -34, 0, 1.6], ['palace_tower', -5, -33, 0, 1.2], ['palace_tower', 5, -33, 0, 1.2],
      ['flower', -4, 2, 0, 1.3], ['flower', 4, 3, 0, 1.3], ['tree_round', -9, -6, 0, 1]],
    glow: [0, 9, -36, 2.4, 'cityGlow'],
  },
  14: {
    palette: 'epilogue', seed: 1414,
    props: [['house_a', -2, -8, 0.2, 1.1], ['lamp', 3, -3, 0, 1], ['fence', -6, -2, 0.3, 1], ['flower', 2, 2, 0, 1.2]],
    glow: [10, 7, -60, 1.6, 'horizonLight'],
  },
};
