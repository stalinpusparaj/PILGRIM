/**
 * Low-res surface grids for `src/gen/Water.ts`, in the local XZ plane at y = 0, indexed (shared vertices keep
 * the surface closed while the vertex shader moves it). `depth` per vertex is the distance from the shore,
 * eased to 0..1 over `shore` metres. Interior vertices are jittered for a hand-made look; the rim stays clean.
 */
import type { Rng } from '../rng';

export interface GridSpec {
  cell: number; // target triangle size (m)
  shore: number; // metres from the edge to full depth
}

export interface Grid {
  pos: number[];
  depth: number[];
  index: number[];
}

const MAX_RINGS = 24;
/** Cell budget for a box (48 × 48); long thin boxes (rivers) keep square-ish cells within it. */
const MAX_BOX_CELLS = 48 * 48;

export const smooth01 = (x: number): number => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/** Push a triangle wound counter-clockwise seen from above (+Y), so the front face points up. */
function tri(g: Grid, a: number, b: number, c: number): void {
  const p = g.pos;
  const ax = p[a * 3]!;
  const az = p[a * 3 + 2]!;
  const ny = (p[b * 3 + 2]! - az) * (p[c * 3]! - ax) - (p[b * 3]! - ax) * (p[c * 3 + 2]! - az);
  if (ny >= 0) g.index.push(a, b, c);
  else g.index.push(a, c, b);
}

/** Disc of concentric rings with 6k vertices on ring k: even, hex-like triangles. */
export function circleGrid(radius: number, s: GridSpec, rng: Rng): Grid {
  const g: Grid = { pos: [0, 0, 0], depth: [smooth01(radius / s.shore)], index: [] };
  const rings = Math.min(MAX_RINGS, Math.max(2, Math.ceil(radius / s.cell)));
  const step = radius / rings;
  let prevStart = 0;
  let prevCount = 1;
  let prevOffset = 0;
  for (let k = 1; k <= rings; k++) {
    const n = 6 * k;
    const start = g.pos.length / 3;
    const offset = rng.range(0, 0.5) / n; // in turns
    for (let j = 0; j < n; j++) {
      const inner = k < rings; // the rim stays a clean circle
      const a = (offset + (j + (inner ? rng.range(-0.2, 0.2) : 0)) / n) * Math.PI * 2;
      const rad = k * step + (inner ? rng.range(-0.22, 0.22) * step : 0);
      g.pos.push(Math.cos(a) * rad, 0, Math.sin(a) * rad);
      g.depth.push(smooth01((radius - rad) / s.shore));
    }
    // Stitch the previous ring to this one, walking both by angle.
    let i = 0;
    let j = 0;
    while (i < prevCount || j < n) {
      const nextIn = prevOffset + (i + 1) / prevCount;
      const nextOut = offset + (j + 1) / n;
      const a = prevStart + (i % prevCount);
      if (i < prevCount && prevCount > 1 && (j >= n || nextIn < nextOut)) {
        tri(g, a, start + (j % n), prevStart + ((i + 1) % prevCount));
        i++;
      } else {
        tri(g, a, start + (j % n), start + ((j + 1) % n));
        j++;
        if (prevCount === 1 && j >= n) i = prevCount;
      }
    }
    prevStart = start;
    prevCount = n;
    prevOffset = offset;
  }
  return g;
}

/** Rectangle grid with alternating diagonals (reads as faceted, not as stripes). */
export function boxGrid(w: number, d: number, s: GridSpec, rng: Rng): Grid {
  const g: Grid = { pos: [], depth: [], index: [] };
  const fit = Math.min(1, Math.sqrt(MAX_BOX_CELLS / Math.max(1, (w / s.cell) * (d / s.cell))));
  const nx = Math.max(2, Math.round((w / s.cell) * fit));
  const nz = Math.max(2, Math.round((d / s.cell) * fit));
  for (let iz = 0; iz <= nz; iz++) {
    for (let ix = 0; ix <= nx; ix++) {
      const inner = ix > 0 && ix < nx && iz > 0 && iz < nz;
      const x = (ix / nx - 0.5) * w + (inner ? rng.range(-0.22, 0.22) * (w / nx) : 0);
      const z = (iz / nz - 0.5) * d + (inner ? rng.range(-0.22, 0.22) * (d / nz) : 0);
      g.pos.push(x, 0, z);
      g.depth.push(smooth01(Math.min(w / 2 - Math.abs(x), d / 2 - Math.abs(z)) / s.shore));
    }
  }
  const row = nx + 1;
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const a = iz * row + ix;
      const b = a + 1;
      const c = a + row;
      const e = c + 1;
      if ((ix + iz) % 2 === 0) {
        tri(g, a, c, e);
        tri(g, a, e, b);
      } else {
        tri(g, a, c, b);
        tri(g, b, c, e);
      }
    }
  }
  return g;
}
