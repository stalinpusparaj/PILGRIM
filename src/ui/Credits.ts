/**
 * Credits (GDD 2.14 "End"; GDD 2.16 rule 7: the credits always name John Bunyan's The Pilgrim's Progress (1678)
 * and the King James Version). A slow upward scroll of: the game's name and emblem, "Based on The Pilgrim's
 * Progress by John Bunyan (1678)", "Scripture from the King James Version", "Every model, sound and tune in this
 * game was made by our own code.", the code library we build on, and a thank-you.
 *
 * - 'menu' (from the title): a BACK button; Escape / pad B go back.
 * - 'end' (after the Epilogue and the sequel card, GDD 2.10): returns to the title by itself a few seconds after
 *   the end of the roll (or with TITLE SCREEN).
 *
 * The scroll pauses while the player scrolls by hand (wheel, drag, arrows, d-pad) and resumes after a moment.
 * With reduced motion it does not move by itself.
 */
import { emblemSvg } from './Emblem';
import { h } from './dom';
import { Menu } from './Menu';
import { Texts, menuButton, playSfx, reduceMotion, uid } from './menu-screen';

export type CreditsVariant = 'menu' | 'end';

export interface CreditsOptions {
  variant: CreditsVariant;
  /** BACK / TITLE SCREEN, or the end of the 'end' roll. */
  onDone(): void;
}

/** Scroll speed (px per second) and the pause after a manual scroll (s). */
const SPEED = 26;
const MANUAL_PAUSE_S = 2.5;
const STEP_PX = 90;
/** 'end' roll: back to the title this long after reaching the bottom (s). */
const END_HOLD_S = 5;

/** Credit lines in order: [i18n key, style]. */
const LINES: ReadonlyArray<readonly [string, 'name' | 'line' | 'big']> = [
  ['ui.title.gameName', 'name'],
  ['ui.credits.bunyan', 'big'],
  ['ui.credits.kjv', 'line'],
  ['ui.credits.madeHere', 'line'],
  ['ui.credits.code', 'line'],
  ['ui.credits.thanks', 'big'],
];

export class Credits {
  readonly root: HTMLDivElement;
  private readonly texts = new Texts();
  private readonly scroller: HTMLDivElement;
  private readonly menu: Menu;
  private readonly offs: Array<() => void> = [];
  private raf = 0;
  private last = 0;
  private pos = 0;
  private manualUntil = 0;
  private endedAt: number | null = null;
  private done = false;

  constructor(
    parent: HTMLElement,
    private readonly opts: CreditsOptions,
  ) {
    const titleId = uid('pg-credits');
    const tx = this.texts;
    const emblem = h('div', { className: 'pg-credits__emblem', 'aria-hidden': 'true' });
    emblem.innerHTML = emblemSvg(84, { id: 'pg-credits-emblem' });
    const lines = LINES.map(([key, style]) => tx.text(h('p', { className: `pg-credits__${style}` }), key));
    this.scroller = h(
      'div',
      { className: 'pg-credits__scroll', tabIndex: -1 },
      h(
        'div',
        { className: 'pg-credits__roll' },
        tx.text(h('h2', { className: 'pg-menu-title', id: titleId }), 'ui.credits.title'),
        emblem,
        ...lines,
      ),
    );
    const button = menuButton(tx, opts.variant === 'end' ? 'ui.pause.titleScreen' : 'ui.common.back', {
      onClick: () => this.finish(),
      className: 'pg-credits__back',
    });
    this.root = h(
      'div',
      {
        className: 'pg-screen pg-scrim pg-credits',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': titleId,
      },
      this.scroller,
      h('div', { className: 'pg-credits__foot' }, button),
    );
    parent.appendChild(this.root);
    this.menu = new Menu({
      root: this.root,
      nav: 'vertical',
      onBack: () => this.finish(),
      onNavigate: (dir) => {
        if (dir !== 'up' && dir !== 'down') return false;
        this.nudge(dir === 'down' ? STEP_PX : -STEP_PX);
        return true;
      },
    });
    const manual = (): void => this.holdAuto();
    for (const type of ['wheel', 'touchstart', 'pointerdown'] as const) {
      this.scroller.addEventListener(type, manual, { passive: true });
      this.offs.push(() => this.scroller.removeEventListener(type, manual));
    }
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
    playSfx('ui_open');
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    for (const off of this.offs.splice(0)) off();
    this.menu.dispose();
    this.texts.dispose();
    this.root.remove();
  }

  private finish(): void {
    if (this.done) return;
    this.done = true;
    this.opts.onDone();
  }

  private holdAuto(): void {
    this.manualUntil = performance.now() + MANUAL_PAUSE_S * 1000;
  }

  private nudge(px: number): void {
    this.holdAuto();
    this.scroller.scrollTop += px;
    this.pos = this.scroller.scrollTop;
  }

  private readonly tick = (now: number): void => {
    this.raf = requestAnimationFrame(this.tick);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const el = this.scroller;
    const max = el.scrollHeight - el.clientHeight;
    if (now < this.manualUntil || reduceMotion()) {
      this.pos = el.scrollTop;
    } else if (this.pos < max) {
      this.pos = Math.min(max, this.pos + SPEED * dt);
      el.scrollTop = this.pos;
    }
    if (this.opts.variant !== 'end') return;
    const atEnd = el.scrollTop >= max - 2;
    if (!atEnd) this.endedAt = null;
    else if (this.endedAt === null) this.endedAt = now;
    else if (now - this.endedAt > END_HOLD_S * 1000) this.finish();
  };
}
