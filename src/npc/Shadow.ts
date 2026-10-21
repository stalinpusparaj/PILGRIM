/**
 * The shadows of the Valley of the Shadow (GDD 2.9 "Shadows (Chapter IX)"): smoky blobs with two ember eyes that
 * lurk beside the dark path, drift up to Christian, drain Hope while close and nudge him toward the path's edge
 * (the ditch and the bog). They never touch his hearts and can never be destroyed:
 * - Prayer (`prayer:burst`, src/player/Prayer.ts) within its ring makes them flee squeaking for 8 s.
 * - The Sword (Combat target) scatters one into a puff for 3 s; then it gathers itself again.
 * - `setActive(false)` (dawn) sends them away into the dark; they melt out of sight, and come back with true.
 *
 * Placement comes from the level: every zone of type 'shadows' with shape 'way' (from, to; `count` shadows, default
 * 4) lays its shadows along that stretch of the Way, alternating sides, a few metres off the ribbon.
 * Hope drain respects god mode, story beats (the follow camera suspended) and the Helmet (half, GDD 2.7.6 #3).
 * Service 'shadows' while they exist (tests: `probe()`, `summon(i)`).
 */
import * as THREE from 'three';
import '../audio/events';
import { events } from '../core/Events';
import { services } from '../core/Services';
import type { Engine } from '../core/Engine';
import { Rng } from '../gen/rng';
import type { Combat } from '../player/Combat';
import { PRAYER } from '../player/Prayer';
import type { LevelZone } from '../world/LevelTypes';
import type { PlaySession } from '../world/PlaySession';
import { PLAY_ORDER } from '../world/play-loop';
import { NPC_ORDER } from './NPC';
import { ShadowMeshes } from './shadow-mesh';

declare module '../core/Events' {
  interface EventMap {
    'shadow:flee': { count: number };
    'shadow:scatter': void;
  }
}
declare module '../core/Services' {
  interface ServiceMap {
    shadows: Shadows;
  }
}

export type ShadowState = 'lurk' | 'chase' | 'flee' | 'scatter' | 'gone';

export const SHADOW = {
  radius: 0.55,
  float: 1.0,
  chase: 11,
  keep: 1.1,
  speed: 1.5,
  drainNear: 3.2,
  drain: 3,
  nudgeNear: 2.4,
  nudge: 0.7,
  flee: 4.5,
  fleeFor: PRAYER.fleeSeconds,
  scatterFor: 3,
} as const;
const HOPE_STEP = 0.5;

interface Shade {
  home: THREE.Vector3;
  pos: THREE.Vector3;
  prev: THREE.Vector3;
  vel: THREE.Vector3;
  state: ShadowState;
  timer: number;
  phase: number;
  size: number;
}

export interface ShadowsOptions {
  engine: Engine;
  session: PlaySession;
  combat: Combat | null;
  zones: readonly LevelZone[];
  seed: number;
}

const tmp = new THREE.Vector3();
const hit = { t: 0, dist: 0, point: new THREE.Vector3() };

export class Shadows {
  private readonly o: ShadowsOptions;
  private readonly list: Shade[] = [];
  private readonly mesh: ShadowMeshes;
  private readonly offs: Array<() => void> = [];
  private active = true;
  private pending = 0;
  private time = 0;
  private disposed = false;

