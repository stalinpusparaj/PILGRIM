/**
 * Helpers for CollisionWorld queries: the terrain ray march and the collider ray walk (camera arm), and fitting
 * a standing spot onto a collider top (ledge climbs). Allocation-free.
 */
import { BOX, CYL, rayEntry, type ColEntry } from './collision-shapes';
import type { UniformGrid } from './collision-grid';

interface HeightField {
  heightAt(x: number, z: number): number;
}

/** March step along a ray over the terrain (m); the facets are ~2.3 m, so thin crests are not skipped in play. */
const MARCH = 0.5;

/**
 * Distance along a unit ray to the terrain within maxDist, or Infinity. 0 when the origin is under the ground.
 * Marches in half-metre steps, then bisects the crossing to ~1 mm.
 */
export function rayTerrain(
  t: HeightField,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxDist: number,
): number {
  if (oy - t.heightAt(ox, oz) < 0) return 0;
  let prev = 0;
  for (let s = MARCH; ; s += MARCH) {
    const tt = s < maxDist ? s : maxDist;
    if (oy + dy * tt - t.heightAt(ox + dx * tt, oz + dz * tt) < 0) {
      let a = prev;
      let b = tt;
      for (let i = 0; i < 10; i++) {
        const m = (a + b) * 0.5;
        if (oy + dy * m - t.heightAt(ox + dx * m, oz + dz * m) < 0) b = m;
        else a = m;
      }
      return a;
    }
    if (tt >= maxDist) return Infinity;
    prev = tt;
  }
}

/**
 * Moves the point (px, pz) onto the walkable top of `e` so a disc of `inset` around it lies on the top (a box
 * inset from its sides, a cylinder or sphere cap from its rim). False when the top is too small to stand on.
 */
export function fitOnTop(
  e: ColEntry,
  px: number,
  pz: number,
  inset: number,
  capSin: number,
  out: { x: number; z: number },
): boolean {
  const dx = px - e.cx;
  const dz = pz - e.cz;
  if (e.kind === BOX) {
    const ix = e.hx - inset;
    const iz = e.hz - inset;
    if (ix < 0 || iz < 0) return false;
    let lx = dx * e.cos - dz * e.sin;
    let lz = dx * e.sin + dz * e.cos;
    lx = lx < -ix ? -ix : lx > ix ? ix : lx;
    lz = lz < -iz ? -iz : lz > iz ? iz : lz;
    out.x = e.cx + lx * e.cos + lz * e.sin;
    out.z = e.cz - lx * e.sin + lz * e.cos;
    return true;
  }
  const room = (e.kind === CYL ? e.hx : e.hx * capSin) - inset;
  if (room < 0) return false;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d <= room) {
    out.x = px;
    out.z = pz;
  } else {
    out.x = e.cx + (dx / d) * room;
    out.z = e.cz + (dz / d) * room;
  }
  return true;
}

/**
 * Nearest collider hit along a unit ray within min(maxDist, best), walking the grid cell by cell so only the
 * colliders near the ray are tested. Returns the new best distance (or `best` when nothing nearer was hit).
 */
export function rayColliders(
  grid: UniformGrid,
  entries: readonly ColEntry[],
  accept: (id: number) => boolean,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxDist: number,
  best: number,
): number {
  grid.begin();
  for (let t0 = 0; t0 < maxDist && t0 < best; t0 += grid.cell) {
    const t1 = Math.min(maxDist, t0 + grid.cell);
    const ax = ox + dx * t0;
    const az = oz + dz * t0;
    const bx = ox + dx * t1;
    const bz = oz + dz * t1;
    const from = grid.count;
    const n = grid.collect(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), accept);
    for (let k = from; k < n; k++) {
      const t = rayEntry(entries[grid.found[k]!]!, ox, oy, oz, dx, dy, dz);
      if (t < best) best = t;
    }
  }
  return best;
}
