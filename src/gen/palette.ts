/**
 * Chapter palettes. Every colour in a chapter comes from here (GDD 2.12). The named accents are the exact hex
 * values from GDD 2.10; the rest (sky gradient, fog, ground bands) are derived to sit in harmony with them.
 */
import * as THREE from 'three';
import { colorOf } from './geom';

export type PaletteId =
  | 'title'
  | 'test'
  | 'city'
  | 'slough'
  | 'wrongHill'
  | 'wicketGate'
  | 'interpreter'
  | 'cross'
  | 'hill'
  | 'humiliation'
  | 'shadow'
  | 'vanity'
  | 'doubting'
  | 'delectable'
  | 'river'
  | 'epilogue';

export interface Palette {
  id: PaletteId;
  sky: { top: string; horizon: string; bottom: string; sun: string };
  fog: { color: string; near: number; far: number };
  light: {
    sun: string;
    sunIntensity: number;
    sunDir: [number, number, number];
    hemiSky: string;
    hemiGround: string;
    hemiIntensity: number;
  };
  ground: {
    low: string;
    mid: string;
    high: string;
    slope: string;
    path: string;
    pathEdge: string;
    detour: string;
  };
  water: { shallow: string; deep: string };
  /** GDD 2.10 named colours for this chapter, e.g. accents.horizonLight. */
  accents: Record<string, string>;
}

/** GDD 2.11 skin tones. Heroes and villains are spread across all of them (GDD 1.6, 2.16 rule 5). */
export const SKIN_TONES = ['#F1C7A3', '#E0A57A', '#C68A5E', '#9C6644', '#6E4A33'] as const;

const SUN_HIGH: [number, number, number] = [0.45, 0.8, 0.35];
const SUN_LOW: [number, number, number] = [0.8, 0.35, 0.2];

