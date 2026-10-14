/**
 * The Slough's hidden stepping stones (GDD 2.7.5, 2.10 Ch II "standing still for 2 s reveals glowing stepping
 * stones under the mud"; Help "shows the steps that were there all along"). Part of the Slough (Slough.ts).
 *
 * A landmark `{ "type": "steps", "id", "path": "way" | <detour id>, "from", "to" }` lays flat rounded stones every
 * ~1.6 m (`params.spacing`) along that stretch of path, zig-zagging about its centre line (`params.offset` shifts
 * the row), only on slough or mud. Hidden under the mud (not drawn, no collider) until `reveal()` raises the set
 * in a ripple from the player: each stone pops up with a soft glow (palette accent `stepsGlow`), sparkles and
 * becomes a walkable collider; once up they stay up. Two InstancedMeshes for all stones (lit stone + glowing
 * top) = 2 draw calls, hidden until the first reveal; matrices are written only while stones move.
 */
import * as THREE from 'three';
import '../audio/events';
import { events } from '../core/Events';
import { mat } from '../gen/materials';
import { PALETTES, type Palette } from '../gen/palette';
import { Rng, hashString } from '../gen/rng';
import type { Collider } from '../gen/types';
import type { Particles } from '../gen/Particles';
import type { Way } from '../gen/Way';
import type { LevelData } from './LevelTypes';
import { GLOW, easeOutBack, stoneGeometry } from './slough-stone';

declare module '../core/Events' {
  interface EventMap {
    /** A set of Slough stepping stones (landmark id) started to rise. */
    'slough:steps': { id: string };
  }
}

/** What the stones need from the CollisionWorld (src/world/Collision.ts). */
export interface ColliderHost {
  groundAt(x: number, z: number, fromY?: number): number;
  addCollider(c: Collider, opts?: { walkable?: boolean; tag?: string; floor?: boolean }): number;
  removeCollider(handle: number): void;
}

export interface StepsWorld {
  readonly level: LevelData;
  readonly palette: Palette;
  readonly scene: THREE.Scene;
  readonly particles: Particles;
  wayById(id: string): Way | null;
}

export const STEPS_LANDMARK = 'steps';

const STONE = {
  spacing: 1.6,
  /** Top and bottom radius, depth (m). Wide and flat: easy to land on. */
  topR: 0.55,
  bottomR: 0.63,
  depth: 0.4,
  /** Top above the mud / ground (m): well under the 0.3 m step-up. */
  lift: 0.12,
  /** Sideways zig-zag either side of the path's centre line (m). */
  zigzag: [0.08, 0.26] as const,
  scale: [0.92, 1.08] as const,
  /** Hidden depth below the final top (m), rise time (s), ripple delay per metre from the player (s). */
  hide: 0.6,
  rise: 0.9,
  ripple: 0.06,
  maxDelay: 1.6,
  /** Rise progress at which the collider appears and the sparkle pops. */
  solidAt: 0.45,
  sparkleAt: 0.55,
  colliderHeight: 0.7,
  /** On the stones: reach from a centre (× scale; bridges the gaps, so the row never drops to mud speed)... */
  standR: 0.95,
  /** ...with the feet no lower than top − this (m). */
  standDy: 0.25,
};
const AMBIENT = { every: 0.45, r2: 28 * 28 };
const SPARKLE_PER_STONE = 4;
const HIDDEN = 0;
const RISING = 1;
const UP = 2;

interface StoneSet {
  id: string;
  first: number;
  count: number;
  revealed: boolean;
}

