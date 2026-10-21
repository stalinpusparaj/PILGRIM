/**
 * CHAPTER XIII — THE RIVER AND THE CELESTIAL CITY (GDD 2.10).
 *
 * Beats: slow happy walk through Beulah → Shining Ones at the river → wade into
 * the river (Hope = depth mechanic: hold Pray) → Hopeful: "I feel the bottom"
 * → far bank, armour turns to light → climb to the Gate → [E] Show the Roll
 * → gate opens, bells, light fills.
 */
import { ARMOUR_LIGHT_FLAG } from '../player/player-outfit';
import type { ChapterContext, ChapterScript } from './types';

class Chapter13 {
  private riverCrossed = false;
  private ending = false;

  constructor(private readonly ctx: ChapterContext) {}

  start(): void {
    const ctx = this.ctx;
    this.riverCrossed = ctx.state.flag('ch13.riverCrossed') === true;

    ctx.objective('ch13.objective.walkBeulah');
    ctx.music('celestial', 'calm');
    ctx.ambience('river');

    // Hopeful companion (from ch10)
    ctx.addCompanion('hopeful', {
      idle: ['bark.ch10.hopeful.idle.1', 'bark.ch10.hopeful.idle.2'],
      cheer: ['bark.ch10.hopeful.cheer.1', 'bark.ch10.hopeful.cheer.2'],
      lowHope: ['bark.ch10.hopeful.lowHope.1'],
    });

    // ── Beulah walk ──────────────────────────────────────────────────────────
    ctx.onTrigger('beulah_walk', () => {
      ctx.toast('ch13.toast.beulah');
      ctx.music('celestial', 'joy');
    });

    // ── Shining Ones at the river ────────────────────────────────────────────
    ctx.onTrigger('river_reach', () => {
      void ctx.talk('ch13_shining_ones', { with: 'shining_one_a' }).then(() => {
        ctx.objective('ch13.objective.crossRiver');
        ctx.toast('ch13.toast.riverDepth');
      });
    });

    // ── Wading in ────────────────────────────────────────────────────────────
    ctx.onTrigger('river_wade', () => {
      if (this.riverCrossed) return;
      ctx.toast('ch13.toast.prayToStayUp');
      ctx.objective('ch13.objective.prayRiver');
      void ctx.talk('ch13_hopeful_river', { with: 'hopeful' });
    });

    // ── Zone: river ──────────────────────────────────────────────────────────
    ctx.onZone(
      'river',
      () => {
        ctx.music('celestial', 'tension');
      },
      () => {
        if (!this.riverCrossed) {
          this.riverCrossed = true;
          ctx.state.setFlag('ch13.riverCrossed', true);
          ctx.music('celestial', 'joy');
        }
      },
    );

    // ── Far bank ─────────────────────────────────────────────────────────────
    ctx.onTrigger('far_bank', () => {
      ctx.toast('ch13.toast.armourLight');
      // Outfit swap to the light version
      ctx.state.setFlag(ARMOUR_LIGHT_FLAG, true);
      if (!ctx.state.burden) ctx.session.player.setRecipe('christian_free');
      ctx.objective('ch13.objective.climbToGate');
    });

    // ── Gate: Show the Roll ───────────────────────────────────────────────────
    ctx.onTrigger('gate_near', () => {
      ctx.objective('ch13.objective.showRoll');
    });

    const gate = ctx.landmark('celestial_gate');
    if (gate) {
      ctx.onInteract({
        id: 'show_roll_gate',
        pos: gate,
        radius: 3,
        verb: 'ui.verb.showRoll',
        enabled: true,
        onUse: () => {
          if (!ctx.state.data.hasRoll) {
            ctx.toast('ui.toast.needRoll');
            return;
          }
          void ctx.talk('ch13_gate').then(() => {
            ctx.music('celestial', 'joy');
            ctx.toast('ch13.toast.gateOpens');
            void ctx.wait(2).then(() => {
              if (this.ending) return;
              this.ending = true;
              ctx.complete();
            });
          });
        },
      });
    }

    // The last action of the game is "[E] Show the Roll" at the Gate (GDD 2.7.4): walking past it does not end it.
    ctx.onTrigger(
      'ch13_end',
      () => {
        if (this.ending) return;
        ctx.objective('ch13.objective.showRoll');
        ctx.guide({ landmark: 'celestial_gate' });
      },
      { once: false },
    );
  }
}

const script: ChapterScript = {
  id: 'ch13',
  level: 'ch13',
  start(ctx: ChapterContext) {
    const ch = new Chapter13(ctx);
    ch.start();
  },
};

export default script;
