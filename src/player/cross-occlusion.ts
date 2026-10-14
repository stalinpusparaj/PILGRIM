/**
 * Keeps the Cross's camera from looking through things (GDD 2.5 "spring arm with collision against simple
 * colliders"): the cross itself always stands right beside the scene. A ray from the look-at point back to the
 * camera is tested against the world's static colliders near the player (gathered once); when something is in the
 * way the camera slides in front of it at once and eases back out when it clears. The pull-in is kept as an amount
 * short of where the camera wants to be (not a distance from the look-at point), so a camera that moves away from
 * what it looks at, or a new shot (`reset()`), never jumps. Allocation-free per frame.
 */
import * as THREE from 'three';
import type { Collider } from '../gen/types';
import { damp } from './cross-types';

/** Colliders further than this from where the scene happens are ignored (m). */
const REACH = 45;
/** Stop this far in front of a hit (m), never closer than MIN_ARM to the look-at point. */
const PAD = 0.3;
const MIN_ARM = 0.8;
/** Easing back out after an occluder clears (per second). */
const OUT_RATE = 2.5;

export class CameraOcclusion {
  private readonly near: Collider[] = [];
  /** How far (m) the camera is held in front of where it wants to be. */
  private pull = 0;
  private readonly dir = new THREE.Vector3();

  constructor(colliders: readonly Collider[], around: THREE.Vector3) {
    for (const c of colliders) {
      const dx = c.center[0] - around.x;
      const dz = c.center[2] - around.z;
      if (dx * dx + dz * dz <= REACH * REACH) this.near.push(c);
    }
  }

  /** A new shot: forget the pull-in (it was measured along another line). */
  reset(): void {
    this.pull = 0;
  }

  /** Moves `cam` along the look→camera line in front of the first collider in the way. */
  apply(cam: THREE.Vector3, look: THREE.Vector3, dt: number): void {
    const d = this.dir.copy(cam).sub(look);
    const full = d.length();
    if (full < 1e-4) return;
    d.divideScalar(full);
    const hit = this.cast(look, d, full);
    const want = hit < full ? Math.max(0, full - Math.max(MIN_ARM, hit - PAD)) : 0;
    if (want > this.pull) this.pull = want;
    else this.pull += (want - this.pull) * damp(OUT_RATE, dt);
    if (this.pull > 1e-4)
      cam.copy(look).addScaledVector(d, Math.max(Math.min(MIN_ARM, full), full - this.pull));
  }

  /** Distance along the ray to the first collider surface (Infinity: none). Rays starting inside one ignore it. */
  private cast(o: THREE.Vector3, d: THREE.Vector3, max: number): number {
    let best = Infinity;
    for (const c of this.near) {
      const t =
        c.kind === 'box'
          ? rayBox(o, d, c)
          : c.kind === 'cylinder'
            ? rayCylinder(o, d, c)
            : raySphere(o, d, c);
      if (t >= 0 && t < best && t <= max) best = t;
    }
    return best;
  }
}

type Box = Extract<Collider, { kind: 'box' }>;
type Cyl = Extract<Collider, { kind: 'cylinder' }>;
type Sph = Extract<Collider, { kind: 'sphere' }>;

const lo = new Float64Array(3);
const ld = new Float64Array(3);

/** Slab test in the box's own frame (rotation.y = rotY). */
function rayBox(o: THREE.Vector3, d: THREE.Vector3, c: Box): number {
  const cos = Math.cos(c.rotY);
  const sin = Math.sin(c.rotY);
  const px = o.x - c.center[0];
  const pz = o.z - c.center[2];
  lo[0] = px * cos - pz * sin;
  lo[1] = o.y - c.center[1];
  lo[2] = px * sin + pz * cos;
  ld[0] = d.x * cos - d.z * sin;
  ld[1] = d.y;
  ld[2] = d.x * sin + d.z * cos;
  let t0 = -Infinity;
  let t1 = Infinity;
  for (let i = 0; i < 3; i++) {
    const h = c.half[i]!;
    const p = lo[i]!;
    const v = ld[i]!;
    if (Math.abs(v) < 1e-9) {
      if (p < -h || p > h) return -1;
      continue;
    }
    const a = (-h - p) / v;
    const b = (h - p) / v;
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
    if (t0 > t1) return -1;
  }
  return t0 > 0 ? t0 : -1; // starting inside: ignore
}

function rayCylinder(o: THREE.Vector3, d: THREE.Vector3, c: Cyl): number {
  const px = o.x - c.center[0];
  const pz = o.z - c.center[2];
  const a = d.x * d.x + d.z * d.z;
  if (a < 1e-9) return -1;
  const b = px * d.x + pz * d.z;
  const k = px * px + pz * pz - c.radius * c.radius;
  if (k <= 0) return -1; // starting inside
  const disc = b * b - a * k;
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / a;
  if (t <= 0) return -1;
  const y = o.y + d.y * t;
  return Math.abs(y - c.center[1]) <= c.height / 2 ? t : -1;
}

function raySphere(o: THREE.Vector3, d: THREE.Vector3, c: Sph): number {
  const px = o.x - c.center[0];
  const py = o.y - c.center[1];
  const pz = o.z - c.center[2];
  const b = px * d.x + py * d.y + pz * d.z;
  const k = px * px + py * py + pz * pz - c.radius * c.radius;
  if (k <= 0) return -1;
  const disc = b * b - k;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t > 0 ? t : -1;
}
