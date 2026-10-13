/**
 * One shadow for a whole crowd (GDD 2.15 draw-call budget): an InstancedMesh of simple body proxies (a capsule
 * body and a round head, scaled per citizen) that is drawn ONLY into one light's shadow map, never in the colour
 * pass. CrowdMeshes do not cast shadows themselves, so a crowd of any number of body types costs one draw call
 * per body type plus one shadow call, instead of two calls per body type.
 *
 * How: three.js culls each object against the camera frustum in the colour pass and against
 * `light.shadow.getFrustum()` in the shadow pass, through `intersectsFrustum()`. The proxy answers "no" to every
 * frustum except its light's shadow frustum. With shadows off (Low quality) it costs nothing.
 *
 *   const shadow = new CrowdShadow(100, world.sun);
 *   shadow.set(i, pos, rotY, crowdMesh.height, crowdMesh.width);
 */
import * as THREE from 'three';
import { capsule, lowSphere, merge, part } from './geom';
import { mat } from './materials';

/** Proxy proportions in a unit-tall body (feet at 0, head top at 1), matching the ~2.5-heads characters. */
const PROXY = { bodyR: 0.3, bodyTop: 0.62, headR: 0.2, headY: 0.78 };

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** An InstancedMesh that only ever draws into `light`'s shadow map. */
class ShadowOnlyMesh extends THREE.InstancedMesh {
  constructor(
    geometry: THREE.BufferGeometry,
    max: number,
    private readonly light: THREE.DirectionalLight | THREE.SpotLight,
  ) {
    super(geometry, mat('lambert'), max);
  }

  override intersectsFrustum(frustum: THREE.Frustum | THREE.FrustumArray): boolean {
    return frustum === this.light.shadow.getFrustum() && super.intersectsFrustum(frustum);
  }
}

export class CrowdShadow {
  readonly mesh: THREE.InstancedMesh;
  readonly max: number;
  private disposed = false;

  constructor(max: number, light: THREE.DirectionalLight | THREE.SpotLight) {
    this.max = Math.max(1, Math.floor(max));
    const { bodyR, bodyTop, headR, headY } = PROXY;
    // A unit-tall body (capsule from y = 0 to bodyTop, head above it), 2 × bodyR wide; set() scales it per citizen.
    const geometry = merge([
      part(capsule(bodyR, bodyTop - 2 * bodyR, 6), '#FFFFFF', { pos: [0, bodyTop / 2, 0] }),
      part(lowSphere(headR, 1), '#FFFFFF', { pos: [0, headY, 0] }),
    ]);
    this.mesh = new ShadowOnlyMesh(geometry, this.max, light);
    this.mesh.name = 'crowd-shadow';
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = false;
    this.mesh.count = 0;
  }

  get count(): number {
    return this.mesh.count;
  }

  set count(n: number) {
    this.mesh.count = Math.max(0, Math.min(this.max, Math.floor(n)));
    this.mesh.boundingSphere = null;
  }

  /**
   * Places proxy `i` for a citizen standing at `pos` facing `rotY`; `height` is the citizen's height (m) and
   * `width` its shoulder width (m). Also raises `count` to i + 1 when needed.
   */
  set(i: number, pos: THREE.Vector3, rotY: number, height: number, width: number): void {
    if (this.disposed || i < 0 || i >= this.max) return;
    const w = Math.max(0.05, width) / (2 * PROXY.bodyR);
    tmpQ.setFromAxisAngle(UP, rotY);
    tmpS.set(w, Math.max(0.05, height), w * 0.8);
    this.mesh.setMatrixAt(i, tmpM.compose(pos, tmpQ, tmpS));
    this.mesh.instanceMatrix.needsUpdate = true;
    if (i >= this.mesh.count) this.mesh.count = i + 1;
    this.mesh.boundingSphere = null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.dispose();
  }
}
