/**
 * CHAPTER VIII — THE VALLEY OF HUMILIATION / APOLLYON (GDD 2.10, GDD 2.9).
 *
 * Beats: the four sisters walk Christian down to the valley → he goes on alone → Apollyon lands and claims him
 * (3 choices, all "no") → the boss fight (src/npc/Apollyon.ts: paw slams, fiery darts, the fall; 5 hearts, Easy /
 * Normal from Settings) → Christian reaches his sword, says Micah 7:8 and strikes → Apollyon flaps away in a sulk of
 * smoke → a hand of light drops healing leaves (hearts full) → chapter card → end trigger.
 *
 * Positions come from the level file: triggers 'sisters_farewell', 'apollyon_approach', 'ch08_end'; the 'arena'
 * box zone (where the fight happens and the Sword and Shield work).
 */
import * as THREE from 'three';
import '../audio/events';
import { events } from '../core/Events';
import { Hearts } from '../player/Hearts';
import { ApollyonFight, type ApollyonPhase } from '../npc/Apollyon';
import { Arena } from '../npc/apollyon-arena';
import { ensureArmour } from './armour-kit';
import type { ChapterContext, ChapterScript } from './types';

const PHASE_TEXT: Record<Exclude<ApollyonPhase, 'done'>, { toast: string; objective: string }> = {
  paws: { toast: 'ch08.toast.phase1', objective: 'ch08.objective.phase1' },
  darts: { toast: 'ch08.toast.phase2', objective: 'ch08.objective.phase2' },
  fall: { toast: 'ch08.toast.phase3', objective: 'ch08.objective.phase3' },
};

/** How far ahead of Christian Apollyon lands (m). */
const LAND_AHEAD = 9;

class Chapter8 {
  private fightStarted = false;
  private fightDone = false;
  private ending = false;
  private fight: ApollyonFight | null = null;
  private hearts: Hearts | null = null;

  constructor(private readonly ctx: ChapterContext) {}

  start(): void {
    const ctx = this.ctx;
    this.fightDone = ctx.state.flag('ch08.fightDone') === true;
    ensureArmour(ctx);

    ctx.objective(this.fightDone ? 'ui.hud.objective.followLight' : 'ch08.objective.crossValley');
    ctx.music(this.fightDone ? 'pilgrim' : 'apollyon', 'calm');
    ctx.ambience('wind');
    this.apollyonGone(); // he comes down from the sky when the fight starts

    ctx.onTrigger('sisters_farewell', () => {
      void ctx
        .talk('ch08_sisters_farewell', { with: 'discretion' })
        .then(() => ctx.toast('ch08.toast.alone'));
    });

    ctx.onTrigger('apollyon_approach', () => {
      if (!this.fightDone) void this.startFight();
    });

    ctx.onTrigger('ch08_end', () => void this.end(), { once: false });
    ctx.own(() => this.freeFight());
  }

  private async startFight(): Promise<void> {
    if (this.fightStarted) return;
    const ctx = this.ctx;
    const npc = ctx.npc('apollyon');
    const zone = ctx.level.zones.find((z) => z.type === 'arena');
    if (!npc || !zone) {
      console.warn('[ch08] no Apollyon or no arena zone: the fight cannot start');
      return;
    }
    this.fightStarted = true;
    const arena = new Arena(zone);
    ctx.toast('ch08.toast.apollyonApproaches');
    ctx.objective('ch08.objective.faceApollyon');
    ctx.music('apollyon', 'tension');

    // He lands a little way ahead of the pilgrim, facing him.
    const p = ctx.session.player.controller.position;
    const home = arena.landing(p, LAND_AHEAD, new THREE.Vector3());
    home.y = ctx.session.world.terrain.heightAt(home.x, home.z);
    npc.teleport(home, Math.atan2(p.x - home.x, p.z - home.z));
    npc.character.root.visible = true;
    ctx.session.world.particles.emit('dust', home, 24, { spread: 2 });
    events.emit('sfx', { id: 'land', at: [home.x, home.y, home.z], pitch: 0.4 });
    ctx.session.camera.bump(0.8);
    await ctx.wait(1.0);
    await ctx.talk('ch08_apollyon_claim', { with: 'apollyon' });
    if (ctx.session.isDisposed) return;

    // Christian stands in the arena for the fight.
    if (!arena.contains(p.x, p.z, -1)) {
      const at = arena.start(new THREE.Vector3());
      ctx.session.teleport(at.x, at.z, arena.facing);
    }
    const hearts = new Hearts(() => ctx.session.hud);
    hearts.show();
    this.hearts = hearts;
    const combat = ctx.session.gifts.combat;
    combat.engaged = true;
    const fight = new ApollyonFight({ engine: ctx.engine, session: ctx.session, npc, combat, hearts, arena });
    this.fight = fight;
    const off = events.on('apollyon:phase', ({ phase }) => {
      if (phase === 'done') return;
      ctx.toast(PHASE_TEXT[phase].toast);
      ctx.objective(PHASE_TEXT[phase].objective);
    });
    ctx.own(off);
    ctx.music('apollyon', 'boss');
    await fight.run();
    off();
    if (ctx.session.isDisposed) return;
    await this.victory();
  }

  /** "When I fall, I shall arise", the strike, his flight, the healing leaves. */
  private async victory(): Promise<void> {
    const ctx = this.ctx;
    const fight = this.fight;
    if (this.fightDone || !fight) return;
    const player = ctx.session.player;
    ctx.objective(null);
    await ctx.talk('ch08_apollyon_defeat', { with: 'apollyon' });
    if (ctx.session.isDisposed) return;
    player.character.animator.overlay('swing', { restart: true });
    const at = player.renderPosition;
    events.emit('sfx', { id: 'sword_hit', at: [at.x, at.y + 1, at.z] });
    await fight.flyAway();
    if (ctx.session.isDisposed) return;
    this.fightDone = true;
    ctx.state.setFlag('ch08.fightDone', true);

    // A hand of light drops glowing leaves that heal every heart (GDD 2.9 "After").
    this.hearts?.fill();
    ctx.session.world.particles.emit('motes', at.clone().setY(at.y + 3), 30, { color: '#FFF2C2', spread: 2 });
    ctx.state.addHope(30);
    ctx.music('pilgrim', 'calm');
    ctx.toast('ch08.toast.victory');
    await ctx.wait(2.5);
    if (ctx.session.isDisposed) return;
    this.freeFight();
    await ctx.talk('ch08_after_fight');
    if (ctx.session.isDisposed) return;
    ctx.objective('ui.hud.objective.followLight');
    ctx.chapterCard();
  }

  /** The fight's meshes, hearts and the combat hold go away (after the leaves, or the chapter ending). */
  private freeFight(): void {
    this.fight?.dispose();
    this.fight = null;
    this.hearts?.dispose();
    this.hearts = null;
    if (!this.ctx.session.isDisposed) this.ctx.session.gifts.combat.engaged = false;
  }

  /** Apollyon is not in the valley (before he lands, after he flies off). */
  private apollyonGone(): void {
    const c = this.ctx.npc('apollyon')?.character;
    if (c) c.root.visible = false;
  }

  private end(): void {
    if (this.ending) return;
    if (!this.fightDone) {
      this.ctx.toast('ch08.toast.mustFight');
      return;
    }
    this.ending = true;
    this.ctx.objective(null);
    this.ctx.complete();
  }
}

const script: ChapterScript = {
  id: 'ch08',
  level: 'ch08',
  start(ctx) {
    new Chapter8(ctx).start();
  },
};

export default script;
