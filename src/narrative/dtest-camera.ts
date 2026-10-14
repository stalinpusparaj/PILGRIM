/**
 * Camera of the `?dialogue=test` demo: a fixed two-shot of the two actors from the sunny side, drifting very
 * slowly (still with "Reduce camera motion"), framed so both fit at any aspect ratio (a 375 px portrait phone
 * pulls back). It stands in for the gameplay follow camera, so it implements CameraRig: dialogue camera cuts
 * and cutscenes `suspend()` it and drive `engine.camera` themselves; `resume(blend)` glides back to the two-shot.
 * Allocation-free per frame.
 */
import * as THREE from 'three';
import type { CameraRig } from '../core/CameraRig';
import type { Character } from '../gen/CharacterFactory';

export interface DemoGround {
  heightAt(x: number, z: number): number;
}

const SHOT = {
  /** Look-at height above the actors' feet (chest / chin). */
  lookUp: 1.2,
  /** Camera height above the look-at point. */
  rise: 0.55,
  /** Side margin beyond each actor (m) and the closest the camera comes. */
  margin: 1.3,
  minDist: 4.2,
  maxDist: 14,
  /** Swing the camera this far (rad) round towards actor B's back: a 3/4 view of A's face with B's world
   * (for the demo: Christian with the city gate behind him). */
  skew: 0.38,
  clearance: 0.6,
};
const DRIFT = { yaw: 0.1, speed: 0.13 };
const DEFAULT_BLEND = 0.6;

export class DemoCamera implements CameraRig {
  private suspendCount = 0;
  private time = 0;
  private baseFov: number;
  private fromFov = 0;
  private blend = 0;
  private blendTotal = 0;
  private readonly from = new THREE.Vector3();
  private readonly fromLook = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly mid = new THREE.Vector3();
  private readonly side = new THREE.Vector3();
  private readonly want = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    private readonly a: Character,
    private readonly b: Character,
    private readonly ground: DemoGround,
    /** Direction towards the sun (palette light.sunDir); the camera stands on that side of the pair. */
    sunDir: readonly [number, number, number],
  ) {
    this.side.set(sunDir[0], 0, sunDir[2]);
    this.baseFov = camera.fov;
    this.update(0, true);
  }

  /** The two-shot's FOV (Settings > FOV); applied at once unless a shot holds the camera. */
  setBaseFov(fov: number): void {
    this.baseFov = fov;
    if (!this.suspended && this.blend <= 0) this.applyFov(fov);
  }

  /** Where the two-shot camera stands (dialogue cuts keep to this side of the actors: the 180° rule). */
  home(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.want);
  }

  get suspended(): boolean {
    return this.suspendCount > 0;
  }

  suspend(): void {
    this.suspendCount++;
  }

  resume(blend = DEFAULT_BLEND): void {
    if (this.suspendCount === 0) return;
    this.suspendCount--;
    if (this.suspendCount === 0) this.startBlend(blend);
  }

  /** Back to the two-shot whatever the suspend count (end of a conversation, whoever forgot to resume). */
  reset(blend = DEFAULT_BLEND): void {
    const was = this.suspendCount > 0;
    this.suspendCount = 0;
    if (was) this.startBlend(blend);
  }

  focus(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.a.root.position).setY(this.a.root.position.y + this.a.height * 0.9);
  }

  /** Once per rendered frame (real seconds). `snap` jumps straight to the shot. */
  update(frameDt: number, snap = false, reduceMotion = false): void {
    if (this.suspended && !snap) return;
    const dt = Math.min(frameDt, 0.1);
    this.time += dt;
    this.frame(reduceMotion);
    const cam = this.camera;
    if (snap) {
      this.blend = 0;
      this.applyFov(this.baseFov);
      cam.position.copy(this.want);
      cam.lookAt(this.look);
      return;
    }
    if (this.blend > 0) {
      this.blend = Math.max(0, this.blend - dt);
      const k = smooth(1 - this.blend / this.blendTotal);
      cam.position.lerpVectors(this.from, this.want, k);
      this.tmp.lerpVectors(this.fromLook, this.look, k);
      cam.lookAt(this.tmp);
      this.applyFov(this.fromFov + (this.baseFov - this.fromFov) * k);
      return;
    }
    cam.position.copy(this.want);
    cam.lookAt(this.look);
  }

  // ---------------------------------------------------------------------------------------------- private

  private applyFov(fov: number): void {
    if (Math.abs(this.camera.fov - fov) < 1e-3) return;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  private startBlend(seconds: number): void {
    const cam = this.camera;
    this.fromFov = cam.fov;
    if (seconds <= 0) {
      this.blend = 0;
      this.applyFov(this.baseFov);
      return;
    }
    this.from.copy(cam.position);
    cam.getWorldDirection(this.fwd);
    this.fromLook.copy(cam.position).addScaledVector(this.fwd, cam.position.distanceTo(this.look) || 5);
    this.blend = this.blendTotal = seconds;
  }

  /** The two-shot for this frame: `want` (camera position) and `look`. */
  private frame(reduceMotion: boolean): void {
    const pa = this.a.root.position;
    const pb = this.b.root.position;
    this.mid.addVectors(pa, pb).multiplyScalar(0.5);
    const span = Math.hypot(pb.x - pa.x, pb.z - pa.z);
    // Perpendicular to the pair, on the sun's side, swung a little round behind actor B (3/4 view of A).
    const ax = span > 1e-3 ? (pb.x - pa.x) / span : 1;
    const az = span > 1e-3 ? (pb.z - pa.z) / span : 0;
    let px = -az;
    let pz = ax;
    if (px * this.side.x + pz * this.side.z < 0) {
      px = -px;
      pz = -pz;
    }
    const drift = reduceMotion ? 0 : Math.sin(this.time * DRIFT.speed) * DRIFT.yaw;
    const yaw = Math.atan2(px, pz) + drift;
    const dx = Math.sin(yaw) * Math.cos(SHOT.skew) + ax * Math.sin(SHOT.skew);
    const dz = Math.cos(yaw) * Math.cos(SHOT.skew) + az * Math.sin(SHOT.skew);
    const dl = Math.hypot(dx, dz) || 1;

    // Distance that fits both actors (+ margin) across the horizontal field of view.
    const cam = this.camera;
    const halfV = THREE.MathUtils.degToRad(cam.fov) / 2;
    const tanH = Math.tan(halfV) * Math.max(0.3, cam.aspect);
    const half = span / 2 + SHOT.margin;
    const dist = THREE.MathUtils.clamp(half / tanH, SHOT.minDist, SHOT.maxDist);

    this.look.set(this.mid.x, this.mid.y + SHOT.lookUp, this.mid.z);
    this.want.set(this.look.x + (dx / dl) * dist, this.look.y + SHOT.rise, this.look.z + (dz / dl) * dist);
    const floor = this.ground.heightAt(this.want.x, this.want.z) + SHOT.clearance;
    if (this.want.y < floor) this.want.y = floor;
  }
}

function smooth(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}
