/**
 * Upper-body overlay clips (layer 'upper'): talk, wave, point, read, knock, reach. They write only chest,
 * neck, head and arms; the Animator lays them over whatever the legs are doing. Each starts from the relaxed
 * arm pose and the shared posture, so fading an overlay in or out never jolts the shoulders or straightens a
 * burdened back. Waving, pointing, knocking and reaching use the right arm.
 */
import type { AnimParams, Pose, ProcClip } from './types';
import { rigOf } from './clips-rig';
import { reachArm } from './clips-ik';
import {
  TAU,
  add,
  addLimb,
  armTo,
  breathe,
  bump,
  hold,
  leanOf,
  posture,
  restArms,
  smooth,
  styleOf,
} from './clips-util';

/** Common base for overlays: relaxed arms, posture and breathing. */
function base(p: AnimParams, out: Pose): void {
  restArms(out, 0);
  posture(out, leanOf(p), true);
  breathe(out, Math.sin((TAU * p.time) / 3.4), 0.8);
}

// ------------------------------------------------------------------------------------------------ talk

function sampleTalk(t: number, p: AnimParams, out: Pose): void {
  base(p, out);
  const st = styleOf(p);
  const amp = (1 + 0.6 * st.swagger) * (1 - 0.5 * st.stiffness);
  // Syllable bob at 2.5 Hz plus slow tilts (all periods divide the 4 s loop).
  const syl = Math.sin(TAU * 2.5 * t);
  add(out, 'neck', 0.02 * syl, 0, 0);
  add(out, 'head', 0.045 * syl, 0.12 * amp * Math.sin((TAU * t) / 4), 0.07 * Math.sin((TAU * t) / 2));
  // Gesture beats: right hand, left hand, then a two-handed shrug.
  const gR = hold(t, 0.15, 1.6, 0.35, 0.4) * amp;
  const gL = hold(t, 1.75, 3.0, 0.35, 0.4) * amp;
  const gB = hold(t, 3.0, 3.95, 0.25, 0.35);
  armTo(out, -1, Math.min(1, gR), -0.65, 0, 0.2, -1.05, 0.15, 0, 0, 0.2, 0.35);
  armTo(out, 1, Math.min(1, gL), -0.65, 0, 0.2, -1.05, 0.15, 0, 0, 0.2, 0.35);
  addLimb(out, 'lowerArm', -1, 0.12 * syl * gR, 0, 0);
  addLimb(out, 'lowerArm', 1, -0.12 * syl * gL, 0, 0);
  armTo(out, 1, gB, -0.3, 0, 0.6, -1.0, 0.5, 0, 0, 0, 0.4);
  armTo(out, -1, gB, -0.3, 0, 0.6, -1.0, 0.5, 0, 0, 0, 0.4);
  add(out, 'chest', -0.04 * gB, 0.08 * (gL - gR), 0);
  add(out, 'head', -0.04 * gB, 0, 0.12 * gB);
}

// ------------------------------------------------------------------------------------------------ wave

function sampleWave(t: number, p: AnimParams, out: Pose): void {
  base(p, out);
  const w = Math.sin((TAU * t) / 0.6);
  const flick = Math.sin((TAU * t) / 0.6 - 0.8);
  // Right arm up beside the head (clear of it), forearm swinging side to side.
  armTo(out, -1, 1, -0.3, 0, 1.75, 0, 0, 1.2 + 0.4 * w, 0, 0, 0.3 * flick);
  add(out, 'chest', 0, -0.06, -0.06);
  add(out, 'head', 0, -0.05, 0.1 + 0.03 * w);
}

// ----------------------------------------------------------------------------------------------- point

function samplePoint(t: number, p: AnimParams, out: Pose): void {
  base(p, out);
  const pulse = bump(t, 0.1, 0.9);
  // "Point far": right arm straight, forward and up, a little thrust each loop.
  armTo(out, -1, 1, -1.95 - 0.12 * pulse, 0, 0.12, -0.06, 0, 0, -0.12, 0, 0);
  add(out, 'chest', -0.03, -0.16 - 0.04 * pulse, 0);
  add(out, 'neck', -0.06, -0.06, 0);
  add(out, 'head', -0.14 - 0.03 * pulse, -0.04, 0);
}