  constructor(o: ShadowsOptions) {
    this.o = o;
    const rng = new Rng(o.seed);
    const way = o.session.world.ways.main;
    const terrain = o.session.world.terrain;
    for (const z of o.zones) {
      const from = typeof z.from === 'number' ? z.from : 0;
      const to = typeof z.to === 'number' ? z.to : 1;
      const n = typeof z['count'] === 'number' ? Math.max(0, Math.floor(z['count'] as number)) : 4;
      for (let i = 0; i < n; i++) {
        const t = from + ((i + rng.range(0.25, 0.75)) / Math.max(1, n)) * (to - from);
        const at = way.sample(t, new THREE.Vector3());
        const tan = way.tangent(t, new THREE.Vector3());
        const side = i % 2 === 0 ? 1 : -1;
        const off = way.halfWidth + rng.range(2.2, 3.6);
        at.x += -tan.z * side * off;
        at.z += tan.x * side * off;
        at.y = terrain.heightAt(at.x, at.z) + SHADOW.float;
        this.list.push({
          home: at.clone(),
          pos: at.clone(),
          prev: at.clone(),
          vel: new THREE.Vector3(),
          state: 'lurk',
          timer: 0,
          phase: rng.range(0, Math.PI * 2),
          size: 1,
        });
      }
    }
    this.mesh = new ShadowMeshes(Math.max(1, this.list.length), SHADOW.radius, o.seed);
    o.session.world.scene.add(this.mesh.object);
    const loop = o.engine.loop;
    this.offs.push(
      loop.add({ update: (dt) => this.update(dt) }, NPC_ORDER + 3),
      loop.add({ render: (a) => this.render(a) }, PLAY_ORDER.world + 3),
      events.on('prayer:burst', (b) => this.onPrayer(b.x, b.z, b.radius)),
    );
    for (const s of this.list) {
      const off = o.combat?.addTarget({
        pos: (out) => out.copy(s.pos),
        radius: SHADOW.radius,
        hittable: () => this.active && (s.state === 'lurk' || s.state === 'chase'),
        onHit: (from) => this.scatter(s, from),
      });
      if (off) this.offs.push(off);
    }
    services.register('shadows', this);
  }

  get count(): number {
    return this.list.length;
  }

  /** Tests / debug: each shadow's state and distance to Christian. */
  probe(): Array<{ state: ShadowState; dist: number }> {
    const p = this.o.session.player.controller.position;
    return this.list.map((s) => ({ state: s.state, dist: Math.hypot(s.pos.x - p.x, s.pos.z - p.z) }));
  }

  /** Dawn (false): they slip away into what is left of the dark. True brings them back to their places. */
  setActive(on: boolean): void {
    if (on === this.active) return;
    this.active = on;
    for (const s of this.list) {
      s.state = on ? 'lurk' : 'gone';
      s.timer = 0;
      if (on) s.size = 1;
    }
  }

