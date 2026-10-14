/**
 * Shared types and small math for the Burden (Burden.ts) and the Cross drop (CrossDrop.ts + cross-*.ts).
 *
 * `BurdenPlayer` is the slice of `Player` (src/player/Player.ts, ARCHITECTURE "Gameplay (Phase 2)") these modules
 * use, written structurally (a real Player is assignable to it) so these modules stay decoupled from the Player's
 * internals and can be driven by a stand-in in tests.
 */
import type * as THREE from 'three';
import type { Character } from '../gen/CharacterFactory';

/** The Controller's movement numbers (src/player/Controller.ts). */
export type { MoveParams } from './Controller';

export type BurdenPlayerMode = 'play' | 'locked' | 'cutscene';

/** What the Burden and the Cross need from the Player. */
export interface BurdenPlayer {
  readonly character: Character;
  readonly controller: {
    readonly position: THREE.Vector3;
    readonly velocity: THREE.Vector3;
    readonly grounded: boolean;
  };
  /** Interpolated feet position (render). */
  readonly renderPosition: THREE.Vector3;
  /** Horizontal facing (unit). */
  readonly forward: THREE.Vector3;
  mode: BurdenPlayerMode;
  /** Zone speed multiplier (1 by default); the Cross ramps it to 0 to bring the player to a stop. */
  speedScale: number;
  /** True: input only walks (no jumps or climbs); the Cross sets it while it slows the player. */
  walkOnly: boolean;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function easeInOutCubic(t: number): number {
  const u = clamp(t, 0, 1);
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
}

export function easeOutCubic(t: number): number {
  const u = 1 - clamp(t, 0, 1);
  return 1 - u * u * u;
}

/** Frame-rate independent smoothing factor for exponential damping at `rate` per second. */
export function damp(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

/** Horizontal distance. */
export function hdist(ax: number, az: number, bx: number, bz: number): number {
  return Math.hypot(bx - ax, bz - az);
}

/** Sound position tuple for the 'sfx' event. */
export function at3(v: THREE.Vector3): [number, number, number] {
  return [v.x, v.y, v.z];
}
