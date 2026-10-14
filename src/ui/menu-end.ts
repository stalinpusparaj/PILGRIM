/**
 * Full-screen title cards over the night (GDD 2.14 "End", GDD 2.10 Epilogue). The words fade in; any press, tap
 * or pad A continues, and the card moves on by itself after a while.
 * - 'dream' (default): "THE END OF THE DREAM", shown after Chapter XIII, before the Epilogue, with Bunyan's own
 *   last line of Part I ("So I awoke, and behold it was a dream.").
 * - 'sequel': the sequel hook "CHRISTIANA'S JOURNEY - coming soon", after the Epilogue and before the credits.
 */
import { h } from './dom';
import { Menu } from './Menu';
import { Texts, afterPaint, uid } from './menu-screen';

export type EndCardVariant = 'dream' | 'sequel';

export interface EndCardOptions {
  variant?: EndCardVariant;
  onDone(): void;
}

/** Each card's title and line (i18n keys) and how long it stays by itself (s). */
const CARDS: Readonly<Record<EndCardVariant, { title: string; line: string; auto: number }>> = {
  dream: { title: 'ui.end.title', line: 'ui.end.awoke', auto: 9 },
  sequel: { title: 'ui.end.sequel.title', line: 'ui.end.sequel.soon', auto: 7 },
};

export class EndCard {
  readonly root: HTMLDivElement;
  private readonly texts = new Texts();
  private readonly menu: Menu;
  private readonly offs: Array<() => void> = [];
  private timer = 0;
  private done = false;

  constructor(
    parent: HTMLElement,
    private readonly o: EndCardOptions,
  ) {
    const titleId = uid('pg-end');
    const variant = o.variant ?? 'dream';
    const text = CARDS[variant];
    const card = h(
      'button',
      { type: 'button', className: 'pg-end__card', dataset: { menuItem: '' }, onClick: () => this.finish() },
      this.texts.text(h('span', { className: 'pg-end__title', id: titleId }), text.title),
      this.texts.text(h('span', { className: 'pg-end__line' }), text.line),
    );
    this.root = h(
      'div',
      {
        className: `pg-screen pg-end pg-end--${variant}`,
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': titleId,
      },
      card,
    );
    parent.appendChild(this.root);
    this.menu = new Menu({ root: this.root, onBack: () => this.finish(), sounds: false });
    this.offs.push(afterPaint(() => this.root.classList.add('is-shown')));
    this.timer = window.setTimeout(() => this.finish(), text.auto * 1000);
  }

  dispose(): void {
    window.clearTimeout(this.timer);
    for (const off of this.offs.splice(0)) off();
    this.menu.dispose();
    this.texts.dispose();
    this.root.remove();
  }

  private finish(): void {
    if (this.done) return;
    this.done = true;
    this.o.onDone();
  }
}
