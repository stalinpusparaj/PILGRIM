/**
 * Combat overlay clips (layer 'upper', GDD 2.12 "sword swing, shield raise, shield block"): `swing` is a one-shot
 * bonk-swing of the right arm (the sword hand, propR), `block` holds the left arm (the shield hand, propL) up in
 * front of the chest with a small brace. Both start from the relaxed arms and the shared posture, like every
 * other overlay (clips-upper.ts), so fading them in and out never jolts the shoulders.
 */
import type { AnimParams, Pose, ProcClip } from './types';
import { TAU, add, armTo, breathe, bump, leanOf, posture, restArms, smooth } from './clips-util';

/** Swing length (s) and the moment the blade passes in front (normalised; counted as a cue). */
const SWING_LEN = 0.5;
const SWING_HIT = 0.3;

function base(p: AnimParams, out: Pose): void {
  restArms(out, 0);
  posture(out, leanOf(p), true);
  breathe(out, Math.sin((TAU * p.time) / 3.4), 0.8);
}

function sampleSwing(t: number, p: AnimParams, out: Pose): void {
  base(p, out);
  const u = t / SWING_LEN;
  // Wind up over the shoulder, chop down and across, then ease back to rest.
  const up = smooth(0, 0.22, u) * (1 - smooth(0.22, 0.38, u));
  const down = smooth(0.22, 0.38, u) * (1 - smooth(0.6, 1, u));
  const w = Math.max(up, down);
  const ux = up > down ? -2.7 : -0.85;
  const uz = up > down ? 0.35 : -0.2;
  armTo(out, -1, w, ux, 0, uz, up > down ? -0.6 : -0.15, 0, 0, 0.2, 0, 0);
  // The other arm swings back for balance; the chest twists into the cut.
  armTo(out, 1, 0.6 * w, 0.4, 0, 0.3, -0.4, 0, 0);
  add(out, 'chest', 0.12 * down - 0.08 * up, 0.25 * up - 0.3 * down, 0);
  add(out, 'head', -0.05 * up + 0.08 * down, 0, 0);
}

function sampleBlock(t: number, p: AnimParams, out: Pose): void {
  base(p, out);
  const raise = smooth(0, 0.12, t);
  const brace = 0.03 * Math.sin(TAU * 1.5 * t) * raise;
  // Shield arm forward and bent, the shield across the chest; the sword arm ready at the side.
  armTo(out, 1, raise, -1.25 + brace, 0, -0.35, -1.05, 0, 0, 0, 0, 0.2);
  armTo(out, -1, 0.5 * raise, -0.5, 0, 0.25, -0.6, 0, 0);
  add(out, 'chest', 0.08 * raise, 0.12 * raise, 0);
  add(out, 'head', 0.06 * raise, -0.06 * raise, 0);
  add(out, 'neck', -0.04 * raise + 0.02 * bump(t % 1, 0, 1), 0, 0);
}

export const swing: ProcClip = {
  name: 'swing',
  loop: false,
  duration: SWING_LEN,
  layer: 'upper',
  cues: [SWING_HIT],
  sample: sampleSwing,
};

export const block: ProcClip = { name: 'block', loop: true, duration: 2, layer: 'upper', sample: sampleBlock };
