/**
 * Resting clips: sit, nap, pray, kneel. Ground contact comes from the measured rig (groundHips), so the seat
 * is at knee height and knees touch the ground on every body type. `sit` and `nap` sit on a seat at the
 * character's knee height (bench, stool, rock); place the character with its hips over the seat.
 */
import type { AnimParams, Pose, ProcClip } from './types';
import { rigOf } from './clips-rig';
import { reachArm } from './clips-ik';
import {
  HALF_PI,
  TAU,
  add,
  breathe,
  clamp,
  get,
  groundHips,
  leanOf,
  legWorld,
  limb,
  lookAround,
  posture,
  rot,
  smooth,
  styleOf,
  wobble,
  type Side,
} from './clips-util';

/** Kneeling foot: lying on its top behind the knee, toes pointing back. */
const KNEEL_FOOT = Math.PI - 0.35;

/**
 * Put a mitten on the lap (top of the thigh), `fwd` = fraction of the thigh from hip to knee, `inward` pulls
 * it toward the middle (1 = hands meet). Accounts for the torso pitch already written to `out`.
 */
function lapHand(out: Pose, p: AnimParams, side: Side, fwd: number, inward: number, w: number): void {
  const r = rigOf(p);
  const h = r.h;
  const chestY = h - r.headR - r.headC.y;
  const x =
    side * Math.max(0.03 * h, r.hipWidth * (1 - inward) + 0.02 * h * (1 - inward) + 0.025 * h * inward);
  const y = -r.hipJoint + 0.06 * h - (chestY - r.hipHeight);
  const z = fwd * r.thigh + 0.02 * h;
  const th = get(out, 'hips', 'x') + get(out, 'spine', 'x') + get(out, 'chest', 'x');
  const c = Math.cos(th);
  const s = Math.sin(th);
  reachArm(out, p, side, x, y * c + z * s, -y * s + z * c, side, -0.2, -1, w);
}

// ------------------------------------------------------------------------------------------------- sit

function sampleSit(t: number, p: AnimParams, out: Pose): void {
  const st = styleOf(p);
  const hp = -0.06;
  rot(out, 'hips', hp, 0, 0);
  // Thighs level on the seat, shins down, toes tapping in turn; knees drift in and out.
  const sway = 0.06 * Math.sin((TAU * t) / 5);
  for (let i = 0; i < 2; i++) {
    const side: Side = i === 0 ? 1 : -1;
    const tap = Math.max(0, Math.sin((TAU * t) / 1.25 + i * Math.PI)) * 0.22 * clamp(st.bounce, 0, 1.5);
    legWorld(out, side, HALF_PI, -0.05, hp, -tap, 0.08 + sway * side);
  }
  add(out, 'spine', 0.06, 0, 0);
  posture(out, leanOf(p) * 0.6, false);
  breathe(out, Math.sin((TAU * p.time) / 3.6), 1);
  lookAround(out, p.time, 0.8);
  for (let i = 0; i < 2; i++) {
    const side: Side = i === 0 ? 1 : -1;
    lapHand(out, p, side, 0.6, 0, 1);
    limb(out, 'hand', side, 0.35, 0, 0);
  }
  groundHips(out, p);
}

// ------------------------------------------------------------------------------------------------- nap

/** Nap loop: the head jerks awake at this normalised time. */
const NOD_AT = 0.72;
/** Normalised snore times (deep breaths out) in the nap loop. */
const SNORES = [0.375, 0.875] as const;

function sampleNap(t: number, p: AnimParams, out: Pose): void {
  const u = t / 6;
  const hp = -0.18;
  rot(out, 'hips', hp, 0, 0);
  for (let i = 0; i < 2; i++) {
    const side: Side = i === 0 ? 1 : -1;
    legWorld(out, side, HALF_PI - 0.1, -0.25, hp, 0.1, 0.14);
  }
  // Slumped, slow deep breathing.
  const breath = Math.sin((TAU * t) / 3);
  add(out, 'spine', 0.28, 0, 0);
  add(out, 'chest', 0.15 + 0.04 * breath, 0, 0);
  posture(out, leanOf(p) * 0.5, false);
  // The head sinks slowly, jerks awake on a springy neck (overshooting up), then sinks again.
  const sink = u < NOD_AT ? smooth(0, NOD_AT, u) : 1 - wobble(t - NOD_AT * 6, 2.2, 0.35);
  add(out, 'neck', 0.12 + 0.12 * sink, 0, 0);
  add(out, 'head', 0.1 + 0.4 * sink + 0.03 * breath, 0, 0.15 * Math.sin(TAU * u) * (0.4 + Math.max(0, sink)));
  for (let i = 0; i < 2; i++) {
    const side: Side = i === 0 ? 1 : -1;
    lapHand(out, p, side, 0.55, 1, 1);
  }
  groundHips(out, p);
}

