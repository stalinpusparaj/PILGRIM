/**
 * CHAPTER IX — THE VALLEY OF THE SHADOW (GDD 2.10). Not in the film.
 *
 * Beats: two men run back and warn him off → the dark valley (a ditch on the right, a bog on the left, both
 * bonk-hazards beside the path) → whispers that feel like his own thoughts → the smoking pit blocks the path and
 * only Prayer pushes the smoke back → a voice ahead recites Psalm 23:4 → dawn: the traps are easy to see → end.
 *
 * Prayer (Q / pad Y / the PRAY button) is read here directly: the general Prayer gift (golden ring, shadows
 * fleeing, GDD 2.7.6 #6) is not built yet, so this chapter answers the one prayer its story needs.
 *
 * Positions come from the level file: triggers 'valley_enter', 'two_men_warn', 'whisper_zone_1'..'_4',
 * 'ember_pit_near', 'voice_ahead', 'dawn_breaks', 'trap_section', 'ch09_end'; the zone 'ember_pit' (the smoke).
 */
import * as THREE from 'three';
import '../audio/events';
import { events } from '../core/Events';
import { services } from '../core/Services';
import { ParticleEmitter } from '../gen/Particles';
import type { ChapterContext, ChapterScript } from './types';

const WHISPERS = [
  'ch09.whisper.turnBack',
  'ch09.whisper.tooSmall',
  'ch09.whisper.goHome',
  'ch09.whisper.notEnough',
] as const;
/** A prayer counts when he is this close to the smoke's edge (m). */
const PRAY_REACH = 8;
const PRAYER_HOPE = 20;

class Chapter9 {
  private whisperIdx = 0;
  private pitDone = false;
  private ending = false;
  private smoke: { center: THREE.Vector3; radius: number; handle: number; emitter: ParticleEmitter } | null =
    null;

  constructor(private readonly ctx: ChapterContext) {}

  start(): void {
    const ctx = this.ctx;
    this.pitDone = ctx.state.flag('ch09.pitDone') === true;
    const dawnBroken = ctx.state.flag('ch09.dawnBroken') === true;

    ctx.objective('ch09.objective.crossValley');
    ctx.music('valley', 'sad');
    ctx.ambience('valley');
    if (!this.pitDone) this.blockPit();

    ctx.onTrigger('valley_enter', () => ctx.toast('ch09.toast.dark'));
    ctx.onTrigger('two_men_warn', () => void ctx.talk('ch09_two_men', { with: 'two_men_a' }));
    for (let i = 1; i <= WHISPERS.length; i++) {
      ctx.onTrigger(`whisper_zone_${i}`, () => this.showWhisper());
    }

    ctx.onZone(
      'shadowValley',
      () => ctx.objective(this.pitDone ? 'ch09.objective.keepGoing' : 'ch09.objective.crossValley'),
      () => {
        if (!this.ending) ctx.music('valley', 'calm');
      },
    );

    ctx.onTrigger('ember_pit_near', () => {
      if (this.pitDone) return;
      ctx.objective('ch09.objective.prayPath');
      ctx.toast('ch09.toast.smokingPit');
    });

    ctx.onTrigger('voice_ahead', () => {
      ctx.toast('ch09.toast.voiceAhead');
      void ctx.talk('ch09_voice_ahead');
    });

    ctx.onTrigger('dawn_breaks', () => void this.onDawn());
    if (dawnBroken) {
      ctx.music('pilgrim', 'calm');
      ctx.ambience('birdsong');
      ctx.objective('ch09.objective.trapSection');
    }

    ctx.onTrigger('trap_section', () => {
      if (ctx.state.flag('ch09.dawnBroken') === true) ctx.toast('ch09.toast.traps');
    });

    ctx.onTrigger('ch09_end', () => void this.end(), { once: false });
    ctx.own(() => this.clearPit());
  }

  update(dt: number): void {
    const s = this.smoke;
    if (!s) return;
    s.emitter.update(dt, s.center);
    const p = this.ctx.session.player;
    if (p.mode !== 'play' || !services.tryGet('input')?.pressed('pray')) return;
    const d = Math.hypot(p.renderPosition.x - s.center.x, p.renderPosition.z - s.center.z);
    if (d <= s.radius + PRAY_REACH) void this.pray();
  }

  /** The smoke stands in the path as a wall until a prayer pushes it back. */
  private blockPit(): void {
    const zone = this.ctx.level.zones.find((z) => z.id === 'ember_pit');
    if (!zone || zone.x === undefined || zone.z === undefined || zone.r === undefined) return;
    const s = this.ctx.session;
    const y = s.world.terrain.heightAt(zone.x, zone.z);
    const center = new THREE.Vector3(zone.x, y, zone.z);
    const radius = zone.r * 0.7;
    const handle = s.col.addCollider({
      kind: 'cylinder',
      center: [zone.x, y + 2, zone.z],
      radius,
      height: 4,
    });
    const emitter = new ParticleEmitter(s.world.particles, 'smoke', 14, { spread: radius });
    this.smoke = { center, radius, handle, emitter };
  }

  private clearPit(): void {
    if (!this.smoke) return;
    if (!this.ctx.session.isDisposed) this.ctx.session.col.removeCollider(this.smoke.handle);
    this.smoke = null;
  }

  private async pray(): Promise<void> {
    if (this.pitDone || !this.smoke) return;
    this.pitDone = true;
    const ctx = this.ctx;
    const player = ctx.session.player;
    const at = this.smoke.center.clone();
    ctx.state.setFlag('ch09.pitDone', true);
    player.mode = 'locked';
    player.character.animator.play('pray');
    events.emit('sfx', { id: 'prayer_swell' });
    ctx.state.addHope(PRAYER_HOPE);
    ctx.session.world.particles.emit(
      'sparkle',
      player.renderPosition.clone().setY(player.renderPosition.y + 1),
      30,
    );
    await ctx.wait(1.4);
    if (ctx.session.isDisposed) return;
    this.clearPit();
    ctx.session.world.particles.emit('smoke', at.setY(at.y + 1), 20, { spread: 3 });
    player.character.animator.play('idle');
    player.mode = 'play';
    ctx.toast('ch09.toast.pitCleared');
    ctx.objective('ch09.objective.keepGoing');
  }

  private showWhisper(): void {
    this.ctx.toast(WHISPERS[this.whisperIdx % WHISPERS.length]!);
    this.whisperIdx++;
  }

  private async onDawn(): Promise<void> {
    const ctx = this.ctx;
    if (ctx.state.flag('ch09.dawnBroken') === true) return;
    ctx.state.setFlag('ch09.dawnBroken', true);
    ctx.music('pilgrim', 'calm');
    ctx.ambience('birdsong');
    ctx.toast('ch09.toast.dawn');
    ctx.objective('ch09.objective.trapSection');
    await ctx.wait(1.0);
    if (ctx.session.isDisposed) return;
    await ctx.talk('ch09_dawn_praise');
  }

  private async end(): Promise<void> {
    if (this.ending) return;
    this.ending = true;
    const ctx = this.ctx;
    ctx.objective(null);
    await ctx.talk('ch09_end_talk');
    ctx.complete();
  }
}

let running: Chapter9 | null = null;

const script: ChapterScript = {
  id: 'ch09',
  level: 'ch09',
  start(ctx) {
    running = new Chapter9(ctx);
    running.start();
  },
  update(dt) {
    running?.update(dt);
  },
  dispose() {
    running = null;
  },
};

export default script;
