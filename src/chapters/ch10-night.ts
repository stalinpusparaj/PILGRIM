/**
 * Chapter X beat 8 (GDD 2.10): night over Vanity Fair, and a short sneak through the empty street to the gate past
 * lantern-carrying watchmen. Each watchman walks his patrol across the street and back; his lantern throws a warm
 * pool of light on the ground ahead of him. Stepping into a pool = caught: back to the start of the section
 * (no harm, no Hope lost). The first catch explains the trick; after MERCY.slow catches the watchmen slow down and
 * yawn, after MERCY.sleep they nod off and their lanterns dim, so no child is ever stuck here (GDD 2.2 "grace, not
 * grind"). At the gate the night lifts again (the chapter calls `escape()` when Hopeful joins).
 *
 * Level: zones of type 'patrol' (box; `npc` = the watchman's NPC id, optional `phase` 0..1 to start part-way),
 * the 'sneak_start' spot zone. The night look is a LookShift (src/gen/fx/LookShift.ts) eased in over 4 s.
 */
import * as THREE from 'three';
import '../audio/events';
import { events } from '../core/Events';
import { services } from '../core/Services';
import { LookShift, type Look } from '../gen/fx/LookShift';
import { patrolEnds, spot } from './ch10-kit';
import type { ChapterContext, NPC } from './types';

/** GDD 2.10 Ch X palette: night #22304A. */
const NIGHT: Look = {
  sky: { top: '#0B1024', horizon: '#22304A', bottom: '#141B2E' },
  fog: { color: '#1A2236', near: 14, far: 70 },
  sun: { color: '#8FA4D8', intensity: 0.28 },
  hemi: { sky: '#3A4A70', ground: '#141826', intensity: 0.6 },
};
/** The lantern's pool: radius (m; smaller on Easy), how far ahead of him it lies (m). */
export const POOL = { radius: 2.1, radiusEasy: 1.8, ahead: 2.0 } as const;
const PATROL = { speed: 1.2, pause: 2.2 } as const;
/** Catches before the watchmen slow and yawn, and before they nod off (lanterns dimmed, nobody caught). */
export const MERCY = { slow: 3, sleep: 5, slowSpeed: 0.8, slowPause: 3.5 } as const;

interface Watch {
  npc: NPC;
  ends: [THREE.Vector3, THREE.Vector3];
  pool: THREE.Mesh;
}

export class NightSneak {
  private look: LookShift | null = null;
  private readonly watches: Watch[] = [];
  private readonly poolGeo = new THREE.CircleGeometry(POOL.radius, 28).rotateX(-Math.PI / 2);
  private readonly poolMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#FFD27A'),
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  private active = false;
  private asleep = false;
  private lock = 0;
  private caughtTimes = 0;

  constructor(private readonly ctx: ChapterContext) {}

  get sneaking(): boolean {
    return this.active;
  }

  get caught(): number {
    return this.caughtTimes;
  }

  /** The watchmen wait out of sight until night. */
  start(): void {
    const ctx = this.ctx;
    for (const z of ctx.level.zones) {
      if (z.type !== 'patrol') continue;
      const npc = ctx.npc(String(z['npc'] ?? ''));
      if (!npc) continue;
      const pool = new THREE.Mesh(this.poolGeo, this.poolMat);
      pool.name = `ch10:lantern-pool:${z.id}`;
      pool.visible = false;
      pool.renderOrder = 3;
      ctx.session.world.scene.add(pool);
      const ends = patrolEnds(ctx, z);
      const phase = typeof z['phase'] === 'number' ? (z['phase'] as number) : 0;
      if (phase > 0) ends.reverse();
      npc.teleport(ends[0].clone().lerp(ends[1], phase % 1));
      npc.character.root.visible = false;
      this.watches.push({ npc, ends, pool });
    }
    ctx.own(() => this.dispose());
  }

  /** Night falls (eased; `instant` when the chapter reopens mid-night). */
  nightfall(instant = false): void {
    if (this.look) return;
    this.look = new LookShift(this.ctx.session.world, NIGHT, 4);
    if (instant) this.look.snap();
  }

  /** The sneak begins: watchmen out with their lanterns, Christian at the start. */
  begin(): void {
    const ctx = this.ctx;
    this.nightfall();
    this.active = true;
    ctx.objective('ch10.objective.sneak');
    ctx.guide({ npc: 'hopeful' });
    for (const w of this.watches) {
      w.npc.character.root.visible = true;
      w.pool.visible = true;
      void this.patrol(w);
    }
    this.toStart();
  }

