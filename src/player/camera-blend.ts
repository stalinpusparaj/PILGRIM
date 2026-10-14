/**
 * resume(blend) for the follow camera (CameraRig contract): remembers where a cutscene or dialogue cut left the
 * camera and eases from there to the live follow framing over `seconds` (smoothstep in and out). Allocation-free.
 *
 * The move ORBITS the player instead of cutting straight across: position is eased in a cylinder around the
 * pivot (the player's head) - angle the short way round, distance and height separately - and the camera looks at
 * an eased look-at point. A shot in front of Christian therefore swings round him to the follow view behind,
 * never through his head. The start is remembered relative to the pivot, so the blend travels with a player who
 * is already walking.
 */
import * as THREE from 'three';
import { smoothstep, wrapAngle } from './camera-math';

export class CameraBlend {
  /** Start position and look-at point, relative to the pivot when the blend started. */
  private readonly fromOff = new THREE.Vector3();
  private readonly fromLookOff = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly toLook = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private fromFov = 55;
  private dur = 0;
  private t = 0;

  get active(): boolean {
    return this.t < this.dur;
  }

  /**
   * Start from the camera's current transform, orbiting `pivot` (the player's head). `seconds` <= 0 (or NaN) cuts
   * straight to the follow view.
   */
  start(camera: THREE.PerspectiveCamera, seconds: number, pivot: THREE.Vector3): void {
    if (!(seconds > 0)) {
      this.cancel();
      return;
    }
    camera.updateMatrixWorld();
    camera.getWorldDirection(this.dir);
    this.fromOff.copy(camera.position).sub(pivot);
    const reach = Math.max(1, this.fromOff.length());
    this.fromLookOff.copy(this.fromOff).addScaledVector(this.dir, reach);
    this.fromFov = camera.fov;
    this.dur = seconds;
    this.t = 0;
  }

  cancel(): void {
    this.dur = 0;
    this.t = 0;
  }

  /**
   * `camera` already holds this frame's follow transform; moves it back towards the remembered start and returns
   * the field of view to use. `pivot` = the player's head now; `dt` = real seconds this frame (0 while paused).
   */
  apply(camera: THREE.PerspectiveCamera, fov: number, dt: number, pivot: THREE.Vector3): number {
    this.t = Math.min(this.dur, this.t + dt);
    const k = smoothstep(0, 1, this.dur > 0 ? this.t / this.dur : 1);
    // Where the follow rig wants to be, and what it looks at, relative to the pivot.
    camera.getWorldDirection(this.dir);
    const tx = camera.position.x - pivot.x;
    const ty = camera.position.y - pivot.y;
    const tz = camera.position.z - pivot.z;
    const reach = Math.max(1, Math.hypot(tx, ty, tz));
    this.toLook.copy(camera.position).addScaledVector(this.dir, reach);

    const f = this.fromOff;
    const ra = Math.hypot(f.x, f.z);
    const rb = Math.hypot(tx, tz);
    const aa = Math.atan2(f.x, f.z);
    const ab = Math.atan2(tx, tz);
    const ang = aa + wrapAngle(ab - aa) * k;
    const r = ra + (rb - ra) * k;
    camera.position.set(
      pivot.x + Math.sin(ang) * r,
      pivot.y + f.y + (ty - f.y) * k,
      pivot.z + Math.cos(ang) * r,
    );
    this.look.copy(this.fromLookOff).add(pivot).lerp(this.toLook, k);
    camera.lookAt(this.look);
    return this.fromFov + (fov - this.fromFov) * k;
  }
}
