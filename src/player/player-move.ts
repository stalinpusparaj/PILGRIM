/**
 * Player movement helpers (GDD 2.6, 2.7.1, 2.15): camera-relative wish velocity from the move stick / keys,
 * smooth facing, angle maths, and the speeds used when no Burden system is running.
 * Everything here is allocation-free (scratch objects are module level).
 */
import * as THREE from 'three';
import type { MoveParams } from './Controller';
import { BURDENED_MOVE, FREE_MOVE } from './Burden';

/** Speeds when no Burden system is running (its own GDD 2.7.1 numbers). */
export const BURDENED_FALLBACK: Readonly<MoveParams> = BURDENED_MOVE;
export const FREE_FALLBACK: Readonly<MoveParams> = FREE_MOVE;

export const TAU = Math.PI * 2;

/** Facing turn: exponential ease (per second) with a top speed (rad/s). Burdened turns are slower and heavier. */
export const TURN = {
  free: { ease: 10, max: 7 },
  burdened: { ease: 6, max: 4 },
} as const;

/** Wish speeds below this (m/s) leave the facing alone. */
const TURN_MIN = 0.05;

/** New facing yaw: turns toward a wish velocity (m/s) with the free or the slower, heavier burdened turn. */
export function faceWish(yaw: number, wish: { x: number; z: number }, dt: number, burdened: boolean): number {
  if (wish.x * wish.x + wish.z * wish.z <= TURN_MIN * TURN_MIN) return yaw;
  const t = burdened ? TURN.burdened : TURN.free;
  return turnToward(yaw, yawOf(wish.x, wish.z), dt, t.ease, t.max);
}

/** Wraps an angle to (-PI, PI]. */
export function wrapAngle(a: number): number {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

/** Shortest-way interpolation between two yaw angles. */
export function lerpAngle(a: number, b: number, t: number): number {
  return a + wrapAngle(b - a) * t;
}

/** Yaw (rotation.y) that makes a +Z-facing character look along (x, z). */
export function yawOf(x: number, z: number): number {
  return Math.atan2(x, z);
}

/** Turns `yaw` toward `target`: eased, capped at `max` rad/s. Returns the new yaw (wrapped). */
export function turnToward(yaw: number, target: number, dt: number, ease: number, max: number): number {
  const d = wrapAngle(target - yaw);
  let step = d * (1 - Math.exp(-ease * dt));
  const cap = max * dt;
  if (step > cap) step = cap;
  else if (step < -cap) step = -cap;
  return wrapAngle(yaw + step);
}

const camDir = new THREE.Vector3();
/** Last usable camera heading, kept for the rare frame the camera looks straight down. */
const lastHeading = { x: 0, z: 1 };

/**
 * Camera-relative wish velocity on XZ (m/s). `mx`/`my` are the move stick (-1..1, y = forward, length <= 1),
 * `speed` the speed at full stick. Pushing "forward" walks away from the camera; "right" walks to screen right.
 */
export function cameraWish(
  camera: THREE.Camera,
  mx: number,
  my: number,
  speed: number,
  out: { x: number; z: number },
): { x: number; z: number } {
  camera.getWorldDirection(camDir);
  let fx = camDir.x;
  let fz = camDir.z;
  const len = Math.sqrt(fx * fx + fz * fz);
  if (len > 1e-3) {
    fx /= len;
    fz /= len;
    lastHeading.x = fx;
    lastHeading.z = fz;
  } else {
    fx = lastHeading.x;
    fz = lastHeading.z;
  }
  // right = forward x up = (-fz, 0, fx)
  out.x = (fx * my - fz * mx) * speed;
  out.z = (fz * my + fx * mx) * speed;
  return out;
}

/** Copies every MoveParams field into `out` (no allocation) and scales the ground speeds. */
export function scaledParams(src: Readonly<MoveParams>, speedScale: number, out: MoveParams): MoveParams {
  Object.assign(out, src);
  const s = Number.isFinite(speedScale) ? Math.max(0, speedScale) : 1;
  out.walkSpeed = src.walkSpeed * s;
  out.runSpeed = src.runSpeed * s;
  return out;
}