// ------------------------------------------------------------------------------------------------ read

function sampleRead(t: number, p: AnimParams, out: Pose): void {
  base(p, out);
  const r = rigOf(p);
  const h = r.h;
  const turn = bump(t, 4.0, 5.0);
  // Book held in both mittens in front of the belly; the right hand turns a page.
  const y = r.armL.shoulder.y - 0.13 * h;
  const z = 0.21 * h;
  reachArm(out, p, 1, 0.075 * h, y, z, 1, -0.6, -0.4, 1);
  reachArm(
    out,
    p,
    -1,
    -0.075 * h + 0.11 * h * turn,
    y + 0.025 * h * turn,
    z + 0.02 * h * turn,
    -1,
    -0.6,
    -0.4,
    1,
  );
  addLimb(out, 'hand', 1, -0.2, 0, 0);
  addLimb(out, 'hand', -1, -0.2, 0, 0);
  add(out, 'chest', 0.05, 0, 0);
  add(out, 'neck', 0.16, 0, 0);
  // Eyes follow the lines: a small left-to-right scan, a nod at each line end.
  const scan = (t / 1.5) % 1;
  const across = smooth(0, 0.85, scan) - smooth(0.85, 1, scan);
  add(out, 'head', 0.3 + 0.05 * bump(scan, 0.8, 1), 0.07 - 0.14 * across, 0);
}

// ----------------------------------------------------------------------------------------------- knock

/** Knock impact times (s) in the one-shot. */
const KNOCKS = [0.5, 0.78, 1.06] as const;
const KNOCK_LEN = 1.7;

function sampleKnock(t: number, p: AnimParams, out: Pose): void {
  base(p, out);
  const env = smooth(0, 0.35, t) * (1 - smooth(1.3, KNOCK_LEN, t));
  let tap = 0;
  for (let i = 0; i < KNOCKS.length; i++) tap += bump(t, KNOCKS[i] - 0.11, KNOCKS[i] + 0.06);
  // Fist up at the door, the forearm swings in from the elbow for each knock.
  armTo(out, -1, env, -1.05, 0, 0.15, -1.3 + 0.45 * tap, 0, 0, 0.25, 0, 0);
  const listen = bump(t, 1.1, 1.65);
  add(out, 'chest', 0.05 * env, -0.05 * env, 0);
  add(out, 'head', -0.05 * env, 0.1 * listen, 0.15 * listen);
}

// ----------------------------------------------------------------------------------------------- reach

function sampleReach(t: number, p: AnimParams, out: Pose): void {
  base(p, out);
  const beckon = Math.sin(TAU * t);
  const strain = 0.5 + 0.5 * Math.sin((TAU * t) / 2);
  // Big helping hand forward and a little down; the other arm back for balance.
  armTo(out, -1, 1, -1.3 - 0.08 * strain, 0, 0.06, -0.12, 0, 0, 0.15 + 0.2 * beckon, 0, 0);
  armTo(out, 1, 1, 0.35, 0, 0.25, -0.3, 0, 0);
  add(out, 'chest', 0.2 + 0.04 * strain, -0.12, 0);
  add(out, 'neck', 0.05, 0, 0);
  add(out, 'head', 0.12, -0.05, 0);
}

export const talk: ProcClip = { name: 'talk', loop: true, duration: 4, layer: 'upper', sample: sampleTalk };
export const wave: ProcClip = { name: 'wave', loop: true, duration: 1.2, layer: 'upper', sample: sampleWave };
export const point: ProcClip = {
  name: 'point',
  loop: true,
  duration: 2.4,
  layer: 'upper',
  sample: samplePoint,
};
export const read: ProcClip = { name: 'read', loop: true, duration: 6, layer: 'upper', sample: sampleRead };
export const reach: ProcClip = {
  name: 'reach',
  loop: true,
  duration: 2,
  layer: 'upper',
  sample: sampleReach,
};
export const knock: ProcClip = {
  name: 'knock',
  loop: false,
  duration: KNOCK_LEN,
  layer: 'upper',
  cues: KNOCKS.map((k) => k / KNOCK_LEN),
  sample: sampleKnock,
};
