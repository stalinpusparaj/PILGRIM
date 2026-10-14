/**
 * Drives a PerspectiveCamera along CameraTracks (src/narrative/cutscene-types.ts): picks the latest-started
 * track, walks its position and look rails by eased progress, eases the FOV. Rails with moving points (actors,
 * functions) are re-measured every frame and low-pass filtered (~0.15 s), so a talking head's nods never shake
 * the camera (GDD 2.5 "No shaky cam"). Allocation-free per frame.
 */
import * as THREE from 'three';
import type { CameraCue, CameraTrack, CutsceneContext } from './cutscene-types';
import { Rail, clamp01, ease, groundHeight, isDynamic, resolvePoint } from './cutscene-math';

/** How far in front of the camera its "look" anchor sits when it was not looking at a known point. */
const LOOK_ANCHOR_DIST = 8;
/** Smoothing time constant for moving rails (seconds). */
const FOLLOW_TAU = 0.15;
/** With a ground sampler the camera never dips closer than this to the terrain (no peeking under hills). */
const GROUND_CLEARANCE = 0.4;

interface TrackRuntime {
  cue: CameraCue;
  /** The track playing: the cue itself, or what a DeferredShot built when it started (null: it failed). */
  def: CameraTrack | null;
  path: Rail;
  look: Rail;
  dynamic: boolean;
}

/** Shot FOVs are designed for a 16:9 screen. */
const DESIGN_ASPECT = 16 / 9;
/** Narrower screens widen the vertical FOV toward keeping the shot's width, up to this many degrees. */
const MAX_FITTED_FOV = 75;

/**
 * A shot's vertical FOV for the camera's aspect: on screens narrower than 16:9 (portrait phones) it widens so
 * the frame keeps more of its width — part of the way (exponent 0.6), so faces do not shrink to dots, and never
 * past 75° (the Settings FOV maximum) unless the shot itself asked for more.
 */
export function fitFov(fov: number, aspect: number): number {
  if (!(aspect > 0) || aspect >= DESIGN_ASPECT) return fov;
  const k = Math.pow(DESIGN_ASPECT / aspect, 0.6);
  const fitted = (2 * Math.atan(Math.tan((fov * Math.PI) / 360) * k) * 180) / Math.PI;
  return Math.max(fov, Math.min(MAX_FITTED_FOV, fitted));
}

export function setFov(camera: THREE.PerspectiveCamera, fov: number): void {
  if (!Number.isFinite(fov) || Math.abs(camera.fov - fov) < 1e-3) return;
  camera.fov = fov;
  camera.updateProjectionMatrix();
}

