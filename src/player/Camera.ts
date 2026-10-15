/**
 * GDD 2.5 follow camera; implements CameraRig and registers itself as the 'cameraRig' service.
 *
 * - Third person, 5.8 m behind and 3.6 m above the feet, looking slightly down at chest height (toy diorama).
 * - Orbit from Input.look (mouse, right stick, right-half touch drag; Settings cameraSpeed and invertY are
 *   applied inside Input), pitch clamped. Spring arm against terrain and colliders (camera-arm.ts).
 * - Auto-camera (Settings autoCamera: 'default' follows on every device, with explicit 'on'/'off'): gently
 *   recenters behind the heading, even after stopping; never while the player is looking around (resumes 0.9 s after),
 *   and pauses re-centering while reverse movement is held (that would spin the view with camera-relative steering).
 * - Burdened: a small shoulder offset, a slow sway, heavy-step thuds, and an over-the-shoulder offset so Christian's head
 *   peeks out beside the huge sack (camera-config.ts). Reduce camera motion removes sway, thuds and FOV kick.
 * - Fixed-step update(dt) moves the rig's parameters; render(alpha) rebuilds the camera around the player's
 *   interpolated renderPosition from interpolated parameters, so it is jitter-free at any refresh rate.
 *   render() must run after Player.render() and before the Engine's render system (order 1000).
 * - suspend()/resume(blend) are counted; resume snaps the rig behind the player and blends from wherever the
 *   cutscene left the camera. snap() for teleports and respawns (also automatic for jumps of more than 3 m).
 *
 *   const cam = new FollowCamera(engine.camera, player, collision);
 *   loop.add(cam, order);   // after the player
 *   ...
 *   cam.dispose();
 */
import * as THREE from 'three';
import type { CameraRig } from '../core/CameraRig';
import { events } from '../core/Events';
import { services } from '../core/Services';
import { SETTINGS_RANGES } from '../core/Settings';
import { SpringArm, keepAboveGround } from './camera-arm';
import { CameraBlend } from './camera-blend';
import { CAMERA, CAMERA_TUNE } from './camera-config';
import { installCameraDebug } from './camera-debug';
import { CameraFeel } from './camera-feel';
import { CamParams, clamp, damp, smoothstep, wrapAngle } from './camera-math';
import type { CameraCollision, CameraTarget } from './camera-types';

export type { CameraCollision, CameraTarget } from './camera-types';

const DEFAULT_FOV = 55;
/** Head centre as a fraction of the character's height (focus()). */
const HEAD_FRACTION = 0.85;