  /** Puts shadow `i` right beside Christian, hunting (tests). */
  summon(i: number): void {
    const s = this.list[i];
    if (!s) return;
    const p = this.o.session.player.controller.position;
    s.pos.set(p.x + 1.6, p.y + SHADOW.float, p.z);
    s.prev.copy(s.pos);
    s.state = 'chase';
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const off of this.offs.splice(0)) off();
    this.mesh.dispose();
    if (services.tryGet('shadows') === this) services.unregister('shadows');
  }

  // ------------------------------------------------------------------------------------------- inside

  private update(dt: number): void {
    if (this.disposed) return;
    this.time += dt;
    const s = this.o.session;
    const p = s.player.controller.position;
    const free = s.player.mode === 'play' && services.tryGet('cameraRig')?.suspended !== true;
    let drain = 0;
    for (const sh of this.list) {
      sh.prev.copy(sh.pos);
      sh.timer -= dt;
      const d = Math.hypot(sh.pos.x - p.x, sh.pos.z - p.z);
      this.think(sh, d);
      this.move(sh, dt, p);
      if (sh.state === 'chase' && free) {
        if (d < SHADOW.drainNear) drain = SHADOW.drain;
        if (d < SHADOW.nudgeNear) this.nudge(sh, dt);
      }
    }
    this.drain(drain, dt);
  }

  private think(sh: Shade, d: number): void {
    if (sh.state === 'gone') return;
    if ((sh.state === 'flee' || sh.state === 'scatter') && sh.timer <= 0) sh.state = 'lurk';
    if (sh.state === 'scatter') sh.size = Math.min(1, 0.35 + 0.65 * (1 - sh.timer / SHADOW.scatterFor));
    else sh.size += (1 - sh.size) * 0.1;
    if (sh.state === 'lurk' && d < SHADOW.chase) sh.state = 'chase';
    else if (sh.state === 'chase' && d > SHADOW.chase * 1.6) sh.state = 'lurk';
  }

  private move(sh: Shade, dt: number, p: THREE.Vector3): void {
    const terrain = this.o.session.world.terrain;
    let speed: number = SHADOW.speed;
    if (sh.state === 'gone') {
      sh.size = Math.max(0, sh.size - dt * 0.6);
      tmp.copy(sh.home).sub(sh.pos);
    } else if (sh.state === 'chase') {
      tmp.set(sh.pos.x - p.x, 0, sh.pos.z - p.z);
      const d = tmp.length() || 1;
      tmp.multiplyScalar(SHADOW.keep / d).add(p).sub(sh.pos);
    } else if (sh.state === 'flee' || sh.state === 'scatter') {
      tmp.set(sh.pos.x - p.x, 0, sh.pos.z - p.z).normalize();
      speed = sh.state === 'flee' ? SHADOW.flee : SHADOW.flee * 1.4 * Math.max(0.1, sh.timer / SHADOW.scatterFor);
    } else {
      tmp.set(
        sh.home.x + Math.sin(this.time * 0.5 + sh.phase) * 1.5 - sh.pos.x,
        0,
        sh.home.z + Math.cos(this.time * 0.4 + sh.phase) * 1.5 - sh.pos.z,
      );
    }
    tmp.y = 0;
    const len = tmp.length();
    if (len > 1e-3) sh.pos.addScaledVector(tmp, Math.min(len, speed * dt) / len);
    sh.pos.y = terrain.heightAt(sh.pos.x, sh.pos.z) + SHADOW.float + 0.15 * Math.sin(this.time * 2 + sh.phase);
    if (Math.random() < dt * 3 && sh.size > 0.1) this.o.session.world.particles.emit('smoke', sh.pos, 1, { spread: 0.3 });
  }

  /** Close shadows lean on him toward the path's edge (sideways off the Way, the side he is already on). */
  private nudge(sh: Shade, dt: number): void {
    const s = this.o.session;
    const p = s.player.controller.position;
    s.world.ways.main.closest(p.x, p.z, hit);
    tmp.set(p.x - hit.point.x, 0, p.z - hit.point.z);
    if (tmp.lengthSq() < 0.04) tmp.set(p.x - sh.pos.x, 0, p.z - sh.pos.z);
    if (tmp.lengthSq() < 1e-6) return;
    p.addScaledVector(tmp.normalize(), SHADOW.nudge * dt);
    s.col.resolve(p, 0.35, 1.5);
  }

  private drain(rate: number, dt: number): void {
    const s = this.o.session;
    if (rate <= 0 || s.god) return;
    if (s.state.hasGift('helmet')) rate *= 0.5;
    this.pending += rate * dt;
    if (this.pending >= HOPE_STEP) {
      const n = Math.floor(this.pending / HOPE_STEP) * HOPE_STEP;
      this.pending -= n;
      s.state.addHope(-n);
    }
  }

  private onPrayer(x: number, z: number, radius: number): void {
    let n = 0;
    for (const sh of this.list) {
      if (sh.state === 'gone' || Math.hypot(sh.pos.x - x, sh.pos.z - z) > radius + SHADOW.radius) continue;
      sh.state = 'flee';
      sh.timer = SHADOW.fleeFor;
      n++;
    }
    if (n === 0) return;
    const p = this.o.session.player.controller.position;
    events.emit('sfx', { id: 'shadow_squeak', at: [p.x, p.y + 1, p.z] });
    events.emit('shadow:flee', { count: n });
  }

  private scatter(sh: Shade, from: THREE.Vector3): void {
    sh.state = 'scatter';
    sh.timer = SHADOW.scatterFor;
    sh.size = 0.35;
    this.o.session.world.particles.emit('smoke', sh.pos, 12, { spread: 0.8 });
    events.emit('sfx', { id: 'shadow_squeak', at: [from.x, from.y + 1, from.z], pitch: 1.3 });
    events.emit('shadow:scatter');
  }

  private render(alpha: number): void {
    if (this.disposed) return;
    const a = Math.max(0, Math.min(1, alpha));
    const yawTo = this.o.session.player.renderPosition;
    for (let i = 0; i < this.list.length; i++) {
      const sh = this.list[i]!;
      tmp.lerpVectors(sh.prev, sh.pos, a);
      const yaw = Math.atan2(yawTo.x - tmp.x, yawTo.z - tmp.z);
      const squash = 1 + 0.08 * Math.sin(this.time * 3 + sh.phase);
      this.mesh.set(i, tmp, yaw, sh.size, squash, SHADOW.radius);
    }
    this.mesh.commit(this.list.length);
  }
}