export class CameraDirector {
  /**
   * Reduce camera motion: every shot holds its final framing (cuts instead of moves; FOV changes snap too).
   * Look targets that follow actors still follow them, gently smoothed.
   */
  still = false;
  private camera: THREE.PerspectiveCamera;
  private tracks: TrackRuntime[] = [];
  private actors: CutsceneContext['actors'] = undefined;
  private ground: CutsceneContext['ground'] = undefined;
  private active = -1;
  private hasLook = false;
  private smoothValid = false;
  private readonly startPos = new THREE.Vector3();
  private readonly startQuat = new THREE.Quaternion();
  private fov0 = 55;
  private readonly anchorPos = new THREE.Vector3();
  private readonly anchorLook = new THREE.Vector3();
  private readonly lastLook = new THREE.Vector3();
  private readonly pos = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly smoothPos = new THREE.Vector3();
  private readonly smoothLook = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
  }

  /** Shots for the next run (sorted by start; ties keep their order). */
  load(
    cues: readonly CameraCue[],
    actors: CutsceneContext['actors'],
    ground?: CutsceneContext['ground'],
  ): void {
    this.actors = actors;
    this.ground = ground;
    this.tracks = cues
      .map((cue, i) => ({ cue, i }))
      .filter(
        ({ cue }) =>
          Number.isFinite(cue.start) && ('shot' in cue || (cue.path.length > 0 && cue.look.length > 0)),
      )
      .sort((a, b) => a.cue.start - b.cue.start || a.i - b.i)
      .map(({ cue }) => ({
        cue,
        def: 'shot' in cue ? null : cue,
        path: new Rail(),
        look: new Rail(),
        dynamic: 'shot' in cue ? false : isDynamicTrack(cue),
      }));
    this.active = -1;
    this.hasLook = false;
    this.smoothValid = false;
  }

  /** Remembers the camera as gameplay left it (for 'camera' anchors and restore()). */
  begin(camera?: THREE.PerspectiveCamera): void {
    if (camera) this.camera = camera;
    this.startPos.copy(this.camera.position);
    this.startQuat.copy(this.camera.quaternion);
    this.fov0 = this.camera.fov;
  }

  get startFov(): number {
    return this.fov0;
  }

  /** The last track's end time (0 without tracks). */
  get endTime(): number {
    let end = 0;
    for (const t of this.tracks) end = Math.max(end, t.cue.end, t.cue.start);
    return end;
  }

  get trackCount(): number {
    return this.tracks.length;
  }

  /** Index (in start order) of the track driving the camera, or -1 before the first one starts. */
  get activeIndex(): number {
    return this.active;
  }

  /** Puts the camera back exactly where begin() found it. */
  restore(): void {
    this.camera.position.copy(this.startPos);
    this.camera.quaternion.copy(this.startQuat);
    setFov(this.camera, this.fov0);
  }

  /** Places the camera for cutscene time `t`. `frameDt` (real seconds) only feeds the smoothing of moving rails. */
  apply(t: number, frameDt: number): void {
    let idx = -1;
    for (let i = 0; i < this.tracks.length; i++) {
      if (this.tracks[i]!.cue.start <= t) idx = i;
      else break;
    }
    if (idx < 0) return; // before the first shot: the camera stays where gameplay left it
    if (idx !== this.active) this.activate(idx);
    const rt = this.tracks[idx]!;
    const def = rt.def;
    if (!def) return; // a deferred shot that could not be framed: hold the last frame
    const span = def.end - def.start;
    const u = span > 1e-6 ? clamp01((t - def.start) / span) : 1;
    const e = this.still ? 1 : ease(def.ease, u);
    if (rt.dynamic) this.build(rt, def);
    rt.path.at(e, this.pos);
    rt.look.at(e, this.look);
    if (rt.dynamic) {
      if (!this.smoothValid) {
        this.smoothPos.copy(this.pos);
        this.smoothLook.copy(this.look);
        this.smoothValid = true;
      } else {
        const k = 1 - Math.exp(-Math.max(0, frameDt) / FOLLOW_TAU);
        this.smoothPos.lerp(this.pos, k);
        this.smoothLook.lerp(this.look, k);
      }
      this.pos.copy(this.smoothPos);
      this.look.copy(this.smoothLook);
    }
    if (this.ground) {
      const floor = groundHeight(this.ground, this.pos.x, this.pos.z, -Infinity) + GROUND_CLEARANCE;
      if (this.pos.y < floor) this.pos.y = floor;
    }
    this.camera.position.copy(this.pos);
    if (this.pos.distanceToSquared(this.look) > 1e-8) this.camera.lookAt(this.look);
    const fov = def.fov;
    if (typeof fov === 'number') setFov(this.camera, fitFov(fov, this.camera.aspect));
    else if (fov) setFov(this.camera, fitFov(fov[0] + (fov[1] - fov[0]) * e, this.camera.aspect));
    this.lastLook.copy(this.look);
    this.hasLook = true;
  }

  /** A new shot: capture where the camera is (the 'camera' anchor), frame a deferred shot, resolve the rails. */
  private activate(idx: number): void {
    this.active = idx;
    this.anchorPos.copy(this.camera.position);
    if (this.hasLook) this.anchorLook.copy(this.lastLook);
    else {
      this.camera.getWorldDirection(this.fwd);
      this.anchorLook.copy(this.camera.position).addScaledVector(this.fwd, LOOK_ANCHOR_DIST);
    }
    this.smoothValid = false; // a cut never glides
    const rt = this.tracks[idx]!;
    const cue = rt.cue;
    if ('shot' in cue) {
      try {
        const built = cue.shot();
        rt.def =
          built.path.length > 0 && built.look.length > 0
            ? { ...built, start: cue.start, end: cue.end }
            : null;
      } catch (err) {
        console.error('[cutscene] a deferred shot threw; holding the previous frame', err);
        rt.def = null;
      }
      rt.dynamic = rt.def !== null && isDynamicTrack(rt.def);
    }
    if (rt.def) this.build(rt, rt.def);
  }

  private build(rt: TrackRuntime, def: CameraTrack): void {
    fill(rt.path, def.path, this.actors, this.anchorPos);
    fill(rt.look, def.look, this.actors, this.anchorLook);
  }
}

function isDynamicTrack(t: CameraTrack): boolean {
  return t.path.some(isDynamic) || t.look.some(isDynamic);
}

function fill(
  rail: Rail,
  sources: CameraTrack['path'],
  actors: CutsceneContext['actors'],
  anchor: THREE.Vector3,
): void {
  const pts = rail.setCount(sources.length);
  for (let i = 0; i < sources.length; i++) resolvePoint(sources[i]!, actors, anchor, pts[i]!);
  rail.rebuild();
}

/** Eases a camera's FOV back after a cutscene (render-time, real seconds; instant when `seconds` <= 0). */
export class FovTween {
  private camera: THREE.PerspectiveCamera | null = null;
  private from = 0;
  private to = 0;
  private t = 0;
  private dur = 0;

  get active(): boolean {
    return this.camera !== null;
  }

  start(camera: THREE.PerspectiveCamera, to: number, seconds: number): void {
    if (seconds <= 0 || Math.abs(camera.fov - to) < 1e-3) {
      setFov(camera, to);
      this.camera = null;
      return;
    }
    this.camera = camera;
    this.from = camera.fov;
    this.to = to;
    this.t = 0;
    this.dur = seconds;
  }

  update(frameDt: number): void {
    const cam = this.camera;
    if (!cam) return;
    this.t += Math.max(0, frameDt);
    const u = ease('smootherstep', this.t / this.dur);
    setFov(cam, this.from + (this.to - this.from) * u);
    if (u >= 1) this.camera = null;
  }

  cancel(): void {
    this.camera = null;
  }
}
