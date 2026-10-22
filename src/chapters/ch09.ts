/**
 * CHAPTER IX — THE VALLEY OF THE SHADOW (GDD 2.10). Not in the film.
 *
 * Beats: two men run back and warn him off → the dark valley (a ditch on the right, a bog on the left, both
 * bonk-hazards beside the path) → whispers that feel like his own thoughts → the smoking pit blocks the path and
 * only Prayer pushes the smoke back → a voice ahead recites Psalm 23:4 → dawn: the traps are easy to see → end.
 *
 * Prayer is the general gift (src/player/Prayer.ts: Q / pad Y / PRAY, a golden ring, +20 Hope, 15 s rest); this
 * chapter only listens for its `prayer:burst` near the smoke. The shadows (src/npc/Shadow.ts, GDD 2.9) lurk along
 * the dark stretch, drain Hope when close and nudge him toward the ditch and the bog; Prayer sends them fleeing, the
 * Sword scatters them. At dawn they slip away and the night lifts (LookShift eases sky, fog and light to dawn).
 *
 * Positions come from the level file: triggers 'valley_enter', 'two_men_warn', 'whisper_zone_1'..'_4',
 * 'ember_pit_near', 'voice_ahead', 'dawn_breaks', 'trap_section', 'ch09_end'; the zone 'ember_pit' (the smoke);
 * 'shadows' zones (where the shadows lurk; also a combat zone for the Sword and Shield).
 */
import * as THREE from 'three';
import '../audio/events';
import { events } from '../core/Events';
import { ParticleEmitter } from '../gen/Particles';
import { LookShift, type Look } from '../gen/fx/LookShift';
import { Shadows } from '../npc/Shadow';
import type { ChapterContext, ChapterScript } from './types';

const WHISPERS = [
  'ch09.whisper.turnBack',
  'ch09.whisper.tooSmall',
  'ch09.whisper.goHome',
  'ch09.whisper.notEnough',
] as const;
/** A prayer counts when he is this close to the smoke's edge (m), or anywhere inside 'ember_pit_near'. */
const PRAY_REACH = 8;
/** GDD 2.10 Ch IX "Second half at dawn": the valley eases from night to a cool dawn (palette accent #9FB8D9). */
const DAWN: Look = {
  sky: { top: '#5E78A8', horizon: '#E9B99A', bottom: '#9FB8D9' },
  fog: { color: '#8496B8', near: 25, far: 150 },
  sun: { color: '#FFD9AE', intensity: 2.4 },
  hemi: { sky: '#B8CCE8', ground: '#6E6680', intensity: 2.2 },
};
const DAWN_SECONDS = 5;

class Chapter9 {
  private whisperIdx = 0;
  private pitDone = false;
  private ending = false;
  private smoke: { center: THREE.Vector3; radius: number; handle: number; emitter: ParticleEmitter } | null =
    null;
  private shadows: Shadows | null = null;
  private dawn: LookShift | null = null;

  constructor(private readonly ctx: ChapterContext) {}

  start(): void {
    const ctx = this.ctx;
    this.pitDone = ctx.state.flag('ch09.pitDone') === true;
    const dawnBroken = ctx.state.flag('ch09.dawnBroken') === true;

    ctx.objective('ch09.objective.crossValley');
    ctx.music('valley', 'sad');
    ctx.ambience('valley');
    if (!this.pitDone) this.blockPit();
    this.addShadows(dawnBroken);
    ctx.own(
      events.on('prayer:burst', (b) => {
        const sm = this.smoke;
        if (!sm || this.pitDone) return;
        if (this.prayerReaches(b.x, b.z)) void this.clearSmoke();
      }),
    );

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
      this.startDawn(true);
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
    if (s) s.emitter.update(dt, s.center);
    this.dawn?.update(dt);
  }

  /** Near enough the smoke, or anywhere the chapter has asked him to pray ('ember_pit_near'). */
  private prayerReaches(x: number, z: number): boolean {
    const sm = this.smoke;
    if (!sm) return false;
    if (Math.hypot(x - sm.center.x, z - sm.center.z) <= sm.radius + PRAY_REACH) return true;
    const t = this.ctx.level.triggers.find((tr) => tr.id === 'ember_pit_near');
    return !!t && t.shape === 'circle' && Math.hypot(x - t.at[0], z - t.at[2]) <= (t.r ?? 0) + 1;
  }

  /** The night lifts (eased, or at once when the chapter reopens after its dawn). */
  private startDawn(instant: boolean): void {
    if (this.dawn) return;
    const look = new LookShift(this.ctx.session.world, DAWN, DAWN_SECONDS);
    if (instant) look.snap();
    this.dawn = look;
    this.ctx.own(() => {
      look.dispose();
      if (this.dawn === look) this.dawn = null;
    });
  }

  /** The shadows along the dark stretch ('shadows' zones); gone at dawn. */
  private addShadows(dawn: boolean): void {
    const ctx = this.ctx;
    const zones = ctx.level.zones.filter((z) => z.type === 'shadows');
    if (zones.length === 0) return;
    const shadows = new Shadows({
      engine: ctx.engine,
      session: ctx.session,
      combat: ctx.session.gifts.combat,
      zones,
      seed: ctx.level.seed + 9,
    });
    if (dawn) shadows.setActive(false);
    this.shadows = shadows;
    ctx.own(() => {
      shadows.dispose();
      if (this.shadows === shadows) this.shadows = null;
    });
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

  /** A prayer went up near the smoke (the Prayer gift already knelt him, lit the ring and gave the Hope). */
  private async clearSmoke(): Promise<void> {
    if (this.pitDone || !this.smoke) return;
    this.pitDone = true;
    const ctx = this.ctx;
    const at = this.smoke.center.clone();
    ctx.state.setFlag('ch09.pitDone', true);
    await ctx.wait(1.2);
    if (ctx.session.isDisposed) return;
    this.clearPit();
    ctx.session.world.particles.emit('smoke', at.setY(at.y + 1), 20, { spread: 3 });
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
    this.shadows?.setActive(false);
    this.startDawn(false);
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
