/**
 * Jumps: hop (the small 0.3 m burdened hop), joyJump (big star jump) and land (squash on touchdown). Each has
 * anticipation, take-off stretch, air pose and a landing squash that springs back (squash on the hips, volume
 * preserving). The air arc is in the clip unless p.rootMotion is false (the controller then owns the height).
 */
import type { AnimParams, Pose, ProcClip } from './types';
import { rigOf } from './clips-rig';
import {
  addLimb,
  add,
  arc,
  armTo,
  bump,
  burdenOf,
  groundHips,
  hold,
  impulse,
  leanOf,
  legWorld,
  limb,
  posture,
  restArms,
  rot,
  smooth,
  type Side,
} from './clips-util';

/** Landing squash then a small stretchy overshoot, L = seconds since touchdown. */
function landSquash(L: number, depth: number): number {
  if (L < 0) return 0;
  return -depth * impulse(L, 14) + 0.35 * depth * bump(L, 0.1, 0.3);
}

/** Landing give: knees soak up the touchdown over ~0.1 s, then straighten (L = seconds since touchdown). */
function give(L: number, len: number): number {
  return smooth(0, 0.1, L) * (1 - smooth(0.14, len, L));
}

/** Airborne weight: 1 between take-off and touchdown, eased over a few frames. */
function airborne(t: number, off: number, land: number): number {
  return smooth(off, off + 0.05, t) * (1 - smooth(land - 0.04, land, t));
}

// ------------------------------------------------------------------------------------------------- hop

const HOP_LEN = 0.8;
const HOP_OFF = 0.17;
const HOP_LAND = 0.55;

function sampleHop(t: number, p: AnimParams, out: Pose): void {
  const bb = burdenOf(p);
  const pre = smooth(0, 0.1, t) * (1 - smooth(0.1, HOP_OFF + 0.02, t));
  const tuck = bump(t, HOP_OFF, HOP_LAND);
  const post = give(t - HOP_LAND, HOP_LEN - HOP_LAND);
  const crouch = 0.9 * pre + (0.75 + 0.25 * bb) * post;
  const hp = 0.12 * crouch;
  rot(out, 'hips', hp, 0, 0);
  for (let i = 0; i < 2; i++) {
    const side: Side = i === 0 ? 1 : -1;
    legWorld(out, side, 0.55 * crouch + 0.5 * tuck, 0.7 * crouch + 0.35 * tuck, hp, 0.35 * tuck, 0.04);
  }
  // Arms back while crouching, forward and up at take-off, out for balance, then down on landing.
  const up = bump(t, HOP_OFF - 0.05, HOP_OFF + 0.25);
  restArms(out, 0);
  for (let i = 0; i < 2; i++) {
    const side: Side = i === 0 ? 1 : -1;
    addLimb(out, 'upperArm', side, 0.5 * pre - 0.9 * up + 0.3 * post, 0, 0.4 * tuck + 0.2 * post);
    addLimb(out, 'lowerArm', side, -0.3 * up, 0, 0);
  }
  posture(out, leanOf(p) + 0.1 * crouch, false);
  add(out, 'head', -0.08 * up + 0.08 * post, 0, 0);
  const air = (t - HOP_OFF) / (HOP_LAND - HOP_OFF);
  out.squash =
    1 - 0.1 * pre + 0.1 * bump(t, HOP_OFF - 0.03, HOP_OFF + 0.2) + landSquash(t - HOP_LAND, 0.16 + 0.04 * bb);
  groundHips(out, p, arc(p, air, 0.19), airborne(t, HOP_OFF, HOP_LAND));
}

// -------------------------------------------------------------------------------------------- joy jump

const JOY_LEN = 1.4;
const JOY_OFF = 0.28;
const JOY_LAND = 0.95;

