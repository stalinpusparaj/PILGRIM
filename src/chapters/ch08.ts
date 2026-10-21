/**
 * CHAPTER VIII — THE VALLEY OF HUMILIATION / APOLLYON BOSS (GDD 2.10, GDD 2.9).
 *
 * Beats: the four sisters walk Christian down to the valley entrance → he goes on
 * alone → Apollyon lands → pre-fight dialogue (3 choices, all "no") → boss fight
 * (Phase 1: paw slams; Phase 2: fiery darts; Phase 3: the fall and the sword reach)
 * → healing leaves → chapter card → end trigger.
 *
 * Hearts (5) are shown only during the fight and cleared after.
 * The fight itself is physics-driven; the chapter reacts to the trigger events the
 * level produces and manages the narrative/HUD layer only.
 *
 * Positions come from the level file: triggers 'sisters_farewell', 'apollyon_approach',
 * 'fight_phase1', 'fight_phase2', 'fight_phase3', 'fight_finale', 'ch08_end'.
 */
import type { ChapterContext, ChapterScript } from './types';

// ─── chapter class ────────────────────────────────────────────────────────────

class Chapter8 {
  private fightStarted = false;
  private fightDone = false;
  private ending = false;

  constructor(private readonly ctx: ChapterContext) {}

  start(): void {
    const ctx = this.ctx;

    this.fightStarted = ctx.state.flag('ch08.fightStarted') === true;
    this.fightDone = ctx.state.flag('ch08.fightDone') === true;

    ctx.objective('ch08.objective.crossValley');
    ctx.music('apollyon', 'calm');
    ctx.ambience('wind');

    // Sisters say goodbye at the valley entrance
    ctx.onTrigger('sisters_farewell', () => {
      ctx.toast('ch08.toast.alone');
      void ctx.talk('ch08_sisters_farewell');
    });

    // Apollyon lands: pre-fight dialogue
    ctx.onTrigger('apollyon_approach', () => {
      if (this.fightDone) return;
      void this.beginEncounter();
    });

    // Phase transitions (narrative / music only; gameplay handled by the level)
    ctx.onTrigger('fight_phase1', () => {
      ctx.music('apollyon', 'tension');
      ctx.objective('ch08.objective.fightPhase1');
    });

    ctx.onTrigger('fight_phase2', () => {
      ctx.music('apollyon', 'boss');
      ctx.objective('ch08.objective.fightPhase2');
    });

    ctx.onTrigger('fight_phase3', () => {
      ctx.objective('ch08.objective.fightPhase3');
      ctx.toast('ch08.toast.reachSword');
    });

    // Apollyon defeated
    ctx.onTrigger('fight_finale', () => void this.onVictory());

    ctx.onTrigger('ch08_end', () => void this.end(), { once: false });

    // Restore HUD hearts if we reloaded mid-fight
    if (this.fightStarted && !this.fightDone) {
      ctx.session.hud?.setHearts(5);
      ctx.music('apollyon', 'boss');
    }
  }

  // ── pre-fight encounter ──────────────────────────────────────────────────

  private async beginEncounter(): Promise<void> {
    if (this.fightStarted) return;
    this.fightStarted = true;
    this.ctx.state.setFlag('ch08.fightStarted', true);

    const ctx = this.ctx;
    ctx.objective('ch08.objective.faceApolly');
    ctx.music('apollyon', 'tension');

    // 3-choice pre-fight talk (all of them mean "no")
    await ctx.talk('ch08_apollyon_claim', { with: 'apollyon' });
    if (ctx.session.isDisposed) return;

    // Show 5 hearts
    ctx.session.hud?.setHearts(5);
    ctx.objective('ch08.objective.fightPhase1');
    ctx.music('apollyon', 'boss');
  }

  // ── victory ──────────────────────────────────────────────────────────────

  private async onVictory(): Promise<void> {
    if (this.fightDone) return;
    this.fightDone = true;
    this.ctx.state.setFlag('ch08.fightDone', true);

    const ctx = this.ctx;

    // Clear hearts and restore Hope
    ctx.session.hud?.setHearts(null);
    ctx.state.addHope(30);
    ctx.music('pilgrim', 'calm');
    ctx.objective('ch08.objective.healingLeaves');
    ctx.toast('ch08.toast.victory');

    await ctx.wait(2.0);
    if (ctx.session.isDisposed) return;

    await ctx.talk('ch08_after_fight');
    if (ctx.session.isDisposed) return;

    ctx.objective('ui.hud.objective.followLight');
    ctx.chapterCard();
  }

  // ── end ──────────────────────────────────────────────────────────────────

  private async end(): Promise<void> {
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

// ─── script export ────────────────────────────────────────────────────────────

let running: Chapter8 | null = null;

const script: ChapterScript = {
  id: 'ch08',
  level: 'ch08',
  start(ctx) {
    running = new Chapter8(ctx);
    running.start();
  },
  dispose() {
    running = null;
  },
};

export default script;
