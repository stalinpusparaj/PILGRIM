/**
 * Standing and locomotion clips: idle, walk, run, burdened walk, cover-ears run. Stride cadence and thigh swing
 * are solved together from p.speed (clips-gait.ts) so planted feet do not slide; the cadence goes through `rate`,
 * so the Animator integrates the phase and speed changes never make the legs jump.
 * Gait phase 0 = left foot strikes in front, 0.5 = right foot strikes.
 */
import type { AnimParams, Pose, ProcClip } from './types';
import { rigOf } from './clips-rig';
import { reachArm } from './clips-ik';
import { signatureArms } from './clips-pose';
import { legSpeed, plantedGait, steadyLegs, type Gait, type GaitSpec } from './clips-gait';
import {
  TAU,
  add,
  addLimb,
  armSwing,
  bump,
  burdenOf,
  clamp,
  frac,
  gaitLeg,
  groundHips,
  impulse,
  leanOf,
  legWorld,
  limb,
  lookAround,
  posture,
  breathe,
  rot,
  restArms,
  speedOf,
  styleOf,
  type Side,
} from './clips-util';

/** Counter-rotate the torso against the hips so shoulders swing opposite the legs (legs: steadyLegs). */
function torsoTwist(out: Pose, hipYaw: number, hipRoll: number, chestAmt: number): void {
  add(out, 'spine', 0, -hipYaw * 0.5, -hipRoll * 0.4);
  add(out, 'chest', 0, -hipYaw * chestAmt, -hipRoll * 0.4);
  add(out, 'head', 0, hipYaw * 0.3, 0);
}

// ------------------------------------------------------------------------------------------------ gaits

// Shared scratch (no allocation per frame); each *Gait() fills `G` and returns it.
const G: Gait = { swing: 0, rate: 0 };
/** A brisk toy stride; stiff walkers take quicker, shorter steps. */
const WALK: GaitSpec = {
  pref: 0,
  contact: 0.5,
  bias: 0.02,
  sweep: 1,
  minSwing: 0.12,
  maxSwing: 0.85,
  lo: 0.5,
  hi: 3.6,
};
/** Feet touch down around mid-stance between flights (legs split in the air). */
const RUN: GaitSpec = {
  pref: 0,
  contact: 0.25,
  bias: 0.16,
  sweep: Math.SQRT1_2,
  minSwing: 0.3,
  maxSwing: 0.95,
  lo: 0.9,
  hi: 4.4,
};
/** Short, quick, heavy steps under the sack. */
const BURDENED: GaitSpec = {
  pref: 0,
  contact: 0.5,
  bias: 0.04,
  sweep: 1,
  minSwing: 0.1,
  maxSwing: 0.7,
  lo: 0.45,
  hi: 3.0,
};

function walkGait(p: AnimParams): Gait {
  WALK.pref = (0.9 + 0.25 * legSpeed(p)) * (1 + 0.15 * styleOf(p).stiffness);
  return plantedGait(p, WALK, G);
}

function runGait(p: AnimParams, frantic = 0): Gait {
  RUN.pref = 1.4 + 0.17 * legSpeed(p) + frantic;
  return plantedGait(p, RUN, G);
}

function burdenedGait(p: AnimParams): Gait {
  BURDENED.pref = (1.0 + 0.3 * legSpeed(p)) * (1 + 0.1 * (Math.max(0.6, burdenOf(p)) - 1));
  return plantedGait(p, BURDENED, G);
}

// ------------------------------------------------------------------------------------------------ idle

