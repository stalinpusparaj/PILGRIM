/**
 * Shot builders for dialogue camera cuts and cutscenes, and `cutTo` for instant cuts (DialogueHost.camera()).
 * Each builder frames characters as they stand right now and returns a short CameraTrack (start 0, ~4 s) with a
 * gentle push-in; positions are fixed points (no actor tracking), so nods and breathing never move the camera.
 *
 *   rig.suspend();
 *   cutTo(engine, shots.overShoulder(christian, evangelist));   // instant cut (first frame of the shot)
 *   ...
 *   rig.resume(0.8);
 *
 * In a cutscene, retime a shot: `{ ...shots.closeUp(evangelist), start: 3, end: 7 }` or `retime(shot, 3, 7)`.
 * Characters face +z at yaw 0 (GDD rig convention); "right" below is the camera-right of the facing direction.
 */
import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import type { Character } from '../gen/CharacterFactory';
import type { CameraTrack, CutsceneContext, Vec3Tuple } from './cutscene-types';
import { fitFov, setFov } from './cutscene-camera';
import { Rail, clamp01, ease, headPosition, resolvePoint, yawOf } from './cutscene-math';

export interface ShotOptions {
  /** Shot length in seconds (default 4). */
  duration?: number;
  /** Dolly-in over the shot, as a fraction of the camera distance (default 0.06; 0 = locked off). */
  push?: number;
  /** Vertical FOV in degrees (defaults per shot). */
  fov?: number;
  /** Close-up: 1 = a little to the camera's right of the face (the subject's left); over-the-shoulder: 1 = over
   * the listener's right shoulder; two-shot: which side of the pair. Default 1. */
  side?: 1 | -1;
  /**
   * Two-shot and over-the-shoulder: stay on this camera position's side of the line between the two characters
   * (the 180° rule), e.g. `engine.camera.position`, so a series of cuts never flips who is on the left.
   */
  keepSideOf?: THREE.Vector3;
  /**
   * Raises the subject on screen by this fraction of the half-frame height (0 = centred, the default). Dialogue
   * cuts use it so the speaker's face sits above the bottom dialogue panel (DialogueHost cameras pass ~0.4).
   */
  lift?: number;
}

const DEFAULTS = { duration: 4, push: 0.06 };
const FOV = { closeUp: 38, overShoulder: 42, two: 45 };
/** Over-the-shoulder: extra metres out to the side and up per unit of the listener's `burdenSize`. */
const BURDEN_CLEAR = { side: 0.45, up: 0.3 };

const a = new THREE.Vector3();
const b = new THREE.Vector3();
const dir = new THREE.Vector3();
const right = new THREE.Vector3();
const mid = new THREE.Vector3();

function tuple(v: THREE.Vector3): Vec3Tuple {
  return [v.x, v.y, v.z];
}

/** Size factor for distances: 1 for an adult (~1.6 m), bigger for giants, never tiny. */
function sizeOf(c: Character): number {
  return Math.min(3, Math.max(0.7, c.height / 1.6));
}

function track(
  from: THREE.Vector3,
  to: THREE.Vector3,
  look: THREE.Vector3,
  fov: number,
  o: ShotOptions,
): CameraTrack {
  const f = o.fov ?? fov;
  // Aiming below the subject by `lift` of the half-frame (at the shot's final distance) raises it on screen.
  const drop = o.lift ? to.distanceTo(look) * Math.tan(THREE.MathUtils.degToRad(f) / 2) * o.lift : 0;
  const aim: Vec3Tuple = [look.x, look.y - drop, look.z];
  return {
    start: 0,
    end: Math.max(0.1, o.duration ?? DEFAULTS.duration),
    path: [tuple(from), tuple(to)],
    look: [aim],
    ease: 'sineInOut',
    fov: f,
  };
}

/** Camera position `dist` from `target` along `along`, nudged sideways and up, plus its pushed-back start. */
function framed(
  target: THREE.Vector3,
  along: THREE.Vector3,
  dist: number,
  side: number,
  up: number,
  push: number,
) {
  right.set(-along.z, 0, along.x); // camera-right when looking back along `along`
  const end = target.clone().addScaledVector(along, dist).addScaledVector(right, side);
  end.y += up;
  const start = end.clone().addScaledVector(along, dist * push);
  return { start, end };
}

function sideOf(o: ShotOptions, origin: THREE.Vector3, axisRight: THREE.Vector3): 1 | -1 {
  if (o.keepSideOf) {
    const dx = o.keepSideOf.x - origin.x;
    const dz = o.keepSideOf.z - origin.z;
    return dx * axisRight.x + dz * axisRight.z >= 0 ? 1 : -1;
  }
  return o.side ?? 1;
}

