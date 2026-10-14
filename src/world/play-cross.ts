/**
 * The play session's handles on the Cross (GDD 2.7.1, debug F1 "Go to the Cross" / "Cross drop now", tests):
 * where to stand in front of the level's cross, which tomb the sack goes to, and the hold-to-skip test. The
 * sequence itself is src/player/CrossDrop.ts.
 */
import * as THREE from 'three';
import { services } from '../core/Services';
import { landmarkPosition, pointAhead } from './play-spawn';
import type { World } from './World';

export const CROSS = {
  /** Without a tomb within `tombNear` m, the sack rolls to a point this far ahead (m). */
  ahead: 12,
  tombNear: 60,
  /** "Go to the Cross": stand this far from its foot, on the tomb's side (m). */
  stand: 2.6,
  /** GDD 2.6: hold Space this long to skip a scene (s). */
  skipHold: 1,
} as const;

const crossAt = new THREE.Vector3();
const tombAt = new THREE.Vector3();

/** In front of the cross facing it, the tomb behind (downhill); null when the level has no cross. */
export function crossStand(
  world: World,
  fallbackFacing: number,
): { x: number; z: number; facing: number } | null {
  const cross = landmarkPosition(world, 'cross', crossAt);
  if (!cross) return null;
  const tomb = landmarkPosition(world, 'tomb', tombAt);
  let dx = tomb ? tomb.x - cross.x : Math.sin(fallbackFacing);
  let dz = tomb ? tomb.z - cross.z : Math.cos(fallbackFacing);
  const len = Math.hypot(dx, dz) || 1;
  dx /= len;
  dz /= len;
  return { x: cross.x + dx * CROSS.stand, z: cross.z + dz * CROSS.stand, facing: Math.atan2(-dx, -dz) };
}

/** The level's tomb when it is near `from`, else a point 12 m ahead along `facing`. A new vector. */
export function crossTomb(world: World, from: THREE.Vector3, facing: number): THREE.Vector3 {
  const tomb = landmarkPosition(world, 'tomb');
  if (tomb && Math.hypot(tomb.x - from.x, tomb.z - from.z) <= CROSS.tombNear) return tomb;
  return pointAhead(world, from, facing, CROSS.ahead, new THREE.Vector3());
}

/** Space (or pad A, the JUMP button) held for a second skips the sequence. */
export function crossSkipHeld(): boolean {
  return (services.tryGet('input')?.holdTime('skip') ?? 0) >= CROSS.skipHold;
}
