/**
 * Clip registry: every procedural clip by name, in a stable order for the Lab. Re-exported by index.ts; kept
 * separate so the Animator can import it without an import cycle.
 */
import type { AnimName, ProcClip } from './types';
import { burdenedWalk, coverEarsRun, idle, run, walk } from './clips-loco';
import { hop, joyJump, land } from './clips-air';
import { kneel, nap, pray, sit } from './clips-rest';
import { knock, point, reach, read, talk, wave } from './clips-upper';
import { fall, trip } from './clips-tumble';
import { climb, push } from './clips-work';

export const CLIPS: Record<AnimName, ProcClip> = {
  idle,
  walk,
  run,
  burdenedWalk,
  hop,
  joyJump,
  talk,
  wave,
  point,
  sit,
  nap,
  pray,
  read,
  trip,
  coverEarsRun,
  climb,
  push,
  kneel,
  knock,
  reach,
  fall,
  land,
};

/** Every clip name in a stable order (Lab lists, tests). */
export const ANIM_NAMES: readonly AnimName[] = [
  'idle',
  'walk',
  'run',
  'burdenedWalk',
  'hop',
  'joyJump',
  'talk',
  'wave',
  'point',
  'sit',
  'nap',
  'pray',
  'read',
  'trip',
  'coverEarsRun',
  'climb',
  'push',
  'kneel',
  'knock',
  'reach',
  'fall',
  'land',
];

/**
 * Speed (m/s) to show each speed-driven clip at in the Lab (GDD 2.7.1 for walk, burdened walk and run). Set
 * `params.speed` to this before playing; gameplay sets the real speed every frame instead.
 */
export const NOMINAL_SPEED: Readonly<Partial<Record<AnimName, number>>> = {
  walk: 3.4,
  run: 6,
  burdenedWalk: 2,
  coverEarsRun: 5,
  climb: 1,
  push: 1.2,
};

/** True for overlay clips (talk, wave, point, read, knock, reach). */
export function isUpperClip(name: AnimName): boolean {
  return CLIPS[name].layer === 'upper';
}
