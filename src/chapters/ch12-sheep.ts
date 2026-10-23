/**
 * Chapter XII beat 1 (GDD 2.10): "Optional: help round up 5 runaway sheep (kids love this)." Five lambs graze
 * where they wandered off ('spot' zones 'lamb_1'..'lamb_5'), bleating now and then so a child can find them by ear.
 * Walk up to one and it hops and trots after Christian, the lambs following in a little line; lead them into the
 * fold ('sheep_fold' spot zone, fenced in the level) and they settle in. All five home: "Good Shepherd" badge,
 * +10 Hope and a wave from the shepherds. One InstancedMesh (src/gen/sheep.ts) draws the whole flock.
 */
import * as THREE from 'three';
import '../audio/events';
import { events } from '../core/Events';
import { mat } from '../gen/materials';
import { buildSheepGeometry } from '../gen/sheep';
import { spot } from './ch10-kit';
import type { ChapterContext } from './types';

const LAMB = { find: 2.4, speed: 3.6, graze: 0.35, gap: 1.15, foldR: 4.5, slotR: 1.5, hop: 0.45 } as const;
const BAA = { min: 5, max: 10 } as const;
const HOME_FLAG = 'ch12.lambsHome';

type LambState = 'lost' | 'follow' | 'home';
interface Lamb {
  home: THREE.Vector3;
  pos: THREE.Vector3;
  yaw: number;
  state: LambState;
  baa: number;
  hop: number;
  slot: THREE.Vector3;
  scale: number;
}

export class Flock {
  private readonly lambs: Lamb[] = [];
  private readonly followers: Lamb[] = [];
  private mesh: THREE.InstancedMesh | null = null;
  private readonly geo: THREE.BufferGeometry;
  private readonly fold: THREE.Vector3 | null;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly tmp = new THREE.Vector3();
  private time = 0;
  private done = false;

  constructor(private readonly ctx: ChapterContext) {
    const pal = ctx.session.world.palette;
    this.geo = buildSheepGeometry(pal.accents['sheep'] ?? '#F7F4EC', '#3A302C');
    this.fold = spot(ctx, 'sheep_fold');
    const homes = ctx.level.zones
      .filter((z) => z.type === 'spot' && z.id.startsWith('lamb_'))
      .map((z) => spot(ctx, z.id))
      .filter((p): p is THREE.Vector3 => p !== null);
    ctx.own(() => this.dispose());
    if (homes.length === 0 || !this.fold) return;
    const penned = Number(ctx.state.flag(HOME_FLAG)) >= homes.length;
    this.done = penned;
    homes.forEach((home, i) => {
      const slot = this.slotFor(i, homes.length);
      this.lambs.push({
        home,
        pos: (penned ? slot : home).clone(),
        yaw: i * 1.7,
        state: penned ? 'home' : 'lost',
        baa: BAA.min + i * 1.3,
        hop: 0,
        slot,
        scale: 0.9 + ((i * 37) % 5) * 0.05,
      });
    });
    const mesh = new THREE.InstancedMesh(this.geo, mat('lambert'), this.lambs.length);
    mesh.name = 'ch12:flock';
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    ctx.session.world.scene.add(mesh);
    this.mesh = mesh;
    this.draw();
  }

  /** Lambs found (following or home) and lambs home. */
  get counts(): { found: number; home: number; total: number } {
    const home = this.lambs.filter((l) => l.state === 'home').length;
    return { found: home + this.followers.length, home, total: this.lambs.length };
  }

  update(dt: number): void {
    if (!this.mesh || !this.fold) return;
    this.time += dt;
    const player = this.ctx.session.player.controller.position;
    for (const [i, l] of this.lambs.entries()) {
      l.hop = Math.max(0, l.hop - dt);
      if (l.state === 'lost') this.graze(l, i, dt, player);
      else if (l.state === 'home') this.walk(l, l.slot, 1.4, 0.05, dt);
    }
    let lead: THREE.Vector3 = player;
    for (const l of this.followers) {
      this.walk(l, lead, LAMB.speed, LAMB.gap, dt);
      lead = l.pos;
    }
    const f = this.fold;
    if (this.followers.some((l) => Math.hypot(l.pos.x - f.x, l.pos.z - f.z) < LAMB.foldR)) this.pen();
    this.draw();
  }

