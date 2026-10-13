/**
 * Seeded random numbers (GDD 2.12 "Core utilities"): every generated world looks the same every time.
 * mulberry32, written in-house: tiny, fast and good enough for placement, jitter and colour variation.
 */

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform float in [min, max). */
  range(min: number, max: number): number;
  /** Integer in [min, max] (inclusive). */
  int(min: number, max: number): number;
  /** One element of a non-empty list. */
  pick<T>(list: readonly T[]): T;
}

/** A deterministic generator for `seed` (any number; it is folded to 32 bits). */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (list) => list[Math.min(list.length - 1, Math.floor(next() * list.length))],
  };
}

/**
 * Stateless hash of three integers to [0, 1). Used where the same input must always give the same value,
 * e.g. jittering a vertex shared by several triangles so the surface does not crack.
 */
export function hash3(x: number, y: number, z: number, seed = 0): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (x | 0), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13) ^ (y | 0), 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16) ^ (z | 0), 0x27d4eb2f);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
