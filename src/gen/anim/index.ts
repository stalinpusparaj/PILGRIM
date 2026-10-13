/**
 * Procedural animation library (GDD 2.12, ARCHITECTURE "Procedural animation"): clips driven by code curves,
 * blended by the Animator. Import from here.
 */
export type { AnimName, AnimParams, AnimStyle, ArmRest, BonePose, Pose, ProcClip, RigInfo } from './types';
export { DEFAULT_STYLE } from './types';
export { CLIPS, ANIM_NAMES, NOMINAL_SPEED, isUpperClip } from './clips-all';
export { Animator } from './Animator';
export { ANIM_BONES, UPPER_BONES } from './clips-track';
export type { PlayOptions } from './Animator';
export { measureRig, standardRig } from './clips-rig';
