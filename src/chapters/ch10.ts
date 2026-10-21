/**
 * CHAPTER X — FAITHFUL AND VANITY FAIR (GDD 2.10).
 *
 * Beats: Faithful joins → pride-trip toast → Talkative talks too much → Evangelist warns
 * → enter the fair → stall choices → arrest → Faithful departs in a chariot of light
 * → sneaking section → Hopeful joins as companion.
 */
import type { ChapterContext, ChapterScript } from './types';

class Chapter10 {
  private faithfulJoined = false;
  private arrested = false;
  private ending = false;

  constructor(private readonly ctx: ChapterContext) {}

  start(): void {
    const ctx = this.ctx;
    this.faithfulJoined = ctx.state.flag('ch10.faithfulJoined') === true;
    this.arrested = ctx.state.flag('ch10.arrested') === true;

    ctx.objective('ch10.objective.openRoad');
    ctx.music('pilgrim', 'calm');
    ctx.ambience('hills');

    // ── Faithful joins ──────────────────────────────────────────────────────
    ctx.onTrigger('faithful_joins', () => {
      if (this.faithfulJoined) return;
      ctx.state.setFlag('ch10.faithfulJoined', true);
      this.faithfulJoined = true;
      void ctx.talk('ch10_faithful_join', { with: 'faithful' }).then(() => {
        ctx.addCompanion('faithful', {
          idle: ['bark.ch10.faithful.idle.1', 'bark.ch10.faithful.idle.2'],
          cheer: ['bark.ch10.faithful.cheer.1'],
        });
        ctx.objective('ch10.objective.walkTogether');
        ctx.state.meet('faithful');
      });
    });

    // ── Talkative meets ─────────────────────────────────────────────────────
    ctx.onTrigger('talkative_meets', () => {
      void ctx.talk('ch10_talkative', { with: 'talkative' }).then(() => {
        ctx.toast('ch10.toast.talkativeLeaves');
      });
    });

    // ── Evangelist warns ────────────────────────────────────────────────────
    ctx.onTrigger('evangelist_warns', () => {
      void ctx.talk('ch10_evangelist_warn', { with: 'evangelist_brief' }).then(() => {
        ctx.objective('ch10.objective.enterFair');
      });
    });

    // ── Enter the fair ─────────────────────────────────────────────────────
    ctx.onTrigger('fair_enter', () => {
      ctx.music('vanity', 'calm');
      ctx.ambience('fair');
      ctx.objective('ch10.objective.throughFair');
      ctx.toast('ch10.toast.enterFair');
    });

    // ── Buy the truth (bubble line from Christian) ──────────────────────────
    ctx.onTalk('faithful', 'ch10_truth_answer', { verb: 'ui.verb.ask', once: false });

    // ── Arrest trigger ──────────────────────────────────────────────────────
    ctx.onTrigger('arrest_trigger', () => {
      if (this.arrested) return;
      this.arrested = true;
      ctx.state.setFlag('ch10.arrested', true);
      ctx.objective('ch10.objective.inCage');
      ctx.toast('ch10.toast.arrested');
      ctx.music('tension', 'tension');
    });

    // ── Faithful departs ────────────────────────────────────────────────────
    ctx.onTrigger('faithful_departs', () => {
      ctx.removeCompanion('faithful');
      ctx.toast('ch10.toast.faithfulDeparts');
      ctx.music('pilgrim', 'sad');
      ctx.objective('ch10.objective.escapeNight');
    });

    // ── Sneaking section ────────────────────────────────────────────────────
    ctx.onTrigger('sneaking_start', () => {
      ctx.toast('ch10.toast.sneakingNight');
      ctx.music('tension', 'tension');
    });

    // ── Hopeful joins ───────────────────────────────────────────────────────
    ctx.onTrigger('hopeful_joins', () => {
      void ctx.talk('ch10_hopeful_join', { with: 'hopeful' }).then(() => {
        ctx.addCompanion('hopeful', {
          idle: ['bark.ch10.hopeful.idle.1', 'bark.ch10.hopeful.idle.2'],
          cheer: ['bark.ch10.hopeful.cheer.1', 'bark.ch10.hopeful.cheer.2'],
          lowHope: ['bark.ch10.hopeful.lowHope.1'],
        });
        ctx.state.meet('hopeful');
        ctx.music('pilgrim', 'calm');
        ctx.objective('ch10.objective.pressOn');
      });
    });

    // ── Chapter end ─────────────────────────────────────────────────────────
    ctx.onTrigger('ch10_end', () => {
      if (this.ending) return;
      this.ending = true;
      ctx.complete();
    });
  }
}

const script: ChapterScript = {
  id: 'ch10',
  level: 'ch10',
  start(ctx: ChapterContext) {
    const ch = new Chapter10(ctx);
    ch.start();
  },
};

export default script;