export const PALETTES: Record<PaletteId, Palette> = {
  title: {
    id: 'title',
    sky: { top: '#5E6FA8', horizon: '#F2C9A0', bottom: '#E8B98F', sun: '#FFE8A3' },
    fog: { color: '#E9C3A2', near: 60, far: 320 },
    light: {
      sun: '#FFE2B8',
      sunIntensity: 2.2,
      sunDir: SUN_LOW,
      hemiSky: '#C9D6F0',
      hemiGround: '#8A7A5A',
      hemiIntensity: 1.1,
    },
    ground: {
      low: '#8DBF6A',
      mid: '#7FAF5F',
      high: '#A7B98A',
      slope: '#9C8F78',
      path: '#E8D3A3',
      pathEdge: '#BFAF8C',
      detour: '#9FB0A8',
    },
    water: { shallow: '#8FC9D9', deep: '#3F7F9C' },
    accents: { horizonLight: '#FFE8A3' },
  },
  test: {
    id: 'test',
    sky: { top: '#6FA8DC', horizon: '#CFE6F2', bottom: '#E6EEDC', sun: '#FFF4D6' },
    fog: { color: '#CFE2E8', near: 60, far: 300 },
    light: {
      sun: '#FFF1DC',
      sunIntensity: 2.4,
      sunDir: SUN_HIGH,
      hemiSky: '#CFE6F2',
      hemiGround: '#7A8A5A',
      hemiIntensity: 1.1,
    },
    ground: {
      low: '#8DBF6A',
      mid: '#7FB05C',
      high: '#A9B98C',
      slope: '#9A8C74',
      path: '#E8D3A3',
      pathEdge: '#BCA987',
      detour: '#93A9A6',
    },
    water: { shallow: '#8FC9D9', deep: '#3F7F9C' },
    accents: {},
  },
  // CHAPTER I — dusk orange #E8A26B, plum sky #6B4A5E, stone #8C8577, timber #6E5D50, horizon light #FFE8A3
  city: {
    id: 'city',
    sky: { top: '#6B4A5E', horizon: '#E8A26B', bottom: '#C98A66', sun: '#FFE8A3' },
    fog: { color: '#B9876F', near: 35, far: 230 },
    light: {
      sun: '#F2B47E',
      sunIntensity: 1.8,
      sunDir: SUN_LOW,
      hemiSky: '#B98A8E',
      hemiGround: '#5E4E44',
      hemiIntensity: 1.0,
    },
    ground: {
      low: '#8F8A62',
      mid: '#86805C',
      high: '#9C9474',
      slope: '#8C8577',
      path: '#D9B98C',
      pathEdge: '#8C8577',
      detour: '#8E8C80',
    },
    water: { shallow: '#8A9AA0', deep: '#4E5A66' },
    accents: {
      dusk: '#E8A26B',
      plum: '#6B4A5E',
      stone: '#8C8577',
      timber: '#6E5D50',
      horizonLight: '#FFE8A3',
    },
  },
  // CHAPTER II — mud #5B4A35, reeds #8A8B5A, sky #9AA3A0, steps glow #F5E6B8
  slough: {
    id: 'slough',
    sky: { top: '#7F8986', horizon: '#9AA3A0', bottom: '#A7ACA2', sun: '#E6E2D0' },
    fog: { color: '#98A09C', near: 25, far: 170 },
    light: {
      sun: '#E8E4D4',
      sunIntensity: 1.4,
      sunDir: SUN_HIGH,
      hemiSky: '#A9B2AE',
      hemiGround: '#4E4230',
      hemiIntensity: 1.2,
    },
    ground: {
      low: '#5B4A35',
      mid: '#6E6A45',
      high: '#80834F',
      slope: '#6A5C44',
      path: '#C9B184',
      pathEdge: '#8A7A5C',
      detour: '#7A7A66',
    },
    water: { shallow: '#6E5B40', deep: '#4A3B29' },
    accents: { mud: '#5B4A35', reeds: '#8A8B5A', sky: '#9AA3A0', stepsGlow: '#F5E6B8' },
  },
  // CHAPTER III — hills #8DBF6A, sky #A9D3E8, mountain #5E4B5C, fire flashes #FF8A3D
  wrongHill: {
    id: 'wrongHill',
    sky: { top: '#6FAFD6', horizon: '#A9D3E8', bottom: '#D8EADF', sun: '#FFF4D6' },
    fog: { color: '#BFDCE6', near: 60, far: 320 },
    light: {
      sun: '#FFF0D6',
      sunIntensity: 2.4,
      sunDir: SUN_HIGH,
      hemiSky: '#BFE0F0',
      hemiGround: '#6A8A4A',
      hemiIntensity: 1.1,
    },
    ground: {
      low: '#8DBF6A',
      mid: '#7FB35E',
      high: '#9BC77A',
      slope: '#8E8A6E',
      path: '#E6CF9C',
      pathEdge: '#B8A47E',
      detour: '#C7D9B8',
    },
    water: { shallow: '#8FC9D9', deep: '#3F7F9C' },
    accents: { hills: '#8DBF6A', sky: '#A9D3E8', mountain: '#5E4B5C', fire: '#FF8A3D' },
  },
  // CHAPTER IV — wall #C9BBA0, gate #8A5A3B, castle #3E3548, safe light #FFF2C2
  wicketGate: {
    id: 'wicketGate',
    sky: { top: '#7A86A8', horizon: '#D9CDB4', bottom: '#CFC2A8', sun: '#FFF2C2' },
    fog: { color: '#C9BFAE', near: 40, far: 240 },
    light: {
      sun: '#FFEFCF',
      sunIntensity: 2.0,
      sunDir: SUN_HIGH,
      hemiSky: '#C4C8D8',
      hemiGround: '#6E6050',
      hemiIntensity: 1.1,
    },
    ground: {
      low: '#8FA86A',
      mid: '#86985F',
      high: '#9C9C78',
      slope: '#8C8270',
      path: '#E3CFA3',
      pathEdge: '#B9A98A',
      detour: '#9AA39A',
    },
    water: { shallow: '#8FB9C9', deep: '#46708A' },
    accents: { wall: '#C9BBA0', gate: '#8A5A3B', castle: '#3E3548', safeLight: '#FFF2C2' },
  },
  // CHAPTER V — candle #F2C98A, wood #8B5A3C, warm red #B5523B
  interpreter: {
    id: 'interpreter',
    sky: { top: '#2E2A3E', horizon: '#6B4F52', bottom: '#4A3A36', sun: '#F2C98A' },
    fog: { color: '#3E302C', near: 20, far: 90 },
    light: {
      sun: '#F2C98A',
      sunIntensity: 1.2,
      sunDir: SUN_HIGH,
      hemiSky: '#F2C98A',
      hemiGround: '#5A3A2A',
      hemiIntensity: 0.9,
    },
    ground: {
      low: '#8B5A3C',
      mid: '#7E5236',
      high: '#9A6A48',
      slope: '#6E4A32',
      path: '#C99A6A',
      pathEdge: '#8B5A3C',
      detour: '#7A6458',
    },
    water: { shallow: '#8FB9C9', deep: '#46708A' },
    accents: { candle: '#F2C98A', wood: '#8B5A3C', warmRed: '#B5523B' },
  },
  // CHAPTER VI — dawn #F7C9A8 → #FFE9A8, grass #9ED26A, cross #A0703F, tomb #B9B3A6
  cross: {
    id: 'cross',
    sky: { top: '#9DB8DE', horizon: '#F7C9A8', bottom: '#FFE9A8', sun: '#FFF3C9' },
    fog: { color: '#F5D9BE', near: 50, far: 280 },
    light: {
      sun: '#FFE4BE',
      sunIntensity: 2.2,
      sunDir: SUN_LOW,
      hemiSky: '#FFE9C8',
      hemiGround: '#7AA050',
      hemiIntensity: 1.2,
    },
    ground: {
      low: '#9ED26A',
      mid: '#92C760',
      high: '#A9D87C',
      slope: '#A8A07E',
      path: '#EED8A8',
      pathEdge: '#C4B08A',
      detour: '#B8CFA8',
    },
    water: { shallow: '#9FD3E0', deep: '#4F8CA6' },
    accents: { dawnA: '#F7C9A8', dawnB: '#FFE9A8', grass: '#9ED26A', cross: '#A0703F', tomb: '#B9B3A6' },
  },
  // CHAPTER VII — hill green #7FBF5F, dusk #8C7BC4, palace #F4EEE2, blue roofs #6C8FB3
  hill: {
    id: 'hill',
    sky: { top: '#6F62A8', horizon: '#8C7BC4', bottom: '#E7B9A4', sun: '#FFE0B8' },
    fog: { color: '#A99BC9', near: 50, far: 280 },
    light: {
      sun: '#FFD9B0',
      sunIntensity: 1.9,
      sunDir: SUN_LOW,
      hemiSky: '#B9AEE0',
      hemiGround: '#5F8A48',
      hemiIntensity: 1.1,
    },
    ground: {
      low: '#7FBF5F',
      mid: '#72B055',
      high: '#8CC46E',
      slope: '#8E8670',
      path: '#E6CF9C',
      pathEdge: '#B8A47E',
      detour: '#7E8C86',
    },
    water: { shallow: '#8FC9D9', deep: '#3F7F9C' },
    accents: { hillGreen: '#7FBF5F', dusk: '#8C7BC4', palace: '#F4EEE2', roofs: '#6C8FB3' },
  },
  // CHAPTER VIII — valley #7FAF6A → sky #5B4A7A, fire #FF7A2F, Apollyon teal #3F6F78, wings #8C2F39
  humiliation: {
    id: 'humiliation',
    sky: { top: '#5B4A7A', horizon: '#A98FB0', bottom: '#C9B4A8', sun: '#FFD9A8' },
    fog: { color: '#8E7FA0', near: 40, far: 230 },
    light: {
      sun: '#FFD2A8',
      sunIntensity: 1.8,
      sunDir: SUN_LOW,
      hemiSky: '#A99BC4',
      hemiGround: '#5A7A4A',
      hemiIntensity: 1.1,
    },
    ground: {
      low: '#7FAF6A',
      mid: '#749F60',
      high: '#8AA878',
      slope: '#7E7468',
      path: '#DCC79A',
      pathEdge: '#A8977A',
      detour: '#7E8A80',
    },
    water: { shallow: '#8FB9C9', deep: '#46708A' },
    accents: { valley: '#7FAF6A', sky: '#5B4A7A', fire: '#FF7A2F', scales: '#3F6F78', wings: '#8C2F39' },
  },
  // CHAPTER IX — dark #14121C, lantern #FFD27A, embers #E2553A, dawn #9FB8D9
  shadow: {
    id: 'shadow',
    sky: { top: '#0C0B12', horizon: '#1E1A2A', bottom: '#14121C', sun: '#9FB8D9' },
    fog: { color: '#14121C', near: 6, far: 45 },
    light: {
      sun: '#6A6E8A',
      sunIntensity: 0.25,
      sunDir: SUN_HIGH,
      hemiSky: '#2A2838',
      hemiGround: '#0E0C14',
      hemiIntensity: 0.35,
    },
    ground: {
      low: '#2A2632',
      mid: '#33303C',
      high: '#3E3A46',
      slope: '#24212C',
      path: '#5A5246',
      pathEdge: '#3A3530',
      detour: '#2A2A30',
    },
    water: { shallow: '#2A2A38', deep: '#141420' },
    accents: { dark: '#14121C', lantern: '#FFD27A', embers: '#E2553A', dawn: '#9FB8D9' },
  },
  // CHAPTER X — pink #E64B8B, mustard #F2C230, violet #7B4FD6, teal #2EC4B6, night #22304A
  vanity: {
    id: 'vanity',
    sky: { top: '#5FA8E0', horizon: '#F6D6E6', bottom: '#F2E2C8', sun: '#FFF2C8' },
    fog: { color: '#EAD9E6', near: 50, far: 260 },
    light: {
      sun: '#FFEED8',
      sunIntensity: 2.4,
      sunDir: SUN_HIGH,
      hemiSky: '#E9DDF5',
      hemiGround: '#8A7A5A',
      hemiIntensity: 1.2,
    },
    ground: {
      low: '#A9C77A',
      mid: '#9DBB6E',
      high: '#B4C98E',
      slope: '#A09078',
      path: '#E8D3A3',
      pathEdge: '#C2A985',
      detour: '#C9A0C0',
    },
    water: { shallow: '#8FC9D9', deep: '#3F7F9C' },
    accents: { pink: '#E64B8B', mustard: '#F2C230', violet: '#7B4FD6', teal: '#2EC4B6', night: '#22304A' },
  },
  // CHAPTER XI — meadow #A6D96A, storm #39414F, castle #6F6A73, key gold #FFC94A
  doubting: {
    id: 'doubting',
    sky: { top: '#6FAFD6', horizon: '#CFE6E0', bottom: '#E0EBD0', sun: '#FFF4D6' },
    fog: { color: '#C9DCD8', near: 50, far: 280 },
    light: {
      sun: '#FFF0D6',
      sunIntensity: 2.2,
      sunDir: SUN_HIGH,
      hemiSky: '#CFE6F0',
      hemiGround: '#6A8A4A',
      hemiIntensity: 1.1,
    },
    ground: {
      low: '#A6D96A',
      mid: '#98CC5E',
      high: '#B0D884',
      slope: '#9A9080',
      path: '#E2CB98',
      pathEdge: '#A89A84',
      detour: '#B6E07E',
    },
    water: { shallow: '#8FD0E0', deep: '#3F86A6' },
    accents: { meadow: '#A6D96A', storm: '#39414F', castle: '#6F6A73', keyGold: '#FFC94A' },
  },
  // CHAPTER XII — green #8FD17E, sky #9FD8F5, sheep #F7F4EC, sleepy haze #E9B872
  delectable: {
    id: 'delectable',
    sky: { top: '#5FB4E6', horizon: '#9FD8F5', bottom: '#DDF0E8', sun: '#FFF6DC' },
    fog: { color: '#C6E6F2', near: 70, far: 360 },
    light: {
      sun: '#FFF2DA',
      sunIntensity: 2.5,
      sunDir: SUN_HIGH,
      hemiSky: '#CFEAF8',
      hemiGround: '#6FA05A',
      hemiIntensity: 1.15,
    },
    ground: {
      low: '#8FD17E',
      mid: '#82C472',
      high: '#9ED68E',
      slope: '#9C9688',
      path: '#ECD7A6',
      pathEdge: '#BFAE8C',
      detour: '#E9B872',
    },
    water: { shallow: '#9FD8F5', deep: '#4A90B8' },
    accents: { green: '#8FD17E', sky: '#9FD8F5', sheep: '#F7F4EC', haze: '#E9B872' },
  },
  // CHAPTER XIII — not specified in the GDD: warm Beulah light, flowers, a bright river (derived, see DECISIONS)
  river: {
    id: 'river',
    sky: { top: '#7FB8E8', horizon: '#FFE7B8', bottom: '#FFF3D6', sun: '#FFFFFF' },
    fog: { color: '#FCEBD0', near: 60, far: 340 },
    light: {
      sun: '#FFF1D2',
      sunIntensity: 2.6,
      sunDir: SUN_HIGH,
      hemiSky: '#FFF0D8',
      hemiGround: '#88B070',
      hemiIntensity: 1.3,
    },
    ground: {
      low: '#9CD47A',
      mid: '#90CA70',
      high: '#B2DC8E',
      slope: '#B8AE96',
      path: '#F2E2B8',
      pathEdge: '#D2BE96',
      detour: '#C9D9B8',
    },
    water: { shallow: '#9FDCEB', deep: '#3C7FA8' },
    accents: {
      cityGold: '#FFE7A0',
      flowersPink: '#F2A0C0',
      flowersBlue: '#9FB8F2',
      flowersYellow: '#FFE07A',
    },
  },
  // EPILOGUE — back in the City of Destruction, softer and a little hopeful
  epilogue: {
    id: 'epilogue',
    sky: { top: '#6B5A86', horizon: '#F0B47E', bottom: '#D9A27E', sun: '#FFE8A3' },
    fog: { color: '#C99A80', near: 35, far: 230 },
    light: {
      sun: '#F6C08A',
      sunIntensity: 1.9,
      sunDir: SUN_LOW,
      hemiSky: '#C9A0A4',
      hemiGround: '#5E4E44',
      hemiIntensity: 1.05,
    },
    ground: {
      low: '#8F8A62',
      mid: '#86805C',
      high: '#9C9474',
      slope: '#8C8577',
      path: '#D9B98C',
      pathEdge: '#8C8577',
      detour: '#8E8C80',
    },
    water: { shallow: '#8A9AA0', deep: '#4E5A66' },
    accents: {
      dusk: '#E8A26B',
      plum: '#6B4A5E',
      stone: '#8C8577',
      timber: '#6E5D50',
      horizonLight: '#FFE8A3',
      secret: '#2E3A6B',
    },
  },
};

export function getPalette(id: string): Palette {
  const p = (PALETTES as Record<string, Palette | undefined>)[id];
  if (!p) throw new Error(`Unknown palette "${id}"`);
  return p;
}

/** Cached linear THREE.Color for a hex (shared instance — do not mutate). */
export function color(hex: string): THREE.Color {
  return colorOf(hex);
}

function toHex(c: THREE.Color): string {
  return `#${c.getHexString()}`;
}

/** Lighten (amount > 0) or darken (amount < 0) in HSL lightness, -1..1. */
export function shade(hex: string, amount: number): string {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.min(1, Math.max(0, hsl.l + amount)));
  return toHex(c);
}

/** Linear mix in sRGB-ish space between two hexes. */
export function mix(a: string, b: string, t: number): string {
  return toHex(new THREE.Color(a).lerp(new THREE.Color(b), t));
}

/** Small random variation of a hex (for per-instance colour jitter). */
export function vary(hex: string, amount: number, r: number): string {
  return shade(hex, (r * 2 - 1) * amount);
}