function sampleIdle(_t: number, p: AnimParams, out: Pose): void {
  const st = styleOf(p);
  const r = rigOf(p);
  const burden = burdenOf(p);
  const calm = 1 - 0.7 * st.stiffness;
  const time = p.time;
  // Breathing: slower and deeper under the burden.
  const breathHz = burden > 0.05 ? 1 / 2.8 : 1 / 3.6;
  breathe(out, Math.sin(TAU * time * breathHz), 1 + 0.6 * burden);
  // Weight shift from leg to leg; swagger cocks a hip.
  const w = Math.sin((TAU * time) / 7.3) * calm;
  const cock = 0.6 * st.swagger;
  const shift = clamp(w + cock, -1, 1);
  out.hips.x = 0.014 * r.h * shift;
  // Contrapposto: the loaded hip rides up, the shoulders tilt back the other way.
  rot(out, 'hips', 0, 0.03 * shift, 0.045 * shift);
  add(out, 'spine', 0, 0, -0.06 * shift);
  add(out, 'chest', 0, -0.02 * shift, -0.015 * shift);
  // The unloaded leg relaxes its knee.
  for (let i = 0; i < 2; i++) {
    const s: Side = i === 0 ? 1 : -1;
    const slack = Math.max(0, -shift * s);
    legWorld(out, s, 0.06 * slack, 0.1 * slack, 0, 0, 0.03 + 0.05 * st.swagger);
    add(out, i === 0 ? 'thighL' : 'thighR', 0, 0, -0.045 * shift);
  }
  if (p.pose) signatureArms(out, p, p.pose);
  else restArms(out, st.swagger);
  posture(out, leanOf(p), false);
  // The burdened hitch the sack up every few seconds.
  let hitchLift = 0;
  if (burden > 0.05) {
    const u = frac(time / 6.2);
    const hitch = bump(u, 0.82, 0.95) * burden;
    add(out, 'chest', -0.08 * hitch, 0, 0);
    addLimb(out, 'upperArm', 1, -0.08 * hitch, 0, 0.06 * hitch);
    addLimb(out, 'upperArm', -1, -0.08 * hitch, 0, 0.06 * hitch);
    hitchLift = 0.01 * r.h * hitch;
  }
  lookAround(out, time, calm);
  groundHips(out, p, hitchLift);
}

// ------------------------------------------------------------------------------------------------ walk

function sampleWalk(t: number, p: AnimParams, out: Pose): void {
  const ph = frac(t);
  const st = styleOf(p);
  const r = rigOf(p);
  const k = clamp(speedOf(p) / 3.4, 0.25, 1.5);
  const loose = 1 - 0.55 * st.stiffness;
  const s = Math.sin(TAU * ph);
  const c = Math.cos(TAU * ph);
  const hp = 0.04 * k;
  const yaw = -0.09 * k * (1 + 0.8 * st.swagger) * (1 - 0.7 * st.stiffness) * c;
  const roll = 0.035 * (0.6 + st.swagger) * s;
  rot(out, 'hips', hp, yaw, roll);
  out.hips.x = 0.012 * r.h * (1 + st.swagger) * s;
  torsoTwist(out, yaw, roll, 0.8);
  const swing = walkGait(p).swing;
  const knee = (0.55 + 0.35 * k) * loose;
  gaitLeg(out, 1, ph, swing, WALK.bias, knee, 0.12 * loose, 0.22 * loose, hp, 1);
  gaitLeg(out, -1, ph + 0.5, swing, WALK.bias, knee, 0.12 * loose, 0.22 * loose, hp, 1);
  steadyLegs(out, p, yaw, roll);
  const arm = (0.28 + 0.2 * k) * (1 - 0.75 * st.stiffness) * (1 + 0.3 * st.swagger);
  armSwing(out, 1, ph, arm, 0.25 + 0.1 * k, 0.06 + 0.08 * st.swagger);
  armSwing(out, -1, ph + 0.5, arm, 0.25 + 0.1 * k, 0.06 + 0.08 * st.swagger);
  posture(out, leanOf(p) + 0.03 * k, false);
  // Toy bounce: a little hop on every step, sharp at the foot plant.
  const hop = Math.abs(s);
  add(out, 'head', 0.03 * (hop - 0.5) * st.bounce, 0, 0);
  out.squash = 1 + 0.02 * st.bounce * (hop - 0.5);
  groundHips(out, p, (0.006 + 0.014 * st.bounce) * r.h * Math.sqrt(k) * hop);
}

// ------------------------------------------------------------------------------------------------- run

