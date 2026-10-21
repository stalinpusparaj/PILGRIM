/**
 * CHAPTER XII — THE DELECTABLE MOUNTAINS AND ENCHANTED GROUND (GDD 2.10).
 *
 * Beats: shepherds welcome → looking glass at viewpoint → shepherds warn about Flatterer
 * → Ignorance meets → fork in road (correct path or net trap) → Atheist laughs
 * → enchanted ground (sleepy Hope drain) → Hopeful's story keeps them awake → end.
 */
import '../audio/events';
import { events } from '../core/Events';
import type { ChapterContext, ChapterScript } from './types';

/** Sitting on a sleepy couch costs this much Hope and wakes him at the last waystone (GDD 2.7.8). */
const COUCH_HOPE = -40;
const COUCHES = ['sleepy_couch_1', 'sleepy_couch_2'] as const;

class Chapter12 {
  private shepherdsDone = false;
  private forkDone = false;
  private enchanted = false;
  private ending = false;
  private removeHopefulTalk: (() => void) | null = null;

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
      void ctx
        .talk('ch12_knowledge', { with: 'knowledge' })
        .then(() => ctx.talk('ch12_experience', { with: 'experience' }))
        .then(() => ctx.talk('ch12_watchful_s', { with: 'watchful_s' }))
        .then(() => ctx.talk('ch12_sincere', { with: 'sincere' }))
        .then(() => {
          ctx.objective('ch12.objective.lookGlass');
          ctx.toast('ch12.toast.shepherdWarning');
        });
    });

    // ── Viewpoint / Looking Glass ────────────────────────────────────────────
    const viewpoint = ctx.landmark('viewpoint_sign');
    if (viewpoint) {
      ctx.onInteract({
        id: 'looking_glass_use',
        pos: viewpoint,
        radius: 3,
        verb: 'ui.verb.look',
        enabled: true,
        onUse: () => {
          ctx.toast('ch12.toast.lookingGlass');
          ctx.objective('ch12.objective.followWay');
        },
      });
    }
    ctx.onTrigger('viewpoint_reach', () => ctx.objective('ch12.objective.lookGlass'));

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
      void ctx.talk('ch12_flatterer', { with: 'flatterer' });
    });

    // Following the Flatterer: a net drops, a Shining One cuts them free and sets them back at the fork.
    ctx.onTrigger('net_trap', () => void this.netTrap(), { once: false });

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
    // Talking with Hopeful keeps them awake: [E] Talk on him only while on the Enchanted Ground.
    ctx.onZone(
      'sleepy',
      () => {
        if (this.enchanted) return;
        this.enchanted = true;
        ctx.music('mountains', 'sad');
        ctx.objective('ch12.objective.stayAwake');
        this.removeHopefulTalk ??= ctx.onTalk(
          'hopeful',
          () => ctx.talk('ch12_hopeful_talk', { with: 'hopeful' }).then(() => ctx.state.addHope(15)),
          { once: false },
        );
      },
      () => {
        this.enchanted = false;
        this.removeHopefulTalk?.();
        this.removeHopefulTalk = null;
        if (!this.ending) ctx.music('mountains', 'calm');
      },
    );

    for (const id of COUCHES) {
      const pos = ctx.landmark(id);
      if (!pos) continue;
      ctx.onInteract({
        id,
        pos,
        radius: 2.2,
        verb: 'ui.verb.sit',
        enabled: true,
        onUse: () => void this.couch(),
      });
    }

    // ── Chapter end ──────────────────────────────────────────────────────────
    ctx.onTrigger('ch12_end', () => {
      if (this.ending) return;
      this.ending = true;
      ctx.complete();
    });
  }

  private async netTrap(): Promise<void> {
    const ctx = this.ctx;
    const player = ctx.session.player;
    if (player.mode !== 'play') return;
    ctx.state.enterDetour('flatterer_road');
    events.emit('sfx', { id: 'net_drop' });
    ctx.toast('ch12.toast.flattererNet');
    player.mode = 'locked';
    await ctx.wait(3);
    if (ctx.session.isDisposed) return;
    const fork = ctx.level.triggers.find((t) => t.id === 'fork_correct');
    if (fork) ctx.session.teleport(fork.at[0], fork.at[2]);
    player.mode = 'play';
    ctx.toast('ch12.toast.shiningOneFrees');
  }

  /** The soft cushions: he falls asleep and wakes at the last waystone with less Hope. */
  private async couch(): Promise<void> {
    const ctx = this.ctx;
    const player = ctx.session.player;
    if (player.mode !== 'play') return;
    player.mode = 'locked';
    player.character.animator.play('nap');
    ctx.toast('ch12.toast.fellAsleep');
    await ctx.wait(2.5);
    if (ctx.session.isDisposed) return;
    ctx.state.addHope(COUCH_HOPE);
    ctx.session.respawn(ctx.state.waystone || null);
    player.character.animator.play('idle');
    player.mode = 'play';
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
