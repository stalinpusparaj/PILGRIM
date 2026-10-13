/**
 * Effort clips: climb (ladder / rock face, hand over hand, facing +Z) and push (leaning into something
 * heavy). Cadence follows p.speed like the gaits; with speed 0 they keep a slow straining rhythm.
 */
import type { AnimParams, Pose, ProcClip } from './types';
import { rigOf } from './clips-rig';
import { legSpeed, plantedGait, steadyLegs, type Gait, type GaitSpec } from './clips-gait';
import {
  TAU,
  add,
  cadence,
  frac,
  gaitLeg,
  groundHips,
  leanOf,
  legWorld,
  limb,
  posture,
  rot,
  styleOf,
  type Side,
} from './clips-util';

// ----------------------------------------------------------------------------------------------- climb

function sampleClimb(t: number, p: AnimParams, out: Pose): void {
  const ph = frac(t);
  const r = rigOf(p);
  const c = Math.cos(TAU * ph);
  const s = Math.sin(TAU * ph);
  const hp = 0.12;
  rot(out, 'hips', hp, 0, 0.04 * s);
  out.hips.x = 0.01 * r.h * s;
  // Each pull lifts the body a little; the root itself is moved by the caller.
  out.hips.y = 0.015 * r.h * Math.sin(2 * TAU * ph);
  for (let i = 0; i < 2; i++) {
    const side: Side = i === 0 ? 1 : -1;
    const up = 0.5 + 0.5 * (i === 0 ? c : -c); // this leg's step height, 0..1
    legWorld(out, side, 1.1 * up, 0.05 + 0.3 * up, hp, -0.1 * up, 0.08);
    // Opposite hand reaches high while this foot steps up.
    const reach = 1 - up;
    // Raised arms open into a V so they pass beside the big head.
    limb(out, 'upperArm', side, -1.65 - 1.1 * reach, 0, 0.25 + 0.3 * reach);
    limb(out, 'lowerArm', side, -0.15 - 0.9 * (1 - reach), 0, 0);
    limb(out, 'hand', side, -0.3, 0, 0);
  }
  add(out, 'spine', 0.05, 0, -0.03 * s);
  add(out, 'neck', -0.1, 0, 0);
  add(out, 'head', -0.15, 0.08 * s, 0);
}

// ------------------------------------------------------------------------------------------------ push

const G: Gait = { swing: 0, rate: 0 };
/** Slow strong steps, feet behind the hips (clips-gait.ts keeps them planted). */
const PUSH: GaitSpec = {
  pref: 0,
  contact: 0.5,
  bias: -0.25,
  sweep: 1,
  minSwing: 0.1,
  maxSwing: 0.7,
  lo: 0.35,
  hi: 2.2,
};

function pushGait(p: AnimParams): Gait {
  PUSH.pref = 0.8 + 0.25 * legSpeed(p);
  return plantedGait(p, PUSH, G);
}

function samplePush(t: number, p: AnimParams, out: Pose): void {
  const ph = frac(t);
  const st = styleOf(p);
  const r = rigOf(p);
  const s = Math.sin(TAU * ph);
  const hp = 0.3;
  const yaw = -0.05 * Math.cos(TAU * ph);
  rot(out, 'hips', hp, yaw, 0.03 * s);
  // Driving, planted steps with the feet set back behind the hips.
  const swing = pushGait(p).swing;
  gaitLeg(out, 1, ph, swing, PUSH.bias, 0.55, 0.3, 0.25, hp, 1);
  gaitLeg(out, -1, ph + 0.5, swing, PUSH.bias, 0.55, 0.3, 0.25, hp, 1);
  steadyLegs(out, p, yaw, 0.03 * s);
  add(out, 'spine', 0.2, 0, -0.02 * s);
  posture(out, leanOf(p) * 0.3, false);
  // Strain: a fine tremble through the shoulders.
  const tremble = 0.012 * Math.sin(TAU * 9 * p.time) * (1 - 0.5 * st.stiffness);
  add(out, 'chest', 0.05 + tremble, 0, 0);
  add(out, 'neck', -0.25, 0, 0);
  add(out, 'head', -0.15, 0, 0);
  // Arms level forward at the shoulders, elbows soft, palms flat against the load.
  for (let i = 0; i < 2; i++) {
    const side: Side = i === 0 ? 1 : -1;
    limb(out, 'upperArm', side, -0.95 + 0.04 * (i === 0 ? s : -s), 0, 0.12);
    limb(out, 'lowerArm', side, -0.5, -0.15, 0);
    limb(out, 'hand', side, -0.6, 0, 0);
  }
  out.squash = 1 - 0.015 * Math.abs(s);
  groundHips(out, p, -0.01 * r.h * Math.abs(s));
}

export const climb: ProcClip = {
  name: 'climb',
  loop: true,
  duration: 1,
  layer: 'full',
  steps: [0, 0.5],
  rate: (p) => cadence(p, 2.2, 0.4, 1.6),
  sample: sampleClimb,
};

export const push: ProcClip = {
  name: 'push',
  loop: true,
  duration: 1,
  layer: 'full',
  gait: 1,
  steps: [0, 0.5],
  rate: (p) => pushGait(p).rate,
  sample: samplePush,
};
