/**
 * Chapter X beat 4 (GDD 2.10, 2.7.8 "Fair stalls"): Vanity Fair. Stall-keepers call out as the pilgrims pass;
 * "[E] Look" at a stall for its offer, "Yes please" or "No thank you". Every "Yes please" puts a small sack of fair
 * things on Christian's back for the rest of the chapter (each one slows him a little) and Faithful sighs. The
 * crowd stares at the pilgrims' strange clothes. In the middle of the street the crier asks what they will buy:
 * "We buy the truth." (Bunyan) — and calls the guards (the arrest, ch10-trial.ts).
 *
 * Level: NPCs 'keeper_<stall>' (STALLS), 'crier'; trigger 'buy_truth'; zones of type 'crowd' (the square's crowd,
 * `day: "cage"`, only stands there while the pilgrims are caged).
 * The chapter owns `player.speedScale` (no mud in Ch X); dispose() puts it back to 1 and frees the sacks.
 */
import * as THREE from 'three';
import '../audio/events';
import { events } from '../core/Events';
import { services } from '../core/Services';
import { lowSphere, merge, part, cylinder } from '../gen/geom';
import { mat } from '../gen/materials';
import { buildCrowd, type CrowdSet } from './ch10-kit';
import type { ChapterContext } from './types';

export const STALLS = ['games', 'sweets', 'hats', 'trinkets'] as const;
export type Stall = (typeof STALLS)[number];
/** Each sack takes this share of his speed (the most: MAX_BAGS of them). */
export const BAG_SLOW = 0.1;
const MAX_BAGS = 4;
/** "[E] Look" reaches the keeper from this far (m): generous, he stands in front of his counter. */
const LOOK_REACH = 3.4;
/** A keeper calls out once when Christian comes this close (m). */
const CALL_NEAR = 7;

export class Fair {
  private readonly crowds: CrowdSet[] = [];
  private readonly sacks: THREE.Mesh[] = [];
  private readonly called = new Set<string>();
  private time = 0;
  private bags = 0;

  constructor(
    private readonly ctx: ChapterContext,
    private readonly onArrest: () => void,
  ) {}

  /** Sacks on his back right now. */
  get bagCount(): number {
    return this.bags;
  }

  start(arrested: boolean): void {
    const ctx = this.ctx;
    for (const z of ctx.level.zones) {
      if (z.type !== 'crowd') continue;
      const square = z['day'] === 'cage';
      this.crowds.push(buildCrowd(ctx, z, square, !square));
    }
    ctx.own(() => this.dispose());
    for (const id of STALLS) if (ctx.state.flag(`ch10.yes.${id}`) === true) this.addSack(false);
    if (arrested) return;
    for (const id of STALLS) this.offer(id);
    ctx.onTrigger('fair_enter', () => {
      ctx.music('vanity', 'calm');
      ctx.ambience('fair');
      ctx.objective('ch10.objective.throughFair');
      ctx.toast('ch10.toast.enterFair');
      void ctx.wait(4).then(() => ctx.toast('ch10.toast.stares'));
    });
    ctx.onTrigger('buy_truth', () => void this.buyTruth());
  }

  /** Day crowds in the street; the square's crowd while the pilgrims are caged. */
  setCrowds(street: boolean, square: boolean): void {
    for (const c of this.crowds) c.setVisible(c.zoneId === 'crowd_square' ? square : street);
  }

  update(dt: number): void {
    this.time += dt;
    for (const c of this.crowds) c.update(this.time);
    this.ctx.session.player.speedScale = 1 - BAG_SLOW * this.bags;
    this.callOut();
  }

  /** "[E] Look" at a stall: the keeper's offer, yes or no. */
  private offer(id: Stall): void {
    const ctx = this.ctx;
    const keeper = ctx.npc(`keeper_${id}`);
    if (!keeper) return;
    if (ctx.state.flag(`ch10.yes.${id}`) === true || ctx.state.flag(`ch10.no.${id}`) === true) return;
    const pos = keeper.position.clone();
    const off = ctx.onInteract({
      id: `stall_${id}`,
      pos,
      radius: LOOK_REACH,
      height: 1.6,
      verb: 'ui.verb.look',
      enabled: true,
      onUse: () => {
        off();
        void ctx.talk(`ch10_stall_${id}`, { with: `keeper_${id}` }).then(() => {
          if (ctx.state.flag(`ch10.yes.${id}`) === true) this.addSack(true);
        });
      },
    });
  }

  /** Keepers call their wares once each as he comes near. */
  private callOut(): void {
    const ctx = this.ctx;
    if (ctx.state.flag('ch10.arrested') === true) return;
    const p = ctx.session.player.renderPosition;
    for (const id of STALLS) {
      if (this.called.has(id)) continue;
      const k = ctx.npc(`keeper_${id}`);
      if (!k || k.position.distanceTo(p) > CALL_NEAR) continue;
      this.called.add(id);
      k.lookAt(() => p.clone().setY(p.y + 1.5));
      k.character.animator.overlay('wave');
      services.tryGet('bubbles')?.show(k.character, `ch10.keeper.call.${id}`, { mood: 'excited', durationSec: 2.5 });
      void ctx.wait(3).then(() => k.character.animator.overlay(null));
    }
  }

  /** A sack of fair things on his back: heavier, slower; Faithful sighs. */
  private addSack(fresh: boolean): void {
    if (this.bags >= MAX_BAGS) return;
    const c = this.ctx.session.player.character;
    const i = this.bags++;
    const g = merge([
      part(lowSphere(0.16, 1), ['#C9A66B', '#B5915A', '#D8B880', '#A8854E'][i % 4]!, { scale: [1, 1.15, 0.9] }),
      part(cylinder(0.05, 0.07, 0.08, 6), '#8A6A3A', { pos: [0, 0.18, 0] }),
    ]);
    const sack = new THREE.Mesh(g, mat('lambert'));
    sack.name = 'ch10:sack';
    sack.position.set((i % 2 === 0 ? -1 : 1) * 0.13, -0.05 + Math.floor(i / 2) * 0.24, -0.16);
    c.attach(sack, 'back');
    this.sacks.push(sack);
    if (!fresh) return;
    const at = this.ctx.session.player.renderPosition;
    events.emit('sfx', { id: 'burden_boing', at: [at.x, at.y + 1, at.z], pitch: 1.4, volume: 0.6 });
    if (this.bags === 1) this.ctx.toast('ch10.toast.bag');
    const f = this.ctx.npc('faithful');
    if (f) services.tryGet('bubbles')?.show(f.character, 'ch10.faithful.sigh', { mood: 'sad', durationSec: 2.5 });
  }

  /** "What will you buy?" — "We buy the truth." Then the guards. */
  private async buyTruth(): Promise<void> {
    const ctx = this.ctx;
    if (ctx.state.flag('ch10.arrested') === true) return;
    await ctx.talk('ch10_buy_truth', { with: 'crier' });
    if (ctx.session.isDisposed) return;
    this.onArrest();
  }

  private dispose(): void {
    for (const c of this.crowds) c.dispose();
    this.crowds.length = 0;
    for (const s of this.sacks) {
      s.removeFromParent();
      s.geometry.dispose();
    }
    this.sacks.length = 0;
    if (!this.ctx.session.isDisposed) this.ctx.session.player.speedScale = 1;
  }
}
