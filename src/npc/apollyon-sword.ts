/**
 * GDD 2.9 Phase 3: "the sword spins away and lands 4 m off". While it flies, the sword in Christian's hand is
 * hidden (its prop bone shrunk to nothing) and this stand-in spins along an arc, then sticks in the ground with a
 * glint until he reaches it. One small merged mesh (shared 'lambert' material); dispose() frees its geometry and
 * gives the hand its sword back.
 */
import * as THREE from 'three';
import { bevelBox, merge, part } from '../gen/geom';
import { mat } from '../gen/materials';
import type { Character } from '../gen/CharacterFactory';
import type { Particles } from '../gen/Particles';

/** Flight time (s, game time: the throw runs in slow motion). */
const FLIGHT = 0.9;
const ARC = 1.6;

export class ThrownSword {
  readonly landing = new THREE.Vector3();
  private readonly mesh: THREE.Mesh;
  private readonly from = new THREE.Vector3();
  private hand: Character | null = null;
  private t = -1;
  private glint = 0;

  constructor(
    scene: THREE.Object3D,
    private readonly particles: Particles,
  ) {
    const g = merge([
      part(bevelBox(0.07, 0.85, 0.02, 0.01), '#D9DEE3', { pos: [0, 0.55, 0] }),
      part(bevelBox(0.3, 0.05, 0.06, 0.01), '#E8C25A', { pos: [0, 0.12, 0] }),
      part(bevelBox(0.05, 0.16, 0.05, 0.01), '#8A5A3B', { pos: [0, 0.02, 0] }),
    ]);
    this.mesh = new THREE.Mesh(g, mat('lambert'));
    this.mesh.name = 'apollyon:thrownSword';
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /** True once it has landed (and until reached). */
  get landed(): boolean {
    return this.mesh.visible && this.t >= FLIGHT;
  }

  /** Knocks the sword out of `holder`'s hand at `from`, landing at `to` (ground). */
  throw(holder: Character, from: THREE.Vector3, to: THREE.Vector3): void {
    this.giveBack();
    this.hand = holder;
    holder.bones['propR']?.scale.setScalar(0.001);
    this.from.copy(from);
    this.landing.copy(to);
    this.t = 0;
    this.mesh.visible = true;
  }

  /** The sword is back in his hand (reached, or the phase restarts). */
  giveBack(): void {
    this.hand?.bones['propR']?.scale.setScalar(1);
    this.hand = null;
    this.mesh.visible = false;
    this.t = -1;
  }

  update(dt: number): void {
    if (this.t < 0) return;
    const before = this.t;
    this.t += dt;
    const k = Math.min(1, this.t / FLIGHT);
    const m = this.mesh;
    m.position.lerpVectors(this.from, this.landing, k);
    m.position.y += ARC * 4 * k * (1 - k);
    if (k < 1) {
      m.rotation.set(this.t * 14, this.t * 3, 0);
    } else {
      // Stuck in the ground, blade down, leaning a little.
      m.rotation.set(Math.PI + 0.25, 0.4, 0.1);
      m.position.y = this.landing.y + 0.95;
      if (before < FLIGHT) this.particles.emit('dust', this.landing, 10);
      this.glint -= dt;
      if (this.glint <= 0) {
        this.glint = 0.35;
        this.particles.emit('sparkle', m.position, 2, { spread: 0.3 });
      }
    }
  }

  dispose(): void {
    this.giveBack();
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
  }
}
