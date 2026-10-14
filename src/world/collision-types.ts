/**
 * Public data types of CollisionWorld (re-exported by Collision.ts).
 */
import type * as THREE from 'three';
import type { Collider } from '../gen/types';
import type { Way } from '../gen/Way';
import type { LevelData } from './LevelTypes';

/** What CollisionWorld needs from a terrain (Terrain satisfies it; tests pass analytic grounds). */
export interface GroundField {
  readonly size: number;
  heightAt(x: number, z: number): number;
  normalAt(x: number, z: number, out?: THREE.Vector3): THREE.Vector3;
}

/** The parts of a World that collision reads (a built World satisfies it). */
export interface CollisionSource {
  terrain: GroundField;
  colliders: readonly Collider[];
  level: Pick<LevelData, 'zones' | 'water'>;
  ways: { main: Way; detours: readonly Way[] };
}

/** Result of `probeGround`: support height, its normal, and whether it is steeper than the slope limit. */
export interface GroundHit {
  y: number;
  nx: number;
  ny: number;
  nz: number;
  steep: boolean;
  /** Collider handle that supports the feet, or -1 for the terrain. */
  handle: number;
}

export function makeGroundHit(): GroundHit {
  return { y: 0, nx: 0, ny: 1, nz: 0, steep: false, handle: -1 };
}

export interface LedgeHit {
  top: number;
  at: THREE.Vector3;
}