export const shots = {
  /** Head and shoulders of one character, from the front with a slight three-quarter angle. */
  closeUp(c: Character, o: ShotOptions = {}): CameraTrack {
    headPosition(c, a);
    const yaw = yawOf(c);
    dir.set(Math.sin(yaw), 0, Math.cos(yaw));
    const s = sizeOf(c);
    const side = (o.side ?? 1) * 0.22 * s;
    const { start, end } = framed(a, dir, 2.2 * s, side, 0.03 * s, o.push ?? DEFAULTS.push);
    // Aim a little above the eyes: the face sits lower in frame, leaving headroom for a speech bubble.
    a.y += 0.12 * s;
    return track(start, end, a, FOV.closeUp, o);
  },

  /** Over `from`'s shoulder onto `to`'s face (`from` is the listener, `to` the one speaking). */
  overShoulder(from: Character, to: Character, o: ShotOptions = {}): CameraTrack {
    headPosition(from, a);
    headPosition(to, b);
    dir.set(b.x - a.x, 0, b.z - a.z);
    if (from === to || dir.lengthSq() < 0.01) return shots.closeUp(to, o);
    dir.normalize();
    right.set(-dir.z, 0, dir.x);
    const side = sideOf(o, a, right);
    const s = sizeOf(from);
    // Big toy heads: a tight shoulder shot would fill the frame with the back of the listener's head. Instead the
    // camera stands well out to the side and a little behind, just under the listener's eye line, looking straight
    // at the speaker's eyes: the speaker is centred (safe on a portrait phone, where the listener drops out of
    // frame) and on a wide screen the listener's head and shoulder edge into the side of the frame.
    const end = a
      .clone()
      .addScaledVector(dir, -0.9 * s)
      .addScaledVector(right, 1.2 * s * side);
    end.y -= 0.1 * s;
    // A burdened listener (Christian's sack on his back): step further out and up so the sack stays out of frame.
    const burden = Math.max(0, from.burdenSize);
    end.addScaledVector(right, BURDEN_CLEAR.side * burden * side);
    end.y += BURDEN_CLEAR.up * burden;
    const look = b;
    const push = (o.push ?? DEFAULTS.push) * end.distanceTo(b);
    const start = end.clone().addScaledVector(mid.copy(b).sub(end).normalize(), -push); // dolly in toward the speaker
    return track(start, end, look, FOV.overShoulder, o);
  },

  /** Both characters side by side in frame, from the side, with a slow drift along the line between them. */
  two(c1: Character, c2: Character, o: ShotOptions = {}): CameraTrack {
    headPosition(c1, a);
    headPosition(c2, b);
    dir.set(b.x - a.x, 0, b.z - a.z);
    if (c1 === c2 || dir.lengthSq() < 0.01) return shots.closeUp(c1, { ...o, push: 0, fov: o.fov ?? 50 });
    const sep = dir.length();
    dir.divideScalar(sep);
    mid.copy(a).add(b).multiplyScalar(0.5);
    right.set(-dir.z, 0, dir.x); // perpendicular to the line between them
    const side = sideOf(o, mid, right);
    const s = Math.max(sizeOf(c1), sizeOf(c2));
    const dist = Math.max(2.8 * s, sep * 1.3 + 1.2 * s);
    const end = mid.clone().addScaledVector(right, dist * side);
    end.y += 0.25 * s + dist * 0.08;
    const drift = dist * (o.push ?? DEFAULTS.push) * 0.6;
    const start = end.clone().addScaledVector(dir, -drift);
    end.addScaledVector(dir, drift);
    const look = mid.clone();
    look.y -= 0.1 * s;
    return track(start, end, look, FOV.two, o);
  },
};

/** The same shot played at another time in a cutscene. */
export function retime(t: CameraTrack, start: number, end = start + (t.end - t.start)): CameraTrack {
  return { ...t, start, end };
}

const pos = new THREE.Vector3();
const look = new THREE.Vector3();
const pathRail = new Rail();
const lookRail = new Rail();
const here = new THREE.Vector3();
const ahead = new THREE.Vector3();

function fillRail(
  rail: Rail,
  sources: CameraTrack['path'],
  actors: CutsceneContext['actors'],
  anchor: THREE.Vector3,
): Rail {
  const pts = rail.setCount(sources.length);
  for (let i = 0; i < sources.length; i++) resolvePoint(sources[i]!, actors, anchor, pts[i]!);
  rail.rebuild();
  return rail;
}

function isCamera(v: Engine | THREE.PerspectiveCamera): v is THREE.PerspectiveCamera {
  return (v as THREE.PerspectiveCamera).isPerspectiveCamera === true;
}

/**
 * Instant cut: puts the camera on a track's frame at `progress` (0 = its first frame, default) with its FOV
 * (widened on screens narrower than 16:9, see fitFov).
 * Does not suspend the 'cameraRig' — the caller (a DialogueHost) suspends it first and resumes it afterwards.
 * Rails that start at 'camera' resolve to where the camera is now. Accepts the Engine (engine.camera) or a camera.
 */
export function cutTo(
  target: Engine | THREE.PerspectiveCamera,
  t: CameraTrack,
  opts?: { progress?: number; actors?: CutsceneContext['actors'] },
): void {
  const camera = isCamera(target) ? target : target.camera;
  if (t.path.length === 0 || t.look.length === 0) return;
  const u = ease(t.ease, clamp01(opts?.progress ?? 0));
  here.copy(camera.position);
  camera.getWorldDirection(ahead).multiplyScalar(8).add(here);
  fillRail(pathRail, t.path, opts?.actors, here).at(u, pos);
  fillRail(lookRail, t.look, opts?.actors, ahead).at(u, look);
  camera.position.copy(pos);
  if (pos.distanceToSquared(look) > 1e-8) camera.lookAt(look);
  if (typeof t.fov === 'number') setFov(camera, fitFov(t.fov, camera.aspect));
  else if (t.fov) setFov(camera, fitFov(t.fov[0] + (t.fov[1] - t.fov[0]) * u, camera.aspect));
  camera.updateMatrixWorld();
}
