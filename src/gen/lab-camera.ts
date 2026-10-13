/**
 * Character Lab camera: OrbitControls for free looking, plus eased moves between named shots. The gameplay
 * shot matches GDD 2.5 (4.5 m back, 2.2 m up, looking slightly down) so the cast is judged at the distance
 * players will see it.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/** GDD 2.5 third-person camera offset. */
export const GAMEPLAY_CAMERA = { back: 4.5, up: 2.2 } as const;
const CLOSE_CAMERA = { back: 2.3, up: 1.1 } as const;
const WIDE_CAMERA = { back: 9, up: 3.6 } as const;

export type Shot = 'close' | 'gameplay' | 'wide';

const MOVE_SECONDS = 0.6;

export class LabCamera {
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;

  private readonly fromPos = new THREE.Vector3();
  private readonly fromTarget = new THREE.Vector3();
  private readonly toPos = new THREE.Vector3();
  private readonly toTarget = new THREE.Vector3();
  private t = 1;
  private duration = MOVE_SECONDS;

  constructor(dom: HTMLElement, fov: number) {
    this.camera = new THREE.PerspectiveCamera(fov, 1, 0.05, 1200);
    this.camera.position.set(0, GAMEPLAY_CAMERA.up, GAMEPLAY_CAMERA.back);
    this.controls = new OrbitControls(this.camera, dom);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.minDistance = 0.8;
    this.controls.maxDistance = 80;
    this.controls.maxPolarAngle = Math.PI * 0.495; // never below the ground
    this.controls.target.set(0, 1, 0);
    this.controls.update();
  }

  /** Is an eased move in progress (controls are locked meanwhile)? */
  get moving(): boolean {
    return this.t < 1;
  }

  /** Ease to a camera position and look target. `seconds = 0` jumps. */
  goTo(position: THREE.Vector3, target: THREE.Vector3, seconds = MOVE_SECONDS): void {
    this.fromPos.copy(this.camera.position);
    this.fromTarget.copy(this.controls.target);
    this.toPos.copy(position);
    this.toTarget.copy(target);
    this.duration = Math.max(1e-3, seconds);
    this.t = seconds <= 0 ? 1 : 0;
    if (this.t >= 1) this.apply(1);
    this.controls.enabled = this.t >= 1;
  }

  /**
   * A named shot of a subject facing +Z: the camera sits in front of it (characters face the camera), at the
   * shot's distance, looking at `lookY` above the subject's feet.
   */
  shot(kind: Shot, subject: THREE.Vector3, lookY: number, seconds = MOVE_SECONDS): void {
    const o = kind === 'close' ? CLOSE_CAMERA : kind === 'gameplay' ? GAMEPLAY_CAMERA : WIDE_CAMERA;
    const pos = new THREE.Vector3(subject.x, subject.y + o.up, subject.z + o.back);
    const target = new THREE.Vector3(subject.x, subject.y + lookY, subject.z);
    this.goTo(pos, target, seconds);
  }

  /** Frames a row of `width` metres centred on `center` (the wide lineup shot). */
  frameRow(center: THREE.Vector3, width: number, lookY: number, seconds = MOVE_SECONDS): void {
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * Math.max(0.3, this.camera.aspect));
    const half = width / 2 + 1.2;
    const dist = Math.max(GAMEPLAY_CAMERA.back, half / Math.tan(hfov / 2));
    const pos = new THREE.Vector3(center.x, center.y + 1.2 + dist * 0.22, center.z + dist);
    const target = new THREE.Vector3(center.x, center.y + lookY, center.z);
    this.goTo(pos, target, seconds);
  }

  /** Per rendered frame: advance an eased move, or let OrbitControls apply damping. */
  update(frameDt: number): void {
    if (this.t < 1) {
      this.t = Math.min(1, this.t + frameDt / this.duration);
      this.apply(this.t);
      if (this.t >= 1) this.controls.enabled = true;
      return;
    }
    this.controls.update();
  }

  dispose(): void {
    this.controls.dispose();
  }

  private apply(t: number): void {
    const k = t * t * (3 - 2 * t); // smoothstep ease in/out
    this.camera.position.lerpVectors(this.fromPos, this.toPos, k);
    this.controls.target.lerpVectors(this.fromTarget, this.toTarget, k);
    this.camera.lookAt(this.controls.target);
    if (t >= 1) this.controls.update();
  }
}