function sampleJoy(t: number, p: AnimParams, out: Pose): void {
  const r = rigOf(p);
  const pre = smooth(0, 0.18, t) * (1 - smooth(0.18, JOY_OFF + 0.02, t));
  const star = hold(t, JOY_OFF, JOY_LAND, 0.15, 0.2);
  const post = give(t - JOY_LAND, JOY_LEN - JOY_LAND - 0.1);
  const yay = hold(t, JOY_LAND + 0.05, JOY_LEN, 0.1, 0.2);
  const crouch = pre + 0.8 * post;
  const hp = 0.15 * crouch - 0.05 * star;
  rot(out, 'hips', hp, 0, 0);
  for (let i = 0; i < 2; i++) {
    const side: Side = i === 0 ? 1 : -1;
    legWorld(
      out,
      side,
      0.75 * crouch + 0.12 * star,
      0.95 * crouch + 0.2 * star,
      hp,
      0.4 * star,
      0.04 + 0.42 * star,
    );
  }
  // Arms: swing back in the crouch, flung up into a big V at the top, then a little "yay" pump.
  restArms(out, 0);
  for (let i = 0; i < 2; i++) {
    const side: Side = i === 0 ? 1 : -1;
    addLimb(out, 'upperArm', side, 0.7 * pre, 0, 0);
    armTo(out, side, star, -0.25, 0, 2.45, -0.1, 0, 0, 0, 0, 0.3);
    armTo(out, side, yay * (1 - star), -0.6, 0, 0.45, -1.6, -0.3, 0, 0.2, 0, 0);
  }
  add(out, 'spine', -0.06 * star, 0, 0);
  add(out, 'chest', -0.12 * star + 0.1 * pre, 0, 0);
  add(out, 'head', -0.28 * star + 0.15 * pre + 0.06 * post, 0, 0);
  posture(out, leanOf(p) * (1 - star), false);
  const air = (t - JOY_OFF) / (JOY_LAND - JOY_OFF);
  // A tiny extra bounce of joy after landing.
  const bounce = r.h * 0.03 * bump(t, 1.12, 1.32);
  out.squash =
    1 - 0.14 * pre + 0.18 * bump(t, JOY_OFF - 0.03, JOY_OFF + 0.25) + landSquash(t - JOY_LAND, 0.2);
  groundHips(out, p, arc(p, air, 0.5) + bounce, airborne(t, JOY_OFF, JOY_LAND));
}

// ------------------------------------------------------------------------------------------------ land

const LAND_LEN = 0.5;

function sampleLand(t: number, p: AnimParams, out: Pose): void {
  const crouch = give(t, LAND_LEN);
  const hp = 0.15 * crouch;
  rot(out, 'hips', hp, 0, 0);
  for (let i = 0; i < 2; i++) {
    const side: Side = i === 0 ? 1 : -1;
    legWorld(out, side, 0.6 * crouch, 0.75 * crouch, hp, 0, 0.04 + 0.03 * crouch);
  }
  restArms(out, 0);
  for (let i = 0; i < 2; i++) {
    const side: Side = i === 0 ? 1 : -1;
    addLimb(out, 'upperArm', side, -0.2 * crouch, 0, 0.35 * crouch);
    limb(out, 'lowerArm', side, -0.18 - 0.4 * crouch, 0, 0);
  }
  posture(out, leanOf(p) + 0.12 * crouch, false);
  add(out, 'head', 0.12 * crouch, 0, 0);
  out.squash = 1 + landSquash(t, 0.18);
  groundHips(out, p);
}

export const hop: ProcClip = {
  name: 'hop',
  loop: false,
  duration: HOP_LEN,
  layer: 'full',
  cues: [HOP_OFF / HOP_LEN, HOP_LAND / HOP_LEN],
  sample: sampleHop,
};

export const joyJump: ProcClip = {
  name: 'joyJump',
  loop: false,
  duration: JOY_LEN,
  layer: 'full',
  cues: [JOY_OFF / JOY_LEN, JOY_LAND / JOY_LEN],
  sample: sampleJoy,
};

export const land: ProcClip = {
  name: 'land',
  loop: false,
  duration: LAND_LEN,
  layer: 'full',
  cues: [0],
  sample: sampleLand,
};