function runLegs(out: Pose, p: AnimParams, ph: number, swing: number, hp: number, knee: number): number {
  const st = styleOf(p);
  const loose = 1 - 0.45 * st.stiffness;
  gaitLeg(out, 1, ph, swing, RUN.bias, knee * loose, 0.32 * loose, 0.15, hp);
  gaitLeg(out, -1, ph + 0.5, swing, RUN.bias, knee * loose, 0.32 * loose, 0.15, hp);
  // Flight with the legs split (around each push-off and reach); a foot is down only around mid-stance.
  const f = Math.cos(2 * TAU * ph);
  return f > 0 ? f : 0;
}

function sampleRun(t: number, p: AnimParams, out: Pose): void {
  const ph = frac(t);
  const st = styleOf(p);
  const r = rigOf(p);
  const k = clamp(speedOf(p) / 6, 0.4, 1.4);
  const c = Math.cos(TAU * ph);
  const hp = 0.1 * k;
  const yaw = -0.12 * k * (1 - 0.6 * st.stiffness) * c;
  const roll = 0.03 * (0.5 + st.swagger) * Math.sin(TAU * ph);
  rot(out, 'hips', hp, yaw, roll);
  torsoTwist(out, yaw, roll, 1.1);
  const flight = runLegs(out, p, ph, runGait(p).swing, hp, 1.45);
  steadyLegs(out, p, yaw, roll);
  const pump = (0.5 + 0.15 * k) * (1 - 0.6 * st.stiffness);
  for (let i = 0; i < 2; i++) {
    const s: Side = i === 0 ? 1 : -1;
    const cs = i === 0 ? c : -c;
    limb(out, 'upperArm', s, pump * cs, 0, 0.14);
    limb(out, 'lowerArm', s, -1.35 - 0.3 * (cs < 0 ? -cs : 0), -0.2, 0);
    limb(out, 'hand', s, 0.15, 0, 0);
  }
  posture(out, leanOf(p) + 0.14 + 0.06 * k, false);
  add(out, 'head', -0.06, 0, 0);
  out.squash = 1 + 0.03 * st.bounce * (flight - 0.4);
  groundHips(out, p, r.h * (0.03 + 0.015 * st.bounce) * k * flight);
}

// --------------------------------------------------------------------------------------- burdened walk

/** Normalised time of the huff in the 4-cycle (8-step) burdened loop. */
const HUFF_AT = 0.85;

function sampleBurdened(t: number, p: AnimParams, out: Pose): void {
  const u = frac(t / 4);
  const ph = frac(t);
  const st = styleOf(p);
  const r = rigOf(p);
  const bb = Math.max(0.6, burdenOf(p));
  const k = clamp(speedOf(p) / 2, 0.3, 1.3);
  const loose = 1 - 0.5 * st.stiffness;
  const s = Math.sin(TAU * ph);
  const c = Math.cos(TAU * ph);
  // Heavy waddle: the hips roll and the chest rocks over each planted foot.
  const hp = 0.06;
  const roll = 0.05 * (1 + 0.4 * bb) * s;
  const yaw = -0.05 * k * c;
  rot(out, 'hips', hp, yaw, roll);
  out.hips.x = 0.018 * r.h * s;
  torsoTwist(out, yaw, roll, 0.6);
  add(out, 'chest', 0, 0, -0.05 * s);
  // Short, quick, planted strides; a growing burden lowers the knees so the feet drag along the ground.
  const swing = burdenedGait(p).swing;
  const knee = (0.42 + 0.1 * k) * (1.25 - 0.4 * bb) * loose;
  gaitLeg(out, 1, ph, swing, BURDENED.bias, knee, 0.16, 0.12, hp, 1);
  gaitLeg(out, -1, ph + 0.5, swing, BURDENED.bias, knee, 0.16, 0.12, hp, 1);
  steadyLegs(out, p, yaw, roll);
  // Mittens grip the sack's straps at the chest; a small sway with each step.
  for (let i = 0; i < 2; i++) {
    const side: Side = i === 0 ? 1 : -1;
    const cs = i === 0 ? c : -c;
    limb(out, 'upperArm', side, -0.45 + 0.05 * cs, 0, 0.3);
    limb(out, 'lowerArm', side, -1.75, -0.25, 0);
    limb(out, 'hand', side, 0.3, 0, 0);
  }
  // About 20 degrees forward (GDD 2.7.1).
  posture(out, leanOf(p) + 0.09, false);
  // Plod: the body sinks after each foot plant and pushes back up.
  const q = frac(ph * 2);
  const plod = impulse(q, 7);
  add(out, 'head', 0.05 * plod, 0, 0);
  // Huff: draw breath (straighten, shoulders up) then puff out and sag.
  const inhale = bump(u, 0.6, HUFF_AT);
  const exhale = bump(u, HUFF_AT - 0.02, 1);
  add(out, 'chest', -0.1 * inhale + 0.08 * exhale, 0, 0);
  add(out, 'head', -0.1 * inhale + 0.12 * exhale, 0, 0);
  addLimb(out, 'upperArm', 1, 0, 0, 0.06 * inhale);
  addLimb(out, 'upperArm', -1, 0, 0, 0.06 * inhale);
  out.squash = 1 - 0.025 * plod * bb + 0.015 * inhale;
  groundHips(out, p, -0.012 * r.h * bb * plod);
}

