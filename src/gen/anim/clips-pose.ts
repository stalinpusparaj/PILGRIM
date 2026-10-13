/**
 * Signature rest poses from the GDD 2.11 design sheet. The idle clip holds one instead of hanging arms when the
 * recipe asks for it (`recipe.pose` → AnimParams.pose); walking, running and the overlays still own the arms.
 *   armsCrossed   Obstinate: forearms folded across the belly, left over right, chin up.
 *   handsOnHeart  Christiana: both mittens pressed to the heart, head tilted kindly.
 *   pointFar      Evangelist: right arm straight, forward and up at the far light (the staff stays in the left).
 */
import type { AnimParams, Pose } from './types';
import type { RestPose } from '../char-types';
import { rigOf } from './clips-rig';
import { reachArm } from './clips-ik';
import { TAU, add, armTo, bump, frac, limb, restArms } from './clips-util';

export function signatureArms(out: Pose, p: AnimParams, pose: RestPose): void {
  const r = rigOf(p);
  const h = r.h;
  const breath = Math.sin((TAU * p.time) / 3.6);
  switch (pose) {
    case 'armsCrossed': {
      // Mittens tucked by the opposite elbows; the left forearm sits in front of the right.
      const y = r.armL.shoulder.y - 0.17 * h + 0.004 * h * breath;
      const z = r.bodyR + 0.045 * h;
      reachArm(out, p, 1, -0.085 * h, y + 0.012 * h, z + 0.03 * h, 1, -0.35, 0.25, 1);
      reachArm(out, p, -1, 0.085 * h, y - 0.012 * h, z, -1, -0.35, 0.25, 1);
      limb(out, 'hand', 1, 0, 0, -0.25);
      limb(out, 'hand', -1, 0, 0, -0.25);
      add(out, 'chest', -0.04, 0, 0);
      add(out, 'head', -0.05, 0, 0); // chin up: not moving an inch
      return;
    }
    case 'handsOnHeart': {
      // Left mitten on the heart, the right one over it.
      const y = r.armL.shoulder.y - 0.1 * h + 0.003 * h * breath;
      const z = r.bodyR * 0.85 + 0.035 * h;
      reachArm(out, p, 1, 0.05 * h, y, z, 0.7, -1, -0.2, 1);
      reachArm(out, p, -1, 0.025 * h, y - 0.03 * h, z + 0.025 * h, -0.7, -1, -0.2, 1);
      limb(out, 'hand', 1, -0.3, 0, 0);
      limb(out, 'hand', -1, -0.3, 0, 0);
      add(out, 'head', 0.04, 0, -0.08); // a warm little head tilt
      return;
    }
    case 'pointFar': {
      // As the point overlay, held: a small thrust every few seconds keeps it alive.
      restArms(out, 0);
      const pulse = bump(frac(p.time / 4.2), 0.05, 0.3);
      armTo(out, -1, 1, -1.9 - 0.1 * pulse, 0, 0.12, -0.06, 0, 0, -0.12, 0, 0);
      add(out, 'chest', -0.02, -0.12 - 0.03 * pulse, 0);
      add(out, 'neck', -0.05, -0.05, 0);
      add(out, 'head', -0.1, -0.03, 0);
      return;
    }
  }
}