export class SteppingStones {
  readonly sets: readonly StoneSet[];
  readonly count: number;
  private readonly body: THREE.InstancedMesh | null = null;
  private readonly glow: THREE.InstancedMesh | null = null;
  private readonly col: ColliderHost;
  private readonly particles: Particles;
  private readonly x: Float32Array;
  private readonly z: Float32Array;
  private readonly top: Float32Array;
  private readonly rot: Float32Array;
  private readonly scale: Float32Array;
  /** Seconds since this stone's rise began (negative while it waits for the ripple). */
  private readonly time: Float32Array;
  private readonly state: Uint8Array;
  private readonly sparkled: Uint8Array;
  private readonly handles: Int32Array;
  private rising = 0;
  private dirty = false;
  private ambientTimer = 0;
  private ambientNext = 0;
  private readonly sparkleOpts: { color: string; spread: number };
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly yAxis = new THREE.Vector3(0, 1, 0);
  private disposed = false;

  /**
   * `keep(x, z)`: may a stone stand here (slough or mud)? `mudLevelAt(x, z)`: the mud surface height there, or
   * -Infinity. Stone tops sit `lift` above the higher of the collision ground and the mud surface.
   */
  constructor(
    world: StepsWorld,
    col: ColliderHost,
    keep: (x: number, z: number) => boolean,
    mudLevelAt: (x: number, z: number) => number,
  ) {
    this.col = col;
    this.particles = world.particles;
    const pal = world.palette;
    const glowHex = pal.accents['stepsGlow'] ?? PALETTES.slough.accents['stepsGlow'] ?? pal.sky.sun;
    this.sparkleOpts = { color: glowHex, spread: 0.35 };
    // Layout: per stone x, z, top, rotation, scale.
    const xs: number[] = [];
    const zs: number[] = [];
    const tops: number[] = [];
    const rots: number[] = [];
    const scales: number[] = [];
    const sets: StoneSet[] = [];
    const p = new THREE.Vector3();
    const tan = new THREE.Vector3();
    for (const lm of world.level.landmarks) {
      if (lm.type !== STEPS_LANDMARK) continue;
      const way = world.wayById(typeof lm.path === 'string' ? lm.path : 'way');
      if (!way) {
        console.warn(`[slough] steps "${lm.id}": no path "${String(lm.path)}"; skipped`);
        continue;
      }
      const params = lm.params ?? {};
      const spacing =
        typeof params.spacing === 'number' && params.spacing > 0.5 ? params.spacing : STONE.spacing;
      const offset = typeof params.offset === 'number' ? params.offset : 0;
      const from = Math.min(1, Math.max(0, lm.from ?? 0));
      const to = Math.min(1, Math.max(from, lm.to ?? 1));
      const n = Math.max(1, Math.floor((way.length * (to - from)) / spacing) + 1);
      const rng = new Rng(hashString(`steps:${lm.id}`));
      const first = xs.length;
      for (let k = 0; k < n; k++) {
        const t = n === 1 ? (from + to) / 2 : from + ((to - from) * k) / (n - 1);
        way.sample(t, p);
        way.tangent(t, tan);
        const tl = Math.hypot(tan.x, tan.z) || 1;
        const side = offset + (k % 2 === 0 ? -1 : 1) * rng.range(STONE.zigzag[0], STONE.zigzag[1]);
        const x = p.x + (tan.z / tl) * side;
        const z = p.z - (tan.x / tl) * side;
        const rot = rng.range(0, Math.PI * 2);
        const scale = rng.range(STONE.scale[0], STONE.scale[1]);
        if (!keep(x, z)) continue;
        xs.push(x);
        zs.push(z);
        tops.push(Math.max(col.groundAt(x, z), mudLevelAt(x, z)) + STONE.lift);
        rots.push(rot);
        scales.push(scale);
      }
      if (xs.length === first) {
        console.warn(`[slough] steps "${lm.id}": no slough or mud along its path range; no stones`);
        continue;
      }
      sets.push({ id: lm.id, first, count: xs.length - first, revealed: false });
    }

    const count = xs.length;
    this.count = count;
    this.sets = sets;
    this.x = Float32Array.from(xs);
    this.z = Float32Array.from(zs);
    this.top = Float32Array.from(tops);
    this.rot = Float32Array.from(rots);
    this.scale = Float32Array.from(scales);
    this.time = new Float32Array(count);
    this.state = new Uint8Array(count);
    this.sparkled = new Uint8Array(count);
    this.handles = new Int32Array(count).fill(-1);
    if (count === 0) return;

    const geoms = stoneGeometry(pal, glowHex, STONE);
    this.body = new THREE.InstancedMesh(geoms.body, mat('lambert'), count);
    this.glow = new THREE.InstancedMesh(geoms.glow, mat('glow'), count);
    this.body.name = 'slough:steps';
    this.glow.name = 'slough:stepsGlow';
    this.body.receiveShadow = true;
    const bounds = new THREE.Box3();
    this.m.makeScale(0, 0, 0);
    for (let i = 0; i < count; i++) {
      this.body.setMatrixAt(i, this.m);
      this.glow.setMatrixAt(i, this.m);
      bounds.expandByPoint(this.v.set(this.x[i]!, this.top[i]!, this.z[i]!));
    }
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    sphere.radius += STONE.bottomR + STONE.hide + 0.5;
    for (const mesh of [this.body, this.glow]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.boundingSphere = sphere.clone();
      mesh.visible = false; // no draw calls until the first reveal
      world.scene.add(mesh);
    }
  }

