/** Shared types for the procedural toolkit. */
import type * as THREE from 'three';
import type { Rng } from './rng';
import type { Palette } from './palette';
import type { Vec3 } from './geom';

export type { Vec3 } from './geom';

/** Simple colliders for the in-house kinematic controller (GDD 2.15). Coordinates in the owner's local space. */
export type Collider =
  | { kind: 'box'; center: Vec3; half: Vec3; rotY: number }
  | { kind: 'cylinder'; center: Vec3; radius: number; height: number }
  | { kind: 'sphere'; center: Vec3; radius: number };

export type PropParams = Record<string, number | string | boolean>;

/**
 * A built prop, at the origin, facing +Z, standing on y = 0. `geometry` uses the shared lit material; `glow` (if
 * any) uses the shared glow material (flames, lit windows, the far light).
 */
export interface PropResult {
  geometry: THREE.BufferGeometry;
  colliders: Collider[];
  glow?: THREE.BufferGeometry;
}

export type PropBuilder = (rng: Rng, pal: Palette, params: PropParams) => PropResult;
