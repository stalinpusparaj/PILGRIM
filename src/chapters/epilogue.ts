/**
 * EPILOGUE — CHRISTIANA (GDD 2.10, Bunyan Part II).
 *
 * Beats: Christiana misses Christian → Secret arrives with a letter from the King
 * → Christiana looks at the four boys and the far light → smiles
 * → title card: "CHRISTIANA'S JOURNEY — coming soon."
 */
import type { ChapterContext, ChapterScript } from './types';

class Epilogue {
  private ending = false;

  constructor(private readonly ctx: ChapterContext) {}

  start(): void {
    const ctx = this.ctx;

    ctx.objective('epilogue.objective.remember');
    ctx.music('pilgrim', 'sad');
    ctx.ambience('birdsong');

    // ── Christiana's opening monologue ───────────────────────────────────────
    ctx.onTrigger('christiana_start', () => {
      void ctx.talk('epilogue_christiana_misses', { with: 'christiana' });
    });

    // ── Secret arrives with the letter ──────────────────────────────────────
    ctx.onTrigger('secret_arrives', () => {
      void ctx.talk('epilogue_secret_letter', { with: 'secret' }).then(() => {
        ctx.objective('epilogue.objective.lookToLight');
        ctx.music('pilgrim', 'calm');
        ctx.toast('epilogue.toast.invitation');
      });
    });

    // ── Far light view: Christiana decides ──────────────────────────────────
    ctx.onTrigger('far_light_view_trig', () => {
      ctx.toast('epilogue.toast.soonCard');
      ctx.music('pilgrim', 'joy');
      void ctx.wait(3).then(() => {
        if (this.ending) return;
        this.ending = true;
        ctx.complete();
      });
    });

    // ── Fallback end trigger ─────────────────────────────────────────────────
    ctx.onTrigger('epilogue_end', () => {
      if (this.ending) return;
      this.ending = true;
      ctx.complete();
    });
  }
}

const script: ChapterScript = {
  id: 'epilogue',
  level: 'epilogue',
  start(ctx: ChapterContext) {
    const ep = new Epilogue(ctx);
    ep.start();
  },
};

export default script;
