/**
 * Tumbles: trip (stumble, face-plant, get up) and fall (bump down on the bottom, dazed, get up; used for
 * bonks and knock-downs). Built from a few code-defined key poses eased with smoothstep, plus procedural
 * extras (dizzy head, impact squash). Legs are keyed in world angles and the body is put on the ground every
 * frame, so feet, knees, seat and face meet the floor on any body type.
 */
import type { BoneName } from '../rig';
import type { AnimParams, Pose, ProcClip } from './types';
import { rigOf } from './clips-rig';
import { TAU, add, bump, groundHips, legWorld, limb, lerp, smooth, type Limb, type Side } from './clips-util';

type V3 = readonly [number, number, number];
/** Upper arm, lower arm, hand (left-side values; the right side mirrors). */
type Arm = readonly [V3, V3, V3];
/** Thigh forward angle, shin back angle (world, from vertical), toe pitch, spread. */
type Leg = readonly [number, number, number, number];

interface Key {
  t: number;
  hips?: V3;
  spine?: V3;
  chest?: V3;
  neck?: V3;
  head?: V3;
  arm?: Arm;
  armR?: Arm;
  leg?: Leg;
  legR?: Leg;
  /** Hips forward offset, fraction of height. */
  z?: number;
  squash?: number;
}

const Z3: V3 = [0, 0, 0];
/** Foot pitch lying face down / kneeling: on its top, toes pointing back. */
const PRONE_FOOT = Math.PI - 0.25;
const KNEEL_FOOT = Math.PI - 0.35;
const REST_ARM: Arm = [
  [0.04, 0, 0.06],
  [-0.18, 0, 0],
  [0.08, 0, 0],
];
const STAND: Leg = [0, 0, 0, 0.03];
const ARM_PARTS: readonly Limb[] = ['upperArm', 'lowerArm', 'hand'];

function mix3(out: Pose, bone: BoneName, a: V3 | undefined, b: V3 | undefined, w: number): void {
  const A = a ?? Z3;
  const B = b ?? Z3;
  add(out, bone, lerp(A[0], B[0], w), lerp(A[1], B[1], w), lerp(A[2], B[2], w));
}

/** Ease between the two keys around time t and write the pose (hips put on the ground). */
function sampleKeys(keys: readonly Key[], t: number, p: AnimParams, out: Pose): void {
  let i = 0;
  while (i < keys.length - 2 && t >= keys[i + 1].t) i++;
  const A = keys[i];
  const B = keys[i + 1];
  const w = smooth(A.t, B.t, t);
  mix3(out, 'hips', A.hips, B.hips, w);
  mix3(out, 'spine', A.spine, B.spine, w);
  mix3(out, 'chest', A.chest, B.chest, w);
  mix3(out, 'neck', A.neck, B.neck, w);
  mix3(out, 'head', A.head, B.head, w);
  const hp = lerp(A.hips ? A.hips[0] : 0, B.hips ? B.hips[0] : 0, w);
  for (let s = 0; s < 2; s++) {
    const side: Side = s === 0 ? 1 : -1;
    const aArm = (s === 1 && A.armR) || A.arm || REST_ARM;
    const bArm = (s === 1 && B.armR) || B.arm || REST_ARM;
    for (let j = 0; j < 3; j++) {
      const x = lerp(aArm[j][0], bArm[j][0], w);
      const y = lerp(aArm[j][1], bArm[j][1], w);
      const z = lerp(aArm[j][2], bArm[j][2], w);
      limb(out, ARM_PARTS[j], side, x, y, z);
    }
    const aLeg = (s === 1 && A.legR) || A.leg || STAND;
    const bLeg = (s === 1 && B.legR) || B.leg || STAND;
    legWorld(
      out,
      side,
      lerp(aLeg[0], bLeg[0], w),
      lerp(aLeg[1], bLeg[1], w),
      hp,
      lerp(aLeg[2], bLeg[2], w),
      lerp(aLeg[3], bLeg[3], w),
    );
  }
  out.hips.z = rigOf(p).h * lerp(A.z ?? 0, B.z ?? 0, w);
  out.squash = lerp(A.squash ?? 1, B.squash ?? 1, w);
}

