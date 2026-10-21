/**
 * Where the player starts (GDD 2.15 `&waystone=`, 2.7.2 "wake at the last waystone"): a couple of metres into the
 * main Way facing along it, or (PlaySession.respawn) in front of a waystone (Waystones.spot) facing along the Way.
 * Pure lookups over the built World; nothing here holds level coordinates.
 */
import * as THREE from 'three';
import type { World } from './World';

export { sessionRecipe } from '../player/player-outfit';

export interface SpawnPoint {
  readonly pos: THREE.Vector3;
  /** rotation.y that looks along the Way (characters face +Z). */
  facing: number;
}

/** Start this far into the Way (m), so the camera has ground behind the player. */
const WAY_START_IN = 2;
const tan = new THREE.Vector3();

/** The start of the main Way, facing along it. Writes into `out` when given. */
export function spawnPoint(world: World, out?: SpawnPoint): SpawnPoint {
  const sp: SpawnPoint = out ?? { pos: new THREE.Vector3(), facing: 0 };
  const way = world.ways.main;
  const t = way.length > 0 ? Math.min(0.5, WAY_START_IN / way.length) : 0;
  way.sample(t, sp.pos);
  sp.pos.y = world.terrain.heightAt(sp.pos.x, sp.pos.z);
  way.tangent(t, tan);
  sp.facing = Math.atan2(tan.x, tan.z);
  return sp;
}

/** rotation.y that looks along the main Way (its forward direction) at the Way point closest to (x, z). */
export function facingAlongWay(world: World, x: number, z: number): number {
  const way = world.ways.main;
  way.tangent(way.closest(x, z).t, tan);
  return Math.atan2(tan.x, tan.z);
}

/** A point `dist` metres ahead of `from` along `facing`, on the ground. */
export function pointAhead(
  world: World,
  from: THREE.Vector3,
  facing: number,
  dist: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  const x = from.x + Math.sin(facing) * dist;
  const z = from.z + Math.cos(facing) * dist;
  return out.set(x, world.terrain.heightAt(x, z), z);
}

/** Ground position of the first landmark of `type` ('tomb', 'cross'...), or null. */
export function landmarkPosition(
  world: World,
  type: string,
  out = new THREE.Vector3(),
): THREE.Vector3 | null {
  const lm = world.level.landmarks.find((l) => l.type === type && Array.isArray(l.at));
  if (!lm || !lm.at) return null;
  const [x, , z] = lm.at;
  return out.set(x, world.terrain.heightAt(x, z), z);
}
