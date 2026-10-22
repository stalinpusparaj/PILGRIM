/**
 * The chariot of light (GDD 2.10 Ch X beat 7, GDD 1.6 "Faithful's martyrdom"): at night a chariot of light comes
 * down for Faithful and carries him up while the fair falls silent. No execution is shown or described. A small
 * glowing chariot (shared 'glow' material: it stays bright at night) with a trail of motes; one mesh, its geometry
 * freed by dispose().
 */
import * as THREE from 'three';
import { bevelBox, cylinder, lowSphere, merge, part } from '../gen/geom';
import { mat } from '../gen/materials';
import type { Particles } from '../gen/Particles';

const GOLD = '#FFE8A3';
const WHITE = '#FFFFFF';
/** Height it comes down from and goes back up to (m above the spot). */
export const CHARIOT_HEIGHT = 16;

function chariotGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [
    part(bevelBox(1.6, 0.25, 1.1, 0.06), GOLD, { pos: [0, 0.45, 0] }),
    part(bevelBox(1.6, 0.7, 0.12, 0.04), WHITE, { pos: [0, 0.85, 0.5] }),
    part(bevelBox(0.12, 0.55, 1.1, 0.04), WHITE, { pos: [-0.75, 0.75, 0] }),
    part(bevelBox(0.12, 0.55, 1.1, 0.04), WHITE, { pos: [0.75, 0.75, 0] }),
    part(lowSphere(0.12, 1), GOLD, { pos: [0, 1.3, 0.55] }),
  ];
  for (const sx of [-1, 1])
    parts.push(part(cylinder(0.42, 0.42, 0.1, 10), GOLD, { pos: [sx * 0.86, 0.42, -0.1], rot: [0, 0, Math.PI / 2] }));
  return merge(parts);
}

export class Chariot {
  readonly object: THREE.Mesh;
  private readonly ground = new THREE.Vector3();
  private rider: THREE.Object3D | null = null;
  private riderLift = 0.5;
  private from = 0;
  private to = 0;
  private t = 0;
  private dur = 0;
  private trail = 0;

  constructor(
    scene: THREE.Object3D,
    private readonly particles: Particles,
  ) {
    this.object = new THREE.Mesh(chariotGeometry(), mat('glow'));
    this.object.name = 'ch10:chariot';
    this.object.visible = false;
    scene.add(this.object);
  }

  /** Comes down from the sky onto `at` (ground) over `seconds`, facing `yaw`. */
  descend(at: THREE.Vector3, yaw: number, seconds: number): void {
    this.ground.copy(at);
    this.object.rotation.y = yaw;
    this.object.visible = true;
    this.move(CHARIOT_HEIGHT, 0, seconds);
  }

  /** Takes `rider` (a character root) up and away over `seconds`. */
  rise(rider: THREE.Object3D, seconds: number): void {
    this.rider = rider;
    this.move(0, CHARIOT_HEIGHT, seconds);
  }

  /** Per rendered frame. */
  update(dt: number): void {
    if (!this.object.visible) return;
    if (this.t < this.dur) this.t = Math.min(this.dur, this.t + dt);
    const k = this.dur > 0 ? this.t / this.dur : 1;
    const e = k * k * (3 - 2 * k);
    const y = this.from + (this.to - this.from) * e;
    this.object.position.set(this.ground.x, this.ground.y + y, this.ground.z);
    if (this.rider) this.rider.position.set(this.ground.x, this.ground.y + y + this.riderLift, this.ground.z);
    this.trail -= dt;
    if (this.trail <= 0) {
      this.trail = 0.06;
      this.particles.emit('motes', this.object.position, 2, { color: GOLD, spread: 0.8 });
      this.particles.emit('sparkle', this.object.position, 1, { color: WHITE, spread: 0.6 });
    }
    if (this.to > this.from && k >= 1) {
      this.object.visible = false;
      if (this.rider) this.rider.visible = false;
      this.rider = null;
    }
  }

  dispose(): void {
    this.object.removeFromParent();
    this.object.geometry.dispose();
  }

  private move(from: number, to: number, seconds: number): void {
    this.from = from;
    this.to = to;
    this.t = 0;
    this.dur = Math.max(0.1, seconds);
  }
}
