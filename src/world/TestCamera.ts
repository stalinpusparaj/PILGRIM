/**
 * Camera rig for the test world (?chapter=test). Three modes, keys 1-3:
 * 1 follow   - the gameplay framing of GDD 2.5: 4.5 m behind and 2.2 m above a point moving along the Way,
 *              looking slightly down; the heading swings in gently (auto-camera feel); burdened = 0.2 m lower
 *              plus a slow sway (off with "Reduce camera motion").
 * 2 orbit    - free OrbitControls around the moving focus (drag to turn, wheel / pinch to zoom).
 * 3 overview - a high, slow circle round the whole map.
 * All motion is exponential damping on real frame time, so it is smooth at any frame rate, and nothing is
 * allocated per frame.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type TestCameraMode = 'follow' | 'orbit' | 'overview';
export const TEST_CAMERA_MODES: readonly TestCameraMode[] = ['follow', 'orbit', 'overview'];

export interface CameraGround {
  heightAt(x: number, z: number): number;
}

export interface FollowOptions {
  burdened: boolean;
  reduceMotion: boolean;
}

/** GDD 2.5 gameplay camera. */
const FOLLOW = {
  back: 4.5,
  up: 2.2,
  burdenDrop: 0.2,
  lookUp: 1.0, // look at the character's chest/head, so the view tips slightly down
  yawRate: 2.2, // 1/s, how fast the camera swings in behind
  posRate: 9, // 1/s, smooths terrain bumps in the camera height
  glide: 1.0, // s, easing back in after orbit / overview
  glideRate: 5, // 1/s
  clearance: 0.5,
  sway: { amp: 0.1, speed: 0.75 },
};
const ORBIT = { minDistance: 1.5, maxDistance: 160, maxPolar: Math.PI * 0.49, damping: 0.08 };
const OVERVIEW = { radius: 0.42, height: 0.3, lapSeconds: 150 };

export class TestCamera {
  readonly camera: THREE.PerspectiveCamera;
  private mode: TestCameraMode = 'follow';
  private controls: OrbitControls | null = null;
  private yaw = 0;
  private time = 0;
  private overviewAngle = 0;
  private snap = true;
  private glide = 0;
  private readonly look = new THREE.Vector3();
  private readonly want = new THREE.Vector3();
  private readonly lastFocus = new THREE.Vector3();
  private disposed = false;

  constructor(
    camera: THREE.PerspectiveCamera,
    private readonly dom: HTMLElement,
    private readonly ground: CameraGround,
    /** World size (m); the overview circles the origin, the world's centre. */
    private readonly worldSize: number,
  ) {
    this.camera = camera;
  }

  get current(): TestCameraMode {
    return this.mode;
  }

  setMode(mode: TestCameraMode): void {
    if (this.disposed || mode === this.mode) return;
    this.mode = mode;
    // Orbit controls are created on the next update, around the focus of that frame.
    if (mode !== 'orbit') this.dropControls();
    // Leaving orbit/overview: glide back rather than cut. Entering overview: start where the camera is.
    this.snap = false;
    this.glide = mode === 'follow' ? FOLLOW.glide : 0;
    if (mode === 'overview') this.overviewAngle = Math.atan2(this.camera.position.z, this.camera.position.x);
  }

  /** Once per rendered frame. `focus` is the ground point being followed, `heading` its rotation.y. */
  update(frameDt: number, focus: THREE.Vector3, heading: number, o: FollowOptions): void {
    if (this.disposed) return;
    const dt = Math.min(frameDt, 0.1);
    this.time += dt;
    if (this.mode === 'follow') this.follow(dt, focus, heading, o);
    else if (this.mode === 'orbit') this.orbit(focus);
    else this.overview(dt);
    this.lastFocus.copy(focus);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.dropControls();
  }

