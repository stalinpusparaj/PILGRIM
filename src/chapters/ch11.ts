/**
 * CHAPTER XI — BY-PATH MEADOW AND DOUBTING CASTLE (GDD 2.10).
 *
 * Beats: by-ends joins briefly → Demas at silver mine → pillar of salt promise
 * → river rest (Hope full) → stile into soft meadow (forced detour) → storm
 * → giant captures them → dungeon (Hopeful encourages) → Key of Promise puzzle
 * (3 locks) → escape in morning sunshine → warning sign.
 */
import type { ChapterContext, ChapterScript } from './types';

const LOCK_IDS = ['cell_door', 'outer_door', 'iron_gate'] as const;

class Chapter11 {
  private lockIdx = 0;
  private dungeonDone = false;
  private ending = false;

  constructor(private readonly ctx: ChapterContext) {}

  start(): void {
    const ctx = this.ctx;
    this.lockIdx = (ctx.state.flag('ch11.lockIdx') as number) || 0;
    this.dungeonDone = ctx.state.flag('ch11.dungeonDone') === true;

    ctx.objective('ch11.objective.pressOn');
    ctx.music('pilgrim', 'calm');
    ctx.ambience('hills');

    // Hopeful companion (joined at end of ch10)
    ctx.addCompanion('hopeful', {
      idle: ['bark.ch10.hopeful.idle.1', 'bark.ch10.hopeful.idle.2'],
      cheer: ['bark.ch10.hopeful.cheer.1', 'bark.ch10.hopeful.cheer.2'],
      lowHope: ['bark.ch10.hopeful.lowHope.1'],
    });

    // ── By-ends ─────────────────────────────────────────────────────────────
    ctx.onTrigger('by_ends_meet', () => {
      void ctx.talk('ch11_by_ends', { with: 'by_ends' });
    });

    // ── Demas at mine (detour) ───────────────────────────────────────────────
    ctx.onTrigger('demas_wave', () => {
      void ctx.talk('ch11_demas', { with: 'demas' });
      ctx.onZone('silverMine', () => {
        ctx.toast('ch11.toast.mineBonk');
        ctx.state.enterDetour('silver_mine');
      });
    });

    // ── Pillar of salt ───────────────────────────────────────────────────────
    ctx.onTrigger('pillar_salt', () => {
      ctx.toast('ch11.toast.pillarSalt');
    });

    // ── River rest ───────────────────────────────────────────────────────────
    ctx.onTrigger('river_reach', () => {
      ctx.state.addHope(100 - ctx.state.hope);
      ctx.toast('ch11.toast.riverRest');
    });

    // ── Stile into meadow (forced detour) ────────────────────────────────────
    ctx.onTrigger('stile_cross', () => {
      ctx.state.enterDetour('stile_meadow');
      ctx.objective('ch11.objective.storm');
      ctx.toast('ch11.toast.softMeadow');
    });

    ctx.onTrigger('storm_trigger', () => {
      ctx.music('despair', 'tension');
      ctx.ambience('rain');
      ctx.toast('ch11.toast.storm');
      ctx.objective('ch11.objective.shelter');
    });

    // ── Dungeon ──────────────────────────────────────────────────────────────
    ctx.onTrigger('dungeon_door', () => {
      if (this.dungeonDone) return;
      ctx.music('despair', 'sad');
      ctx.ambience('dungeon');
      ctx.objective('ch11.objective.findWayOut');
      ctx.toast('ch11.toast.dungeon');
      void ctx.talk('ch11_giant_stomp', { with: 'giant_despair' }).then(() => {
        void ctx.talk('ch11_hopeful_encourage', { with: 'hopeful' });
      });
      this.startLockPuzzle();
    });
  }

  private startLockPuzzle(): void {
    const ctx = this.ctx;
    if (this.lockIdx >= LOCK_IDS.length) {
      this.escape();
      return;
    }

    const lockId = LOCK_IDS[this.lockIdx]!;

    // After 90 s give a hint from Hopeful
    void ctx.wait(90).then(() => {
      if (this.lockIdx < LOCK_IDS.length) {
        void ctx.talk('ch11_key_hint', { with: 'hopeful' });
      }
    });

    ctx.onTrigger(lockId, () => {
      if (!ctx.state.data.carried.includes('key_promise')) {
        ctx.toast('ch11.toast.needKey');
        return;
      }
      this.lockIdx++;
      ctx.state.setFlag('ch11.lockIdx', this.lockIdx);
      if (this.lockIdx >= LOCK_IDS.length) {
        this.dungeonDone = true;
        ctx.state.setFlag('ch11.dungeonDone', true);
        this.escape();
      } else {
        ctx.toast('ch11.toast.lockOpen');
      }
    });
  }

  private escape(): void {
    const ctx = this.ctx;
    ctx.objective('ch11.objective.runFromGiant');
    ctx.music('pilgrim', 'joy');
    ctx.ambience('hills');
    ctx.toast('ch11.toast.giantFreezes');

    ctx.onTrigger('escape_trigger', () => {
      ctx.toast('ch11.toast.warningSign');
    });

    ctx.onTrigger('ch11_end', () => {
      if (this.ending) return;
      this.ending = true;
      ctx.complete();
    });
  }
}

const script: ChapterScript = {
  id: 'ch11',
  level: 'ch11',
  start(ctx: ChapterContext) {
    const ch = new Chapter11(ctx);
    ch.start();
  },
};

export default script;