  get hasHidden(): boolean {
    for (let i = 0; i < this.sets.length; i++) if (!this.sets[i]!.revealed) return true;
    return false;
  }

  isRevealed(id: string): boolean {
    return this.sets.some((s) => s.id === id && s.revealed);
  }

  /** Index of the hidden set with a stone nearest to (x, z) within `range` m, or -1. */
  nearestHidden(x: number, z: number, range: number): number {
    let best = -1;
    let bestD = range * range;
    this.sets.forEach((set, si) => {
      if (set.revealed) return;
      for (let i = set.first; i < set.first + set.count; i++) {
        const d = (this.x[i]! - x) ** 2 + (this.z[i]! - z) ** 2;
        if (d <= bestD) {
          bestD = d;
          best = si;
        }
      }
    });
    return best;
  }

  /**
   * Raise one set (index into `sets`) in a ripple spreading from (fromX, fromZ). `instant`: already up, with no
   * sound and no event (a save that had them revealed).
   */
  reveal(setIndex: number, fromX: number, fromZ: number, instant = false): void {
    const set = this.sets[setIndex];
    if (!set || set.revealed || this.disposed) return;
    set.revealed = true;
    let nearest = set.first;
    let nearestD = Infinity;
    for (let i = set.first; i < set.first + set.count; i++) {
      const d = Math.hypot(this.x[i]! - fromX, this.z[i]! - fromZ);
      if (d < nearestD) {
        nearestD = d;
        nearest = i;
      }
      if (instant) {
        this.time[i] = STONE.rise;
        this.state[i] = UP;
        this.sparkled[i] = 1;
        this.addCollider(i);
      } else {
        this.time[i] = -Math.min(STONE.maxDelay, d * STONE.ripple);
        this.state[i] = RISING;
        this.rising++;
      }
    }
    if (this.body && this.glow) {
      this.body.visible = true;
      this.glow.visible = true;
    }
    this.dirty = true;
    if (instant) return;
    events.emit('sfx', { id: 'sparkle', at: [this.x[nearest]!, this.top[nearest]!, this.z[nearest]!] });
    events.emit('slough:steps', { id: set.id });
  }

  /** Is a foot position on a risen stone? */
  standingOn(pos: THREE.Vector3): boolean {
    for (let i = 0; i < this.count; i++) {
      if (this.state[i] === HIDDEN || this.time[i]! < STONE.solidAt * STONE.rise) continue;
      if (pos.y < this.top[i]! - STONE.standDy) continue;
      const r = STONE.standR * this.scale[i]!;
      if ((pos.x - this.x[i]!) ** 2 + (pos.z - this.z[i]!) ** 2 <= r * r) return true;
    }
    return false;
  }

