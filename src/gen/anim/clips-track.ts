/**
 * Animator internals: which bones it drives and the pooled track (one playing clip with its own scratch
 * pose). Pure data, allocated once per Animator.
 */
import type { BoneName } from '../rig';
import type { BonePose, Pose, ProcClip } from './types';

/** Bones the Animator drives (root, props, sack, hat, ropes and face bones are left to the Character). */
export const ANIM_BONES = [
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'upperArmL',
  'lowerArmL',
  'handL',
  'upperArmR',
  'lowerArmR',
  'handR',
  'thighL',
  'shinL',
  'footL',
  'thighR',
  'shinR',
  'footR',
] as const satisfies readonly BoneName[];

/**
 * Bones an 'upper' overlay replaces (spine and hips stay with the full layer, so posture and gait carry on).
 */
export const UPPER_BONES: readonly BoneName[] = [
  'chest',
  'neck',
  'head',
  'upperArmL',
  'lowerArmL',
  'handL',
  'upperArmR',
  'lowerArmR',
  'handR',
];

export const N = ANIM_BONES.length;

/** How many times the normalised marks (0..1, repeating every 1) are crossed in [u0, u1). */
export function crossings(marks: readonly number[], u0: number, u1: number): number {
  let n = 0;
  for (let i = 0; i < marks.length; i++) n += Math.ceil(u1 - marks[i]) - Math.ceil(u0 - marks[i]);
  return n;
}

/** One clip in a layer: its clock, fade state and a scratch pose (Map entries mirrored in `slots`). */
export class Track {
  clip: ProcClip | null = null;
  time = 0;
  weight = 0;
  target = 0;
  fadeRate = 4;
  speed = 1;
  ended = false;
  readonly pose: Pose;
  readonly slots: BonePose[] = [];

  constructor() {
    const bones = new Map<BoneName, BonePose>();
    for (let i = 0; i < N; i++) {
      const b: BonePose = { x: 0, y: 0, z: 0 };
      bones.set(ANIM_BONES[i], b);
      this.slots.push(b);
    }
    this.pose = { bones, hips: { x: 0, y: 0, z: 0 }, squash: 1 };
  }

  reset(): void {
    for (let i = 0; i < N; i++) {
      const s = this.slots[i];
      s.x = 0;
      s.y = 0;
      s.z = 0;
    }
    const h = this.pose.hips;
    h.x = 0;
    h.y = 0;
    h.z = 0;
    this.pose.squash = 1;
  }

  gaitPhase(): number {
    const c = this.clip;
    if (!c || !c.gait) return -1;
    const u = (this.time / c.duration) * c.gait;
    return u - Math.floor(u);
  }
}
