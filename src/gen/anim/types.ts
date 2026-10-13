/**
 * Procedural animation types (ARCHITECTURE "Procedural animation"). Clips are pure functions of time and
 * params that write Euler offsets from the rest pose; the Animator blends them and writes the bones.
 *
 * Bone-space convention every clip uses (rest pose: faces +Z, feet on y = 0, arms hanging, rest rotations
 * identity as rig.ts builds them):
 *   X = the character's left, Y = up, Z = forward. Offsets are Euler angles (rad, order 'YXZ') applied in
 *   the bone's rest frame: bone.quaternion = restQuat * offsetQuat.
 *   x > 0 pitches forward/down: spine and head bend forward, thigh swings back, knee (shin) flexes, toes
 *     point down, arm swings back. x < 0: thigh forward, arm forward/up, head looks up, toes up.
 *   z > 0 on a left limb moves it out to the side (right limbs mirror: z < 0); z > 0 on spine/head tilts
 *     the top toward the character's right. y > 0 turns toward the character's left.
 */
import type { RestPose } from '../char-types';
import type * as THREE from 'three';
import type { BoneName } from '../rig';
import type { CharacterRecipe } from '../CharacterFactory';

/** Euler offset (rad) from the rest pose, order 'YXZ'. */
export interface BonePose {
  x: number;
  y: number;
  z: number;
}

export interface Pose {
  bones: Map<BoneName, BonePose>;
  /** Hips translation offset (skeleton units), added to the hips rest position. */
  hips: { x: number; y: number; z: number };
  /**
   * Volume-preserving squash and stretch about the feet, applied on the hips (1 = none, < 1 squashed, > 1
   * stretched). Optional so plain Pose literals stay valid; the Animator treats a missing value as 1.
   */
  squash?: number;
}

/** Walk personality (CharacterRecipe.style with defaults filled in). */
export type AnimStyle = Required<NonNullable<CharacterRecipe['style']>>;

/**
 * Style defaults (the recipe loader's) and meaning. Clips clamp every value, so bad recipes stay safe.
 *   bounce     0..2   toy hop on every step (0 = natural bob only; Pliable and the boys ~1.4-1.8)
 *   stiffness  0..1   rigid limbs: less knee bend, arm swing, torso twist (above ~0.25; Formalist ~0.75)
 *   swagger    0..1   hip sway, shoulder roll, bigger gestures, hands-on-hips idle (Vain-confidence ~0.6)
 *   lean    -0.6..0.6 posture: > 0 hunched, < 0 nose in the air (0.6 = about 12 degrees). A burden
 *                     replaces it with the GDD's burdened lean (20 degrees walking).
 */
export const DEFAULT_STYLE: Readonly<AnimStyle> = { bounce: 0.4, stiffness: 0.4, swagger: 0.1, lean: 0 };

/** Rest geometry of one arm, used by the two-bone IK (pray, read, cover ears). */
export interface ArmRest {
  /** Shoulder joint in the upper arm's parent space (the chest). */
  shoulder: THREE.Vector3;
  upperQ: THREE.Quaternion; // upper arm rest quaternion (relative to its parent)
  lowerQ: THREE.Quaternion; // lower arm rest quaternion (relative to the upper arm)
  upperDir: THREE.Vector3; // unit direction shoulder → elbow in upper-arm local space
  lowerDir: THREE.Vector3; // unit direction elbow → wrist in lower-arm local space
}

/**
 * Proportions measured once from the skeleton's rest pose, in skeleton units. Clips use them for ground
 * contact (soles, knees, seat, belly, head) and arm IK so poses fit every body type. What bones cannot tell
 * (contact radii, toe length) is estimated from the 2.5-heads-tall style; the Character may correct it.
 */
export interface RigInfo {
  h: number; // character height
  hipHeight: number; // hips origin above the ground
  hipJoint: number; // hips origin above the thigh joints
  hipWidth: number; // half distance between the thigh joints
  thigh: number; // thigh joint → knee
  shin: number; // knee → ankle (foot bone)
  ankle: number; // foot bone above the ground
  kneeR: number; // knee pad radius (contact when kneeling or lying)
  seatR: number; // hips origin to the bottom of the pelvis (contact when sitting on the ground)
  bodyR: number; // torso half-depth (contact when lying on the front or back)
  toe: number; // ankle → tip of the toes (along the foot)
  heel: number; // ankle → back of the heel
  headR: number; // head radius
  headDist: number; // hips origin → head centre at rest
  headAngle: number; // forward tilt of that line at rest (an elder's stoop)
  headC: THREE.Vector3; // head centre in chest space (rest)
  upperArm: number; // shoulder → elbow
  lowerArm: number; // elbow → mitten centre
  armL: ArmRest;
  armR: ArmRest;
}

export interface AnimParams {
  /** Locomotion speed in m/s: drives walk/run/climb/push cadence and stride. */
  speed: number;
  /** Burden size, 0 = none, 1 = normal, up to 1.6: forward lean and heavier gait. */
  burden: number;
  /**
   * Free-running clock (s), advanced by Animator.update (breathing, look-around). Left at 0, the Animator seeds
   * it with a deterministic per-instance offset so a crowd never breathes in step.
   */
  time: number;
  style: AnimStyle;
  /** Character height in skeleton units (metres before any scale set on the character's Object3D). */
  height: number;
  /**
   * Hop, joy jump and land own their small vertical arc unless this is false (the player controller moves the
   * root itself while airborne). Default true, so NPCs and the Lab jump without physics.
   */
  rootMotion?: boolean;
  /**
   * Signature rest pose (GDD 2.11 design sheet) the idle clip holds instead of hanging arms: arms crossed
   * (Obstinate), hands on heart (Christiana), pointing far (Evangelist). From the recipe's `pose`.
   */
  pose?: RestPose | null;
  /** Filled by the Animator from the skeleton; clips fall back to standard proportions of `height`. */
  rig?: RigInfo;
}

export type AnimName =
  | 'idle'
  | 'walk'
  | 'run'
  | 'burdenedWalk'
  | 'hop'
  | 'joyJump'
  | 'talk'
  | 'wave'
  | 'point'
  | 'sit'
  | 'nap'
  | 'pray'
  | 'read'
  | 'trip'
  | 'coverEarsRun'
  | 'climb'
  | 'push'
  | 'kneel'
  | 'knock'
  | 'reach'
  | 'fall'
  | 'land';

export interface ProcClip {
  name: AnimName;
  loop: boolean;
  /** Loop cycle length or one-shot length (s), at playback rate 1. */
  duration: number;
  /** 'upper' clips write only chest, neck, head and arms; the Animator overlays them. */
  layer: 'full' | 'upper';
  /** Write offsets into `out` (pre-zeroed); t = seconds into the clip. Must not allocate. */
  sample(t: number, p: AnimParams, out: Pose): void;
  /**
   * Playback rate (1 = real time) from params, e.g. cadence from speed. Integrated, so changes never jump.
   */
  rate?(p: AnimParams): number;
  /**
   * Locomotion: number of stride cycles in `duration`. Gait clips crossfade in step (shared stride phase).
   */
  gait?: number;
  /**
   * Normalised clip times (0..1) where a foot plants; the Animator counts them (`steps`) for footstep audio.
   */
  steps?: readonly number[];
  /** Normalised clip times of events (burdened huff, impact, take-off, knock); counted as `cues`. */
  cues?: readonly number[];
}
