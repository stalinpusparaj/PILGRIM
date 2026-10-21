/**
 * CHAPTER IX — THE VALLEY OF THE SHADOW OF DEATH (GDD 2.9, 2.10).
 *
 * Beats: two men running back warn him off (short talk) → the lantern is the only
 * light (Hope drains in the 'shadowValley' zone) → smoky shadow blobs with ember eyes
 * nudge him off the path → italic whisper toasts → at the smoking pit only Prayer
 * pushes the smoke back → a voice ahead recites Psalm 23:4 (someone else on the road)
 * → dawn breaks; the trap section is now visible → end trigger.
 *
 * No companions (GDD: "goes on alone") so the Hope drain is amplified by the 'alone'
 * flag that remains set since ch02.
 *
 * Positions come from the level file: triggers 'valley_enter', 'two_men_warn',
 * 'whisper_zone_1'…'whisper_zone_4', 'ember_pit_near', 'voice_ahead',
 * 'dawn_breaks', 'trap_section', 'ch09_end'.
 */
import type { ChapterContext, ChapterScript } from './types';

// ─── constants ────────────────────────────────────────────────────────────────

const WHISPERS = [
  'ch09.whisper.turnBack',
  'ch09.whisper.tooSmall',
  'ch09.whisper.goHome',
  'ch09.whisper.notEnough',
] as const;

// ─── chapter class ────────────────────────────────────────────────────────────

class Chapter9 {
  private whisperIdx = 0;
  private pitDone = false;
  private ending = false;

  constructor(private readonly ctx: ChapterContext) {}

  start(): void {
    const ctx = this.ctx;

    this.pitDone = ctx.state.flag('ch09.pitDone') === true;
    const dawnBroken = ctx.state.flag('ch09.dawnBroken') === true;

    ctx.objective('ch09.objective.crossValley');
    ctx.music('valley', 'sad');
    ctx.ambience('valley');

    // ── valley entrance ─────────────────────────────────────────────────────
    ctx.onTrigger('valley_enter', () => {
      ctx.toast('ch09.toast.dark');
    });

    // ── two men warning ─────────────────────────────────────────────────────
    ctx.onTrigger('two_men_warn', () => {
      void ctx.talk('ch09_two_men', { with: 'two_men_a' });
    });

    // ── whisper triggers (italic thought bubbles) ───────────────────────────
    for (let i = 1; i <= 4; i++) {
      ctx.onTrigger(`whisper_zone_${i}`, () => this.showWhisper(), { once: false });
    }

    // ── zone: entering/leaving the deep shadow ──────────────────────────────
    ctx.onZone(
      'shadowValley',
      () => {
        ctx.music('valley', 'sad');
        ctx.objective('ch09.objective.keepGoing');
      },
      () => {
        if (!this.ending) ctx.music('valley', 'calm');
      },
    );

    // ── smoking pit ─────────────────────────────────────────────────────────
    ctx.onTrigger('ember_pit_near', () => {
      if (this.pitDone) return;
      ctx.objective('ch09.objective.prayPath');
      ctx.toast('ch09.toast.smokingPit');
    });

    ctx.onTrigger('ember_pit_clear', () => {
      if (!this.pitDone) {
        this.pitDone = true;
        ctx.state.setFlag('ch09.pitDone', true);
        ctx.objective('ch09.objective.keepGoing');
      }
    });

    // ── voice ahead (Psalm 23:4) ─────────────────────────────────────────────
    ctx.onTrigger('voice_ahead', () => {
      void ctx.talk('ch09_voice_ahead');
    });

    // ── dawn breaks ─────────────────────────────────────────────────────────
    ctx.onTrigger('dawn_breaks', () => void this.onDawn());

    // Restore post-dawn state
    if (dawnBroken) {
      ctx.music('pilgrim', 'calm');
      ctx.ambience('birdsong');
      ctx.objective('ch09.objective.trapSection');
    }

    // ── trap section hints ───────────────────────────────────────────────────
    ctx.onTrigger('trap_section', () => {
      if (ctx.state.flag('ch09.dawnBroken') === true) {
        ctx.toast('ch09.toast.traps');
      }
    });

    // ── chapter end ──────────────────────────────────────────────────────────
    ctx.onTrigger('ch09_end', () => void this.end(), { once: false });
  }

  // ── whisper toasts cycle ─────────────────────────────────────────────────

  private showWhisper(): void {
    this.ctx.toast(WHISPERS[this.whisperIdx % WHISPERS.length]!);
    this.whisperIdx++;
  }

  // ── dawn ─────────────────────────────────────────────────────────────────

  private async onDawn(): Promise<void> {
    if (this.ctx.state.flag('ch09.dawnBroken') === true) return;
    this.ctx.state.setFlag('ch09.dawnBroken', true);

    const ctx = this.ctx;
    ctx.music('pilgrim', 'calm');
    ctx.ambience('birdsong');
    ctx.toast('ch09.toast.dawn');
    ctx.objective('ch09.objective.trapSection');

    await ctx.wait(1.0);
    if (ctx.session.isDisposed) return;

    await ctx.talk('ch09_dawn_praise');
  }

  // ── end ──────────────────────────────────────────────────────────────────

  private async end(): Promise<void> {
    if (this.ending) return;
    this.ending = true;
    const ctx = this.ctx;
    ctx.objective(null);
    await ctx.talk('ch09_end_talk');
    ctx.complete();
  }
}

// ─── script export ────────────────────────────────────────────────────────────

let running: Chapter9 | null = null;

const script: ChapterScript = {
  id: 'ch09',
  level: 'ch09',
  start(ctx) {
    running = new Chapter9(ctx);
    running.start();
  },
  dispose() {
    running = null;
  },
};

export default script;