export class FollowCamera implements CameraRig {
  private readonly arm: SpringArm;
  private readonly feel = new CameraFeel();
  private readonly blend = new CameraBlend();
  private readonly prev = new CamParams();
  private readonly cur = new CamParams();
  private readonly view = new CamParams();
  private readonly lastPos = new THREE.Vector3();
  private readonly pivot = new THREE.Vector3();
  private readonly armVec = new THREE.Vector3();
  private readonly tip = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly blendPivot = new THREE.Vector3();
  private readonly lineDir = new THREE.Vector3();
  private readonly offs: Array<() => void> = [];
  private yawAngle = 0;
  /** Player pitch input, added to the framing's own elevation. */
  private pitchOff = 0;
  /** Smoothed close-up factor (0 = full arm, 1 = pulled right in). */
  private close = 0;
  private lookIdle: number = CAMERA.auto.idle;
  private suspendCount = 0;
  private baseFov = DEFAULT_FOV;
  private disposed = false;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly player: CameraTarget,
    private readonly col: CameraCollision,
  ) {
    this.arm = new SpringArm(col);
    this.baseFov = readFov();
    this.offs.push(
      events.on('settings:changed', ({ key }) => {
        if (key === 'fov') this.baseFov = readFov();
      }),
      installCameraDebug(this),
    );
    this.snap();
    this.render(1, 0);
    services.register('cameraRig', this);
  }

  // ------------------------------------------------------------------------------------------ CameraRig

  get suspended(): boolean {
    return this.suspendCount > 0;
  }

  suspend(): void {
    if (this.disposed) return;
    this.suspendCount++;
    this.blend.cancel();
  }

  resume(blend: number = CAMERA.resumeBlend): void {
    if (this.disposed || this.suspendCount === 0) return;
    if (--this.suspendCount > 0) return;
    this.snap();
    this.blend.start(this.camera, blend, this.focus(this.blendPivot));
  }

  focus(out: THREE.Vector3): THREE.Vector3 {
    const p = this.player.renderPosition;
    return out.set(p.x, p.y + this.player.character.height * HEAD_FRACTION, p.z);
  }

  // ------------------------------------------------------------------------------------------- extras

  /** The camera's look direction (rad), forward = (sin yaw, 0, cos yaw), as of the last fixed step. */
  get yaw(): number {
    return this.yawAngle;
  }

  /** A soft downward camera kick (0..1) for heavy moments; ignored with Reduce camera motion. */
  bump(strength: number): void {
    this.feel.bump(strength, reduceMotion());
  }

  /** Jump straight behind the player with every smoothing settled (teleports, respawns, chapter starts). */
  snap(): void {
    if (this.disposed) return;
    const p = this.player;
    const f = p.forward;
    if (f.x * f.x + f.z * f.z > 1e-6) this.yawAngle = Math.atan2(f.x, f.z);
    this.pitchOff = 0;
    this.lookIdle = CAMERA.auto.idle;
    this.feel.reset(p, reduceMotion());
    this.lastPos.copy(p.controller.position);
    this.arm.reset();
    this.close = 0;
    this.solve(0);
    this.prev.copy(this.cur);
    this.blend.cancel();
  }

  // ------------------------------------------------------------------------------------------ per step

  update(dt: number): void {
    if (this.disposed) return;
    this.prev.copy(this.cur);
    if (this.suspendCount > 0) return;
    const pos = this.player.controller.position;
    const dx = pos.x - this.lastPos.x;
    const dz = pos.z - this.lastPos.z;
    if (dx * dx + dz * dz > CAMERA.teleport ** 2 || Math.abs(pos.y - this.lastPos.y) > CAMERA.teleport * 2) {
      this.snap();
      return;
    }
    this.lastPos.copy(pos);
    const reduce = reduceMotion();
    this.steer(dt);
    this.feel.step(dt, this.player, reduce);
    this.solve(dt);
  }

  render(alpha: number, frameDt: number): void {
    if (this.disposed || this.suspendCount > 0) return;
    const v = this.view.lerp(this.prev, this.cur, alpha);
    const base = this.player.renderPosition;
    const sinY = Math.sin(v.yaw);
    const cosY = Math.cos(v.yaw);
    const rx = -cosY;
    const rz = sinY;
    const feetY = base.y + v.lag + v.bob;
    const px = base.x + rx * v.shoulder;
    const pz = base.z + rz * v.shoulder;
    const cp = Math.cos(v.pitch);
    const reach = v.arm * v.armFrac;
    const cam = this.camera;
    cam.position.set(
      px + (-sinY * cp * v.arm + rx * v.sway) * v.armFrac,
      feetY + CAMERA.pivotHeight + Math.sin(v.pitch) * reach + v.lift,
      pz + (-cosY * cp * v.arm + rz * v.sway) * v.armFrac,
    );
    keepAboveGround(this.col, cam.position);
    this.target.set(px + sinY * v.ahead, feetY + v.lookH, pz + cosY * v.ahead);
    cam.lookAt(this.target);

    let fov = this.baseFov + v.fovKick;
    if (this.blend.active) {
      const paused = services.tryGet('engine')?.loop.paused ?? false;
      const pivot = this.focus(this.blendPivot);
      fov = this.blend.apply(cam, fov, paused ? 0 : frameDt, pivot);
      this.keepLineClear(pivot, cam.position);
      keepAboveGround(this.col, cam.position);
    }
    cam.rotateZ(v.roll);
    if (Math.abs(cam.fov - fov) > 1e-3) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }

  /** One line for the F1 panel. */
  debugLine(): string {
    const c = this.cur;
    const mode = this.suspended ? 'suspended' : autoCameraOn() ? 'auto' : 'manual';
    return `${mode} arm ${(c.arm * c.armFrac).toFixed(2)}/${c.arm.toFixed(2)} m, burden ${this.feel.burden.toFixed(2)}`;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const off of this.offs.splice(0)) off();
    if (services.tryGet('cameraRig') === this) services.unregister('cameraRig');
  }

  // --------------------------------------------------------------------------------------- internals

  /** The resume blend swings round the player: keep it in front of anything between it and his head. */
  private keepLineClear(pivot: THREE.Vector3, cam: THREE.Vector3): void {
    const d = this.lineDir.copy(cam).sub(pivot);
    const len = d.length();
    if (len < 1e-3) return;
    d.divideScalar(len);
    const hit = this.col.raycast(pivot, d, len);
    if (hit !== null) cam.copy(pivot).addScaledVector(d, Math.max(CAMERA.minArm, hit - CAMERA.probe));
  }

  /** Manual orbit from Input.look, then the auto-camera. */
  private steer(dt: number): void {
    const input = services.tryGet('input');
    const lx = input?.look.x ?? 0;
    const ly = input?.look.y ?? 0;
    const looking = Math.abs(lx) + Math.abs(ly) > 1e-6;
    this.lookIdle = looking ? 0 : this.lookIdle + dt;
    // look.x > 0 turns right (yaw decreases with this convention); look.y > 0 looks up (the arm drops).
    this.yawAngle = wrapAngle(this.yawAngle - lx);
    this.pitchOff -= ly;

    const a = CAMERA.auto;
    if (autoCameraOn() && this.lookIdle >= a.idle) {
      const p = this.player;
      const f = p.forward;
      // Do not rotate the camera under held reverse input: with camera-relative steering that
      // would continually rotate the player's desired heading. Recenter as soon as it is released.
      const reversing = (input?.move.y ?? 0) < -0.2;
      if (!looking && !reversing && f.x * f.x + f.z * f.z > 1e-6) {
        const heading = Math.atan2(f.x, f.z);
        const diff = wrapAngle(heading - this.yawAngle);
        const step = diff * (1 - Math.exp(-a.yawRate * dt));
        const cap = a.maxYawRate * dt;
        this.yawAngle = wrapAngle(this.yawAngle + clamp(step, -cap, cap));
        this.pitchOff = damp(this.pitchOff, 0, a.pitchRate, dt);
      }
    }
    const p0 = this.basePitch();
    this.pitchOff = clamp(this.pitchOff, CAMERA.pitchMin - p0, CAMERA.pitchMax - p0);
  }

  /** Camera height above the feet for the current burden (GDD 2.5: 0.2 m lower burdened), minus the pivot. */
  private armRise(): number {
    return CAMERA.height + this.feel.travelLift - CAMERA.burdenDrop * this.feel.burden01 - CAMERA.pivotHeight;
  }

  /** Arm elevation of the GDD framing (no player pitch input). */
  private basePitch(): number {
    return Math.atan2(this.armRise(), CAMERA.back + this.feel.pullBack);
  }

  /** Spring arm + collision at the simulated player position; writes `cur`. dt 0 = settle at once. */
  private solve(dt: number): void {
    const pos = this.player.controller.position;
    const feel = this.feel;
    const b = feel.burden01;
    const yaw = this.yawAngle;
    const sinY = Math.sin(yaw);
    const cosY = Math.cos(yaw);
    const rx = -cosY;
    const rz = sinY;

    this.pivot.set(pos.x, feel.smoothY + feel.bob + CAMERA.pivotHeight, pos.z);
    const narrow = clamp((this.camera.aspect / CAMERA.shoulderAspect) ** 2, CAMERA.shoulderAspectMin, 1);
    const want =
      Math.min(CAMERA.shoulderMax, CAMERA_TUNE.shoulder * feel.burden) *
      (Number.isFinite(narrow) ? narrow : 1) *
      (1 - CAMERA.closeShoulder * this.close);
    const shoulder = this.arm.shoulder(this.pivot, rx, rz, want, dt);
    this.pivot.x += rx * shoulder;
    this.pivot.z += rz * shoulder;

    const rise = this.armRise();
    const back = CAMERA.back + feel.pullBack;
    const arm = Math.hypot(back, rise);
    const pitch = clamp(Math.atan2(rise, back) + this.pitchOff, CAMERA.pitchMin, CAMERA.pitchMax);
    const cp = Math.cos(pitch);
    this.armVec.set(
      -sinY * cp * arm + rx * feel.sway,
      Math.sin(pitch) * arm,
      -cosY * cp * arm + rz * feel.sway,
    );
    const full = this.armVec.length();
    const len = this.arm.solve(this.pivot, this.armVec, rx, rz, dt);
    const frac = full > 1e-4 ? len / full : 1;
    const near = smoothstep(CAMERA.liftFrom, CAMERA.liftTo, frac);
    this.close = dt > 0 ? damp(this.close, near, CAMERA.closeRate, dt) : near;
    const close = this.close;
    let lift = CAMERA.lift * close;
    if (lift > 0) lift = this.arm.rise(this.tip.copy(this.armVec).multiplyScalar(frac).add(this.pivot), lift);

    const c = this.cur;
    c.yaw = yaw;
    c.pitch = pitch;
    c.arm = arm;
    c.armFrac = frac;
    c.lift = lift;
    c.ahead = CAMERA.lookAhead + feel.travelAhead + CAMERA.ahead * close;
    c.roll = feel.roll * (1 - close);
    c.shoulder = shoulder;
    c.lookH = CAMERA_TUNE.lookFree + (CAMERA_TUNE.lookBurdened - CAMERA_TUNE.lookFree) * b;
    c.sway = feel.sway;
    c.bob = feel.bob;
    c.lag = feel.smoothY - pos.y;
    c.fovKick = feel.fovKick;
  }
}

function readFov(): number {
  const fov = services.tryGet('settings')?.data.fov;
  return typeof fov === 'number' && Number.isFinite(fov)
    ? clamp(fov, SETTINGS_RANGES.fov.min, SETTINGS_RANGES.fov.max)
    : DEFAULT_FOV;
}

function reduceMotion(): boolean {
  return services.tryGet('settings')?.data.reduceMotion ?? false;
}

/**
 * Default follows on every input device. Explicit Off preserves fully manual camera control.
 */
function autoCameraOn(): boolean {
  const mode = services.tryGet('settings')?.data.autoCamera ?? 'default';
  if (mode === 'on') return true;
  if (mode === 'off') return false;
  return true; // Default follows on mouse, touch and gamepad; manual look temporarily takes priority.
}
