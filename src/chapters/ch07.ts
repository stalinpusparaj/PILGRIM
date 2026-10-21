/**
 * CHAPTER VII — HILL DIFFICULTY AND PALACE BEAUTIFUL (GDD 2.10, GDD 2.7.6).
 *
 * Beats: drink at the spring → Formalist and Hypocrisy take side paths (barks) →
 * steep climb (switchbacks, ledges) → the arbour halfway (sitting loses the Roll) →
 * Timorous and Mistrust run past → lions at the top (Watchful: keep to the middle) →
 * Palace: four sisters' optional chats + Promises → sleep in the room called Peace →
 * armoury: all six armour gifts, one by one → courtyard practice hints → roof
 * viewpoint of the mountains ahead → end trigger.
 *
 * Positions come from the level file: landmarks 'spring_well', 'arbour_bench',
 * 'palace_gate', 'roof_viewpoint'; triggers 'spring_arrive', 'detour_warning',
 * 'arbour_reach', 'roll_bench', 'lion_zone', 'palace_enter', 'armoury_trigger',
 * 'roof_arrive', 'ch07_end'.
 */
import * as THREE from 'three';
import type { GiftId } from '../core/GameState';
import type { ChapterContext, ChapterScript } from './types';

// ─── constants ────────────────────────────────────────────────────────────────

/** Order that the armoury gives gifts (GDD 2.7.6 #1–#6). key_promise was given in ch06. */
const ARMOURY_GIFTS: GiftId[] = ['sword', 'shield', 'helmet', 'breastplate', 'shoes', 'prayer'];

/** Delay between gifts so the HUD can show each toast in turn. */
const GIFT_DELAY_S = 1.2;
/** How long the arbour nap lasts before he wakes and the Roll is gone (GDD 2.7.4). */
const NAP_S = 3.5;

// ─── chapter class ────────────────────────────────────────────────────────────

class Chapter7 {
  private rollLost = false;
  private armouryDone = false;
  private ending = false;
  private removeRollFind: (() => void) | null = null;
  private removeSit: (() => void) | null = null;
  private drank = false;

  constructor(private readonly ctx: ChapterContext) {}

  start(): void {
    const ctx = this.ctx;

    this.rollLost = ctx.state.rollLost;
    this.armouryDone = ctx.state.flag('ch07.armouryDone') === true;

    ctx.objective('ch07.objective.climbHill');
    ctx.music('pilgrim', 'calm');
    ctx.ambience('wind');

    // ── spring at the foot ──────────────────────────────────────────────────
    ctx.onTrigger('spring_arrive', () => {
      ctx.toast('ch07.toast.springHere');
      const pos = ctx.landmark('spring_well');
      if (!pos) return;
      const off = ctx.onInteract({
        id: 'spring_drink',
        pos,
        radius: 2.5,
        verb: 'ui.verb.drink',
        enabled: true,
        onUse: () => {
          if (this.drank) return;
          this.drank = true;
          off();
          ctx.state.addHope(15);
          ctx.toast('ch07.toast.refreshed');
        },
      });
    });

    // ── detour warning ──────────────────────────────────────────────────────
    ctx.onTrigger('detour_warning', () => {
      ctx.toast('ch07.toast.detourWarning');
    });

    // ── arbour ──────────────────────────────────────────────────────────────
    ctx.onTrigger('arbour_reach', () => this.installArbour());

    // Restore the "find Roll" interactable if the player had sat before saving
    if (this.rollLost) this.installRollFind();

    // Timorous and Mistrust come running downhill, yelling about lions.
    ctx.onTrigger('timorous_run', () => {
      void ctx.talk('ch07_timorous', { with: 'timorous' });
    });

    // ── lions ───────────────────────────────────────────────────────────────
    ctx.onTrigger('lion_zone', () => {
      ctx.toast('ch07.toast.keepMiddle');
      void ctx.talk('ch07_watchful_lion', { with: 'watchful_porter' }).then(() => {
        ctx.objective('ch07.objective.keepMiddle');
      });
    });

    // ── palace ──────────────────────────────────────────────────────────────
    ctx.onTrigger('palace_enter', () => {
      ctx.objective('ch07.objective.palace');
      ctx.ambience('candle');
      ctx.music('interpreter', 'calm');
      this.installPalace();
    });

    // ── armoury ──────────────────────────────────────────────────────────────
    ctx.onTrigger('armoury_trigger', () => {
      if (!this.armouryDone) void this.giveArmoury();
    });

    // ── roof viewpoint ───────────────────────────────────────────────────────
    ctx.onTrigger('roof_arrive', () => {
      ctx.toast('ch07.toast.seeTheCity');
    });

    // ── end ──────────────────────────────────────────────────────────────────
    ctx.onTrigger('ch07_end', () => void this.end(), { once: false });
  }