// ------------------------------------------------------------------------------------------------ trip

const TRIP_IMPACT = 0.62;
const TRIP: readonly Key[] = [
  { t: 0, hips: [0.04, 0, 0], leg: [0.2, 0.1, 0, 0.03], legR: [-0.15, 0.25, 0, 0.03] },
  {
    t: 0.2,
    hips: [0.4, 0, 0],
    spine: [0.15, 0, 0],
    head: [-0.35, 0, 0],
    arm: [[-1.8, 0, 0.45], [-0.3, 0, 0], Z3],
    leg: [-0.45, 0.9, 0.4, 0.04],
    legR: [0.6, 0.3, -0.1, 0.04],
    squash: 1.03,
  },
  {
    t: 0.42,
    hips: [0.95, 0, 0],
    spine: [0.1, 0, 0],
    head: [-0.5, 0, 0],
    arm: [[-2.4, 0, 0.85], [-0.15, 0, 0], Z3],
    leg: [-0.9, 1.3, 0.8, 0.05],
    legR: [-0.7, 1.0, 0.8, 0.05],
    z: 0.12,
  },
  {
    t: TRIP_IMPACT,
    hips: [1.35, 0, 0],
    spine: [0.05, 0, 0],
    head: [-0.35, 0, 0],
    arm: [[-2.2, 0, 1.2], [-0.2, 0, 0], Z3],
    leg: [-1.35, 1.4, PRONE_FOOT, 0.06],
    z: 0.18,
  },
  {
    t: 0.85,
    hips: [1.35, 0, 0],
    head: [-0.4, 0.25, 0],
    arm: [[-1.9, 0, 1.35], [-0.3, 0, 0], Z3],
    leg: [-1.3, 2.5, 1.6, 0.08],
    legR: [-1.3, 2.0, 1.6, 0.08],
    z: 0.18,
  },
  {
    t: 1.05,
    hips: [1.35, 0, 0],
    head: [-0.4, 0.15, 0],
    arm: [[-0.6, 0, 1.35], [-1.0, 0, 0], Z3],
    leg: [-1.35, 1.4, PRONE_FOOT, 0.06],
    z: 0.18,
  },
  {
    t: 1.25,
    hips: [1.3, 0, 0],
    head: [-0.3, 0, 0],
    arm: [
      [0.85, 0, 0.45],
      [-2.5, 0, 0],
      [0.3, 0, 0],
    ],
    leg: [-1.35, 1.4, PRONE_FOOT, 0.06],
    z: 0.18,
  },
  {
    t: 1.55,
    hips: [0.95, 0, 0],
    head: [-0.5, 0, 0],
    arm: [
      [-1.1, 0, 0.15],
      [-0.1, 0, 0],
      [0.5, 0, 0],
    ],
    leg: [0, Math.PI / 2, KNEEL_FOOT, 0.05],
    z: 0.1,
  },
  {
    t: 1.9,
    hips: [0.05, 0, 0],
    head: [0.1, 0, 0],
    arm: [[0.05, 0, 0.1], [-0.3, 0, 0], Z3],
    leg: [0, Math.PI / 2, KNEEL_FOOT, 0.05],
    z: 0.03,
  },
  {
    t: 2.3,
    hips: [0.45, 0, 0],
    head: [-0.3, 0, 0],
    arm: [[-1.0, 0, 0.2], [-0.3, 0, 0], Z3],
    leg: [1.1, 0.9, 0, 0.05],
  },
  { t: 2.6, arm: [[0.1, 0, 0.4], [-0.2, 0, 0], Z3], squash: 1.04 },
  { t: 2.9 },
];
const TRIP_LEN = 2.9;

