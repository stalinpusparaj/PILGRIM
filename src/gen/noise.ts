/** In-house simplex noise (2D and 3D), seeded through Rng. Output is roughly in [-1, 1]. */
import { Rng } from './rng';

export type Noise2D = (x: number, y: number) => number;
export type Noise3D = (x: number, y: number, z: number) => number;

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const F3 = 1 / 3;
const G3 = 1 / 6;

const GRAD3 = new Float32Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1,
  0, -1, -1,
]);

function permutation(seed: number): Uint8Array {
  const rng = new Rng(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    const t = p[i]!;
    p[i] = p[j]!;
    p[j] = t;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255]!;
  return perm;
}

export function createNoise2D(seed: number): Noise2D {
  const perm = permutation(seed);
  return (x, y) => {
    const s = (x + y) * F2;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const t = (i + j) * G2;
    const x0 = x - (i - t);
    const y0 = y - (j - t);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;
    let n = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) {
      const g = (perm[ii + perm[jj]!]! % 12) * 3;
      t0 *= t0;
      n += t0 * t0 * (GRAD3[g]! * x0 + GRAD3[g + 1]! * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) {
      const g = (perm[ii + i1 + perm[jj + j1]!]! % 12) * 3;
      t1 *= t1;
      n += t1 * t1 * (GRAD3[g]! * x1 + GRAD3[g + 1]! * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) {
      const g = (perm[ii + 1 + perm[jj + 1]!]! % 12) * 3;
      t2 *= t2;
      n += t2 * t2 * (GRAD3[g]! * x2 + GRAD3[g + 1]! * y2);
    }
    return 70 * n;
  };
}

export function createNoise3D(seed: number): Noise3D {
  const perm = permutation(seed);
  return (x, y, z) => {
    const s = (x + y + z) * F3;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const k = Math.floor(z + s);
    const t = (i + j + k) * G3;
    const x0 = x - (i - t);
    const y0 = y - (j - t);
    const z0 = z - (k - t);
    let i1: number, j1: number, k1: number, i2: number, j2: number, k2: number;
    if (x0 >= y0) {
      if (y0 >= z0) [i1, j1, k1, i2, j2, k2] = [1, 0, 0, 1, 1, 0];
      else if (x0 >= z0) [i1, j1, k1, i2, j2, k2] = [1, 0, 0, 1, 0, 1];
      else [i1, j1, k1, i2, j2, k2] = [0, 0, 1, 1, 0, 1];
    } else {
      if (y0 < z0) [i1, j1, k1, i2, j2, k2] = [0, 0, 1, 0, 1, 1];
      else if (x0 < z0) [i1, j1, k1, i2, j2, k2] = [0, 1, 0, 0, 1, 1];
      else [i1, j1, k1, i2, j2, k2] = [0, 1, 0, 1, 1, 0];
    }
    const offs = [
      [x0, y0, z0, 0, 0, 0],
      [x0 - i1 + G3, y0 - j1 + G3, z0 - k1 + G3, i1, j1, k1],
      [x0 - i2 + 2 * G3, y0 - j2 + 2 * G3, z0 - k2 + 2 * G3, i2, j2, k2],
      [x0 - 1 + 3 * G3, y0 - 1 + 3 * G3, z0 - 1 + 3 * G3, 1, 1, 1],
    ] as const;
    const ii = i & 255;
    const jj = j & 255;
    const kk = k & 255;
    let n = 0;
    for (const [dx, dy, dz, oi, oj, ok] of offs) {
      let tt = 0.6 - dx * dx - dy * dy - dz * dz;
      if (tt <= 0) continue;
      const g = (perm[ii + oi + perm[jj + oj + perm[kk + ok]!]!]! % 12) * 3;
      tt *= tt;
      n += tt * tt * (GRAD3[g]! * dx + GRAD3[g + 1]! * dy + GRAD3[g + 2]! * dz);
    }
    return 32 * n;
  };
}

/** Fractal Brownian motion, normalised back to roughly [-1, 1]. */
export function fbm2(n: Noise2D, x: number, y: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * n(x * freq, y * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** Ridged noise in [0, 1]: sharp crests, good for rocky ridges. */
export function ridge2(n: Noise2D, x: number, y: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const r = 1 - Math.abs(n(x * freq, y * freq));
    sum += amp * r * r;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}
