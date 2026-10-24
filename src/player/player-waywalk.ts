/**
 * "Hold to walk the Way" (touch, DECISIONS #393). While a thumb rests on the move side without dragging, the
 * Player walks by itself: toward the chapter's goal when it is close (a person, a gate, a waystone), else along
 * the main Way a few metres ahead of the nearest point, so he follows its bends. He stops at the goal and at the
 * Way's end. A drag takes over at once (the ordinary stick).
 */
import * as THREE from 'three';
import { services } from '../core/Services';
import type { Way } from '../gen/Way';

/** Metres along the Way to aim at: far enough to round bends smoothly, near enough to keep to the path. */
const AHEAD_M = 6;
/** A chapter goal within this distance (m) is walked to directly. */
const GOAL_NEAR_M = 18;
/** Stop this close (m) to a goal. */
const ARRIVE_M = 1.6;

const aim = new THREE.Vector3();

/** Fills `out` (m/s on XZ) for an auto-walk from `feet`; false when there is nowhere to go (arrived, Way's end). */
export function wayWalkWish(way: Way, feet: THREE.Vector3, speed: number, out: { x: number; z: number }): boolean {
  const goal = services.tryGet('guide')?.sample();
  let tx: number;
  let tz: number;
  const g = goal?.custom ? goal.target : null;
  const gd = g ? Math.hypot(g.x - feet.x, g.z - feet.z) : Infinity;
  if (g && gd < GOAL_NEAR_M) {
    if (gd < ARRIVE_M) return false;
    tx = g.x;
    tz = g.z;
  } else {
    const near = way.closest(feet.x, feet.z);
    if (near.t >= 0.999) return false;
    way.sample(Math.min(1, near.t + AHEAD_M / way.length), aim);
    tx = aim.x;
    tz = aim.z;
  }
  const dx = tx - feet.x;
  const dz = tz - feet.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.3) return false;
  out.x = (dx / len) * speed;
  out.z = (dz / len) * speed;
  return true;
}
