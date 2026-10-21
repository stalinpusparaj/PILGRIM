/**
 * CHAPTER VI — THE CROSS (GDD 2.10, GDD 2.7.1).
 *
 * Beats: slow burdened climb up the narrow hill → [E] Kneel at the Cross → the full
 * Cross-drop sequence (PlaySession.crossDrop) → the key_promise is quietly added
 * (GDD 2.7.6) → three Shining Ones give the Roll, new clothes and a glowing mark →
 * 20 s of free meadow running → the sleepers (Simple, Sloth, Presumption) are funny
 * and impossible to wake → Formalist and Hypocrisy tumble over the wall → end trigger.
 */
import * as THREE from 'three';
import type { ChapterContext, ChapterScript } from './types';

// ─── chapter class ────────────────────────────────────────────────────────────

class Chapter6 {
  private crossDone = false;
  private ending = false;
  private removeKneel: (() => void) | null = null;
  private sleepersReady = false;

  constructor(private readonly ctx: ChapterContext) {}

  start(): void {
    const ctx = this.ctx;

    this.crossDone = ctx.state.flag('ch06.crossDone') === true;

    ctx.objective('ch06.objective.climbHill');
    ctx.music('burden', 'calm');
    ctx.ambience('birdsong');

    ctx.onTrigger('hill_base', () => {
      ctx.toast('ch06.toast.narrowWay');
    });

    ctx.onTrigger('cross_near', () => {
      if (!this.crossDone) {
        ctx.objective('ch06.objective.crossKneel');
        ctx.guide({ landmark: 'the_cross' });
        this.installKneelInteract();
      }
    });

    ctx.onTrigger('sleepers_near', () => {
      if (this.crossDone) ctx.toast('ch06.toast.sleepers');
    });

    // Formalist and Hypocrisy tumble over the wall instead of using the gate.
    ctx.onTrigger(
      'wall_jumpers',
      () => {
        if (this.crossDone) void ctx.talk('ch06_formalist', { with: 'formalist' });
      },
      { once: false },
    );

    ctx.onTrigger('ch06_end', () => void this.end(), { once: false });

    // Restore state if we reloaded after the Cross
    if (this.crossDone) {
      ctx.objective('ui.hud.objective.followLight');
      ctx.guide(null);
      ctx.music('pilgrim', 'joy');
      if (ctx.session.player.character.recipe.id !== 'christian_free')
        ctx.session.player.setRecipe('christian_free');
      this.installSleepers();
    }
  }

  // ── install the [E] Kneel interactable near the Cross ──────────────────────

  private installKneelInteract(): void {
    const ctx = this.ctx;
    const pos = ctx.landmark('the_cross') ?? new THREE.Vector3();
    this.removeKneel = ctx.onInteract({
      id: 'cross_kneel',
      pos,
      radius: 3.0,
      height: 1.8,
      verb: 'ui.verb.kneel',
      enabled: true,
      onUse: () => void this.doCrossDrop(),
    });
  }

  // ── the Cross-drop sequence ─────────────────────────────────────────────────

  private async doCrossDrop(): Promise<void> {
    if (this.crossDone) return;
    this.crossDone = true;
    this.removeKneel?.();
    this.removeKneel = null;

    const ctx = this.ctx;
    ctx.objective(null);
    ctx.guide(null);

    // Slow the music to silence, then the full procedural sequence
    await ctx.session.crossDrop();

    if (ctx.session.isDisposed) return;

    // Quietly give the key (GDD 2.7.6: "no message")
    ctx.state.giveGift('key_promise', /* quiet */ true);
    ctx.state.setFlag('ch06.crossDone', true);

    // Joy music and the Shining Ones' talk
    ctx.music('pilgrim', 'joy');
    await ctx.talk('ch06_shining_ones');

    if (ctx.session.isDisposed) return;
    // The white clothes with gold trim and the mark on his forehead (sparkle outfit swap).
    ctx.session.player.setRecipe('christian_free');

    ctx.toast('ch06.toast.freeAtLast');
    ctx.objective('ui.hud.objective.followLight');
    this.installSleepers();
  }

  // ── sleepers ────────────────────────────────────────────────────────────────

  private installSleepers(): void {
    if (this.sleepersReady) return;
    this.sleepersReady = true;
    for (const id of ['simple', 'sloth', 'presumption'] as const) {
      this.ctx.onTalk(id, `ch06_${id}`, { once: false });
    }
  }

  // ── end ─────────────────────────────────────────────────────────────────────

  private async end(): Promise<void> {
    if (this.ending) return;
    if (!this.crossDone) {
      this.ctx.toast('ch06.toast.notYet');
      return;
    }
    this.ending = true;
    this.ctx.objective(null);
    this.ctx.complete();
  }
}

// ─── script export ────────────────────────────────────────────────────────────

let running: Chapter6 | null = null;

const script: ChapterScript = {
  id: 'ch06',
  level: 'ch06',
  start(ctx) {
    running = new Chapter6(ctx);
    running.start();
  },
  dispose() {
    running = null;
  },
};

export default script;
