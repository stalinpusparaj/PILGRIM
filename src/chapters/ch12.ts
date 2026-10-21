/**
 * CHAPTER XII — THE DELECTABLE MOUNTAINS AND ENCHANTED GROUND (GDD 2.10).
 *
 * Beats: shepherds welcome → looking glass at viewpoint → shepherds warn about Flatterer
 * → Ignorance meets → fork in road (correct path or net trap) → Atheist laughs
 * → enchanted ground (sleepy Hope drain) → Hopeful's story keeps them awake → end.
 */
import type { ChapterContext, ChapterScript } from './types';


class Chapter12 {
  private shepherdsDone = false;
  private forkDone = false;
  private enchanted = false;
  private ending = false;

  constructor(private readonly ctx: ChapterContext) {}

  start(): void {
    const ctx = this.ctx;
    this.shepherdsDone = ctx.state.flag('ch12.shepherdsDone') === true;
    this.forkDone = ctx.state.flag('ch12.forkDone') === true;

    ctx.objective('ch12.objective.climbMountains');
    ctx.music('mountains', 'calm');
    ctx.ambience('birdsong');

    // Hopeful companion (from ch10)
    ctx.addCompanion('hopeful', {
      idle: ['bark.ch10.hopeful.idle.1', 'bark.ch10.hopeful.idle.2'],
      cheer: ['bark.ch10.hopeful.cheer.1', 'bark.ch10.hopeful.cheer.2'],
      lowHope: ['bark.ch10.hopeful.lowHope.1'],
    });

    // ── Shepherds welcome ────────────────────────────────────────────────────
    ctx.onTrigger('shepherds_meet', () => {
      if (this.shepherdsDone) return;
      this.shepherdsDone = true;
      ctx.state.setFlag('ch12.shepherdsDone', true);
      void ctx.talk('ch12_knowledge', { with: 'knowledge' })
        .then(() => ctx.talk('ch12_experience', { with: 'experience' }))
        .then(() => ctx.talk('ch12_watchful_s', { with: 'watchful_s' }))
        .then(() => ctx.talk('ch12_sincere', { with: 'sincere' }))
        .then(() => {
          ctx.objective('ch12.objective.lookGlass');
          ctx.toast('ch12.toast.shepherdWarning');
        });
    });

    // ── Viewpoint / Looking Glass ────────────────────────────────────────────
    ctx.onInteract({
      id: 'looking_glass_use',
      pos: ctx.landmark('viewpoint') ?? { x: 0, y: 0, z: 0 } as unknown as import('three').Vector3,
      radius: 3,
      verb: 'ui.verb.look',
      enabled: true,
      onUse: () => {
        ctx.toast('ch12.toast.lookingGlass');
        ctx.objective('ch12.objective.followWay');
      },
    });

    // ── Ignorance ────────────────────────────────────────────────────────────
    ctx.onTrigger('ignorance_meets', () => {
      void ctx.talk('ch12_ignorance', { with: 'ignorance' });
    });

    // ── Fork in road ─────────────────────────────────────────────────────────
    ctx.onTrigger('fork_correct', () => {
      if (this.forkDone) return;
      this.forkDone = true;
      ctx.state.setFlag('ch12.forkDone', true);
      ctx.state.unlock('sharpEyes');
      ctx.toast('ch12.toast.correctPath');
    });

    ctx.onTrigger('fork_flatterer', () => {
      void ctx.talk('ch12_flatterer_warn', { with: 'flatterer' }).catch(() => {
        ctx.toast('ch12.toast.flattererNet');
        ctx.state.enterDetour('flatterer_road');
      });
    });

    ctx.onTrigger('net_trap', () => {
      ctx.state.enterDetour('flatterer_road');
      ctx.toast('ch12.toast.flattererNet');
      void ctx.wait(3).then(() => {
        ctx.toast('ch12.toast.shiningOneFrees');
      });
    });

    // ── Atheist ──────────────────────────────────────────────────────────────
    ctx.onTrigger('atheist_near', () => {
      ctx.toast('ch12.toast.atheistLaughs');
    });

    // ── Enchanted ground warning ─────────────────────────────────────────────
    ctx.onTrigger('enchanted_warning', () => {
      ctx.toast('ch12.toast.enchantedGround');
      ctx.objective('ch12.objective.stayAwake');
    });

    // ── Enchanted ground zone ────────────────────────────────────────────────
    ctx.onZone(
      'enchantedGround',
      () => {
        this.enchanted = true;
        ctx.music('mountains', 'sad');
      },
      () => {
        this.enchanted = false;
        if (!this.ending) ctx.music('mountains', 'calm');
      },
    );

    // ── Hopeful's story ──────────────────────────────────────────────────────
    ctx.onInteract({
      id: 'hopeful_talk_enchanted',
      pos: ctx.session.player.renderPosition,
      radius: 5,
      verb: 'ui.verb.talk',
      enabled: true,
      onUse: () => {
        if (!this.enchanted) return;
        void ctx.talk('ch12_hopeful_talk', { with: 'hopeful' }).then(() => {
          ctx.state.addHope(15);
        });
      },
    });

    // ── Chapter end ──────────────────────────────────────────────────────────
    ctx.onTrigger('ch12_end', () => {
      if (this.ending) return;
      this.ending = true;
      ctx.complete();
    });
  }
}

const script: ChapterScript = {
  id: 'ch12',
  level: 'ch12',
  start(ctx: ChapterContext) {
    const ch = new Chapter12(ctx);
    ch.start();
  },
};

export default script;
