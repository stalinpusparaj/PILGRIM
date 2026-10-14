/**
 * Per-shape maths for CollisionWorld: the internal collider record, the player capsule's horizontal push-out,
 * walkable tops under a foot disc, ceilings and ray hits. Shapes follow the `Collider` convention (DECISIONS
 * 119): `center` is the centre of the volume, a cylinder spans center.y ± height / 2, a box turns by rotY about
 * Y like a three.js object (local → world: x' = x cos + z sin, z' = -x sin + z cos). All functions write into
 * caller scratch and never allocate.
 */
import type { Collider } from '../gen/types';

export type SurfaceKind = 'dirt' | 'stone' | 'mud' | 'wood' | 'grass' | 'water';

export const BOX = 0;
export const CYL = 1;
export const SPHERE = 2;
export type ShapeKind = typeof BOX | typeof CYL | typeof SPHERE;

/** Internal collider record (world space, precomputed bounds). */
export interface ColEntry {
  kind: ShapeKind;
  cx: number;
  cy: number;
  cz: number;
  /** Box half extents; cylinder: hx = radius, hy = half height; sphere: hx = radius. */
  hx: number;
  hy: number;
  hz: number;
  cos: number;
  sin: number;
  top: number;
  bottom: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  walkable: boolean;
  /** A floor only (mud surfaces): ground for anything over it or sunk into it, never a wall or a ledge. */
  floor: boolean;
  enabled: boolean;
  alive: boolean;
  surface: SurfaceKind;
  tag: string;
  cells: number[];
}

const SURFACES: readonly SurfaceKind[] = ['dirt', 'stone', 'mud', 'wood', 'grass', 'water'];

export function isSurface(s: string): s is SurfaceKind {
  return (SURFACES as readonly string[]).includes(s);
}

const fin = (v: number, d = 0): number => (Number.isFinite(v) ? v : d);
const pos = (v: number): number => Math.max(0, fin(v));

export function makeEntry(c: Collider, walkable: boolean, tag: string, floor = false): ColEntry {
  const [x, y, z] = c.center;
  const e: ColEntry = {
    kind: BOX,
    cx: fin(x),
    cy: fin(y),
    cz: fin(z),
    hx: 0,
    hy: 0,
    hz: 0,
    cos: 1,
    sin: 0,
    top: 0,
    bottom: 0,
    minX: 0,
    maxX: 0,
    minZ: 0,
    maxZ: 0,
    walkable: walkable || floor,
    floor,
    enabled: true,
    alive: true,
    surface: 'wood',
    tag,
    cells: [],
  };
  if (c.kind === 'box') {
    e.hx = pos(c.half[0]);
    e.hy = pos(c.half[1]);
    e.hz = pos(c.half[2]);
    const r = fin(c.rotY);
    e.cos = Math.cos(r);
    e.sin = Math.sin(r);
    const ex = Math.abs(e.cos) * e.hx + Math.abs(e.sin) * e.hz;
    const ez = Math.abs(e.sin) * e.hx + Math.abs(e.cos) * e.hz;
    setBounds(e, ex, e.hy, ez);
  } else if (c.kind === 'cylinder') {
    e.kind = CYL;
    e.hx = pos(c.radius);
    e.hy = pos(c.height) / 2;
    setBounds(e, e.hx, e.hy, e.hx);
  } else {
    e.kind = SPHERE;
    e.hx = pos(c.radius);
    e.surface = 'stone';
    setBounds(e, e.hx, e.hx, e.hx);
  }
  if (isSurface(tag)) e.surface = tag;
  return e;
}

function setBounds(e: ColEntry, ex: number, ey: number, ez: number): void {
  e.minX = e.cx - ex;
  e.maxX = e.cx + ex;
  e.minZ = e.cz - ez;
  e.maxZ = e.cz + ez;
  e.top = e.cy + ey;
  e.bottom = e.cy - ey;
}

/** Output of a push-out: unit horizontal normal (away from the collider) and depth in metres. */
export interface Push {
  nx: number;
  nz: number;
  depth: number;
}

/**
 * Horizontal push that separates a vertical circle (x, z, r) from a box / cylinder footprint (the shortest way
 * out). Returns the depth (0 when apart). Ties go to +X / +Z so the result is deterministic.
 */
