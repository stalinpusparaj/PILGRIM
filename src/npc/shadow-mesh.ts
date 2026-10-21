/**
 * The look of the Valley's shadows (GDD 2.11 design sheet: smoke #2A2433, eyes #E2553A): lumpy smoky blobs with
 * two ember eyes. Every shadow is one instance of one body InstancedMesh (shared 'lambert' material) and two
 * instances of one eye InstancedMesh (shared 'glow' material, so the eyes stay warm in the dark): 2 draw calls for
 * the whole swarm. Geometry is freed by dispose(); the materials are app-lifetime.
 */
import * as THREE from 'three';
import { jitter, lowSphere, paint, xform } from '../gen/geom';
import { mat } from '../gen/materials';
import { Rng } from '../gen/rng';

export const SMOKE = '#2A2433';
export const EMBER = '#E2553A';

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const s = new THREE.Vector3();
const p = new THREE.Vector3();
const eye = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class ShadowMeshes {
  readonly bodies: THREE.InstancedMesh;
  readonly eyes: THREE.InstancedMesh;
  readonly object = new THREE.Group();

  constructor(max: number, radius: number, seed: number) {
    const rng = new Rng(seed);
    const body = paint(jitter(xform(lowSphere(radius, 1), { scale: [1, 1.25, 1] }), radius * 0.18, rng), (pt) =>
      pt.y < -radius * 0.4 ? '#1E1A26' : SMOKE,
    );
    this.bodies = new THREE.InstancedMesh(body, mat('lambert'), max);
    this.bodies.name = 'shadows:bodies';
    this.eyes = new THREE.InstancedMesh(paint(lowSphere(radius * 0.13, 0), EMBER), mat('glow'), max * 2);
    this.eyes.name = 'shadows:eyes';
    for (const m of [this.bodies, this.eyes]) {
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = false;
      this.object.add(m);
    }
  }

  /** Draws shadow `i` at `at`, facing `yaw`, at `size` (0 hides it) with a squash `squash` (1 = round). */
  set(i: number, at: THREE.Vector3, yaw: number, size: number, squash: number, radius: number): void {
    q.setFromAxisAngle(UP, yaw);
    s.set(size / squash, size * squash, size / squash);
    m4.compose(at, q, s);
    this.bodies.setMatrixAt(i, m4);
    for (let k = 0; k < 2; k++) {
      eye.set((k === 0 ? 0.32 : -0.32) * radius, 0.25 * radius, 0.88 * radius).multiply(s).applyQuaternion(q);
      p.copy(at).add(eye);
      m4.compose(p, q, s.set(size, size, size));
      this.eyes.setMatrixAt(i * 2 + k, m4);
      s.set(size / squash, size * squash, size / squash);
    }
  }

  /** Shadows drawn this frame (instances past it are not drawn). */
  commit(count: number): void {
    this.bodies.count = count;
    this.eyes.count = count * 2;
    this.bodies.instanceMatrix.needsUpdate = true;
    this.eyes.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.object.removeFromParent();
    this.bodies.geometry.dispose();
    this.eyes.geometry.dispose();
    this.bodies.dispose();
    this.eyes.dispose();
  }
}
