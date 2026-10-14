/**
 * What the follow camera needs from the player and the collision world, as structural types: `Player`
 * (src/player/Player.ts) and `CollisionWorld` (src/world/Collision.ts) satisfy them as documented in
 * ARCHITECTURE "Gameplay (Phase 2)", so the camera builds and can be tested without importing either.
 */
import type * as THREE from 'three';

export interface CameraTarget {
  /** Feet position interpolated for the frame being drawn (Player.render(alpha) runs before the camera's). */
  readonly renderPosition: THREE.Vector3;
  /** Facing, a horizontal unit vector (+Z at rotation.y = 0). */
  readonly forward: THREE.Vector3;
  readonly controller: {
    /** Feet position after the last fixed step. */
    readonly position: THREE.Vector3;
    readonly velocity: THREE.Vector3;
    readonly grounded: boolean;
  };
  /** May be swapped (outfit changes); read every step. */
  readonly character: {
    readonly height: number;
    /** 0 = no sack, 1 = normal, up to 1.6 (GDD 2.7.1 growth). */
    readonly burdenSize: number;
    /** Foot-plant counter (heavy burdened steps). */
    readonly animator: { readonly steps: number };
  };
}

export interface CameraCollision {
  /** Distance to the first terrain or collider hit along `dir` (unit), or null within `maxDist`. */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): number | null;
  /** Terrain or the highest walkable top at/below fromY + step-up. */
  groundAt(x: number, z: number, fromY?: number): number;
}
