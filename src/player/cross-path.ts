/**
 * Where the Burden goes at the Cross (GDD 2.7.1 "the sack tumbles down the hill, bounces twice and drops into the
 * open tomb"). Finds the tomb's mouth from the level's 'tomb' landmark (its front faces +Z turned by rotY, or towards
 * the nearest Way like every landmark without one), then plans the sack's ground path from behind the player to a
 * point in front of the mouth:
 *
 * - 'roll': the tomb is below (or level) and near: the path follows the terrain, steering towards the tomb and
 *   leaning downhill, around the player, and must stay clear of colliders and big climbs.
 * - 'arc': uphill, far or blocked: a straight line the sack covers in two big eased hops over everything.
 *
 * All the work happens once, when the sack falls; sampling afterwards is allocation-free.
 */
import * as THREE from 'three';
import type { Collider } from '../gen/types';
import type { World } from '../world/World';
import { faceWay } from '../world/levelPlacements';
import { clamp, hdist } from './cross-types';

export type SackPathMode = 'roll' | 'arc';

export interface TombInfo {
  /** Where the sack disappears (inside the opening, on the ground). */
  readonly mouth: THREE.Vector3;
  /** The end of the sack's path, in front of the mouth. */
  readonly entry: THREE.Vector3;
  /** Horizontal unit direction from entry into the mouth. */
  readonly inward: THREE.Vector3;
  /** The tomb landmark was found: a stone front with an opening (else the sack sinks into the ground). */
  readonly opening: boolean;
}

/** Tomb prop (built-sacred.ts): front face at local z 0.9, dark hollow behind it, threshold out to z 1.33. */
const TOMB = { mouthZ: 0.62, entryZ: 2.6, search: 4 } as const;
const STEP = 0.5;
const ROLL_MAX_DIST = 45;
const AVOID_R = 1.05;
const CLIMB_MAX = 0.8;
const BLOCK_STEP = 0.35;

export function findTomb(world: World, tomb: THREE.Vector3, from: THREE.Vector3): TombInfo {
  const ways = [world.ways.main, ...world.ways.detours];
  let best: { x: number; z: number; rotY: number } | null = null;
  let bestD: number = TOMB.search;
  for (const lm of world.level.landmarks) {
    if (lm.type !== 'tomb' || !Array.isArray(lm.at)) continue;
    const [x, , z] = lm.at;
    const d = hdist(x, z, tomb.x, tomb.z);
    if (d < bestD) {
      bestD = d;
      best = { x, z, rotY: lm.rotY ?? faceWay(ways, x, z) };
    }
  }
  const t = world.terrain;
  if (best) {
    const fx = Math.sin(best.rotY);
    const fz = Math.cos(best.rotY);
    const mouth = new THREE.Vector3(best.x + fx * TOMB.mouthZ, 0, best.z + fz * TOMB.mouthZ);
    const entry = new THREE.Vector3(best.x + fx * TOMB.entryZ, 0, best.z + fz * TOMB.entryZ);
    mouth.y = t.heightAt(mouth.x, mouth.z);
    entry.y = t.heightAt(entry.x, entry.z);
    return { mouth, entry, inward: new THREE.Vector3(-fx, 0, -fz), opening: true };
  }
  // A bare point: approach it from the player's side and sink into the ground there.
  const mouth = new THREE.Vector3(tomb.x, t.heightAt(tomb.x, tomb.z), tomb.z);
  const inward = new THREE.Vector3(mouth.x - from.x, 0, mouth.z - from.z);
  if (inward.lengthSq() < 1e-6) inward.set(0, 0, 1);
  inward.normalize();
  const back = Math.min(1.6, hdist(from.x, from.z, mouth.x, mouth.z) * 0.5);
  const entry = new THREE.Vector3(mouth.x - inward.x * back, 0, mouth.z - inward.z * back);
  entry.y = t.heightAt(entry.x, entry.z);
  return { mouth, entry, inward, opening: false };
}

export class SackPath {
  readonly mode: SackPathMode;
  readonly length: number;
  private readonly xs: Float32Array;
  private readonly zs: Float32Array;
  private readonly gs: Float32Array;
  private readonly tops: Float32Array;
  private readonly cum: Float32Array;
  private cursor = 0;
  private readonly world: World;

