/**
 * Heightfield maths for Terrain: grid layout, triangle-exact sampling, noise + shape stamps, and flattening the
 * ground along the Way and detours. Pure functions over a Float32Array so Terrain.ts stays small.
 */
import { createNoise2D, fbm2, ridge2, type Noise2D } from '../noise';
import { hashString } from '../rng';
import type { Yielder } from '../yielder';
import type { Way, ClosestResult } from '../Way';
import type { LevelData, TerrainStamp } from '../../world/LevelTypes';
import * as THREE from 'three';

/** Grid description: (seg + 1)² vertices, row-major (row = z index), centred on the origin. */
export interface Grid {
  seg: number;
  size: number;
  cell: number;
  half: number;
}

/** Ground band (beyond the ribbon edge) that is fully flat, and the smooth falloff after it, metres. */
export const FLAT_PAD = 0.6;
export const FALLOFF = 2.2;
/** Distance past either end of a Way over which its flattening fades out, metres. */
export const END_FADE = 7;

export function makeGrid(size: number): Grid {
  // 128 cells for 300 m (≈2.3 m cells); other sizes keep that cell size within sane limits.
  const seg = Math.max(32, Math.min(256, Math.round((128 * size) / 300)));
  return { seg, size, cell: size / seg, half: size / 2 };
}

/** True when cell (i, j) is split along its a-d diagonal (alternating, for a diamond facet pattern). */
export function evenCell(i: number, j: number): boolean {
  return ((i + j) & 1) === 0;
}

/**
 * Height at (x, z) on the same triangles the mesh draws (so feet and props sit exactly on the faceted ground).
 * Points outside the map are clamped to the edge.
 */