  /** Fixed step: rise timers, colliders, sparkles; `player` (feet) for the ambient glints. */
  update(dt: number, player: THREE.Vector3): void {
    if (this.disposed || this.count === 0) return;
    if (this.rising > 0) {
      for (let i = 0; i < this.count; i++) {
        if (this.state[i] !== RISING) continue;
        const t = (this.time[i] = this.time[i]! + dt);
        if (t < 0) continue;
        this.dirty = true;
        const p = t / STONE.rise;
        if (p >= STONE.solidAt && this.handles[i] === -1) this.addCollider(i);
        if (p >= STONE.sparkleAt && this.sparkled[i] === 0) {
          this.sparkled[i] = 1;
          this.v.set(this.x[i]!, this.top[i]! + 0.1, this.z[i]!);
          this.particles.emit('sparkle', this.v, SPARKLE_PER_STONE, this.sparkleOpts);
        }
        if (p >= 1) {
          this.state[i] = UP;
          this.rising--;
        }
      }
    }
    // A soft glint now and then on a risen stone near the player, so the row keeps glowing.
    this.ambientTimer -= dt;
    if (this.ambientTimer <= 0) {
      this.ambientTimer = AMBIENT.every;
      for (let k = 0; k < this.count; k++) {
        const i = (this.ambientNext + k) % this.count;
        if (this.state[i] !== UP || (this.x[i]! - player.x) ** 2 + (this.z[i]! - player.z) ** 2 > AMBIENT.r2)
          continue;
        this.v.set(this.x[i]!, this.top[i]! + 0.05, this.z[i]!);
        this.particles.emit('sparkle', this.v, 1, this.sparkleOpts);
        this.ambientNext = i + 1;
        break;
      }
    }
  }

  /** Per rendered frame: write the matrices of stones that moved since the last frame. */
  render(): void {
    if (!this.dirty || !this.body || !this.glow) return;
    this.dirty = false;
    for (let i = 0; i < this.count; i++) {
      if (this.state[i] === HIDDEN) continue;
      const t = this.time[i]!;
      if (this.state[i] === UP && t > STONE.rise + 0.5) continue; // settled, written already
      const p = Math.min(1, Math.max(0, t / STONE.rise));
      const k = easeOutBack(p);
      const sc = this.scale[i]!;
      this.v.set(this.x[i]!, this.top[i]! - STONE.hide * (1 - k), this.z[i]!);
      this.q.setFromAxisAngle(this.yAxis, this.rot[i]!);
      this.m.compose(this.v, this.q, this.s.set(sc, sc, sc));
      this.body.setMatrixAt(i, this.m);
      const g = sc * (1 + GLOW.pop * (1 - p));
      this.m.compose(this.v, this.q, this.s.set(g, sc, g));
      this.glow.setMatrixAt(i, this.m);
      // Let a just-finished stone be written once more at exactly its final pose.
      if (this.state[i] === UP) this.time[i] = STONE.rise + 1;
    }
    this.body.instanceMatrix.needsUpdate = true;
    this.glow.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (let i = 0; i < this.count; i++) {
      if (this.handles[i]! >= 0) this.col.removeCollider(this.handles[i]!);
      this.handles[i] = -1;
    }
    for (const mesh of [this.body, this.glow]) {
      if (!mesh) continue;
      mesh.removeFromParent();
      mesh.geometry.dispose();
      mesh.dispose();
    }
  }

  private addCollider(i: number): void {
    const h = STONE.colliderHeight;
    const c: Collider = {
      kind: 'cylinder',
      center: [this.x[i]!, this.top[i]! - h / 2, this.z[i]!],
      radius: STONE.bottomR * this.scale[i]!,
      height: h,
    };
    this.handles[i] = this.col.addCollider(c, { walkable: true, tag: 'stone' });
  }
}
