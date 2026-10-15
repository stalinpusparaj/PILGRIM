/**
 * Chapter II, Help (GDD 2.10 Ch II): a big friendly man waiting on the far bank. "[E] Take his hand"
 * (ui.verb.takeHand) works from the mud, so a player who never finds the steps is never stuck (GDD: no fail
 * states): a short cutscene — he reaches down, Christian is pulled up onto the bank (the 'land' clip), the
 * stepping stones that were there all along rise and glow (Slough.reveal()) — then a 3-4 line talk where Help
 * asks, as in Bunyan, why Christian did not look for the steps.
 *
 * While Christian is alone and deep in the mud for a while, Help waves and calls out so the way out is clear.
 * The bank spot is the 'help_bank' landmark; the bog centre comes from the level's 'slough' zone.
 */
import * as THREE from 'three';
import { events } from '../core/Events';
import { services } from '../core/Services';
import type { CutsceneDef } from '../narrative/cutscene-types';
import { SLOUGH_ZONE } from '../world/Slough';
import type { ChapterContext } from './types';

const HAND = { radius: 3.8, above: 0.45, priority: 2 };
/** Sunk at least this deep (m) for this long (s) counts as stuck; Help calls again after the cooldown (s). */
const STUCK = { depth: 0.42, after: 4, cooldown: 25 };
/** Cutscene timing (s). */
const T = { reach: 0, pull: 1.4, land: 1.45, reveal: 2.5, lookOver: 2.6, end: 6.6 };
const CAM = {
  back: 4.5,
  up: 3.4,
  side: 1.6,
  lookAhead: 14,
  lookLift: 0.6,
  chest: 1.0,
  aside: 4.6,
  aheadBack: 0.6,
  eye: 1.2,
  fov: 42,
};

export interface HelpDeps {
  /** Christian is alone in the bog (Pliable has gone). */
  alone(): boolean;
  /** The hand was taken: the steps are up, the talk is done. */
  onHelped(): void;
}

export class HelpBeats {
  private removeHand: (() => void) | null = null;
  private helped = false;
  private busy = false;
  private deepT = 0;
  private callT = 0;
  private calledOnce = false;
  private readonly tmp = new THREE.Vector3();

  constructor(
    private readonly ctx: ChapterContext,
    private readonly deps: HelpDeps,
  ) {}

  get done(): boolean {
    return this.helped;
  }

  /** The [E] Take his hand interactable on Help (he does not move, but the position follows him anyway). */
  install(): void {
    const ctx = this.ctx;
    this.helped = ctx.state.flag('ch02.handTaken') === true;
    if (this.helped) {
      ctx.onTalk('help', 'ch02_help_again');
      return;
    }
    const help = ctx.npc('help');
    if (!help) {
      console.error('[ch02] there is no "help" NPC in the level');
      return;
    }
    this.removeHand = ctx.onInteract({
      id: 'take_hand',
      pos: help.position,
      radius: HAND.radius,
      height: help.character.height + HAND.above,
      verb: 'ui.verb.takeHand',
      enabled: true,
      priority: HAND.priority,
      onUse: () => void this.takeHand(),
    });
  }

  /** Every fixed step: the stuck watcher (alone, deep in the mud, not yet helped). */
  update(dt: number): void {
    if (this.helped || this.busy) return;
    this.callT = Math.max(0, this.callT - dt);
    const session = this.ctx.session;
    const stuck = this.deps.alone() && session.slough.sinking && session.slough.depth >= STUCK.depth;
    this.deepT = stuck ? this.deepT + dt : 0;
    if (this.deepT >= STUCK.after && this.callT <= 0) {
      this.deepT = 0;
      this.callT = STUCK.cooldown;
      this.callOut();
    }
  }

  /** Help waves and calls (a world bubble): the way out is over here. */
  callOut(): void {
    const help = this.ctx.npc('help');
    if (!help || this.helped) return;
    help.character.animator.overlay('wave');
    help.lookAt(() => this.playerHead());
    services.tryGet('bubbles')?.show(help.character, 'ch02.help.call.1', { mood: 'excited' });
    if (!this.calledOnce) {
      this.calledOnce = true;
      this.ctx.objective('ch02.objective.takeHand');
    }
  }

  // --------------------------------------------------------------------------------------------- private

  private playerHead(): THREE.Vector3 {
    const p = this.ctx.session.player.renderPosition;
    return this.tmp.set(p.x, p.y + 1.4, p.z);
  }