// ------------------------------------------------------------------------------------------------ pray

function samplePray(t: number, p: AnimParams, out: Pose): void {
  const r = rigOf(p);
  const h = r.h;
  const hp = 0.04;
  rot(out, 'hips', hp, 0, 0.012 * Math.sin((TAU * t) / 5));
  // Kneeling on both knees, toes tucked behind.
  for (let i = 0; i < 2; i++) {
    const side: Side = i === 0 ? 1 : -1;
    legWorld(out, side, 0, HALF_PI, hp, KNEEL_FOOT, 0.04);
  }
  const breath = Math.sin((TAU * t) / 5);
  add(out, 'spine', 0.06, 0, 0);
  add(out, 'chest', 0.04 - 0.025 * breath, 0, 0);
  posture(out, leanOf(p) * 0.5, false);
  // Head bowed, a little deeper on each breath out.
  add(out, 'neck', 0.25, 0, 0);
  add(out, 'head', 0.28 + 0.06 * breath, 0, 0);
  // Mittens pressed together in front of the chest.
  const y = r.armL.shoulder.y - 0.06 * h;
  const z = r.bodyR + 0.07 * h;
  for (let i = 0; i < 2; i++) {
    const side: Side = i === 0 ? 1 : -1;
    reachArm(out, p, side, side * 0.022 * h, y, z, side * 0.8, -1, -0.3, 1);
    limb(out, 'hand', side, -0.25, 0, 0);
  }
  groundHips(out, p);
}

// ----------------------------------------------------------------------------------------------- kneel

function sampleKneel(t: number, p: AnimParams, out: Pose): void {
  const r = rigOf(p);
  const hp = 0.03;
  rot(out, 'hips', hp, -0.06, 0);
  // Left knee on the ground; right foot planted with the knee up (solved so the foot touches too).
  legWorld(out, 1, 0.05, HALF_PI, hp, KNEEL_FOOT, 0.06);
  const depth = r.thigh * Math.cos(0.05) + r.kneeR;
  const bR = -0.1;
  const cosA = clamp((depth - (r.shin + r.ankle) * Math.cos(bR)) / r.thigh, -1, 1);
  legWorld(out, -1, Math.acos(cosA), bR, hp, 0, 0.12);
  const breath = Math.sin((TAU * t) / 4);
  add(out, 'spine', 0.08, 0.06, 0);
  add(out, 'chest', -0.02 * breath, 0, 0);
  posture(out, leanOf(p) * 0.6, false);
  add(out, 'neck', 0.12, 0, 0);
  add(out, 'head', 0.12 + 0.03 * breath, 0, 0);
  // Right forearm rests across the raised knee; the left hangs loose.
  limb(out, 'upperArm', -1, -0.55, 0, 0.1);
  limb(out, 'lowerArm', -1, -0.95, -0.3, 0);
  limb(out, 'hand', -1, 0.3, 0, 0);
  limb(out, 'upperArm', 1, -0.1, 0, 0.08);
  limb(out, 'lowerArm', 1, -0.25, 0, 0);
  groundHips(out, p);
}

export const sit: ProcClip = { name: 'sit', loop: true, duration: 5, layer: 'full', sample: sampleSit };
export const nap: ProcClip = {
  name: 'nap',
  loop: true,
  duration: 6,
  layer: 'full',
  cues: SNORES,
  sample: sampleNap,
};
export const pray: ProcClip = { name: 'pray', loop: true, duration: 5, layer: 'full', sample: samplePray };
export const kneel: ProcClip = { name: 'kneel', loop: true, duration: 4, layer: 'full', sample: sampleKneel };