  private graze(l: Lamb, i: number, dt: number, player: THREE.Vector3): void {
    const t = this.time * 0.25 + i * 2.1;
    this.tmp.set(l.home.x + Math.sin(t) * 1.4, l.home.y, l.home.z + Math.cos(t * 0.8) * 1.4);
    this.walk(l, this.tmp, LAMB.graze, 0.1, dt);
    l.baa -= dt;
    if (l.baa <= 0) {
      l.baa = BAA.min + ((i * 53 + Math.floor(this.time)) % 6) * ((BAA.max - BAA.min) / 5);
      events.emit('sfx', { id: 'sheep_baa', at: [l.pos.x, l.pos.y + 0.6, l.pos.z], pitch: 1.1 + (i % 3) * 0.1 });
    }
    if (Math.hypot(player.x - l.pos.x, player.z - l.pos.z) > LAMB.find) return;
    l.state = 'follow';
    l.hop = LAMB.hop;
    this.followers.push(l);
    events.emit('sfx', { id: 'sheep_baa', at: [l.pos.x, l.pos.y + 0.6, l.pos.z], pitch: 1.5 });
    this.ctx.session.world.particles.emit('sparkle', l.pos.clone().setY(l.pos.y + 0.9), 12);
    const c = this.counts;
    this.ctx.toast('ch12.toast.lambFound', { n: c.found, total: c.total });
  }

  /** Every lamb following him goes into the fold. */
  private pen(): void {
    for (const l of this.followers) {
      l.state = 'home';
      l.hop = LAMB.hop;
      this.ctx.session.world.particles.emit('sparkle', l.pos.clone().setY(l.pos.y + 0.9), 10);
    }
    this.followers.length = 0;
    const c = this.counts;
    this.ctx.state.setFlag(HOME_FLAG, c.home);
    events.emit('sfx', { id: 'sheep_baa', at: [this.fold!.x, this.fold!.y + 0.6, this.fold!.z], pitch: 1.3 });
    if (c.home < c.total) {
      this.ctx.toast('ch12.toast.lambsHome', { n: c.home, total: c.total });
      return;
    }
    if (this.done) return;
    this.done = true;
    this.ctx.state.addHope(10);
    this.ctx.state.unlock('goodShepherd');
    this.ctx.toast('ch12.toast.flockHome');
    for (const id of ['knowledge', 'experience', 'watchful_s', 'sincere'])
      this.ctx.npc(id)?.character.animator.overlay('wave');
  }

  private walk(l: Lamb, target: THREE.Vector3, speed: number, stop: number, dt: number): void {
    const dx = target.x - l.pos.x;
    const dz = target.z - l.pos.z;
    const d = Math.hypot(dx, dz);
    if (d <= stop) return;
    const step = Math.min(d - stop, speed * (d > 4 ? 1.4 : 1) * dt);
    l.pos.x += (dx / d) * step;
    l.pos.z += (dz / d) * step;
    const want = Math.atan2(dx, dz);
    let turn = want - l.yaw;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    l.yaw += turn * Math.min(1, dt * 8);
  }

  private slotFor(i: number, n: number): THREE.Vector3 {
    const f = this.fold!;
    const a = (i / n) * Math.PI * 2;
    return new THREE.Vector3(f.x + Math.sin(a) * LAMB.slotR, f.y, f.z + Math.cos(a) * LAMB.slotR);
  }

  private draw(): void {
    if (!this.mesh) return;
    const terrain = this.ctx.session.world.terrain;
    for (const [i, l] of this.lambs.entries()) {
      const moving = l.state === 'follow' ? 1 : 0.3;
      const bob = Math.abs(Math.sin(this.time * 9 + i)) * 0.04 * moving;
      const hop = l.hop > 0 ? Math.sin((l.hop / LAMB.hop) * Math.PI) * 0.35 : 0;
      this.tmp.set(l.pos.x, terrain.heightAt(l.pos.x, l.pos.z) + bob + hop, l.pos.z);
      this.q.setFromAxisAngle(this.up, l.yaw);
      this.s.setScalar(l.scale);
      this.m.compose(this.tmp, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  private dispose(): void {
    this.mesh?.removeFromParent();
    this.mesh?.dispose();
    this.geo.dispose();
  }
}
