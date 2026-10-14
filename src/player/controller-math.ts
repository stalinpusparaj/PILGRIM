/**
 * Small allocation-free helpers for the kinematic controller (Controller.ts).
 */
import type * as THREE from 'three';

/** Moves the horizontal part of `v` toward (tx, tz) by at most `maxDelta` (m/s), in place. */
export function approach2(v: THREE.Vector3, tx: number, tz: number, maxDelta: number): void {
  const dx = tx - v.x;
  const dz = tz - v.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d <= maxDelta || d < 1e-9) {
    v.x = tx;
    v.z = tz;
    return;
  }
  const k = maxDelta / d;
  v.x += dx * k;
  v.z += dz * k;
}

/** The contact list CollisionWorld.resolve() leaves behind. */
interface Contacts {
  readonly contactCount: number;
  readonly contactNx: Float64Array;
  readonly contactNz: Float64Array;
}

/**
 * Removes the velocity going into each contact (slide along walls; in a corner it stops dead, so pushing into it
 * never jitters). Returns true when the wish pushes into a contact (the 'blocked' flag).
 */
export function clipAgainstContacts(
  v: THREE.Vector3,
  c: Contacts,
  wishX: number,
  wishZ: number,
  wishLen: number,
): boolean {
  let blocked = false;
  const n = c.contactCount;
  for (let i = 0; i < n; i++) {
    const nx = c.contactNx[i]!;
    const nz = c.contactNz[i]!;
    const vn = v.x * nx + v.z * nz;
    if (vn < 0) {
      v.x -= vn * nx;
      v.z -= vn * nz;
    }
    if (wishLen > 0.1 && wishX * nx + wishZ * nz < -0.3 * wishLen) blocked = true;
  }
  // Two walls meeting at an acute angle: clipping by one can push back into the other. Then there is no
  // direction left to slide in.
  for (let i = 0; i < n; i++) {
    if (v.x * c.contactNx[i]! + v.z * c.contactNz[i]! < -1e-6) {
      v.x = 0;
      v.z = 0;
      break;
    }
  }
  return blocked;
}