  private async takeHand(): Promise<void> {
    if (this.helped || this.busy) return;
    this.busy = true;
    const ctx = this.ctx;
    const help = ctx.npc('help');
    const bank = ctx.landmark('help_bank');
    if (!help || !bank) {
      console.error('[ch02] Help needs the "help" NPC and the "help_bank" landmark');
      this.busy = false;
      return;
    }
    this.removeHand?.();
    this.removeHand = null;
    help.character.animator.overlay(null);
    help.lookAt(() => this.playerHead());
    await ctx.cutscene(this.handCutscene(help.position, bank));
    help.lookAt(null);
    this.helped = true;
    ctx.state.setFlag('ch02.handTaken', true);
    await ctx.talk('ch02_help', { with: 'help' });
    ctx.onTalk('help', 'ch02_help_again');
    this.busy = false;
    this.deps.onHelped();
  }

  /** He reaches down, Christian lands on the bank, the stones rise, the camera looks back over the glowing bog. */
  private handCutscene(helpPos: THREE.Vector3, bank: THREE.Vector3): CutsceneDef {
    const ctx = this.ctx;
    const session = ctx.session;
    const centre = this.bogCentre();
    // Away from the bog = Help's side; the camera backs up there and looks over the mud.
    const away = new THREE.Vector3(helpPos.x - centre.x, 0, helpPos.z - centre.z);
    if (away.lengthSq() < 1) away.set(1, 0, 0);
    away.normalize();
    const side = new THREE.Vector3(-away.z, 0, away.x);
    const camAt = new THREE.Vector3()
      .copy(bank)
      .addScaledVector(away, CAM.back)
      .addScaledVector(side, CAM.side);
    camAt.y = session.col.groundAt(camAt.x, camAt.z) + CAM.up;
    const lookAt = new THREE.Vector3().copy(bank).addScaledVector(away, -CAM.lookAhead);
    lookAt.y = session.col.groundAt(lookAt.x, lookAt.z) + CAM.lookLift;
    const facing = Math.atan2(helpPos.x - bank.x, helpPos.z - bank.z);
    // Shot 1: from the side of the pair, chest height, on the hand. Shot 2: rises behind Help and turns to the bog.
    const mid = new THREE.Vector3().addVectors(helpPos, bank).multiplyScalar(0.5);
    const midChest = mid.clone().setY(Math.max(helpPos.y, bank.y) + CAM.chest);
    const cam1 = mid.clone().addScaledVector(side, CAM.aside).addScaledVector(away, CAM.aheadBack);
    cam1.y = Math.max(session.col.groundAt(cam1.x, cam1.z), midChest.y - 0.3) + CAM.eye;
    return {
      id: 'ch02_hand',
      duration: T.end,
      camera: [
        { start: 0, end: T.lookOver, path: [cam1], look: [midChest], fov: CAM.fov },
        {
          start: T.lookOver,
          end: T.end,
          path: [cam1, camAt],
          look: [midChest, lookAt],
          ease: 'smootherstep',
          fov: CAM.fov,
        },
      ],
      actors: [
        {
          actor: 'help',
          actions: [
            { at: T.reach, do: 'overlay', anim: 'reach', fade: 0.25 },
            { at: T.pull + 0.5, do: 'overlay', anim: null, fade: 0.4 },
          ],
        },
        { actor: 'christian', actions: [{ at: T.land, do: 'play', anim: 'land', fade: 0.05 }] },
      ],
      events: [
        {
          at: T.pull,
          essential: true,
          run: () => {
            session.teleport(bank.x, bank.z, facing);
            events.emit('sfx', { id: 'mud_slurp', at: [bank.x, bank.y, bank.z], volume: 1 });
            events.emit('sfx', { id: 'land', at: [bank.x, bank.y, bank.z] });
            this.tmp.set(bank.x, bank.y + 0.1, bank.z);
            session.world.particles.emit('splash', this.tmp, 12);
          },
        },
        {
          at: T.reveal,
          essential: true,
          run: () => {
            session.slough.reveal();
            events.emit('sfx', { id: 'sparkle', at: [bank.x, bank.y, bank.z] });
          },
        },
      ],
    };
  }

  /** Centre of the level's slough zone (the bog), else where Help stands. */
  private bogCentre(): THREE.Vector3 {
    const z = this.ctx.level.zones.find((zone) => zone.type === SLOUGH_ZONE && zone.x !== undefined);
    if (z && z.x !== undefined && z.z !== undefined) return new THREE.Vector3(z.x, 0, z.z);
    const help = this.ctx.npc('help');
    return help ? help.position.clone() : new THREE.Vector3();
  }
}