  /** Out of the gate: the watchmen stop, the night lifts. */
  escape(): void {
    this.active = false;
    this.ctx.guide(null);
    for (const w of this.watches) {
      w.npc.stop();
      w.pool.visible = false;
    }
    this.look?.back();
  }

  update(dt: number): void {
    this.look?.update(dt);
    if (!this.active) return;
    const s = this.ctx.session;
    const p = s.player.controller.position;
    const radius = this.radius();
    for (const w of this.watches) {
      const yaw = w.npc.facing;
      const at = w.npc.position;
      w.pool.position.set(at.x + Math.sin(yaw) * POOL.ahead, 0, at.z + Math.cos(yaw) * POOL.ahead);
      w.pool.position.y = s.world.terrain.heightAt(w.pool.position.x, w.pool.position.z) + 0.06;
      w.pool.scale.setScalar(radius / POOL.radius);
      if (this.asleep) continue;
      const inPool = Math.hypot(p.x - w.pool.position.x, p.z - w.pool.position.z) < radius;
      const bumped = Math.hypot(p.x - at.x, p.z - at.z) < 1.0;
      if ((inPool || bumped) && s.player.mode === 'play' && this.lock <= 0) this.caughtBy(w);
    }
    if (this.lock > 0) {
      this.lock -= dt;
      if (this.lock <= 0 && s.player.mode === 'locked') s.player.mode = 'play';
    }
  }

  /** Watchman's walk: one end, a look round, the other end, again (slower once he is yawning). */
  private async patrol(w: Watch): Promise<void> {
    let i = 1;
    while (this.active && !this.asleep && !this.ctx.session.isDisposed) {
      const tired = this.caughtTimes >= MERCY.slow;
      await w.npc.walkTo(w.ends[i]!, { speed: tired ? MERCY.slowSpeed : PATROL.speed });
      if (!this.active || this.asleep) return;
      await this.ctx.wait(tired ? MERCY.slowPause : PATROL.pause);
      i = 1 - i;
    }
  }

  private radius(): number {
    if (this.asleep) return POOL.radiusEasy * 0.5;
    const easy = services.tryGet('settings')?.data.difficulty !== 'normal';
    return easy ? POOL.radiusEasy : POOL.radius;
  }

  private caughtBy(w: Watch): void {
    const s = this.ctx.session;
    this.caughtTimes++;
    const p = s.player.renderPosition;
    events.emit('sfx', { id: 'bonk', at: [p.x, p.y + 1, p.z], pitch: 1.2, volume: 0.7 });
    w.npc.character.animator.overlay('point');
    void this.ctx.wait(1.2).then(() => w.npc.character.animator.overlay(null));
    this.ctx.toast(this.caughtTimes === 1 ? 'ch10.toast.caughtHint' : 'ch10.toast.caught');
    if (this.caughtTimes === MERCY.slow) {
      for (const x of this.watches) x.npc.character.animator.overlay('wave'); // a big stretch and a yawn
      void this.ctx.wait(1.5).then(() => this.watches.forEach((x) => x.npc.character.animator.overlay(null)));
      this.ctx.toast('ch10.toast.yawn');
    }
    if (this.caughtTimes >= MERCY.sleep) this.nodOff();
    this.toStart();
    s.player.mode = 'locked';
    this.lock = 0.8;
  }

  /** Too many catches: the watchmen sit down and nod off; their lanterns dim. */
  private nodOff(): void {
    if (this.asleep) return;
    this.asleep = true;
    for (const w of this.watches) {
      w.npc.stop();
      w.npc.character.animator.play('nap', { fade: 0.4 });
      this.poolMat.opacity = 0.14;
    }
    this.ctx.toast('ch10.toast.asleep');
  }

  private toStart(): void {
    const at = spot(this.ctx, 'sneak_start');
    const gate = this.ctx.level.triggers.find((t) => t.id === 'hopeful_joins');
    if (!at) return;
    const facing = gate ? Math.atan2(gate.at[0] - at.x, gate.at[2] - at.z) : undefined;
    this.ctx.session.teleport(at.x, at.z, facing);
  }

  private dispose(): void {
    this.active = false;
    this.look?.dispose();
    this.look = null;
    for (const w of this.watches) w.pool.removeFromParent();
    this.watches.length = 0;
    this.poolGeo.dispose();
    this.poolMat.dispose();
  }
}