  // ── arbour: sitting loses the Roll ──────────────────────────────────────────

  private installArbour(): void {
    const ctx = this.ctx;
    if (this.rollLost || this.removeSit || !ctx.state.hasRoll) return;
    const pos = ctx.landmark('arbour_bench');
    if (!pos) return;
    this.removeSit = ctx.onInteract({
      id: 'arbour_sit',
      pos,
      radius: 2.5,
      verb: 'ui.verb.sit',
      enabled: true,
      onUse: () => void this.nap(pos),
    });
  }

  /** He sits, naps (Zzz), wakes, and the Roll has slipped under the bench. */
  private async nap(bench: THREE.Vector3): Promise<void> {
    if (this.rollLost) return;
    const ctx = this.ctx;
    this.rollLost = true;
    ctx.state.setFlag('ch07.sat', true);
    this.removeSit?.();
    this.removeSit = null;
    const player = ctx.session.player;
    player.mode = 'locked';
    player.character.animator.play('sit');
    ctx.toast('ch07.toast.restBench');
    await ctx.wait(0.8);
    player.character.animator.play('nap');
    const zzz = bench.clone().setY(bench.y + 1.6);
    for (let t = 0; t < NAP_S; t += 0.7) {
      ctx.session.world.particles.emit('zzz', zzz, 1);
      await ctx.wait(0.7);
    }
    player.character.animator.play('idle');
    player.mode = 'play';
    ctx.state.loseRoll();
    ctx.toast('ui.toast.rollGone');
    ctx.objective('ch07.objective.findRoll');
    this.installRollFind();
  }

  // ── the Roll is under the bench ──────────────────────────────────────────────

  private installRollFind(): void {
    const ctx = this.ctx;
    if (this.removeRollFind) return;
    const pos = ctx.landmark('arbour_bench');
    if (!pos) return;
    this.removeRollFind = ctx.onInteract({
      id: 'roll_find',
      pos,
      radius: 3.0,
      verb: 'ui.verb.pickUp',
      enabled: true,
      onUse: () => {
        ctx.state.findRoll();
        this.rollLost = false;
        this.removeRollFind?.();
        this.removeRollFind = null;
        ctx.toast('ui.toast.rollFound');
        ctx.objective('ch07.objective.climbHill');
      },
    });
  }

  // ── palace: optional talks ────────────────────────────────────────────────

  private installPalace(): void {
    const ctx = this.ctx;
    ctx.onTalk('watchful_porter', 'ch07_watchful');
    ctx.onTalk('discretion', 'ch07_discretion');
    ctx.onTalk('prudence', 'ch07_prudence');
    ctx.onTalk('piety', 'ch07_piety');
    ctx.onTalk('charity', 'ch07_charity');
  }

  // ── armoury: give all six gifts ───────────────────────────────────────────

  private async giveArmoury(): Promise<void> {
    if (this.armouryDone) return;
    const ctx = this.ctx;
    ctx.objective('ch07.objective.armoury');
    await ctx.talk('ch07_armoury_intro');
    if (ctx.session.isDisposed) return;

    for (const gift of ARMOURY_GIFTS) {
      if (!ctx.state.hasGift(gift)) {
        ctx.state.giveGift(gift);
        await ctx.wait(GIFT_DELAY_S);
        if (ctx.session.isDisposed) return;
      }
    }

    this.armouryDone = true;
    ctx.state.setFlag('ch07.armouryDone', true);
    ctx.session.player.setRecipe('christian_armour');
    ctx.toast('ch07.toast.armoury');
    ctx.objective('ch07.objective.practice');
  }

  // ── end ───────────────────────────────────────────────────────────────────

  private async end(): Promise<void> {
    if (this.ending) return;
    this.ending = true;
    const ctx = this.ctx;
    if (this.rollLost) {
      this.ending = false;
      ctx.toast('ui.toast.needRoll');
      ctx.objective('ch07.objective.findRoll');
      return;
    }
    ctx.objective(null);
    if (ctx.state.flag('ch07.sat') !== true) ctx.state.unlock('wideAwake');
    await ctx.talk('ch07_farewell', { with: 'discretion' });
    ctx.complete();
  }
}

// ─── script export ────────────────────────────────────────────────────────────

let running: Chapter7 | null = null;

const script: ChapterScript = {
  id: 'ch07',
  level: 'ch07',
  start(ctx) {
    running = new Chapter7(ctx);
    running.start();
  },
  dispose() {
    running = null;
  },
};

export default script;
