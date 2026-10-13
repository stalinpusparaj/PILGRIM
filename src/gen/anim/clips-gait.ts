/**
 * Planted-foot gaits: the stride cadence and thigh swing of a locomotion clip are solved together so the foot on
 * the ground travels back exactly as far as the body travels forward (no skating at any speed the clip covers).
 *
 * While a foot is down (for `contact` of each stride cycle, centred on mid-stance), the thigh turns through
 * ±sweep·swing about `bias`, carrying the foot back 2·L·cos(bias)·sin(sweep·swing), L = hip to ankle. In that
 * time the body moves speed·contact/rate. Walks plant with a linear stance (gaitLeg plant = 1, sweep = 1); runs
 * touch down only around mid-stance between flights (sweep = sin(π·contact) of a sinusoidal swing).
 *
 * The clip names the cadence it would like at this speed (`pref`, cycles/s): the swing is solved from it, kept
 * inside [minSwing, maxSwing], and the cadence solved back from the swing actually used, within [lo, hi]
 * (scaled by leg length: small legs step faster, giants slower). Only past maxSwing and hi does a foot slide.
 */
import type { AnimParams, Pose } from './types';
import { rigOf } from './clips-rig';
import { add, clamp, speedOf } from './clips-util';

/** Reference hip-to-ankle length (m): Christian, ~1.5 m tall. */
const REF_LEG = 0.37;

export interface GaitSpec {
  /** Preferred cadence (stride cycles/s) at this speed. */
  pref: number;
  /** Share of a cycle each foot is down, centred on mid-stance (0.5 = walking, less with flight). */
  contact: number;
  /** Average thigh angle (rad, forward). */
  bias: number;
  /** Share of the swing the thigh turns through while the foot is down (1 = linear stance). */
  sweep: number;
  minSwing: number;
  maxSwing: number;
  /** Cadence limits (cycles/s) for a reference leg. */
  lo: number;
  hi: number;
}

export interface Gait {
  /** Thigh swing amplitude (rad) for gaitLeg. */
  swing: number;
  /** Stride cycles per second (the clip's `rate`). */
  rate: number;
}

/** Hip-to-ankle leg length (skeleton units). */
export function legLength(p: AnimParams): number {
  const r = rigOf(p);
  return Math.max(0.05, r.thigh + r.shin);
}

/** Speed in leg lengths per second: what makes a gait brisk for a child and easy for a giant. */
export function legSpeed(p: AnimParams): number {
  return speedOf(p) / legLength(p);
}

export function plantedGait(p: AnimParams, g: GaitSpec, out: Gait): Gait {
  const L = legLength(p);
  const v = speedOf(p);
  const reach = 2 * L * Math.cos(g.bias);
  const scale = clamp(Math.sqrt(REF_LEG / L), 0.6, 1.5);
  const lo = g.lo * scale;
  const hi = g.hi * scale;
  const pref = clamp(g.pref, lo, hi);
  const want = (v * g.contact) / (pref * reach);
  const swing = clamp(want >= 1 ? g.maxSwing : Math.asin(want) / g.sweep, g.minSwing, g.maxSwing);
  out.swing = swing;
  out.rate = clamp((v * g.contact) / (reach * Math.sin(Math.max(1e-3, g.sweep * swing))), lo, hi);
  return out;
}

/**
 * Keeps planted feet under the pelvis motion: the thighs counter the hip yaw and roll (so the legs stay in their
 * stride plane, plumb), and lean to take up the side-to-side sway of the hips (`out.hips.x`), as a stance leg
 * does. Call after the legs are set, before groundHips.
 */
export function steadyLegs(out: Pose, p: AnimParams, hipYaw: number, hipRoll: number): void {
  const lean = -out.hips.x / legLength(p);
  add(out, 'thighL', 0, -hipYaw, -hipRoll + lean);
  add(out, 'thighR', 0, -hipYaw, -hipRoll + lean);
}