  constructor(mode: SackPathMode, pts: number[], world: World, radius: number) {
    this.mode = mode;
    this.world = world;
    const n = pts.length / 2;
    this.xs = new Float32Array(n);
    this.zs = new Float32Array(n);
    this.gs = new Float32Array(n);
    this.tops = new Float32Array(n);
    this.cum = new Float32Array(n);
    const near = nearbyColliders(world.colliders, pts, radius + 1);
    for (let i = 0; i < n; i++) {
      const x = pts[i * 2]!;
      const z = pts[i * 2 + 1]!;
      this.xs[i] = x;
      this.zs[i] = z;
      this.gs[i] = world.terrain.heightAt(x, z);
      this.tops[i] = Math.max(this.gs[i]!, colliderTop(near, x, z, radius * 0.8));
      this.cum[i] = i === 0 ? 0 : this.cum[i - 1]! + hdist(this.xs[i - 1]!, this.zs[i - 1]!, x, z);
    }
    this.length = this.cum[n - 1] ?? 0;
  }

  /** Ground point at distance s (x, terrain height, z). */
  sample(s: number, out: THREE.Vector3): THREE.Vector3 {
    const i = this.seek(s);
    const u = this.frac(i, s);
    out.x = this.xs[i]! + (this.xs[i + 1]! - this.xs[i]!) * u;
    out.z = this.zs[i]! + (this.zs[i + 1]! - this.zs[i]!) * u;
    out.y = this.gs[i]! + (this.gs[i + 1]! - this.gs[i]!) * u;
    return out;
  }

  /** Highest thing under the path at s: terrain or a collider top. */
  topAt(s: number): number {
    const i = this.seek(s);
    return Math.max(this.tops[i]!, this.tops[i + 1] ?? this.tops[i]!);
  }

  /** Terrain height anywhere (the sack leaving the path for the tomb's mouth). */
  groundAtXZ(x: number, z: number): number {
    return this.world.terrain.heightAt(x, z);
  }

  groundAt(s: number): number {
    const i = this.seek(s);
    return this.gs[i]! + (this.gs[i + 1]! - this.gs[i]!) * this.frac(i, s);
  }

  /** Horizontal unit direction of travel at s. */
  tangent(s: number, out: THREE.Vector3): THREE.Vector3 {
    const i = this.seek(s);
    out.set(this.xs[i + 1]! - this.xs[i]!, 0, this.zs[i + 1]! - this.zs[i]!);
    const l = out.length();
    return l > 1e-6 ? out.divideScalar(l) : out.set(0, 0, 1);
  }

  /** Segment index containing s (cursor walk: s mostly moves forward). */
  private seek(s: number): number {
    const last = this.cum.length - 2;
    if (last < 0) return 0;
    let i = clamp(this.cursor, 0, last);
    while (i < last && this.cum[i + 1]! < s) i++;
    while (i > 0 && this.cum[i]! > s) i--;
    this.cursor = i;
    return i;
  }

  private frac(i: number, s: number): number {
    const a = this.cum[i]!;
    const b = this.cum[i + 1] ?? a;
    return b - a > 1e-6 ? clamp((s - a) / (b - a), 0, 1) : 0;
  }
}

/**
 * Plans the sack's path from `start` (where it lands, behind the player) to `entry`, keeping `avoid` (the
 * player) clear. Falls back to 'arc' when rolling would climb, pass through something or go too far.
 */
export function planSackPath(
  world: World,
  start: THREE.Vector3,
  entry: THREE.Vector3,
  avoid: THREE.Vector3,
  radius: number,
): SackPath {
  const t = world.terrain;
  const d = hdist(start.x, start.z, entry.x, entry.z);
  const hs = t.heightAt(start.x, start.z);
  const he = t.heightAt(entry.x, entry.z);
  if (d <= ROLL_MAX_DIST && he - hs < 0.4) {
    const pts = steer(world, start, entry, avoid);
    if (pts) {
      const path = new SackPath('roll', pts, world, radius);
      if (rollable(path, hs)) return path;
    }
  }
  return new SackPath('arc', line(start, entry), world, radius);
}

function line(a: THREE.Vector3, b: THREE.Vector3): number[] {
  const d = hdist(a.x, a.z, b.x, b.z);
  const n = Math.max(1, Math.ceil(d / STEP));
  const pts: number[] = [];
  for (let i = 0; i <= n; i++) pts.push(a.x + ((b.x - a.x) * i) / n, a.z + ((b.z - a.z) * i) / n);
  return pts;
}