// -------------------------------------------------------------------------------------- cover-ears run

function sampleCoverEars(t: number, p: AnimParams, out: Pose): void {
  const ph = frac(t);
  const r = rigOf(p);
  const k = clamp(speedOf(p) / 5, 0.4, 1.3);
  const c = Math.cos(TAU * ph);
  const hp = 0.12;
  const yaw = -0.08 * c;
  rot(out, 'hips', hp, yaw, 0);
  torsoTwist(out, yaw, 0, 0.4);
  const flight = runLegs(out, p, ph, runGait(p, 0.3).swing, hp, 1.2);
  steadyLegs(out, p, yaw, 0);
  // Hunched, head shaking "no no no".
  posture(out, leanOf(p) + 0.26, false);
  add(out, 'neck', 0.12, 0, 0);
  add(out, 'head', 0, 0.28 * Math.sin(2 * TAU * ph), 0.06 * Math.sin(TAU * ph));
  // Mittens clamped over the ears, jiggling with the stride.
  const jig = 0.012 * r.h * Math.sin(2 * TAU * ph);
  for (let i = 0; i < 2; i++) {
    const side: Side = i === 0 ? 1 : -1;
    reachArm(
      out,
      p,
      side,
      side * (r.headR + 0.035 * r.h),
      r.headC.y - 0.03 * r.h + jig,
      0.02 * r.h,
      side,
      -0.25,
      -0.35,
      1,
      'roll',
    );
  }
  out.squash = 1 + 0.025 * (flight - 0.4);
  groundHips(out, p, r.h * 0.03 * k * flight);
}

export const idle: ProcClip = { name: 'idle', loop: true, duration: 6, layer: 'full', sample: sampleIdle };

export const walk: ProcClip = {
  name: 'walk',
  loop: true,
  duration: 1,
  layer: 'full',
  gait: 1,
  steps: [0, 0.5],
  rate: (p) => walkGait(p).rate,
  sample: sampleWalk,
};

export const run: ProcClip = {
  name: 'run',
  loop: true,
  duration: 1,
  layer: 'full',
  gait: 1,
  steps: [0.125, 0.625], // touch-downs, after each split-leg flight
  rate: (p) => runGait(p).rate,
  sample: sampleRun,
};

export const burdenedWalk: ProcClip = {
  name: 'burdenedWalk',
  loop: true,
  duration: 4,
  layer: 'full',
  gait: 4,
  steps: [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875],
  cues: [HUFF_AT],
  rate: (p) => burdenedGait(p).rate,
  sample: sampleBurdened,
};

export const coverEarsRun: ProcClip = {
  name: 'coverEarsRun',
  loop: true,
  duration: 1,
  layer: 'full',
  gait: 1,
  steps: [0.125, 0.625],
  rate: (p) => runGait(p, 0.3).rate,
  sample: sampleCoverEars,
};
