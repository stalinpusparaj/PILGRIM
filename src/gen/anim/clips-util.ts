/**
 * Shared building blocks for procedural clips: easing curves, pose writers, posture, ground contact and gait
 * legs. Everything here is allocation-free so clips can run every frame for every character.
 */
import type { BoneName } from '../rig';
import type { AnimParams, AnimStyle, Pose, RigInfo } from './types';
import { rigOf } from './clips-rig';

export const TAU = Math.PI * 2;
export const HALF_PI = Math.PI / 2;

/** 1 = the character's left limb, -1 = right. Right limbs mirror y and z. */
export type Side = 1 | -1;

// ---------------------------------------------------------------------------------------------- curves

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function frac(x: number): number {
  return x - Math.floor(x);
}

/** Hermite smoothstep of x between e0 and e1 (works for e0 > e1 too). */
export function smooth(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Smooth hump: 0 outside [a, b], rising to 1 in the middle (sin²). */
export function bump(x: number, a: number, b: number): number {
  if (x <= a || x >= b) return 0;
  const s = Math.sin((Math.PI * (x - a)) / (b - a));
  return s * s;
}

/** Plateau: eases 0 → 1 over [a, a+fi], holds, eases back to 0 over [b-fo, b]. */
export function hold(x: number, a: number, b: number, fi: number, fo: number): number {
  return smooth(a, a + fi, x) * (1 - smooth(b - fo, b, x));
}

/** Quick rise then exponential settle; peaks at 1 when x = 1/k (impacts, the burdened plod). */
export function impulse(x: number, k: number): number {
  if (x <= 0) return 0;
  const h = k * x;
  return h * Math.exp(1 - h);
}

/** Under-damped spring step response 0 → 1 with a toy wobble (overshoot), frequency f Hz, damping zeta. */
export function wobble(t: number, f: number, zeta: number): number {
  if (t <= 0) return 0;
  const w = TAU * f;
  const wd = w * Math.sqrt(1 - zeta * zeta);
  return 1 - Math.exp(-zeta * w * t) * (Math.cos(wd * t) + ((zeta * w) / wd) * Math.sin(wd * t));
}

/** Stable integer hash → [0, 1). Deterministic stand-in for randomness (never Math.random). */
export function hash01(n: number): number {
  let h = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------------------- pose writers

const LIMBS = {
  upperArm: ['upperArmL', 'upperArmR'],
  lowerArm: ['lowerArmL', 'lowerArmR'],
  hand: ['handL', 'handR'],
  thigh: ['thighL', 'thighR'],
  shin: ['shinL', 'shinR'],
  foot: ['footL', 'footR'],
} as const satisfies Record<string, readonly [BoneName, BoneName]>;
export type Limb = keyof typeof LIMBS;

export function limbBone(limb: Limb, side: Side): BoneName {
  return LIMBS[limb][side === 1 ? 0 : 1];
}

/** Set a bone's offset. The Animator pre-fills every animated bone, so this never allocates in play. */
export function rot(out: Pose, bone: BoneName, x: number, y: number, z: number): void {
  const b = out.bones.get(bone);
  if (b) {
    b.x = x;
    b.y = y;
    b.z = z;
  } else out.bones.set(bone, { x, y, z });
}

/** Add to a bone's offset. */
export function add(out: Pose, bone: BoneName, x: number, y: number, z: number): void {
  const b = out.bones.get(bone);
  if (b) {
    b.x += x;
    b.y += y;
    b.z += z;
  } else out.bones.set(bone, { x, y, z });
}

/** Read one axis of a bone's current offset (0 if unset). */
export function get(out: Pose, bone: BoneName, axis: 'x' | 'y' | 'z'): number {
  const b = out.bones.get(bone);
  return b ? b[axis] : 0;
}

/** Set a limb using left-side values; the right side mirrors y and z. */
export function limb(out: Pose, l: Limb, side: Side, x: number, y: number, z: number): void {
  rot(out, LIMBS[l][side === 1 ? 0 : 1], x, y * side, z * side);
}

/** Add to a limb using left-side values; the right side mirrors y and z. */
export function addLimb(out: Pose, l: Limb, side: Side, x: number, y: number, z: number): void {
  add(out, LIMBS[l][side === 1 ? 0 : 1], x, y * side, z * side);
}

/** Blend an arm (upper, lower, hand) toward a target pose by weight w (left-side values). */
export function armTo(
  out: Pose,
  side: Side,
  w: number,
  ux: number,
  uy: number,
  uz: number,
  lx: number,
  ly: number,
  lz: number,
  hx = 0,
  hy = 0,
  hz = 0,
): void {
  blendLimb(out, 'upperArm', side, w, ux, uy, uz);
  blendLimb(out, 'lowerArm', side, w, lx, ly, lz);
  blendLimb(out, 'hand', side, w, hx, hy, hz);
}

function blendLimb(out: Pose, l: Limb, side: Side, w: number, x: number, y: number, z: number): void {
  const b = out.bones.get(LIMBS[l][side === 1 ? 0 : 1]);
  if (!b) return limb(out, l, side, x * w, y * w, z * w);
  b.x += (x - b.x) * w;
  b.y += (y * side - b.y) * w;
  b.z += (z * side - b.z) * w;
}

// ------------------------------------------------------------------------------------- style + posture

const S: AnimStyle = { bounce: 0.4, stiffness: 0.4, swagger: 0.1, lean: 0 };

function fin(v: number | undefined, d: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : d;
}

/**
 * The character's style, clamped (shared scratch object: read it, do not keep it). `stiffness` comes back as
 * its effect: 0 up to 0.25, then rising to 1, so ordinary recipes keep a loose, toy-like swing.
 */
export function styleOf(p: AnimParams): Readonly<AnimStyle> {
  const st = p.style;
  S.bounce = clamp(fin(st.bounce, 0.4), 0, 2);
  S.stiffness = clamp((fin(st.stiffness, 0.4) - 0.25) / 0.75, 0, 1);
  S.swagger = clamp(fin(st.swagger, 0.1), 0, 1);
  S.lean = clamp(fin(st.lean, 0), -0.6, 0.6);
  return S;
}

/** Locomotion speed (m/s), never negative or NaN. */
export function speedOf(p: AnimParams): number {
  const v = fin(p.speed, 0);
  return v > 0 ? v : 0;
}

/** Burden size clamped to 0..1.6. */
export function burdenOf(p: AnimParams): number {
  return clamp(fin(p.burden, 0), 0, 1.6);
}

/**
 * Standing forward lean (rad). Style lean gives up to ~12 degrees; a burden takes over from it (0.26 rad
 * standing at size 1, about 20 degrees once walking adds its own lean), growing with the sack.
 */
export function leanOf(p: AnimParams): number {
  const b = burdenOf(p);
  return styleOf(p).lean * 0.35 * (1 - Math.min(1, b)) + b * 0.26;
}

/**
 * Posture: `lean` (rad) bends the spine and chest forward while neck and head look back up, so the face stays
 * forward; leaning back tips the nose up into the air. Full clips pass upperOnly = false; upper overlays pass
 * true and get the same chest/neck/head values, so an overlay never straightens a burdened back.
 */
export function posture(out: Pose, lean: number, upperOnly: boolean): void {
  if (!upperOnly) add(out, 'spine', lean * 0.75, 0, 0);
  add(out, 'chest', lean * 0.25, 0, 0);
  add(out, 'neck', -lean * 0.45, 0, 0);
  add(out, 'head', lean < 0 ? lean * 0.3 : -lean * 0.3, 0, 0);
}

/** Breathing (0..1 cycle value as -1..1) applied to chest, shoulders and head. */
export function breathe(out: Pose, b: number, amount: number): void {
  add(out, 'chest', -0.03 * amount * b, 0, 0);
  add(out, 'head', 0.015 * amount * b, 0, 0);
  addLimb(out, 'upperArm', 1, 0, 0, 0.02 * amount * b);
  addLimb(out, 'upperArm', -1, 0, 0, 0.02 * amount * b);
}

/** Relaxed hanging arms with a soft elbow; swagger plants mittens on the hips. */
export function restArms(out: Pose, swagger: number): void {
  const sw = clamp(swagger, 0, 1);
  for (let i = 0; i < 2; i++) {
    const s: Side = i === 0 ? 1 : -1;
    limb(out, 'upperArm', s, 0.04 + 0.28 * sw, 0, 0.06 + 0.5 * sw);
    limb(out, 'lowerArm', s, -0.18 - 1.05 * sw, -0.35 * sw, 0);
    limb(out, 'hand', s, 0.08, 0, 0.1 * sw);
  }
}

// --------------------------------------------------------------------------------------- legs + ground

/**
 * Set a leg from world-space angles (so hip pitch never tips the feet): a = thigh forward from vertical, b =
 * shin back from vertical, foot = toe pitch relative to the ground (> 0 toes down), spread = out to the side.
 */
export function legWorld(
  out: Pose,
  side: Side,
  a: number,
  b: number,
  hipPitch: number,
  foot = 0,
  spread = 0,
): void {
  limb(out, 'thigh', side, -a - hipPitch, 0, spread);
  limb(out, 'shin', side, a + b, 0, 0);
  limb(out, 'foot', side, foot - b, 0, 0);
}

/**
 * One leg of a stride cycle. ph = 0: this foot strikes in front; 0.5: it pushes off behind; the swing runs
 * 0.5 → 1. swing = thigh amplitude, bias = average forward angle, knee = swing-phase knee lift, load = stance
 * knee give, toe = heel-strike / push-off foot roll. plant (0..1) makes the stance sweep linear in time, so a
 * planted foot moves back at a steady speed and can match the body's (clips-gait.ts); 0 = sinusoidal (runs).
 */
export function gaitLeg(
  out: Pose,
  side: Side,
  ph: number,
  swing: number,
  bias: number,
  knee: number,
  load: number,
  toe: number,
  hipPitch: number,
  plant = 0,
): void {
  const c = Math.cos(TAU * ph);
  const s = Math.sin(TAU * ph);
  const u = frac(ph);
  const lift = s < 0 ? -s : 0;
  const give = s > 0 ? s * (0.6 + 0.4 * c) : 0;
  let a = bias + swing * c;
  if (plant > 0 && u < 0.5) {
    // Planted: the ankle moves back at a steady speed (sin(a) linear in time), and the thigh leans forward by
    // half the stance knee give so the bending knee does not push the foot back (thigh ≈ shin).
    const s0 = Math.sin(bias + swing);
    const lin = Math.asin(clamp(s0 + (Math.sin(bias - swing) - s0) * 2 * u, -1, 1)) + 0.5 * load * give;
    a += (lin - a) * plant;
  }
  const flex = knee * lift * (1.15 - 0.3 * lift) + load * give;
  legWorld(out, side, a, flex - a, hipPitch, -toe * c);
}

/** Arm swing opposite the same-side leg (ph as in gaitLeg). */
export function armSwing(
  out: Pose,
  side: Side,
  ph: number,
  swing: number,
  elbow: number,
  abduct: number,
): void {
  const c = Math.cos(TAU * ph);
  limb(out, 'upperArm', side, swing * c, 0, abduct);
  limb(out, 'lowerArm', side, -elbow - swing * 0.6 * (c < 0 ? -c : 0), 0, 0);
  limb(out, 'hand', side, 0.1, 0, 0);
}

/**
 * How far below the hip joint a leg reaches: knee pad, or the lowest of heel and toe for the foot's pitch.
 */
function depth(r: RigInfo, a1: number, a2: number, f: number): number {
  const knee = r.thigh * Math.cos(a1);
  const ankle = knee + r.shin * Math.cos(a2);
  const cf = Math.cos(f);
  const sf = Math.sin(f);
  const sole = Math.max(r.ankle * cf - r.heel * sf, r.ankle * cf + r.toe * sf, 0.5 * r.kneeR);
  return Math.max(knee + r.kneeR, ankle + sole);
}

/**
 * Put the body on the ground: sets out.hips.y so the lowest of soles, knees, seat/belly and head touches y =
 * 0, using the leg, hip and spine angles already written to `out`. `airborne` (0..1) blends toward the rest
 * hip height so tucked legs lift off instead of the body sinking; `lift` is added on top.
 */
export function groundHips(out: Pose, p: AnimParams, lift = 0, airborne = 0): void {
  const r = rigOf(p);
  const hp = get(out, 'hips', 'x');
  const aL = hp + get(out, 'thighL', 'x');
  const aR = hp + get(out, 'thighR', 'x');
  const bL = aL + get(out, 'shinL', 'x');
  const bR = aR + get(out, 'shinR', 'x');
  const dL = depth(r, aL, bL, bL + get(out, 'footL', 'x'));
  const dR = depth(r, aR, bR, bR + get(out, 'footR', 'x'));
  const legs = Math.max(dL, dR) + r.hipJoint * Math.cos(hp);
  const sp = get(out, 'spine', 'x');
  const ch = get(out, 'chest', 'x');
  // Seat when upright, belly or back when lying.
  const trunk = r.seatR + (r.bodyR - r.seatR) * Math.abs(Math.sin(hp + 0.5 * sp));
  const lean = hp + 0.85 * sp + 0.6 * ch + 0.3 * get(out, 'neck', 'x') + 0.15 * get(out, 'head', 'x');
  const head = r.headR - r.headDist * Math.cos(lean + r.headAngle);
  const y = Math.max(legs, trunk, head);
  out.hips.y = lerp(y - r.hipHeight, 0, clamp(airborne, 0, 1)) + lift;
}

/** Cadence (stride cycles per second) from speed and leg length: `k` leg lengths per stride. */
export function cadence(p: AnimParams, k: number, lo: number, hi: number): number {
  const r = rigOf(p);
  const leg = Math.max(0.05, r.thigh + r.shin + r.ankle);
  return clamp(speedOf(p) / (k * leg), lo, hi);
}

/** Air-time arc (0 → peak → 0, parabolic) scaled by height, or 0 when the caller owns root motion. */
export function arc(p: AnimParams, u: number, heightFrac: number): number {
  if (p.rootMotion === false || u <= 0 || u >= 1) return 0;
  return rigOf(p).h * heightFrac * 4 * u * (1 - u);
}

/** Gentle look-around for idles: holds a few seconds, eases to a new deterministic target. */
export function lookAround(out: Pose, time: number, amount: number): void {
  const slot = Math.floor(time / 3.4);
  const u = time / 3.4 - slot;
  const t = smooth(0.0, 0.3, u);
  const yaw = lerp(lookYaw(slot - 1), lookYaw(slot), t) * amount;
  const pitch = lerp(lookPitch(slot - 1), lookPitch(slot), t) * amount;
  add(out, 'neck', pitch * 0.4, yaw * 0.4, 0);
  add(out, 'head', pitch * 0.6, yaw * 0.6, -yaw * 0.12);
}

function lookYaw(slot: number): number {
  return hash01(slot * 3 + 1) < 0.45 ? 0 : (hash01(slot * 3 + 2) - 0.5) * 1.3;
}

function lookPitch(slot: number): number {
  return (hash01(slot * 3 + 3) - 0.6) * 0.3;
}
