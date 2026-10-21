/**
 * Apollyon's fiery darts (GDD 2.9 Phase 2): slow, big glowing darts thrown in volleys of 3. A dart that reaches
 * Christian asks the host what happened (`reach` → the shield's answer): a perfect block bounces it straight back
 * at Apollyon a little faster (a hit on him when it gets there), a plain block breaks it, nothing hurts him. Darts
 * that miss burn out on the ground or after DART.life seconds. A small pool of meshes sharing one geometry and
 * one material (one draw call per live dart), freed by dispose().
 */
import * as THREE from 'three';
import type { Particles } from '../gen/Particles';
import type { BlockResult } from '../player/Combat';

export const DART = { radius: 0.32, hitPlayer: 0.85, hitFoe: 1.5, life: 5, back: 1.5 } as const;

interface Dart {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  back: boolean;
  alive: boolean;
}

export interface DartHost {
  /** Christian's chest (world). */
  target(out: THREE.Vector3): THREE.Vector3;
  /** Apollyon's chest (world): where bounced darts fly. */
  foe(out: THREE.Vector3): THREE.Vector3;
  /** The ground under (x, z). */
  ground(x: number, z: number): number;
  /** A dart reached Christian: the shield's answer (`none` = it hits him). */
  reach(at: THREE.Vector3): BlockResult;
  /** A bounced dart struck Apollyon. */
  bounced(): void;
}

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

export class Darts {
  private readonly geo = new THREE.IcosahedronGeometry(DART.radius, 1);
  private readonly mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#FFB347'),
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  private readonly pool: Dart[] = [];

  constructor(
    scene: THREE.Object3D,
    private readonly particles: Particles,
    size = 6,
  ) {
    for (let i = 0; i < size; i++) {
      const mesh = new THREE.Mesh(this.geo, this.mat);
      mesh.name = 'apollyon:dart';
      mesh.visible = false;
      mesh.renderOrder = 4;
      scene.add(mesh);
      this.pool.push({ mesh, pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, back: false, alive: false });
    }
  }

  /** Live darts. */
  get count(): number {
    let n = 0;
    for (const d of this.pool) if (d.alive) n++;
    return n;
  }

  /** Distance (m) from `p` to the nearest live dart flying at Christian (Infinity when none). Tests. */
  nearest(p: THREE.Vector3): number {
    let best = Infinity;
    for (const d of this.pool) if (d.alive && !d.back) best = Math.min(best, d.pos.distanceTo(p));
    return best;
  }

  /** Throws one dart from `from` toward `to` at `speed` m/s. False when the pool is full. */
  throw(from: THREE.Vector3, to: THREE.Vector3, speed: number): boolean {
    const d = this.pool.find((x) => !x.alive);
    if (!d) return false;
    d.alive = true;
    d.back = false;
    d.life = DART.life;
    d.pos.copy(from);
    d.vel.subVectors(to, from).normalize().multiplyScalar(speed);
    d.mesh.visible = true;
    d.mesh.position.copy(from);
    this.particles.emit('fire', from, 4);
    return true;
  }

  update(dt: number, host: DartHost): void {
    host.target(tmp2);
    for (const d of this.pool) {
      if (!d.alive) continue;
      d.life -= dt;
      d.pos.addScaledVector(d.vel, dt);
      d.mesh.position.copy(d.pos);
      d.mesh.rotation.y += dt * 6;
      if (Math.random() < 0.5) this.particles.emit('ember', d.pos, 1, { spread: 0.15 });
      if (d.back) {
        host.foe(tmp);
        if (d.pos.distanceTo(tmp) <= DART.hitFoe) {
          this.burst(d, 14);
          host.bounced();
        } else if (d.life <= 0) this.burst(d, 4);
        continue;
      }
      if (d.pos.distanceTo(tmp2) <= DART.hitPlayer) {
        const r = host.reach(d.pos);
        if (r === 'perfect') {
          host.foe(tmp);
          d.vel.subVectors(tmp, d.pos).normalize().multiplyScalar(d.vel.length() * DART.back);
          d.back = true;
          d.life = DART.life;
          this.particles.emit('sparkle', d.pos, 10);
        } else {
          this.burst(d, r === 'block' ? 6 : 10);
        }
        continue;
      }
      if (d.life <= 0 || d.pos.y < host.ground(d.pos.x, d.pos.z)) this.burst(d, 5);
    }
  }

  /** Every dart gone at once (a phase restarts). */
  clear(): void {
    for (const d of this.pool) this.kill(d);
  }

  dispose(): void {
    for (const d of this.pool) d.mesh.removeFromParent();
    this.pool.length = 0;
    this.geo.dispose();
    this.mat.dispose();
  }

  private burst(d: Dart, n: number): void {
    this.particles.emit('ember', d.pos, n, { spread: 0.4 });
    this.kill(d);
  }

  private kill(d: Dart): void {
    d.alive = false;
    d.mesh.visible = false;
  }
}