function sampleTrip(t: number, p: AnimParams, out: Pose): void {
  sampleKeys(TRIP, t, p, out);
  // Shake off the dizziness while kneeling.
  const dizzy = bump(t, 1.7, 2.4);
  add(out, 'head', 0, 0.3 * Math.sin(TAU * 3.5 * t) * dizzy, 0);
  out.squash = (out.squash ?? 1) - 0.12 * bump(t, TRIP_IMPACT - 0.02, TRIP_IMPACT + 0.2);
  groundHips(out, p);
}

// ------------------------------------------------------------------------------------------------ fall

const FALL_IMPACT = 0.48;
const SIT_DAZED: Leg = [1.6, -1.3, -1.1, 0.25];
const FALL: readonly Key[] = [
  { t: 0, leg: [0, 0.05, 0, 0.03] },
  {
    t: 0.22,
    hips: [-0.3, 0, 0],
    spine: [-0.15, 0, 0],
    head: [0.25, 0, 0],
    arm: [[-1.7, 0, 0.7], [-0.5, 0, 0], Z3],
    armR: [[-2.2, 0, 0.5], [-0.3, 0, 0], Z3],
    leg: [-0.1, 0.2, -0.2, 0.05],
    legR: [0.35, 0.3, -0.2, 0.05],
    squash: 1.02,
  },
  {
    t: FALL_IMPACT,
    hips: [-0.4, 0, 0],
    spine: [-0.05, 0, 0],
    head: [-0.25, 0, 0],
    arm: [[0.9, 0, 0.4], [-0.2, 0, 0], Z3],
    leg: [1.9, -1.5, -1.2, 0.12],
  },
  {
    t: 0.8,
    hips: [-0.8, 0, 0],
    head: [0.2, 0, 0],
    arm: [[0.3, 0, 1.0], [-0.4, 0, 0], Z3],
    leg: [2.5, -2.3, -1.6, 0.15],
    legR: [2.3, -2.0, -1.4, 0.15],
  },
  {
    t: 1.2,
    hips: [-0.1, 0, 0],
    head: [0.05, 0, 0],
    arm: [
      [0.6, 0, 0.35],
      [0.1, 0, 0],
      [-0.4, 0, 0],
    ],
    leg: SIT_DAZED,
  },
  {
    t: 1.85,
    hips: [-0.08, 0, 0],
    arm: [
      [0.5, 0, 0.3],
      [0, 0, 0],
      [-0.4, 0, 0],
    ],
    leg: SIT_DAZED,
  },
  {
    t: 2.15,
    hips: [0.5, 0, 0],
    head: [-0.2, 0, 0],
    arm: [[-1.1, 0, 0.2], [-0.3, 0, 0], Z3],
    leg: [1.15, 0.95, 0, 0.05],
  },
  { t: 2.4, arm: [[0.1, 0, 0.35], [-0.2, 0, 0], Z3], squash: 1.03 },
  { t: 2.6 },
];
const FALL_LEN = 2.6;

function sampleFall(t: number, p: AnimParams, out: Pose): void {
  sampleKeys(FALL, t, p, out);
  // Dazed: the head circles (stars go round it) while sitting.
  const daze = bump(t, 1.0, 1.95);
  const a = TAU * 1.6 * t;
  add(out, 'head', 0.1 * Math.cos(a) * daze, 0, 0.16 * Math.sin(a) * daze);
  add(out, 'chest', 0, 0, -0.05 * Math.sin(a) * daze);
  out.squash = (out.squash ?? 1) - 0.12 * bump(t, FALL_IMPACT - 0.02, FALL_IMPACT + 0.2);
  groundHips(out, p);
}

export const trip: ProcClip = {
  name: 'trip',
  loop: false,
  duration: TRIP_LEN,
  layer: 'full',
  cues: [TRIP_IMPACT / TRIP_LEN],
  sample: sampleTrip,
};

export const fall: ProcClip = {
  name: 'fall',
  loop: false,
  duration: FALL_LEN,
  layer: 'full',
  cues: [FALL_IMPACT / FALL_LEN],
  sample: sampleFall,
};