export function sampleGrid(h: Float32Array, g: Grid, x: number, z: number): number {
  const vx = Math.min(g.seg, Math.max(0, (x + g.half) / g.cell));
  const vz = Math.min(g.seg, Math.max(0, (z + g.half) / g.cell));
  const i = Math.min(g.seg - 1, Math.floor(vx));
  const j = Math.min(g.seg - 1, Math.floor(vz));
  const fx = vx - i;
  const fz = vz - j;
  const row = g.seg + 1;
  const ha = h[j * row + i]!;
  const hb = h[j * row + i + 1]!;
  const hc = h[(j + 1) * row + i]!;
  const hd = h[(j + 1) * row + i + 1]!;
  if (evenCell(i, j)) {
    return fz >= fx ? ha + (hd - hc) * fx + (hc - ha) * fz : ha + (hb - ha) * fx + (hd - hb) * fz;
  }
  return fx + fz <= 1
    ? ha + (hb - ha) * fx + (hc - ha) * fz
    : hd + (hc - hd) * (1 - fx) + (hb - hd) * (1 - fz);
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Smooth bump: 1 at the centre, 0 at r, zero slope at both ends. */
function bump(d: number, r: number): number {
  return d >= r ? 0 : 0.5 + 0.5 * Math.cos((Math.PI * d) / r);
}

/**
 * Height offset from one shape stamp. `dir` (radians, 0 = +X, π/2 = +Z) orients valleys, ridges and cliffs:
 * valleys and ridges run along it; a cliff's high side lies in the +dir direction.
 */
export function stampHeight(s: TerrainStamp, x: number, z: number, n: Noise2D): number {
  const dx = x - s.x;
  const dz = z - s.z;
  const r = Math.max(1, s.r);
  const d = Math.hypot(dx, dz);
  const ux = Math.cos(s.dir ?? 0);
  const uz = Math.sin(s.dir ?? 0);
  const along = dx * ux + dz * uz; // signed distance along dir
  const across = -dx * uz + dz * ux; // signed distance across dir
  switch (s.type) {
    case 'hill':
      return (s.height ?? 6) * bump(d, r);
    case 'plateau':
      return (s.height ?? 4) * (1 - smoothstep(0.55 * r, r, d));
    case 'basin':
      // Wide, flat-bottomed bowl (bogs, ponds).
      return -Math.abs(s.depth ?? s.height ?? 2.5) * (1 - smoothstep(0.3 * r, r, d));
    case 'valley': {
      const w = Math.max(4, 0.45 * r);
      return (
        -Math.abs(s.depth ?? s.height ?? 3) *
        bump(Math.abs(across), w) *
        (1 - smoothstep(0.7 * r, r, Math.abs(along)))
      );
    }
    case 'ridge': {
      const w = Math.max(6, 0.3 * r);
      const cross = Math.max(0, 1 - Math.abs(across) / w);
      const crest = cross * cross * (3 - 2 * cross) * (0.75 + 0.5 * ridge2(n, x * 0.03, z * 0.03, 3));
      return (s.height ?? 8) * crest * (1 - smoothstep(0.7 * r, r, Math.abs(along)));
    }
    case 'cliff': {
      // A steep, faceted step across a line through the centre, fading out at radius r.
      const step = smoothstep(-2.2, 2.2, along + 0.8 * n(x * 0.08, z * 0.08));
      return (s.height ?? 6) * step * (1 - smoothstep(0.7 * r, r, d));
    }
    default:
      return 0;
  }
}

/** Base height + fbm noise + stamps, row by row (time-sliced). */
export async function fillHeights(
  h: Float32Array,
  g: Grid,
  level: LevelData,
  y: Yielder,
  onProgress: (p: number) => void,
): Promise<void> {
  const t = level.terrain;
  const noise = createNoise2D((level.seed ^ hashString('terrain')) >>> 0);
  const stampNoise = createNoise2D((level.seed ^ hashString('stamps')) >>> 0);
  const octaves = t.noise.octaves ?? 4;
  const row = g.seg + 1;
  for (let j = 0; j <= g.seg; j++) {
    const z = -g.half + j * g.cell;
    for (let i = 0; i <= g.seg; i++) {
      const x = -g.half + i * g.cell;
      let v = t.base + t.noise.height * fbm2(noise, x * t.noise.scale, z * t.noise.scale, octaves);
      for (const s of t.stamps) {
        if (Math.abs(x - s.x) > s.r + 8 || Math.abs(z - s.z) > s.r + 8) continue;
        v += stampHeight(s, x, z, stampNoise);
      }
      h[j * row + i] = v;
    }
    onProgress(j / g.seg);
    await y.tick();
  }
}

/**
 * Height profile along a Way: the ground under the centre line (averaged across the ribbon), smoothed along the
 * path so the walking slope stays gentle. One sample per metre.
 */
function wayProfile(h: Float32Array, g: Grid, way: Way): Float32Array {
  const m = Math.max(2, Math.ceil(way.length));
  const prof = new Float32Array(m + 1);
  const p = new THREE.Vector3();
  const tan = new THREE.Vector3();
  const hw = way.halfWidth;
  for (let k = 0; k <= m; k++) {
    way.sample(k / m, p);
    way.tangent(k / m, tan);
    const sx = tan.z,
      sz = -tan.x;
    const sl = Math.hypot(sx, sz) || 1;
    const ox = (sx / sl) * hw,
      oz = (sz / sl) * hw;
    prof[k] =
      (2 * sampleGrid(h, g, p.x, p.z) +
        sampleGrid(h, g, p.x + ox, p.z + oz) +
        sampleGrid(h, g, p.x - ox, p.z - oz)) /
      4;
  }
  // Three box-filter passes ≈ a Gaussian over ~±7 m.
  const tmp = new Float32Array(m + 1);
  const R = 4;
  for (let pass = 0; pass < 3; pass++) {
    for (let k = 0; k <= m; k++) {
      let sum = 0,
        cnt = 0;
      for (let q = Math.max(0, k - R); q <= Math.min(m, k + R); q++) {
        sum += prof[q]!;
        cnt++;
      }
      tmp[k] = sum / cnt;
    }
    prof.set(tmp);
  }
  return prof;
}

/**
 * Flatten the ground along every Way: fully flat across the ribbon (+FLAT_PAD), then a smooth falloff. Main ways
 * go first; detour profiles are read from the already-flattened ground so junctions meet, and detours never
 * disturb the main Way's flat band. Writes per-vertex weights into `wayMask` / `detourMask` (for painting).
 */
export async function flattenWays(
  h: Float32Array,
  g: Grid,
  ways: readonly Way[],
  wayMask: Float32Array,
  detourMask: Float32Array,
  y: Yielder,
  onProgress: (p: number) => void,
): Promise<void> {
  const ordered = [...ways.filter((w) => w.kind === 'way'), ...ways.filter((w) => w.kind !== 'way')];
  const hit: ClosestResult = { t: 0, dist: 0, point: new THREE.Vector3() };
  const row = g.seg + 1;
  for (let wi = 0; wi < ordered.length; wi++) {
    const way = ordered[wi]!;
    const prof = wayProfile(h, g, way);
    const m = prof.length - 1;
    const flat = way.halfWidth + FLAT_PAD;
    const lateralReach = flat + FALLOFF;
    const reach = Math.max(lateralReach, END_FADE);
    const isDetour = way.kind !== 'way';
    const mask = isDetour ? detourMask : wayMask;
    // Outward directions at both ends: the flat band fades out gently past an end instead of notching a hill.
    const ends = [0, 1].map((t) => {
      const p = way.sample(t);
      const d = way.tangent(t);
      const l = Math.hypot(d.x, d.z) || 1;
      const sgn = t === 0 ? -1 : 1;
      return { x: p.x, z: p.z, dx: (sgn * d.x) / l, dz: (sgn * d.z) / l };
    });
    const j0 = Math.max(0, Math.floor((way.minZ - reach + g.half) / g.cell));
    const j1 = Math.min(g.seg, Math.ceil((way.maxZ + reach + g.half) / g.cell));
    const i0 = Math.max(0, Math.floor((way.minX - reach + g.half) / g.cell));
    const i1 = Math.min(g.seg, Math.ceil((way.maxX + reach + g.half) / g.cell));
    for (let j = j0; j <= j1; j++) {
      const z = -g.half + j * g.cell;
      for (let i = i0; i <= i1; i++) {
        const x = -g.half + i * g.cell;
        if (!way.closestWithin(x, z, reach, hit)) continue;
        const idx = j * row + i;
        let lateral = hit.dist;
        let endFade = 1;
        if (hit.t <= 1e-6 || hit.t >= 1 - 1e-6) {
          const e = ends[hit.t <= 1e-6 ? 0 : 1]!;
          const along = Math.max(0, (x - e.x) * e.dx + (z - e.z) * e.dz);
          lateral = Math.sqrt(Math.max(0, hit.dist * hit.dist - along * along));
          endFade = 1 - smoothstep(0, END_FADE, along);
        }
        let w = (1 - smoothstep(flat, lateralReach, lateral)) * endFade;
        if (isDetour) w *= 1 - wayMask[idx]!;
        if (w <= 0) continue;
        const s = hit.t * m;
        const k = Math.min(m - 1, Math.floor(s));
        const target = prof[k]! + (prof[k + 1]! - prof[k]!) * (s - k);
        h[idx] = h[idx]! + (target - h[idx]!) * w;
        if (w > mask[idx]!) mask[idx] = w;
      }
      await y.tick();
    }
    onProgress((wi + 1) / ordered.length);
  }
}
