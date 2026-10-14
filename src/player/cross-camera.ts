/**
 * Camera for the Cross (GDD 2.5 "cutscenes: spline rails, gentle eased moves, no shaky cam"): suspends the gameplay
 * follow camera ('cameraRig'), then eases engine.camera between shots. A shot's position, look-at and field of view
 * are LIVE values the director keeps updating (the rolling sack), so a move eases from where the camera was to a
 * smoothly damped copy of the moving goal and then keeps tracking it.
 *
 * Moves ride a rail ORBITING Christian (`avoid()`'s point, his chest), the way the follow camera's resume blend does:
 * the angle round him the short way, the distance and the height eased separately, so the camera swings round him
 * and never cuts through him. The view travels from the old subject to the new one by way of Christian (a curve
 * through his chest), so the frame always holds someone. The field of view eases with the move (a slow push in on
 * the tomb). Never below the terrain; kept in front of colliders (cross-occlusion.ts). A tiny settle on big impacts
 * unless "Reduce camera motion" is on. Runs in render (frame time, scaled like the loop, frozen while paused).
 */
import * as THREE from 'three';
import { services } from '../core/Services';
import type { Terrain } from '../gen/Terrain';
import type { CameraOcclusion } from './cross-occlusion';
import { damp, smoothstep } from './cross-types';

/** A shot as the director keeps it up to date: camera position, look-at point, vertical FOV (degrees). */
export interface CrossShotGoal {
  readonly pos: THREE.Vector3;
  readonly look: THREE.Vector3;
  readonly fov: number;
}

const CLEARANCE = 0.5;
/** How quickly the damped goal follows the live goal (per second). */
const TRACK_RATE = 4.5;
const SHAKE = { freqA: 31, freqB: 23, decay: 9 } as const;
const FOV = { min: 15, max: 90 } as const;
/** A move round him never averages more than this (rad/s): a long swing takes longer than asked. */
const ORBIT_RATE = (65 * Math.PI) / 180;

