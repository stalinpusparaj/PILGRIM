/**
 * Chapter X beat 2 (GDD 2.10): Talkative joins and cannot stop talking. His bubbles overlap and pile up comically
 * over his head; then Christian asks him questions (content/dialogue/ch10.json 'ch10_talkative'). Easy questions
 * only start him off again; the one that shows he only talks ("Do you do the good things you talk about?") sends
 * him off in a huff. He wanders away from the road and is gone.
 *
 * Level: trigger 'talkative_meets', NPC 'talkative'.
 */
import * as THREE from 'three';
import { services } from '../core/Services';
import type { ChapterContext } from './types';

const PILE = ['ch10.talkative.pile.1', 'ch10.talkative.pile.2', 'ch10.talkative.pile.3', 'ch10.talkative.pile.4', 'ch10.talkative.pile.5'];
/** Seconds between his piled-up lines (faster than anyone could read them: that is the joke). */
const GAP = 0.6;
/** How far he wanders off the road before he disappears (m). */
const WANDER = 14;

export class TalkativeBeat {
  constructor(private readonly ctx: ChapterContext) {}

  start(): void {
    const ctx = this.ctx;
    if (ctx.state.flag('ch10.talkativeDone') === true) {
      this.gone();
      return;
    }
    ctx.onTrigger('talkative_meets', () => void this.chatter());
  }

  private async chatter(): Promise<void> {
    const ctx = this.ctx;
    const t = ctx.npc('talkative');
    if (!t) return;
    t.lookAt(() => ctx.session.player.renderPosition.clone().setY(ctx.session.player.renderPosition.y + 1.5));
    t.character.animator.overlay('talk');
    const bubbles = services.tryGet('bubbles');
    for (const key of PILE) {
      bubbles?.speak(t.character, key, { pile: true, durationSec: 5, mood: 'excited', cps: 60 });
      await ctx.wait(GAP);
      if (ctx.session.isDisposed) return;
    }
    await ctx.wait(2.2);
    if (ctx.session.isDisposed) return;
    bubbles?.clear();
    t.character.animator.overlay(null);
    await ctx.talk('ch10_talkative', { with: 'talkative' });
    if (ctx.session.isDisposed) return;
    ctx.state.setFlag('ch10.talkativeDone', true);
    ctx.state.meet('talkative');
    ctx.toast('ch10.toast.talkativeLeaves');
    t.lookAt(null);
    // Off the road, away from the pilgrims, and gone.
    const way = ctx.session.world.ways.main;
    const hit = way.closest(t.position.x, t.position.z);
    const away = new THREE.Vector3(t.position.x - hit.point.x, 0, t.position.z - hit.point.z);
    if (away.lengthSq() < 0.01) away.set(0, 0, 1);
    away.normalize().multiplyScalar(WANDER).add(t.position);
    away.y = ctx.session.world.terrain.heightAt(away.x, away.z);
    await t.walkTo(away);
    this.gone();
  }

  private gone(): void {
    const t = this.ctx.npc('talkative');
    if (t) t.character.root.visible = false;
  }
}
