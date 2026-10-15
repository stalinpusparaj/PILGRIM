/**
 * CHAPTER II — THE SLOUGH OF DESPOND (GDD 2.10): content/levels/ch02.json, dialogue content/dialogue/ch02.json,
 * strings content/i18n/fragments/ch02.*.json.
 *
 * Beats: Pliable follows from the start, chattering about crowns (ch02-pliable.ts) → the Way enters a wide
 * bog under drizzle (the engine's Slough: sinking, reduced speed, stepping stones that rise when Christian stands
 * still 2 s or reads a Promise; `autoReveal` on) → at the edge both sink, the mud takes Pliable's boot with a
 * slurp (the laugh), he climbs out on the home side, a 2-choice talk, he stomps home → alone (flag `alone`: the
 * lantern dims faster) → Help waits on the far bank: "[E] Take his hand" from the mud, he pulls Christian up and
 * the steps that were there all along glow (ch02-help.ts) → a waystone, then the end trigger completes the chapter.
 * Drizzle: a 'rain' particle field around Christian. Objectives follow each beat; nothing here can fail.
 */
import * as THREE from 'three';
import { ParticleEmitter } from '../gen/Particles';
import { HelpBeats } from './ch02-help';
import { PliableBeats } from './ch02-pliable';
import type { ChapterContext, ChapterScript } from './types';

const OBJECTIVE = {
  follow: 'ch02.objective.followWay',
  steps: 'ui.hud.objective.findSteps',
  goOn: 'ch02.objective.goOn',
} as const;
/** Drizzle: streaks per second in a field ahead of the camera (so no streak is born right on the lens). */
const RAIN = { rate: 26, ahead: 9, spread: 8 };

class Chapter2 {
  private readonly pliable: PliableBeats;
  private readonly help: HelpBeats;
  private rain: ParticleEmitter | null = null;
  private readonly rainAt = new THREE.Vector3();
  private alone = false;
  private ending = false;

  constructor(private readonly ctx: ChapterContext) {
    this.pliable = new PliableBeats(ctx, { onGone: () => this.onAlone() });
    this.help = new HelpBeats(ctx, {
      alone: () => this.alone,
      onHelped: () => this.onHelped(),
    });
  }

  start(): void {
    const ctx = this.ctx;
    ctx.session.slough.autoReveal = true;
    this.alone = ctx.state.flag('alone') === true && ctx.state.flag('ch02.pliableGone') === true;
    ctx.objective(this.alone ? OBJECTIVE.steps : OBJECTIVE.follow);
    this.rain = new ParticleEmitter(ctx.session.world.particles, 'rain', RAIN.rate, { spread: RAIN.spread });
    this.help.install();
    if (this.alone) {
      const pliable = ctx.npc('pliable');
      if (pliable) pliable.character.root.visible = false;
    }
    if (this.help.done) this.onHelped();
    else if (this.alone) ctx.guide({ npc: 'help' });
    if (!this.alone) void this.pliable.start();
    ctx.onTrigger('bog_enter', () => {
      if (!this.alone) void this.pliable.bogEnter();
    });
    ctx.onTrigger('help_near', () => {
      if (this.alone && !this.help.done) this.help.callOut();
    });
    ctx.onTrigger('bog_end', () => void this.end(), { once: false });
  }

  update(dt: number): void {
    const session = this.ctx.session;
    if (this.rain) {
      const cam = this.ctx.engine.camera;
      const p = session.player.controller.position;
      cam.getWorldDirection(this.rainAt).multiplyScalar(RAIN.ahead).add(cam.position);
      this.rainAt.y = p.y;
      this.rain.update(dt, this.rainAt);
    }
    this.help.update(dt);
  }

  private onAlone(): void {
    this.alone = true;
    this.ctx.objective(OBJECTIVE.steps);
    this.ctx.guide({ npc: 'help' }); // Help waits on the far bank: that is the way out
  }

  private onHelped(): void {
    this.ctx.objective(OBJECTIVE.goOn);
    this.ctx.guide(null);
  }

  private async end(): Promise<void> {
    if (this.ending) return;
    this.ending = true;
    const ctx = this.ctx;
    ctx.objective(null);
    await ctx.talk('ch02_end');
    ctx.complete();
  }
}

let running: Chapter2 | null = null;

const script: ChapterScript = {
  id: 'ch02',
  level: 'ch02',
  start(ctx) {
    running = new Chapter2(ctx);
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