/** Steepest-descent steering towards the entry; null if it does not get there. */
function steer(
  world: World,
  start: THREE.Vector3,
  entry: THREE.Vector3,
  avoid: THREE.Vector3,
): number[] | null {
  const h = (x: number, z: number): number => world.terrain.heightAt(x, z);
  const pts: number[] = [start.x, start.z];
  let x = start.x;
  let z = start.z;
  const maxIter = Math.ceil(hdist(x, z, entry.x, entry.z) / STEP) * 3 + 40;
  for (let i = 0; i < maxIter; i++) {
    const dx = entry.x - x;
    const dz = entry.z - z;
    const dist = Math.hypot(dx, dz);
    if (dist < STEP * 1.2) {
      pts.push(entry.x, entry.z);
      return smooth(pts);
    }
    const tx = dx / dist;
    const tz = dz / dist;
    const gx = (h(x + 0.6, z) - h(x - 0.6, z)) / 1.2;
    const gz = (h(x, z + 0.6) - h(x, z - 0.6)) / 1.2;
    const gl = Math.hypot(gx, gz);
    // Lean downhill on slopes, more as the tomb gets further away; always keep heading to it.
    const w = gl > 1e-4 ? Math.min(0.45, gl * 1.5) * Math.min(1, dist / 6) : 0;
    let nx = tx * (1 - w) - (gl > 1e-4 ? (gx / gl) * w : 0);
    let nz = tz * (1 - w) - (gl > 1e-4 ? (gz / gl) * w : 0);
    const nl = Math.hypot(nx, nz) || 1;
    nx /= nl;
    nz /= nl;
    if (nx * tx + nz * tz < 0.35) {
      nx = (nx + tx * 2) / 3;
      nz = (nz + tz * 2) / 3;
      const l = Math.hypot(nx, nz) || 1;
      nx /= l;
      nz /= l;
    }
    x += nx * STEP;
    z += nz * STEP;
    // Round the player, never through him.
    const ax = x - avoid.x;
    const az = z - avoid.z;
    const ad = Math.hypot(ax, az);
    if (ad < AVOID_R && ad > 1e-4) {
      x = avoid.x + (ax / ad) * AVOID_R;
      z = avoid.z + (az / ad) * AVOID_R;
    }
    pts.push(x, z);
  }
  return null;
}

/** One pass of neighbour averaging (ends fixed), so the steering wiggles become curves. */
function smooth(pts: number[]): number[] {
  const out = pts.slice();
  for (let i = 2; i < pts.length - 2; i += 2) {
    out[i] = (pts[i - 2]! + pts[i]! * 2 + pts[i + 2]!) / 4;
    out[i + 1] = (pts[i - 1]! + pts[i + 1]! * 2 + pts[i + 3]!) / 4;
  }
  return out;
}

/** No climbs past CLIMB_MAX above the start, nothing taller than a step in the way. */
function rollable(path: SackPath, startH: number): boolean {
  const tmp = new THREE.Vector3();
  for (let s = 0; s <= path.length; s += STEP * 0.5) {
    path.sample(s, tmp);
    if (tmp.y > startH + CLIMB_MAX) return false;
    if (path.topAt(s) > tmp.y + BLOCK_STEP) return false;
  }
  return true;
}

function nearbyColliders(all: readonly Collider[], pts: number[], margin: number): Collider[] {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    minX = Math.min(minX, pts[i]!);
    maxX = Math.max(maxX, pts[i]!);
    minZ = Math.min(minZ, pts[i + 1]!);
    maxZ = Math.max(maxZ, pts[i + 1]!);
  }
  const out: Collider[] = [];
  for (const c of all) {
    const reach = (c.kind === 'box' ? Math.hypot(c.half[0], c.half[2]) : c.radius) + margin;
    const [x, , z] = c.center;
    if (x + reach < minX || x - reach > maxX || z + reach < minZ || z - reach > maxZ) continue;
    out.push(c);
  }
  return out;
}

/** Top of the highest collider within r of (x, z), or -Infinity. */
function colliderTop(cs: readonly Collider[], x: number, z: number, r: number): number {
  let top = -Infinity;
  for (const c of cs) {
    const [cx, cy, cz] = c.center;
    if (c.kind === 'box') {
      const dx = x - cx;
      const dz = z - cz;
      const cos = Math.cos(c.rotY);
      const sin = Math.sin(c.rotY);
      // Into the box frame (rotation.y = rotY).
      const lx = dx * cos - dz * sin;
      const lz = dx * sin + dz * cos;
      if (Math.abs(lx) <= c.half[0] + r && Math.abs(lz) <= c.half[2] + r) top = Math.max(top, cy + c.half[1]);
    } else if (c.kind === 'cylinder') {
      if (hdist(x, z, cx, cz) <= c.radius + r) top = Math.max(top, cy + c.height / 2);
    } else if (hdist(x, z, cx, cz) <= c.radius + r) {
      top = Math.max(top, cy + c.radius);
    }
  }
  return top;
}
