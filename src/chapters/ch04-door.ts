/**
 * The wicket gate's door leaf for the knock scene (GDD 2.10 Ch IV: "Goodwill yanks him inside"). The level places
 * the 'wicket_gate' prop with `open: true` (its leaf stands swung inside against the wall, merged with the other
 * props), and this little mesh is a second leaf that hangs closed in the doorway, with a collider, until the
 * cutscene swings it to the same open angle, where it hides itself and the merged prop's leaf takes over.
 * Same leaf sizes and hinge as src/gen/props/built-gates.ts buildWicketGate; shared 'lambert' material.
 */
import * as THREE from 'three';
import { mat } from '../gen/materials';
import { arc, box, kit, Parts, rod, slab, type Pt } from '../gen/props/built-kit';
import { transformCollider } from '../gen/props/index';
import type { PlaySession } from '../world/PlaySession';

/** buildWicketGate's door: width, arch spring, arch rise, leaf thickness, hinge z, open angle (rad). */
export const LEAF = { width: 1.25, spring: 1.85, rise: 0.42, thick: 0.12, hingeZ: 0.02, openAngle: Math.PI / 2 - 0.2 };

export class GateDoor {
  readonly root = new THREE.Group();
  private readonly leaf: THREE.Mesh;
  private readonly geometry: THREE.BufferGeometry;
  private collider = -1;
  private openness = 0;
  private opening = 0;
  private disposed = false;

  /** `at` is the gate landmark's ground point, `rotY` its facing (the prop faces +Z: the knock side). */
  constructor(
    private readonly session: PlaySession,
    at: THREE.Vector3,
    rotY: number,
  ) {
    const pal = session.world.palette;
    const k = kit(pal);
    const { width: dw, spring, rise } = LEAF;
    const D = new Parts();
    const shape: Pt[] = [[0, 0], [dw, 0], ...arc(dw / 2, spring, dw / 2, rise, 0, Math.PI, 6)];
    D.add(slab(shape, LEAF.thick, k.gate));
    for (const fx of [0.25, 0.5, 0.75]) {
      const x = dw * fx;
      const top = spring + rise * Math.sqrt(1 - ((x - dw / 2) / (dw / 2)) ** 2) - 0.06;
      D.add(box(0.03, top - 0.06, 0.03, k.woodDark, { pos: [x, top / 2, 0.07] }));
    }
    for (const y of [0.4, 1.55]) D.add(box(dw * 0.7, 0.09, 0.03, k.iron, { pos: [dw * 0.35, y, 0.08] }));
    D.add(rod(0.07, 0.07, 0.03, k.iron, { pos: [dw * 0.72, 1.1, 0.07], rot: [Math.PI / 2, 0, 0] }, 8));
    D.add(box(0.26, 0.2, 0.03, k.hollow, { pos: [dw / 2, 1.62, 0.065] }));
    D.add(box(0.03, 0.2, 0.04, k.iron, { pos: [dw / 2, 1.62, 0.08] }));
    const built = D.done();
    this.geometry = built.geometry;
    this.leaf = new THREE.Mesh(this.geometry, mat('lambert'));
    this.leaf.name = 'ch04:door';
    this.leaf.castShadow = true;
    this.leaf.position.set(-dw / 2, 0, LEAF.hingeZ);
    this.root.add(this.leaf);
    this.root.position.copy(at);
    this.root.rotation.y = rotY;
    session.world.scene.add(this.root);
    // Closed: the doorway is a wall (the merged prop, placed open, leaves it free).
    const h = spring + rise;
    this.collider = session.col.addCollider(
      transformCollider(
        { kind: 'box', center: [0, h / 2, 0], half: [dw / 2, h / 2, 0.15], rotY: 0 },
        [at.x, at.y, at.z],
        rotY,
        1,
      ),
    );
  }

  /** 0 closed .. 1 open. */
  get open(): number {
    return this.openness;
  }

  /** Swings the leaf open over `seconds` (the knock scene). */
  swingOpen(seconds = 0.9): void {
    if (this.disposed) return;
    this.opening = 1 / Math.max(0.05, seconds);
    this.freeDoorway();
  }

  /** Straight to open (a skipped scene). */
  setOpen(): void {
    this.openness = 1;
    this.opening = 0;
    this.apply();
    this.freeDoorway();
  }

  update(dt: number): void {
    if (this.disposed || this.opening === 0) return;
    this.openness = Math.min(1, this.openness + dt * this.opening);
    if (this.openness >= 1) this.opening = 0;
    this.apply();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.freeDoorway();
    this.root.removeFromParent();
    this.geometry.dispose();
  }

  private apply(): void {
    // An eased swing, slowing as it meets the wall; at the end the merged prop's own open leaf stands here.
    const u = this.openness;
    const eased = u * u * (3 - 2 * u);
    this.leaf.rotation.y = eased * LEAF.openAngle;
    this.leaf.visible = u < 1;
  }

  private freeDoorway(): void {
    if (this.collider < 0) return;
    if (!this.session.isDisposed) this.session.col.removeCollider(this.collider);
    this.collider = -1;
  }
}