export function pushPrism(e: ColEntry, x: number, z: number, r: number, out: Push): number {
  out.depth = 0;
  const dx = x - e.cx;
  const dz = z - e.cz;
  if (e.kind === CYL) {
    const rr = e.hx + r;
    const d2 = dx * dx + dz * dz;
    if (d2 >= rr * rr) return 0;
    const d = Math.sqrt(d2);
    if (d > 1e-9) {
      out.nx = dx / d;
      out.nz = dz / d;
    } else {
      out.nx = 1;
      out.nz = 0;
    }
    out.depth = rr - d;
    return out.depth;
  }
  // Box: into local space.
  const lx = dx * e.cos - dz * e.sin;
  const lz = dx * e.sin + dz * e.cos;
  const ax = Math.abs(lx);
  const az = Math.abs(lz);
  let nlx: number;
  let nlz: number;
  if (ax <= e.hx && az <= e.hz) {
    // Centre inside the footprint: leave through the nearest side.
    const px = e.hx - ax;
    const pz = e.hz - az;
    if (px <= pz) {
      nlx = lx < 0 ? -1 : 1;
      nlz = 0;
      out.depth = px + r;
    } else {
      nlx = 0;
      nlz = lz < 0 ? -1 : 1;
      out.depth = pz + r;
    }
  } else {
    const qx = lx - Math.max(-e.hx, Math.min(e.hx, lx));
    const qz = lz - Math.max(-e.hz, Math.min(e.hz, lz));
    const d2 = qx * qx + qz * qz;
    if (d2 >= r * r) return 0;
    const d = Math.sqrt(d2);
    nlx = qx / d;
    nlz = qz / d;
    out.depth = r - d;
  }
  // Back to world: x' = x cos + z sin, z' = -x sin + z cos.
  out.nx = nlx * e.cos + nlz * e.sin;
  out.nz = -nlx * e.sin + nlz * e.cos;
  return out.depth;
}

/**
 * Horizontal push for a capsule whose axis spans y0..y1 (radius r) against a sphere: the capsule moves sideways
 * until its nearest axis point is r + R from the centre.
 */
export function pushSphere(
  e: ColEntry,
  x: number,
  y0: number,
  y1: number,
  z: number,
  r: number,
  out: Push,
): number {
  out.depth = 0;
  const yc = e.cy < y0 ? y0 : e.cy > y1 ? y1 : e.cy;
  const dy = e.cy - yc;
  const rr = e.hx + r;
  if (Math.abs(dy) >= rr) return 0;
  const need = Math.sqrt(rr * rr - dy * dy);
  const dx = x - e.cx;
  const dz = z - e.cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= need * need) return 0;
  const d = Math.sqrt(d2);
  if (d > 1e-9) {
    out.nx = dx / d;
    out.nz = dz / d;
  } else {
    out.nx = 1;
    out.nz = 0;
  }
  out.depth = need - d;
  return out.depth;
}

/** Horizontal distance from (x, z) to a box footprint (0 inside). */
export function boxDistance(e: ColEntry, x: number, z: number): number {
  const dx = x - e.cx;
  const dz = z - e.cz;
  const lx = Math.abs(dx * e.cos - dz * e.sin) - e.hx;
  const lz = Math.abs(dx * e.sin + dz * e.cos) - e.hz;
  const qx = lx > 0 ? lx : 0;
  const qz = lz > 0 ? lz : 0;
  return Math.sqrt(qx * qx + qz * qz);
}

/**
 * Height of the walkable top under a foot disc (x, z, radius fr), or -Infinity when the disc misses it. Boxes and
 * cylinders have flat tops; a sphere offers its cap up to `capSin` (= sin of the slope limit) of its radius.
 */
export function topUnder(e: ColEntry, x: number, z: number, fr: number, capSin: number): number {
  if (e.kind === BOX) return boxDistance(e, x, z) <= fr ? e.top : -Infinity;
  const dx = x - e.cx;
  const dz = z - e.cz;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (e.kind === CYL) return d <= e.hx + fr ? e.top : -Infinity;
  const dd = d - fr > 0 ? d - fr : 0;
  if (dd > e.hx * capSin) return -Infinity;
  return e.cy + Math.sqrt(e.hx * e.hx - dd * dd);
}

/** True when a vertical circle (x, z, r) overlaps the footprint of a box or cylinder (spheres use their equator). */
export function footprintOverlaps(e: ColEntry, x: number, z: number, r: number): boolean {
  if (e.kind === BOX) return boxDistance(e, x, z) < r;
  const dx = x - e.cx;
  const dz = z - e.cz;
  const rr = e.hx + r;
  return dx * dx + dz * dz < rr * rr;
}

