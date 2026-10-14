/**
 * The objective line (GDD 2.14, top-left: "Follow the shining light", fades after 6 s) and the chapter card
 * ("CHAPTER I" over "THE CITY OF DESTRUCTION", 3.5 s, centred, title font). Both are timed in update(dt) and
 * animated with one-shot CSS keyframes (hud.css), which body.reduce-motion turns into instant changes.
 */
import { i18n, t } from '../core/I18n';
import { EPILOGUE_CHAPTER } from '../core/Save';
import { h, setText } from './dom';
import { badgeSvg } from './hud-icons';

/** On screen after a new objective (GDD 2.14). */
export const OBJECTIVE_SECONDS = 6;
/** On screen again after the Satchel closes ("briefly"). */
export const OBJECTIVE_RESHOW_SECONDS = 3;
/** A deferred objective (held back by the chapter card or a hidden HUD) gets at least this much time. */
const OBJECTIVE_MIN_SECONDS = 2.5;

export const CARD_SECONDS = 3.5;
/** The card starts leaving here (its fade-out in hud.css is 0.8 s). */
const CARD_OUT_AT = 2.7;

export class ObjectiveLine {
  readonly el: HTMLDivElement;
  private readonly text: HTMLSpanElement;
  private key: string | null = null;
  private remaining = 0;
  /** Wants to be on screen as soon as it is allowed. */
  private pending = false;
  private shown = false;
  private flip = false;

  constructor() {
    const icon = h('span', { className: 'hud-objective__icon' });
    icon.innerHTML = badgeSvg('flag');
    this.text = h('span', { className: 'hud-objective__text' });
    this.el = h(
      'div',
      { className: 'hud-objective', role: 'status', 'aria-live': 'polite' },
      icon,
      this.text,
    );
  }

  get current(): string | null {
    return this.key;
  }

  get visible(): boolean {
    return this.shown;
  }

  /** New objective (an i18n key) or null to clear it. */
  set(key: string | null): void {
    if (!key) {
      this.key = null;
      this.pending = false;
      this.remaining = 0;
      this.hide();
      return;
    }
    this.key = key;
    setText(this.text, t(key));
    this.remaining = OBJECTIVE_SECONDS;
    this.pending = true;
    if (this.shown) this.restartEntrance();
  }

  /** Show the current objective again for a moment (the Satchel just closed). */
  reshow(seconds = OBJECTIVE_RESHOW_SECONDS): void {
    if (!this.key) return;
    this.remaining = Math.max(this.remaining, seconds);
    if (!this.shown) this.pending = true;
  }

  refreshText(): void {
    if (this.key) setText(this.text, t(this.key));
  }

  /** `allowed` is false while the HUD is hidden or a chapter card is up: the objective waits its turn. */
  update(dt: number, allowed: boolean): void {
    if (!allowed) {
      if (this.shown) {
        this.hide();
        this.pending = this.remaining > 0;
      }
      return;
    }
    if (this.pending) {
      this.pending = false;
      this.remaining = Math.max(this.remaining, OBJECTIVE_MIN_SECONDS);
      this.showNow();
    }
    if (!this.shown) return;
    this.remaining -= dt;
    if (this.remaining <= 0) this.hide();
  }

  /** Alternates two identical entrance animations, so the entrance replays even with no frame in between. */
  private showNow(): void {
    this.shown = true;
    this.flip = !this.flip;
    this.el.classList.remove('is-out', this.flip ? 'is-in-b' : 'is-in-a');
    this.el.classList.add(this.flip ? 'is-in-a' : 'is-in-b');
  }

  /** A new objective while the old one is still up: replay the entrance so the change is noticed. */
  private restartEntrance(): void {
    this.shown = false;
    this.pending = true;
  }

  private hide(): void {
    if (!this.shown) return;
    this.shown = false;
    this.el.classList.remove('is-in-a', 'is-in-b');
    this.el.classList.add('is-out');
  }
}

/** i18n id of a chapter number: 1..13, or 'epilogue' for 14 (Save.EPILOGUE_CHAPTER). */
export function chapterKeyId(chapter: number): string {
  return chapter === EPILOGUE_CHAPTER ? 'epilogue' : String(Math.round(chapter));
}

export class ChapterCard {
  readonly el: HTMLDivElement;
  private readonly number: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private id: string | null = null;
  private time = 0;
  private leaving = false;
  private flip = false;

  constructor() {
    this.number = h('div', { className: 'hud-card__number' });
    const rule = h('div', { className: 'hud-card__rule' });
    this.title = h('div', { className: 'hud-card__title' });
    this.el = h(
      'div',
      { className: 'hud-card', role: 'status', 'aria-live': 'polite' },
      this.number,
      rule,
      this.title,
    );
  }

  /** True while the card is on screen. */
  get active(): boolean {
    return this.id !== null;
  }

  /** Shows the card for `chapter`; returns false (nothing shown) when there are no texts for it. */
  show(chapter: number): boolean {
    const id = chapterKeyId(chapter);
    if (!i18n.has(`ui.chapter.${id}.title`)) return false;
    this.id = id;
    this.time = 0;
    this.leaving = false;
    this.refreshText();
    // Alternate two identical entrance animations so a card shown over a card still replays.
    this.flip = !this.flip;
    this.el.classList.remove('is-out', this.flip ? 'is-in-b' : 'is-in-a');
    this.el.classList.add(this.flip ? 'is-in-a' : 'is-in-b');
    return true;
  }

  refreshText(): void {
    if (!this.id) return;
    setText(this.number, t(`ui.chapter.${this.id}.number`));
    setText(this.title, t(`ui.chapter.${this.id}.title`));
  }

  update(dt: number): void {
    if (!this.id) return;
    this.time += dt;
    if (!this.leaving && this.time >= CARD_OUT_AT) {
      this.leaving = true;
      this.el.classList.add('is-out');
    }
    if (this.time >= CARD_SECONDS) {
      this.id = null;
      this.el.classList.remove('is-in-a', 'is-in-b', 'is-out');
    }
  }

  clear(): void {
    this.id = null;
    this.el.classList.remove('is-in-a', 'is-in-b', 'is-out');
  }
}
