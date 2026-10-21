/**
 * The gifts a play session runs (GDD 2.7.6): Prayer (src/player/Prayer.ts, every chapter once given) and the Sword
 * and Shield (src/player/Combat.ts, combat zones only), plus the round touch buttons that follow them (GDD 2.6):
 * JUMP and USE always, PRAY with the Prayer gift, SWORD and SHIELD only while combat is active.
 *
 * A conversation hides the buttons and puts back its own default when it ends (DialoguePanel), so the buttons are
 * re-applied for the first few fixed steps after any story beat ends, and whenever a gift or combat changes.
 *
 * F1 "Gifts": give every gift, pray now (no rest), the prayer and combat readout.
 */
import '../audio/events';
import { events } from '../core/Events';
import { services } from '../core/Services';
import { GIFT_IDS, type GameState } from '../core/GameState';
import type { TouchButton } from '../core/Input';
import { storyHoldsInput } from '../narrative/story-input';
import { Combat } from '../player/Combat';
import { Prayer } from '../player/Prayer';
import type { Player } from '../player/Player';
import type { World } from './World';
import type { Zones } from './Zones';

export interface PlayGiftsOptions {
  player: Player;
  state: GameState;
  world: World;
  zones: Zones;
}

export class PlayGifts {
  readonly combat: Combat;
  readonly prayer: Prayer;

  private readonly state: GameState;
  private readonly offs: Array<() => void> = [];
  private dirty = true;
  private shown = false;
  private held = false;
  /** Steps left to keep re-applying after a story beat (its panel may reset the buttons late). */
  private again = 0;

  constructor(o: PlayGiftsOptions) {
    this.state = o.state;
    this.combat = new Combat(o);
    this.prayer = new Prayer(o);
    const mark = (): void => {
      this.dirty = true;
    };
    this.offs.push(
      events.on('gift:given', mark),
      events.on('state:reset', mark),
      events.on('combat:active', mark),
      events.on('dialogue:end', mark),
      events.on('cutscene:end', mark),
    );
    this.installDebug();
  }

  /** The buttons go on screen (the session is shown). */
  show(): void {
    this.shown = true;
    this.dirty = true;
    this.applyButtons();
  }

  /** The round touch buttons for right now. */
  buttons(): TouchButton[] {
    const list: TouchButton[] = ['jump', 'use'];
    if (this.state.hasGift('prayer')) list.push('pray');
    if (this.combat.active) {
      if (this.state.hasGift('sword')) list.push('sword');
      if (this.state.hasGift('shield')) list.push('shield');
    }
    return list;
  }

  update(dt: number): void {
    this.prayer.update(dt);
    this.combat.update(dt);
    const held = storyHoldsInput();
    if (held !== this.held) {
      this.held = held;
      if (!held) this.again = 10;
    }
    this.applyButtons();
  }

  render(frameDt: number): void {
    this.prayer.render(frameDt);
  }

  dispose(): void {
    for (const off of this.offs.splice(0)) off();
    this.combat.dispose();
    this.prayer.dispose();
  }

  private applyButtons(): void {
    if ((!this.dirty && this.again <= 0) || !this.shown || this.held) return;
    this.dirty = false;
    this.again = Math.max(0, this.again - 1);
    services.tryGet('input')?.setTouchButtons(this.buttons());
  }

  private installDebug(): void {
    const debug = services.tryGet('debug');
    if (!debug) return;
    this.offs.push(
      debug.addButton('Gifts', 'Give all gifts', () => {
        for (const id of GIFT_IDS) this.state.giveGift(id, true);
      }),
      debug.addButton('Gifts', 'Pray now', () => {
        this.prayer.resetCooldown();
        this.prayer.pray();
      }),
      debug.addReadout('Gifts', () => {
        const rest = this.prayer.cooldownLeft;
        const c = this.combat;
        return `pray ${rest > 0 ? rest.toFixed(1) + 's' : 'ready'} | combat ${c.active ? 'on' : 'off'}${c.shieldUp ? ' shield' : ''}`;
      }),
    );
  }
}