  private follow(dt: number, focus: THREE.Vector3, heading: number, o: FollowOptions): void {
    if (this.snap) this.yaw = heading;
    this.yaw = dampAngle(this.yaw, heading, FOLLOW.yawRate, dt);
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    const up = FOLLOW.up - (o.burdened ? FOLLOW.burdenDrop : 0);
    const sway =
      o.burdened && !o.reduceMotion ? Math.sin(this.time * FOLLOW.sway.speed) * FOLLOW.sway.amp : 0;
    // Behind the focus (-forward), raised; the sway slides along the sideways axis (fz, -fx).
    this.want.set(
      focus.x - fx * FOLLOW.back + fz * sway,
      focus.y + up,
      focus.z - fz * FOLLOW.back - fx * sway,
    );
    const floor = this.ground.heightAt(this.want.x, this.want.z) + FOLLOW.clearance;
    if (this.want.y < floor) this.want.y = floor;

    const cam = this.camera.position;
    if (this.snap) {
      cam.copy(this.want);
    } else if (this.glide > 0) {
      // Coming back from another mode: ease in, then lock on.
      this.glide -= dt;
      cam.lerp(this.want, 1 - Math.exp(-FOLLOW.glideRate * dt));
    } else {
      // Locked at exactly 4.5 m behind; only the height is smoothed (terrain bumps), never below the floor.
      const y = cam.y + (this.want.y - cam.y) * (1 - Math.exp(-FOLLOW.posRate * dt));
      cam.set(this.want.x, Math.max(y, floor), this.want.z);
    }
    this.snap = false;
    this.look.set(focus.x, focus.y + FOLLOW.lookUp, focus.z);
    this.camera.lookAt(this.look);
  }

  private orbit(focus: THREE.Vector3): void {
    const c = this.controls;
    if (!c) {
      this.controls = this.makeControls(focus);
      return;
    }
    // The target rides along with the focus and carries the camera with it: orbit a moving walker.
    const dx = focus.x - this.lastFocus.x;
    const dy = focus.y - this.lastFocus.y;
    const dz = focus.z - this.lastFocus.z;
    c.target.x += dx;
    c.target.y += dy;
    c.target.z += dz;
    this.camera.position.x += dx;
    this.camera.position.y += dy;
    this.camera.position.z += dz;
    c.update();
  }

  private overview(dt: number): void {
    this.overviewAngle += (dt * Math.PI * 2) / OVERVIEW.lapSeconds;
    const r = this.worldSize * OVERVIEW.radius;
    const centreY = this.ground.heightAt(0, 0);
    this.want.set(
      Math.cos(this.overviewAngle) * r,
      centreY + this.worldSize * OVERVIEW.height,
      Math.sin(this.overviewAngle) * r,
    );
    this.camera.position.lerp(this.want, 1 - Math.exp(-2 * dt));
    this.look.set(0, centreY, 0);
    this.camera.lookAt(this.look);
  }

  private makeControls(focus: THREE.Vector3): OrbitControls {
    const c = new OrbitControls(this.camera, this.dom);
    c.enableDamping = true;
    c.dampingFactor = ORBIT.damping;
    c.minDistance = ORBIT.minDistance;
    c.maxDistance = ORBIT.maxDistance;
    c.maxPolarAngle = ORBIT.maxPolar;
    c.target.set(focus.x, focus.y + FOLLOW.lookUp, focus.z);
    // Coming from far away (overview, a fresh world): start at a close three-quarter view.
    if (this.camera.position.distanceTo(c.target) > ORBIT.maxDistance * 0.5) {
      this.camera.position.set(focus.x + 5, focus.y + 3.5, focus.z + 5);
    }
    c.update();
    return c;
  }

  private dropControls(): void {
    this.controls?.dispose();
    this.controls = null;
  }
}

/** Frame-rate independent exponential approach for angles (shortest way round). */
function dampAngle(from: number, to: number, rate: number, dt: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return from + d * (1 - Math.exp(-rate * dt));
}