export class CrossCamera {
  private readonly fromPos = new THREE.Vector3();
  private readonly fromLook = new THREE.Vector3();
  private readonly goalPos = new THREE.Vector3();
  private readonly goalLook = new THREE.Vector3();
  private live: CrossShotGoal | null = null;
  private avoidAt: THREE.Vector3 | null = null;
  private avoidR = 0;
  private readonly look = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private baseFov = 55;
  private fromFov = 55;
  private goalFov = 55;
  private moveT = 1;
  private moveDur = 1;
  private shakeT = -1;
  private shakeAmp = 0;
  private suspended = false;
  private active = false;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly terrain: Terrain,
    private readonly reduceMotion: boolean,
    private readonly occlusion: CameraOcclusion | null = null,
  ) {}

  /** The field of view the camera had when the scene began (shots are framed against it). */
  get startFov(): number {
    return this.baseFov;
  }

  /** Takes the camera from the follow rig, starting from wherever it is now. */
  begin(): void {
    if (this.active) return;
    this.active = true;
    const rig = services.tryGet('cameraRig');
    if (rig) {
      rig.suspend();
      this.suspended = true;
    }
    this.camera.updateMatrixWorld();
    this.fromPos.copy(this.camera.position);
    this.camera.getWorldDirection(this.tmp);
    this.fromLook.copy(this.camera.position).addScaledVector(this.tmp, 8);
    this.goalPos.copy(this.fromPos);
    this.goalLook.copy(this.fromLook);
    this.look.copy(this.fromLook);
    this.baseFov = this.fromFov = this.goalFov = this.camera.fov;
    this.moveT = 1;
  }

  /** Eases over `seconds` to a shot whose live goal the caller may keep moving. */
  to(goal: CrossShotGoal, seconds: number): void {
    if (!this.active) return;
    this.fromPos.copy(this.camera.position);
    this.fromLook.copy(this.look);
    this.fromFov = this.camera.fov;
    this.live = goal;
    this.goalPos.copy(goal.pos);
    this.goalLook.copy(goal.look);
    this.goalFov = fovOf(goal.fov, this.baseFov);
    this.moveT = 0;
    const swing = this.avoidAt ? orbitAngle(this.fromPos, this.goalPos, this.avoidAt) : 0;
    this.moveDur = Math.max(0.01, seconds, swing / ORBIT_RATE);
    this.occlusion?.reset(); // the old pull-in was measured along another line
  }

  /** Orbit round this live point (the player's chest) and never come closer than `radius`: never inside him. */
  avoid(p: THREE.Vector3 | null, radius: number): void {
    this.avoidAt = p;
    this.avoidR = radius;
  }

  /** A small settle (impacts). Ignored with Reduce camera motion. */
  shake(amp: number): void {
    if (this.reduceMotion || !this.active) return;
    this.shakeT = 0;
    this.shakeAmp = amp;
  }

  render(dt: number): void {
    if (!this.active) return;
    if (this.live) {
      const k = damp(TRACK_RATE, dt);
      this.goalPos.lerp(this.live.pos, k);
      this.goalLook.lerp(this.live.look, k);
      this.goalFov += (fovOf(this.live.fov, this.baseFov) - this.goalFov) * k;
    }
    this.moveT = Math.min(1, this.moveT + dt / this.moveDur);
    const e = smoothstep(0, 1, this.moveT);
    const cam = this.camera.position;
    const pivot = this.avoidAt;
    if (pivot) {
      orbitLerp(cam, this.fromPos, this.goalPos, e, pivot);
      // A curve from the old subject to the new one that passes him: he stays in frame while the view turns.
      const u = 1 - e;
      this.look
        .copy(this.fromLook)
        .multiplyScalar(u * u)
        .addScaledVector(pivot, 2 * u * e)
        .addScaledVector(this.goalLook, e * e);
    } else {
      cam.lerpVectors(this.fromPos, this.goalPos, e);
      this.look.lerpVectors(this.fromLook, this.goalLook, e);
    }
    this.occlusion?.apply(cam, this.goalLook, dt); // the shot's subject (the view may start far past colliders)
    if (pivot) {
      this.tmp.copy(cam).sub(pivot);
      const d = this.tmp.length();
      if (d < this.avoidR) {
        if (d < 1e-4) this.tmp.set(0, 1, 0);
        cam.copy(pivot).addScaledVector(this.tmp.normalize(), this.avoidR);
      }
    }
    const floor = this.terrain.heightAt(cam.x, cam.z) + CLEARANCE;
    if (cam.y < floor) cam.y = floor;
    const fov = this.fromFov + (this.goalFov - this.fromFov) * e;
    if (Math.abs(fov - this.camera.fov) > 1e-3) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    this.tmp.copy(this.look);
    if (this.shakeT >= 0) {
      this.shakeT += dt;
      const a = this.shakeAmp * Math.exp(-SHAKE.decay * this.shakeT);
      if (a < 0.002) this.shakeT = -1;
      else {
        this.tmp.x += a * Math.sin(SHAKE.freqA * this.shakeT);
        this.tmp.y += a * Math.sin(SHAKE.freqB * this.shakeT + 1.3);
      }
    }
    this.camera.lookAt(this.tmp);
  }

  /** Hands the camera back to the follow rig, which blends from here (its own field of view included). */
  end(blend: number): void {
    if (!this.active) return;
    this.stop();
    if (this.suspended) {
      this.suspended = false;
      services.tryGet('cameraRig')?.resume(blend);
    }
  }

  /** Lets go without handing the camera back (the session is ending and frees the rig itself). */
  release(): void {
    if (!this.active) return;
    this.stop();
    this.suspended = false;
    if (Math.abs(this.camera.fov - this.baseFov) > 1e-3) {
      this.camera.fov = this.baseFov;
      this.camera.updateProjectionMatrix();
    }
  }

  private stop(): void {
    this.active = false;
    this.live = null;
    this.avoidAt = null;
  }
}

function fovOf(fov: number, base: number): number {
  return Number.isFinite(fov) ? Math.min(FOV.max, Math.max(FOV.min, fov)) : base;
}

/** How far (rad) a move from `from` to `to` swings round `pivot`, the short way. */
function orbitAngle(from: THREE.Vector3, to: THREE.Vector3, pivot: THREE.Vector3): number {
  let da = Math.atan2(to.x - pivot.x, to.z - pivot.z) - Math.atan2(from.x - pivot.x, from.z - pivot.z);
  da -= Math.round(da / (Math.PI * 2)) * Math.PI * 2;
  return Math.abs(da);
}

/**
 * `out` = from..to at `t` on a rail round `pivot`: the horizontal angle the short way round, the horizontal distance
 * and the height eased separately (a straight line between two shots on opposite sides would pass through him).
 */
function orbitLerp(
  out: THREE.Vector3,
  from: THREE.Vector3,
  to: THREE.Vector3,
  t: number,
  pivot: THREE.Vector3,
): void {
  const fx = from.x - pivot.x;
  const fz = from.z - pivot.z;
  const tx = to.x - pivot.x;
  const tz = to.z - pivot.z;
  const fa = Math.atan2(fx, fz);
  let da = Math.atan2(tx, tz) - fa;
  da -= Math.round(da / (Math.PI * 2)) * Math.PI * 2;
  const ang = fa + da * t;
  const fr = Math.hypot(fx, fz);
  const r = fr + (Math.hypot(tx, tz) - fr) * t;
  out.set(pivot.x + Math.sin(ang) * r, from.y + (to.y - from.y) * t, pivot.z + Math.cos(ang) * r);
}
