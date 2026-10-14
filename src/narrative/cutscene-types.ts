/**
 * Cutscene data (GDD 2.5 "Cutscenes: spline rails, letterbox bars, gentle eased moves. No shaky cam.").
 * Types only; the player is src/narrative/Cutscene.ts. Times are seconds from the start of the cutscene,
 * positions are metres in the scene (actor roots are expected to be children of the scene, unrotated parent).
 *
 *   const def: CutsceneDef = {
 *     id: 'ch01_evangelist_arrives',
 *     camera: [
 *       { start: 0, end: 3, path: ['camera', [4, 3, 8]], look: [{ actor: 'evangelist', at: 'head' }] },
 *       { ...shots.closeUp(evangelist), start: 3, end: 6 },
 *     ],
 *     actors: [{ actor: 'evangelist', actions: [
 *       { at: 0, do: 'moveTo', path: [[2, 0, 4], [0, 0, 1]], speed: 1.4 },
 *       { at: 3.2, do: 'say', key: 'ch01.evangelist.1' },
 *     ] }],
 *     events: [{ at: 5.5, run: () => state.setFlag('metEvangelist', true), essential: true }],
 *   };
 */
import type * as THREE from 'three';
import type { EventMap, EventName } from '../core/Events';
import type { Character, Expression } from '../gen/CharacterFactory';
import type { AnimName } from '../gen/anim';
import type { AudioEventMap, Mood, MusicState, SfxId, SongId } from '../audio/types';

export type Vec3Tuple = readonly [number, number, number];

/** A point on an actor: 'feet' (root), 'chest' or 'head' (eye level), plus an offset in metres. */
export interface ActorPoint {
  actor: string;
  /** Default 'feet'. */
  at?: 'feet' | 'chest' | 'head';
  offset?: Vec3Tuple;
  /** Rotate `offset` with the actor's facing (+z = in front of them, +x = their left). Default false. */
  local?: boolean;
}

/**
 * A point in the scene. Functions are evaluated every frame (copy-safe: the result is copied at once), so a rail
 * can follow a walking actor. 'camera' is where the camera is when the track begins (for `path`), or the point it
 * was looking at (for `look`): a track starting from 'camera' eases out of the previous shot or the gameplay view.
 */
export type PointSource = Vec3Tuple | THREE.Vector3 | (() => THREE.Vector3) | ActorPoint | 'camera';

export type EaseName = 'linear' | 'smoothstep' | 'smootherstep' | 'easeIn' | 'easeOut' | 'sineInOut';
export type Easing = EaseName | ((u: number) => number);

/**
 * One camera shot: a centripetal Catmull-Rom rail of camera positions and a rail of look-at targets, both walked
 * by the same eased progress from `start` to `end`. One point holds still; two points make a straight move.
 * Tracks are cuts: at any time the latest-started track drives the camera and holds its last frame until the
 * next one starts. Before the first track starts the camera stays where gameplay left it.
 */
export interface CameraTrack {
  start: number;
  end: number;
  path: readonly PointSource[];
  look: readonly PointSource[];
  /** Default 'smootherstep' (gentle start and stop). */
  ease?: Easing;
  /** Vertical FOV in degrees: fixed, or eased [from, to]. Omitted: keep the current FOV. */
  fov?: number | readonly [number, number];
}

/**
 * A shot framed when it starts, not when the cutscene is written: `shot()` runs at `start` (actors are where the
 * scene has put them by then) and its rails, easing and FOV play from `start` to `end`.
 *   { start: 6, end: 9, shot: () => shots.closeUp(pliable) }
 */
export interface DeferredShot {
  start: number;
  end: number;
  shot: () => CameraTrack;
}

export type CameraCue = CameraTrack | DeferredShot;

/** Timed actions for one actor (a Character passed in the play() context under this name). */
export interface ActorTrack {
  actor: string;
  actions: readonly ActorAction[];
}

