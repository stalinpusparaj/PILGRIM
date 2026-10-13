/**
 * Promises in the world (GDD 2.7.5): small glowing paper scrolls that bob and turn above the ground and give
 * off the odd sparkle when the camera is near. All of them are one InstancedMesh with the shared glow material
 * (1 draw call). Picking them up is Phase 2: `setCollected()` hides one.
 */
import * as THREE from 'three';
import { bevelBox, cylinder, lowSphere, merge, part, xform } from '../gen/geom';
import { mat } from '../gen/materials';
import { mix, shade, type Palette } from '../gen/palette';
import type { Particles } from '../gen/Particles';

export interface PromiseEntry {
  id: string;
  /** Ground-level anchor (world space); the scroll floats above it. */
  pos: THREE.Vector3;
}

/** Scroll size multiplier: about 0.6 m wide, readable from the 4.5 m gameplay camera. */
const SCALE = 1.4;
/** Height of the scroll centre above its anchor (m). */
const HOVER = 0.95;
const BOB = { amp: 0.09, speed: 2.1 };
const SPIN = 0.75; // rad/s
const TILT = 0.12; // rad, a gentle rocking lean
const SPARKLE = { every: 0.55, range: 32, spread: 0.35 };

/** Reused emit options (no per-frame allocation). */
const SPARKLE_OPTS = { spread: SPARKLE.spread };

export class PromiseMarkers {
  readonly mesh: THREE.InstancedMesh;
  readonly ids: readonly string[];

  private readonly anchors: THREE.Vector3[];
  private readonly phase: Float32Array;
  private readonly sparkleTimer: Float32Array;
  private readonly collected: Uint8Array;
  private readonly index = new Map<string, number>();
  private readonly matrix = new THREE.Matrix4();
  private readonly quat = new THREE.Quaternion();
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly scale = new THREE.Vector3(SCALE, SCALE, SCALE);
  private readonly pos = new THREE.Vector3();
  private disposed = false;

  constructor(entries: readonly PromiseEntry[], pal: Palette) {
    const n = entries.length;
    this.ids = entries.map((e) => e.id);
    this.anchors = entries.map((e) => e.pos.clone());
    this.phase = new Float32Array(n);
    this.sparkleTimer = new Float32Array(n);
    this.collected = new Uint8Array(n);
    entries.forEach((e, i) => {
      this.index.set(e.id, i);
      // A stable per-scroll phase from its position, so they never bob in step.
      this.phase[i] = (Math.abs(Math.sin(e.pos.x * 12.9898 + e.pos.z * 78.233)) * 43758.5453) % (Math.PI * 2);
      this.sparkleTimer[i] = (this.phase[i]! / (Math.PI * 2)) * SPARKLE.every;
    });

    this.mesh = new THREE.InstancedMesh(scrollGeometry(pal), mat('glow'), Math.max(1, n));
    this.mesh.name = 'promises';
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.update(0, 0, null, null);
    this.mesh.computeBoundingSphere();
    if (this.mesh.boundingSphere) this.mesh.boundingSphere.radius += BOB.amp * 2 + SCALE;
  }

  get count(): number {
    return this.ids.length;
  }

  isCollected(id: string): boolean {
    const i = this.index.get(id);
    return i !== undefined && this.collected[i] === 1;
  }

  /** Hide (collected) or show a scroll. Unknown ids are ignored. */
  setCollected(id: string, collected: boolean): void {
    const i = this.index.get(id);
    if (i !== undefined) this.collected[i] = collected ? 1 : 0;
  }

  /** Current floating position of a scroll (for pickup checks and sparkles), or null for an unknown id. */
  positionOf(id: string, out: THREE.Vector3): THREE.Vector3 | null {
    const i = this.index.get(id);
    if (i === undefined) return null;
    return out.copy(this.anchors[i]!);
  }

  /**
   * Bob, spin and sparkle. `time` is world time (s); `camPos` and `particles` are optional so the first
   * placement can run without them.
   */
  update(time: number, dt: number, camPos: THREE.Vector3 | null, particles: Particles | null): void {
    if (this.disposed) return;
    const range2 = SPARKLE.range * SPARKLE.range;
    for (let i = 0; i < this.anchors.length; i++) {
      const anchor = this.anchors[i]!;
      if (this.collected[i] === 1) {
        this.matrix.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, this.matrix);
        continue;
      }
      const ph = this.phase[i]!;
      this.pos.set(anchor.x, anchor.y + HOVER + Math.sin(time * BOB.speed + ph) * BOB.amp, anchor.z);
      this.euler.set(0, time * SPIN + ph, Math.sin(time * 1.3 + ph) * TILT);
      this.quat.setFromEuler(this.euler);
      this.matrix.compose(this.pos, this.quat, this.scale);
      this.mesh.setMatrixAt(i, this.matrix);

      if (camPos && particles && dt > 0 && camPos.distanceToSquared(this.pos) < range2) {
        const timer = this.sparkleTimer[i]! - dt;
        if (timer <= 0) {
          particles.emit('sparkle', this.pos, 1, SPARKLE_OPTS);
          this.sparkleTimer[i] = timer + SPARKLE.every;
        } else {
          this.sparkleTimer[i] = timer;
        }
      }
    }
    if (this.anchors.length > 0) this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.mesh.geometry.dispose();
    this.mesh.dispose();
    this.mesh.removeFromParent();
  }
}

/** A rolled paper scroll with wooden rod ends, a ribbon and a hanging page. Faces +Z, centred at the origin. */
function scrollGeometry(pal: Palette): THREE.BufferGeometry {
  const paper = mix(pal.sky.sun, '#FFFFFF', 0.45);
  const page = mix(pal.sky.sun, '#FFFFFF', 0.25);
  const rod = shade(pal.ground.path, -0.3);
  const ribbon = shade(mix(pal.sky.sun, pal.ground.path, 0.5), -0.15);
  const along: [number, number, number] = [0, 0, Math.PI / 2];
  // geom.cylinder() stands on its base; centre each one on its length before laying it along X.
  const bar = (radius: number, length: number, radial: number): THREE.BufferGeometry =>
    xform(cylinder(radius, radius, length, radial), { pos: [0, -length / 2, 0] });
  return merge([
    part(bar(0.08, 0.34, 8), paper, { pos: [0, 0.06, 0], rot: along }),
    part(bar(0.086, 0.05, 8), ribbon, { pos: [0, 0.06, 0], rot: along }),
    part(bar(0.018, 0.46, 5), rod, { pos: [0, 0.06, 0], rot: along }),
    part(lowSphere(0.042, 0), rod, { pos: [0.235, 0.06, 0] }),
    part(lowSphere(0.042, 0), rod, { pos: [-0.235, 0.06, 0] }),
    part(bevelBox(0.3, 0.2, 0.018, 0.006), page, { pos: [0, -0.07, 0.07], rot: [-0.15, 0, 0] }),
  ]);
}
