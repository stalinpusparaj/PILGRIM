/**
 * CHAPTER VIII — THE VALLEY OF HUMILIATION / APOLLYON (GDD 2.10, GDD 2.9).
 *
 * Beats: the four sisters walk Christian down to the valley → he goes on alone → Apollyon claims him
 * (3 choices, all "no") → the fight → healing leaves → chapter card → end trigger.
 *
 * The real-time combat (paw slams, shield blocks, fiery darts, hearts lost) is not built yet. Until it is, the
 * first two phases play as short narrated beats and Phase 3 is the GDD's own prompt: Christian is thrown down,
 * the sword lands 4 m away and "[E] Reach for the sword" ends the fight (no time limit, like "Timed prompts" off).
 *
 * Positions come from the level file: triggers 'sisters_farewell', 'apollyon_approach', 'ch08_end'.
 */
import '../audio/events';
import { events } from '../core/Events';
import type { ChapterContext, ChapterScript } from './types';

const HEARTS = 5;
/** How far the sword spins away when Apollyon throws Christian down (GDD 2.9 Phase 3). */
const SWORD_THROW_M = 4;
/** Seconds each narrated phase holds before the next. */
const PHASE_S = 3.2;

class Chapter8 {
  private fightStarted = false;
  private fightDone = false;
  private ending = false;

  constructor(private readonly ctx: ChapterContext) {}

  start(): void {
    const ctx = this.ctx;
    this.fightDone = ctx.state.flag('ch08.fightDone') === true;

    ctx.objective(this.fightDone ? 'ui.hud.objective.followLight' : 'ch08.objective.crossValley');
    ctx.music(this.fightDone ? 'pilgrim' : 'apollyon', 'calm');
    ctx.ambience('wind');
    if (this.fightDone) this.apollyonGone();

    ctx.onTrigger('sisters_farewell', () => {
      void ctx
        .talk('ch08_sisters_farewell', { with: 'discretion' })
        .then(() => ctx.toast('ch08.toast.alone'));
    });

    ctx.onTrigger('apollyon_approach', () => {
      if (!this.fightDone) void this.fight();
    });

    ctx.onTrigger('ch08_end', () => void this.end(), { once: false });
  }

  private async fight(): Promise<void> {
    if (this.fightStarted) return;
    this.fightStarted = true;
    const ctx = this.ctx;
    ctx.toast('ch08.toast.apollyonApproaches');
    ctx.objective('ch08.objective.faceApollyon');
    ctx.music('apollyon', 'tension');
    await ctx.talk('ch08_apollyon_claim', { with: 'apollyon' });
    if (ctx.session.isDisposed) return;

    ctx.session.hud?.setHearts(HEARTS);
    ctx.music('apollyon', 'boss');
    ctx.objective('ch08.objective.fightApollyon');
    const player = ctx.session.player;
    player.mode = 'locked';
    const beats: Array<[string, 'shield_clang' | 'dart_whoosh' | 'perfect_block' | 'sword_hit']> = [
      ['ch08.toast.paws', 'shield_clang'],
      ['ch08.toast.strike', 'sword_hit'],
      ['ch08.toast.darts', 'dart_whoosh'],
      ['ch08.toast.bounce', 'perfect_block'],
    ];
    for (const [key, sfx] of beats) {
      ctx.toast(key);
      events.emit('sfx', { id: sfx });
      await ctx.wait(PHASE_S);
      if (ctx.session.isDisposed) return;
    }

    // Phase 3: the fall. The sword spins away and lands a few metres off.
    ctx.toast('ch08.toast.phase3');
    ctx.objective('ch08.objective.phase3');
    player.character.animator.play('fall');
    ctx.session.world.particles.emit('dust', player.renderPosition, 14);
    const sword = player.renderPosition.clone().addScaledVector(player.forward, SWORD_THROW_M);
    sword.y = ctx.session.world.terrain.heightAt(sword.x, sword.z);
    ctx.session.world.particles.emit('sparkle', sword.clone().setY(sword.y + 0.4), 10);
    await ctx.wait(1.2);
    if (ctx.session.isDisposed) return;
    player.character.animator.play('idle');
    player.mode = 'play';
    const off = ctx.onInteract({
      id: 'reach_sword',
      pos: sword,
      radius: 2.5,
      verb: 'ui.verb.reachSword',
      enabled: true,
      onUse: () => {
        off();
        void this.victory();
      },
    });
    ctx.guide(sword);
  }

  private async victory(): Promise<void> {
    if (this.fightDone) return;
    const ctx = this.ctx;
    ctx.guide(null);
    const player = ctx.session.player;
    player.mode = 'locked';
    player.character.animator.play('reach');
    await ctx.talk('ch08_apollyon_defeat', { with: 'apollyon' });
    if (ctx.session.isDisposed) return;
    this.fightDone = true;
    ctx.state.setFlag('ch08.fightDone', true);
    this.apollyonGone(true);

    // A hand of light drops glowing leaves that heal every heart (GDD 2.9 "After").
    ctx.session.hud?.setHearts(HEARTS);
    ctx.session.world.particles.emit(
      'motes',
      player.renderPosition.clone().setY(player.renderPosition.y + 3),
      30,
    );
    ctx.state.addHope(30);
    ctx.music('pilgrim', 'calm');
    ctx.toast('ch08.toast.victory');
    player.mode = 'play';
    await ctx.wait(2.5);
    if (ctx.session.isDisposed) return;
    ctx.session.hud?.setHearts(null);
    await ctx.talk('ch08_after_fight');
    if (ctx.session.isDisposed) return;
    ctx.objective('ui.hud.objective.followLight');
    ctx.chapterCard();
  }

  /** Apollyon flaps away in a sulk of smoke. */
  private apollyonGone(smoke = false): void {
    const c = this.ctx.npc('apollyon')?.character;
    if (!c) return;
    if (smoke)
      this.ctx.session.world.particles.emit('smoke', c.root.position.clone().setY(c.root.position.y + 2), 24);
    c.root.visible = false;
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
