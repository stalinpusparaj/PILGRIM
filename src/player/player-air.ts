/**
 * Jumps and landings as the player feels them (GDD 2.7.1): the expected air time of a jump (to time-warp the jump
 * clip), the take-off sound, and landing feedback (a thud, and a dust puff plus squash on big drops).
 */
import type * as THREE from 'three';
import '../audio/events';
import { events } from '../core/Events';
import type { World } from '../world/World';
import type { MoveParams } from './Controller';

/** Capsule and feel numbers of the player body. */
export const BODY = {
  radius: 0.35,
  /** Capsule height = character height, within these limits (m). */
  minHeight: 1.1,
  maxHeight: 1.9,
  /** Drop height (m) that counts as a hard landing (squash, dust, louder thud). */
  hardDrop: 1.6,
  /** Landings slower than this (m/s) make no sound. */
  quietLand: 2.5,
  /** Dust puff size on a hard landing. */
  landDust: 10,
} as const;

function gravityOf(p: Readonly<MoveParams>): number {
  const g = Math.abs(p.gravity);
  return g > 0.1 ? g : 24;
}

/** Seconds from take-off to touchdown on flat ground for these params. */
export function airTimeOf(p: Readonly<MoveParams>): number {
  return 2 * Math.sqrt((2 * Math.max(0.05, p.jumpHeight)) / gravityOf(p));
}

/** True when a touchdown at `landSpeed` is a big drop (v^2 / 2g above BODY.hardDrop). */
export function isHardLanding(landSpeed: number, p: Readonly<MoveParams>): boolean {
  return (landSpeed * landSpeed) / (2 * gravityOf(p)) > BODY.hardDrop;
}

/** Take-off sound: the burdened hop is lower and softer. */
export function jumpSound(at: THREE.Vector3, burdened: boolean): void {
  events.emit('sfx', {
    id: 'jump',
    at: [at.x, at.y, at.z],
    pitch: burdened ? 0.8 : 1,
    volume: burdened ? 0.7 : 0.8,
  });
}

/** Touchdown feedback: dust on hard landings, a thud unless it was a tiny step down. */
export function landingFx(world: World, at: THREE.Vector3, landSpeed: number, hard: boolean): void {
  if (hard) world.particles.emit('dust', at, BODY.landDust);
  if (hard || landSpeed > BODY.quietLand) {
    events.emit('sfx', { id: 'land', at: [at.x, at.y, at.z], volume: hard ? 1 : 0.55 });
  }
}
