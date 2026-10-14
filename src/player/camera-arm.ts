/**
 * Spring arm for the follow camera (GDD 2.5): rays from the pivot (Christian's head) against the terrain and the
 * simple colliders (CollisionWorld.raycast). Obstacles pull the camera in fast, but it never trails a pull-in by
 * more than part of the probe radius, so it never enters a wall or the ground; when the way clears it waits a
 * moment and eases back out. The sideways (burdened shoulder) offset is collided the same way first, so the pivot
 * itself never slides into a wall. Allocation-free.
 */
import * as THREE from 'three';
import { CAMERA } from './camera-config';
import { clamp, damp } from './camera-math';
import type { CameraCollision } from './camera-types';

/**
 * Rays to the arm's end: centre, left, right, below and above, offset by these fractions of the probe radius (a
 * cheap stand-in for a sphere sweep; the low ray keeps the camera off wall tops, roofs and rocks under it, the high
 * one off beams and branches just over it, like the crossbeam).
 */
const RAYS: ReadonlyArray<readonly [side: number, down: number]> = [
  [0, 0],
  [-0.8, 0],
  [0.8, 0],
  [0, 0.8],
  [0, -0.8],
];

export class SpringArm {
  /** Smoothed collided arm length (m); < 0 until the first solve (or after reset()). */
  private len = -1;
  /** Smoothed collided sideways offset (m); < 0 until the first solve. */
  private side = -1;
  private hold = 0;
  private readonly dir = new THREE.Vector3();

  constructor(private readonly col: CameraCollision) {}

  /** Forget the smoothing: the next solve jumps straight to the allowed lengths (snap, resume). */
  reset(): void {
    this.len = -1;
    this.side = -1;
    this.hold = 0;
  }

  /** Collided sideways offset (m) from `pivot` towards (rx, 0, rz), wanting `want`. */
  shoulder(pivot: THREE.Vector3, rx: number, rz: number, want: number, dt: number): number {
    let clear = want;
    if (want > 1e-3) {
      this.dir.set(rx, 0, rz);
      const hit = this.col.raycast(pivot, this.dir, want + CAMERA.probe);
      if (hit !== null) clear = clamp(hit - CAMERA.probe, 0, want);
    }
    this.side = this.approach(this.side, clear, dt, false);
    return this.side;
  }

  /**
   * Collided length (m) of the arm `arm` (pivot → wanted camera position) from `pivot`. `rx, rz` is the camera's
   * right vector (for the side rays).
   */
  solve(pivot: THREE.Vector3, arm: THREE.Vector3, rx: number, rz: number, dt: number): number {
    const full = arm.length();
    if (full < 1e-4) return 0;
    let allowed = full;
    const r = CAMERA.probe;
    for (let i = 0; i < RAYS.length; i++) {
      const ray = RAYS[i]!;
      const k = ray[0] * r;
      this.dir.set(arm.x + rx * k, arm.y - ray[1] * r, arm.z + rz * k);
      const dl = this.dir.length();
      this.dir.multiplyScalar(1 / dl);
      const hit = this.col.raycast(pivot, this.dir, dl + r);
      // Map the hit on this ray back to a length along the centre ray, keeping the probe radius clear.
      if (hit !== null) allowed = Math.min(allowed, (hit / dl) * full - r);
    }
    allowed = clamp(allowed, Math.min(CAMERA.minArm, full), full);
    this.len = this.approach(this.len, allowed, dt, true);
    return this.len;
  }

  /** How much of `want` metres the camera at `at` may rise before a ceiling (probe radius kept clear). */
  rise(at: THREE.Vector3, want: number): number {
    if (!(want > 1e-3)) return 0;
    this.dir.set(0, 1, 0);
    const hit = this.col.raycast(at, this.dir, want + CAMERA.probe);
    return hit === null ? want : clamp(hit - CAMERA.probe, 0, want);
  }

  /**
   * In: fast, never more than the slack behind the allowed length. Out: after a short hold (arm only), slowly.
   * `cur < 0` jumps straight to the target.
   */
  private approach(cur: number, target: number, dt: number, holdOut: boolean): number {
    if (cur < 0) return target;
    if (target < cur) {
      if (holdOut) this.hold = CAMERA.easeOutDelay;
      return Math.min(damp(cur, target, CAMERA.pullInRate, dt), target + CAMERA.probe * CAMERA.pullSlack);
    }
    if (holdOut && this.hold > 0) {
      this.hold -= dt;
      return cur;
    }
    return damp(cur, target, CAMERA.easeOutRate, dt);
  }
}

/**
 * Lifts `pos` to stay `floorClear` above the terrain under it. Terrain only (no collider tops can qualify below
 * -Infinity), so the clamp is continuous and never pops at a roof edge; the arm's rays keep it off colliders.
 */
export function keepAboveGround(col: CameraCollision, pos: THREE.Vector3): void {
  const floor = col.groundAt(pos.x, pos.z, -Infinity) + CAMERA.floorClear;
  if (Number.isFinite(floor) && pos.y < floor) pos.y = floor;
}
