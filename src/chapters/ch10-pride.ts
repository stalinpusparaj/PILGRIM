/**
 * Chapter X beat 1 (GDD 2.10): Faithful walks ahead on the open road. Running to pass him makes Christian grin
 * proudly and trip on his face; Faithful helps him up (a lesson about pride, played for a laugh). Walking up to
 * him instead, or reaching 'faithful_joins' first, is a plain happy meeting. Either way Faithful then follows as a
 * companion.
 *
 * Level: trigger 'faithful_seen' (he sets off), trigger 'faithful_joins' (where he waits), NPC 'faithful'.
 */
import * as THREE from 'three';
import '../audio/events';
import { events } from '../core/Events';
import { services } from '../core/Services';
import type { ChapterContext, NPC } from './types';

/** Faithful's walking pace ahead of Christian (m/s): a walk catches him slowly, a run passes him. */
const AHEAD_SPEED = 2.3;
/** Passing him by this much (m along the Way) while running trips Christian. */
const PASS_BY = 0.8;
/** Moving faster than this (m/s) with the run button held counts as running. */
const RUNNING = 2;
const MEET = 1.9;

export const FAITHFUL_BARKS = {
  idle: ['bark.ch10.faithful.idle.1', 'bark.ch10.faithful.idle.2'],
  cheer: ['bark.ch10.faithful.cheer.1'],
};

const hit = { t: 0, dist: 0, point: new THREE.Vector3() };

export class PrideTrip {
  private walking = false;
  private done = false;
  private ranRecently = 0;

  constructor(
    private readonly ctx: ChapterContext,
    private readonly onJoined: () => void,
  ) {}

  /** Wires the beat (not when Faithful already walks with him: the chapter re-adds the companion itself). */
  start(): void {
    const ctx = this.ctx;
    if (ctx.state.flag('ch10.faithfulJoined') === true) {
      this.done = true;
      return;
    }
    ctx.onTrigger('faithful_seen', () => this.setOff());
    ctx.onTrigger('faithful_joins', () => void this.meet());
  }

  update(dt: number): void {
    if (this.done || !this.walking) return;
    const f = this.ctx.npc('faithful');
    const p = this.ctx.session.player;
    if (!f) return;
    // Running = the run button (Shift / pad B / stick at the edge) held while he moves: speeds vary with Settings.
    const running = services.tryGet('input')?.runHeld() === true && p.speed > RUNNING;
    this.ranRecently = running ? 0.5 : Math.max(0, this.ranRecently - dt);
    const way = this.ctx.session.world.ways.main;
    way.closest(p.renderPosition.x, p.renderPosition.z, hit);
    const pt = hit.t;
    way.closest(f.position.x, f.position.z, hit);
    const ahead = (pt - hit.t) * way.length;
    if (ahead > PASS_BY && this.ranRecently > 0) void this.trip(f);
    else if (this.ranRecently === 0 && p.renderPosition.distanceTo(f.position) < MEET) void this.meet();
  }

  /** He sets off along the Way toward 'faithful_joins' and waits there. */
  private setOff(): void {
    const ctx = this.ctx;
    const f = ctx.npc('faithful');
    const end = ctx.level.triggers.find((t) => t.id === 'faithful_joins');
    if (!f || !end || this.done) return;
    ctx.toast('ch10.toast.faithfulAhead');
    ctx.objective('ch10.objective.catchFaithful');
    ctx.guide({ npc: 'faithful' });
    const way = ctx.session.world.ways.main;
    way.closest(f.position.x, f.position.z, hit);
    const from = hit.t;
    way.closest(end.at[0], end.at[2], hit);
    const to = hit.t;
    const path: THREE.Vector3[] = [];
    for (let i = 1; i <= 8; i++) path.push(way.sample(from + ((to - from) * i) / 8, new THREE.Vector3()));
    this.walking = true;
    void f.followPath(path, { speed: AHEAD_SPEED });
  }

  /** Pride comes before a fall: a proud grin, a trip, and a friend's hand. */
  private async trip(f: NPC): Promise<void> {
    if (this.done) return;
    this.done = true;
    this.walking = false;
    const ctx = this.ctx;
    const player = ctx.session.player;
    const c = player.character;
    f.stop();
    player.mode = 'locked';
    c.setExpression('happy');
    c.setMouth('grin');
    services.tryGet('bubbles')?.show(c, 'ch10.christian.proud', { mood: 'excited', durationSec: 1.4 });
    await ctx.wait(0.7);
    if (ctx.session.isDisposed) return;
    c.animator.play('trip', { fade: 0.08 });
    const at = player.renderPosition;
    events.emit('sfx', { id: 'bonk', at: [at.x, at.y, at.z] });
    ctx.session.world.particles.emit('dust', at, 14, { spread: 0.6 });
    ctx.session.camera.bump(0.4);
    await f.walkTo(at.clone().addScaledVector(player.forward, 1.2));
    if (ctx.session.isDisposed) return;
    c.setMouth(null);
    player.mode = 'play'; // the talk locks and unlocks him itself
    await ctx.talk('ch10_pride', { with: 'faithful' });
    this.joined();
  }

  private async meet(): Promise<void> {
    if (this.done) return;
    this.done = true;
    this.walking = false;
    this.ctx.npc('faithful')?.stop();
    await this.ctx.talk('ch10_faithful_join', { with: 'faithful' });
    this.joined();
  }

  private joined(): void {
    const ctx = this.ctx;
    if (ctx.session.isDisposed) return;
    ctx.guide(null);
    ctx.state.setFlag('ch10.faithfulJoined', true);
    ctx.state.meet('faithful');
    ctx.objective('ch10.objective.walkTogether');
    this.onJoined();
  }
}