/**
 * Ray entry distance (ray from o along unit d) into a collider, or Infinity when it misses or starts inside
 * (a camera arm that starts inside a shape should not collapse onto the head).
 */
export function rayEntry(
  e: ColEntry,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
): number {
  if (e.kind === SPHERE) {
    const px = ox - e.cx;
    const py = oy - e.cy;
    const pz = oz - e.cz;
    const b = px * dx + py * dy + pz * dz;
    const c = px * px + py * py + pz * pz - e.hx * e.hx;
    if (c <= 0) return Infinity; // inside
    const disc = b * b - c;
    if (disc < 0) return Infinity;
    const t = -b - Math.sqrt(disc);
    return t >= 0 ? t : Infinity;
  }
  // Box (local frame) and cylinder share the vertical slab.
  let tmin = -Infinity;
  let tmax = Infinity;
  const py = oy - e.cy;
  if (Math.abs(dy) < 1e-12) {
    if (py < -e.hy || py > e.hy) return Infinity;
  } else {
    let t0 = (-e.hy - py) / dy;
    let t1 = (e.hy - py) / dy;
    if (t0 > t1) {
      const s = t0;
      t0 = t1;
      t1 = s;
    }
    tmin = t0;
    tmax = t1;
  }
  const px = ox - e.cx;
  const pz = oz - e.cz;
  if (e.kind === CYL) {
    const a = dx * dx + dz * dz;
    const c = px * px + pz * pz - e.hx * e.hx;
    if (a < 1e-12) {
      if (c > 0) return Infinity;
    } else {
      const b = px * dx + pz * dz;
      const disc = b * b - a * c;
      if (disc < 0) return Infinity;
      const s = Math.sqrt(disc);
      const t0 = (-b - s) / a;
      const t1 = (-b + s) / a;
      if (t0 > tmin) tmin = t0;
      if (t1 < tmax) tmax = t1;
    }
  } else {
    const lx = px * e.cos - pz * e.sin;
    const lz = px * e.sin + pz * e.cos;
    const ldx = dx * e.cos - dz * e.sin;
    const ldz = dx * e.sin + dz * e.cos;
    if (!slab(lx, ldx, e.hx, slabOut)) return Infinity;
    if (slabOut.t0 > tmin) tmin = slabOut.t0;
    if (slabOut.t1 < tmax) tmax = slabOut.t1;
    if (!slab(lz, ldz, e.hz, slabOut)) return Infinity;
    if (slabOut.t0 > tmin) tmin = slabOut.t0;
    if (slabOut.t1 < tmax) tmax = slabOut.t1;
  }
  if (tmax < tmin || tmax < 0 || tmin < 0) return Infinity;
  return tmin;
}

const slabOut = { t0: 0, t1: 0 };
function slab(p: number, d: number, h: number, out: { t0: number; t1: number }): boolean {
  if (Math.abs(d) < 1e-12) {
    out.t0 = -Infinity;
    out.t1 = Infinity;
    return p >= -h && p <= h;
  }
  const a = (-h - p) / d;
  const b = (h - p) / d;
  out.t0 = a < b ? a : b;
  out.t1 = a < b ? b : a;
  return true;
}

/**
 * How deep a capsule (feet at pos.y, radius r, height h) sits in `e`, with the push-out direction in `out`; 0 when
 * clear (always for a floor). A walkable top within `stepUp` of the feet is a step, not a wall. Sphere caps push against the capsule
 * with its lower end lifted by the step height, so low caps are climbed rather than bumped into.
 */
export function penetration(
  e: ColEntry,
  pos: { readonly x: number; readonly y: number; readonly z: number },
  r: number,
  h: number,
  stepUp: number,
  out: Push,
): number {
  if (e.floor) return 0;
  const feet = pos.y;
  const ignore = e.walkable ? stepUp : 0;
  if (e.kind === SPHERE) {
    const y0 = feet + ignore + r;
    const y1 = Math.max(y0, feet + h - r);
    return pushSphere(e, pos.x, y0, y1, pos.z, r, out);
  }
  if (e.top <= feet + ignore + 1e-4 || e.bottom >= feet + h - 1e-4) return 0;
  return pushPrism(e, pos.x, pos.z, r, out);
}
