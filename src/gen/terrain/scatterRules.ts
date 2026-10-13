/**
 * Scatter rule defaults per prop type, clearings around level entities, and a small disc hash used for
 * Poisson-ish spacing (grid rejection). Level rules override minDist / slopeMax / keepClear / scale.
 */
import type { LevelData } from '../../world/LevelTypes';

export interface ScatterTypeDefaults {
  minDist: number;
  /** Degrees. */
  slopeMax: number;
  /** Metres beyond the ribbon edge of every Way and detour. */
  keepClear: number;
  scale: [number, number];
  /** Metres (× scale) pushed into the ground so bases never float on slopes. */
  sink: number;
  /** Max random tilt, radians. */
  tilt: number;
  /** Solid radius (× scale) that other solid props keep away from; 0 = soft (grass, flowers, reeds). */
  footprint: number;
  /** Small props: chunked for distance culling and thinned by quality.grassDensity. */
  small: boolean;
  shadow: boolean;
  collide: 'cylinder' | 'sphere' | null;
  water: 'never' | 'ok' | 'only';
  /** Per-instance value and warm/cool jitter. */
  valueJitter: number;
  hueJitter: number;
  /** Instance cap per type (performance budget guard, GDD 2.15). */
  max: number;
}

const TREE: ScatterTypeDefaults = {
  minDist: 4.5,
  slopeMax: 32,
  keepClear: 2.5,
  scale: [0.85, 1.3],
  sink: 0.12,
  tilt: 0.04,
  footprint: 1.2,
  small: false,
  shadow: true,
  collide: 'cylinder',
  water: 'never',
  valueJitter: 0.1,
  hueJitter: 0.06,
  max: 1500,
};

const SMALL: ScatterTypeDefaults = {
  ...TREE,
  minDist: 0.6,
  slopeMax: 38,
  keepClear: 0.1,
  scale: [0.7, 1.35],
  sink: 0.02,
  tilt: 0.12,
  footprint: 0,
  small: true,
  shadow: false,
  collide: null,
  valueJitter: 0.12,
  hueJitter: 0.08,
  max: 6000,
};

export const SCATTER_DEFAULTS: Record<string, ScatterTypeDefaults> = {
  tree_cone: TREE,
  tree_round: { ...TREE, minDist: 5, footprint: 1.4 },
  tree_dead: { ...TREE, minDist: 5, footprint: 0.8, hueJitter: 0.03 },
  tree_fruit: { ...TREE, minDist: 5, footprint: 1.2 },
  bush: {
    ...TREE,
    minDist: 2.2,
    slopeMax: 35,
    keepClear: 1,
    scale: [0.7, 1.25],
    sink: 0.08,
    tilt: 0.08,
    footprint: 0.8,
    collide: null,
    max: 2000,
  },
  rock: {
    ...TREE,
    minDist: 2.5,
    slopeMax: 55,
    keepClear: 1.2,
    scale: [0.5, 1.6],
    sink: 0.18,
    tilt: 0.35,
    footprint: 0.8,
    collide: 'sphere',
    valueJitter: 0.08,
    hueJitter: 0.03,
  },
  grass: SMALL,
  flower: {
    ...SMALL,
    minDist: 0.8,
    slopeMax: 32,
    keepClear: 0.2,
    scale: [0.75, 1.2],
    hueJitter: 0.04,
    max: 3000,
  },
  reeds: {
    ...SMALL,
    minDist: 0.8,
    slopeMax: 25,
    keepClear: 0.6,
    sink: 0.05,
    small: false,
    water: 'ok',
    max: 1500,
  },
  lily: {
    ...SMALL,
    minDist: 1.2,
    slopeMax: 90,
    keepClear: 0.5,
    sink: 0,
    tilt: 0,
    small: false,
    water: 'only',
    max: 600,
  },
};

const FALLBACK: ScatterTypeDefaults = {
  ...TREE,
  minDist: 3,
  slopeMax: 30,
  keepClear: 1.5,
  scale: [0.85, 1.15],
  footprint: 0.8,
  collide: null,
  max: 1000,
};

export function defaultsFor(type: string): ScatterTypeDefaults {
  return SCATTER_DEFAULTS[type] ?? FALLBACK;
}

/** Keep-out radius around a landmark by type (metres); `params.clear` overrides. */
const LANDMARK_CLEAR: Record<string, number> = {
  house_a: 7,
  house_b: 7,
  house_c: 7,
  gate: 3,
  stall: 4,
  cage: 3,
  arbour: 3.5,
  cross: 3,
  tomb: 3.5,
  well: 2.5,
  waystone: 1.8,
  fence: 3,
  wall: 3,
  stile: 2,
  lamp: 1.2,
  sign: 1.2,
  flag: 1.2,
};

export interface Clearing {
  x: number;
  z: number;
  r: number;
}

/** Circles the scatter keeps out of: landmarks with a position, NPCs, waystones and promises. */
export function clearings(level: LevelData): Clearing[] {
  const out: Clearing[] = [];
  for (const l of level.landmarks) {
    if (!l.at) continue; // path-placed landmarks sit on the Way, which is already kept clear
    const p = l.params?.clear;
    out.push({ x: l.at[0], z: l.at[2], r: typeof p === 'number' ? p : (LANDMARK_CLEAR[l.type] ?? 3) });
  }
  for (const n of level.npcs) if (n.at) out.push({ x: n.at[0], z: n.at[2], r: 1.5 });
  for (const w of level.waystones) out.push({ x: w.at[0], z: w.at[2], r: 2 });
  for (const p of level.promises) out.push({ x: p.at[0], z: p.at[2], r: 1.5 });
  return out;
}

/** Spatial hash of discs: "is there any disc overlapping this one?" in O(1)-ish. */
export class DiscHash {
  private readonly cells = new Map<number, number[]>();
  private maxR = 0;

  constructor(private readonly cell: number) {}

  private key(cx: number, cz: number): number {
    return (cx + 32768) * 65536 + (cz + 32768);
  }

  add(x: number, z: number, r: number): void {
    const k = this.key(Math.floor(x / this.cell), Math.floor(z / this.cell));
    let list = this.cells.get(k);
    if (!list) this.cells.set(k, (list = []));
    list.push(x, z, r);
    if (r > this.maxR) this.maxR = r;
  }

  /** True when a stored disc overlaps the disc (x, z, r). */
  hits(x: number, z: number, r: number): boolean {
    const reach = r + this.maxR;
    const cx0 = Math.floor((x - reach) / this.cell),
      cx1 = Math.floor((x + reach) / this.cell);
    const cz0 = Math.floor((z - reach) / this.cell),
      cz1 = Math.floor((z + reach) / this.cell);
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const list = this.cells.get(this.key(cx, cz));
        if (!list) continue;
        for (let i = 0; i < list.length; i += 3) {
          const dx = list[i]! - x,
            dz = list[i + 1]! - z,
            rr = list[i + 2]! + r;
          if (dx * dx + dz * dz < rr * rr) return true;
        }
      }
    }
    return false;
  }
}
