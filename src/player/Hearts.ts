/**
 * Hearts (GDD 2.7.7): Chapter VIII only. 5 hearts under the Hope lantern (HUD.setHearts) while the Apollyon fight
 * runs; a hit costs one heart, half with the Breastplate (GDD 2.7.6 #4), and half again on Easy (GDD 2.9 "half
 * damage"). Values are kept in quarter hearts; the HUD shows them rounded up to the half heart, so a living
 * Christian never shows an empty row. Reaching 0 emits `hearts:empty` once (the fight answers with I SHALL ARISE
 * and restarts its phase); `fill()` re-arms it.
 */
import '../audio/events';
import { events } from '../core/Events';
import type { GameState } from '../core/GameState';

declare module '../core/Events' {
  interface EventMap {
    'hearts:changed': { value: number; max: number };
    'hearts:empty': void;
  }
}

export const HEARTS_MAX = 5;

/** What one of Apollyon's hits costs (hearts), from the Breastplate and the difficulty. */
export function hitCost(state: Pick<GameState, 'hasGift'>, difficulty: 'easy' | 'normal'): number {
  return (state.hasGift('breastplate') ? 0.5 : 1) * (difficulty === 'easy' ? 0.5 : 1);
}

/** Anything with HUD.setHearts (the session's HUD may be null while it is not shown). */
export interface HeartsView {
  setHearts(n: number | null, max?: number): void;
}

export class Hearts {
  readonly max: number;
  private v: number;
  private shown = false;
  private emptied = false;
  private disposed = false;

  constructor(
    private readonly view: () => HeartsView | null,
    max = HEARTS_MAX,
  ) {
    this.max = max;
    this.v = max;
  }

  get value(): number {
    return this.v;
  }

  get visible(): boolean {
    return this.shown;
  }

  show(): void {
    this.shown = true;
    this.sync();
  }

  hide(): void {
    this.shown = false;
    this.view()?.setHearts(null);
  }

  /** All hearts back (the healing leaves, a restarted phase). */
  fill(): void {
    this.set(this.max);
  }

  /** Takes `amount` hearts; returns what is left. Nothing below 0; `hearts:empty` once on reaching it. */
  damage(amount: number): number {
    if (!(amount > 0) || this.disposed) return this.v;
    this.set(this.v - amount);
    if (this.v <= 0 && !this.emptied) {
      this.emptied = true;
      events.emit('hearts:empty');
    }
    return this.v;
  }

  dispose(): void {
    if (this.disposed) return;
    this.hide();
    this.disposed = true;
  }

  private set(n: number): void {
    if (this.disposed) return;
    this.v = Math.max(0, Math.min(this.max, Math.round(n * 4) / 4));
    if (this.v > 0) this.emptied = false;
    this.sync();
    events.emit('hearts:changed', { value: this.v, max: this.max });
  }

  private sync(): void {
    if (!this.shown) return;
    this.view()?.setHearts(this.v > 0 ? Math.ceil(this.v * 2) / 2 : 0, this.max);
  }
}