export type ActorAction =
  /** Full-body clip (upper-body clips are routed to the overlay by the Animator). */
  | { at: number; do: 'play'; anim: AnimName; fade?: number; speed?: number }
  /** Upper-body overlay (talk, wave, point, read, knock, reach); null fades it out. */
  | { at: number; do: 'overlay'; anim: AnimName | null; fade?: number }
  | { at: number; do: 'expression'; expression: Expression }
  /**
   * Walk from where the actor stands through `path` (resolved when the move starts) at `speed` m/s (default
   * 1.6). The gait is chosen by speed (idle / walk / run, burdenedWalk for a burdened recipe) unless `anim`
   * is given; `arrive` plays at the end (default 'idle'). The actor faces along the path unless `face` is false.
   */
  | {
      at: number;
      do: 'moveTo';
      path: readonly PointSource[];
      speed?: number;
      anim?: AnimName;
      arrive?: AnimName;
      face?: boolean;
    }
  /** Keep turning (the whole body, gently) to face a target; null stops. A later move cancels it. */
  | { at: number; do: 'lookAt'; target: PointSource | null; turnRate?: number }
  /** Turn to a yaw (radians, 0 = facing +z). */
  | { at: number; do: 'face'; yaw: number }
  /** Teleport (and optionally set the yaw at once). */
  | { at: number; do: 'place'; to: PointSource; yaw?: number }
  /** A line: an i18n key shown in a speech bubble (the 'bubbles' service) or as a letterbox caption. */
  | { at: number; do: 'say'; key: string; mood?: Mood; params?: Record<string, string | number> }
  | { at: number; do: 'show' }
  | { at: number; do: 'hide' };

/** `[name, payload]` for any event on the bus (payload left out for void events). */
export type EmitTuple = {
  [K in EventName]: EventMap[K] extends void ? readonly [K] : readonly [K, EventMap[K]];
}[EventName];

export type MusicCue =
  SongId | AudioEventMap['music:play'] | { state: MusicState; fade?: number } | 'stop' | 'silence';

interface EventBase {
  at: number;
  /**
   * Fired even when the cutscene is skipped (or ends before `at`), in time order, so game state stays the same
   * whether or not the player watched: give items, set flags, change the chapter music.
   */
  essential?: boolean;
}

export type TimedEvent = EventBase &
  ({ run: () => void } | { sfx: SfxId | AudioEventMap['sfx'] } | { music: MusicCue } | { emit: EmitTuple });

export interface CutsceneDef {
  id: string;
  /** Hold Space / pad A / the on-screen ring for 1 s to skip (default true). */
  skippable?: boolean;
  /**
   * Length in seconds. Default: the last camera end, action or event time, extended while an actor is still
   * walking. Actions still pending at the end jump to their end state.
   */
  duration?: number;
  camera?: readonly CameraCue[];
  actors?: readonly ActorTrack[];
  events?: readonly TimedEvent[];
  /** Seconds the gameplay camera takes to blend back afterwards (default 0.8; 0 cuts). */
  blendOut?: number;
}

/** A line on screen: close() removes it early (skips, the end of the cutscene). */
export interface SayHandle {
  close?(): void;
}

/** Shows an actor's line. The 'bubbles' service (SpeechBubbles) is used when it provides this shape. */
export type SayFn = (
  actor: Character,
  key: string,
  opts: { mood?: Mood; params?: Record<string, string | number> },
) => SayHandle | void;

export interface CutsceneContext {
  /** Actors by the names used in ActorTrack.actor and ActorPoint.actor. */
  actors?: Record<string, Character>;
  /** Ground height for moves and places (a chapter's Terrain or CollisionWorld). Without it, path y is used. */
  ground?: { heightAt(x: number, z: number): number } | { groundAt(x: number, z: number): number };
  /**
   * Actors nobody else animates (built only for this scene): the player calls their update(dt) every fixed
   * step. Actors owned by the World (NPCs) or the Player are animated by their owners, never twice.
   */
  animate?: readonly string[];
  /** Overrides how lines are shown (default: the 'bubbles' service, else a caption in the letterbox). */
  say?: SayFn;
  /**
   * Gameplay input is switched off (Input.setGameplayActive(false): held keys released, touch controls hidden,
   * pointer lock freed) and switched back on at the end. Pass false when the cutscene plays outside gameplay
   * (title, opening) so it is left off. Default true.
   */
  restoreGameplay?: boolean;
}

export type CutsceneResult = 'done' | 'skipped';
