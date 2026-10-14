/**
 * Demo end (GDD 2.14 "Demo end"): "The Way goes on..." / "Nine more chapters wait beyond the gate." /
 * GET THE FULL GAME / TITLE SCREEN. GET THE FULL GAME opens VITE_STORE_URL in a new tab and is left out when the
 * build has no store link. Escape / pad B also go to the title screen.
 */
import { buildFlags } from '../core/Flags';
import { emblemSvg } from './Emblem';
import { h } from './dom';
import { Menu } from './Menu';
import { Texts, menuButton, playSfx, uid } from './menu-screen';

export interface DemoEndOptions {
  onTitle(): void;
  /** Store link (default: the VITE_STORE_URL build flag; '' hides the button). */
  storeUrl?: string;
}

export class DemoEnd {
  readonly root: HTMLDivElement;
  private readonly texts = new Texts();
  private readonly menu: Menu;

  constructor(parent: HTMLElement, o: DemoEndOptions) {
    const titleId = uid('pg-demo-end');
    const url = o.storeUrl ?? buildFlags.STORE_URL;
    const tx = this.texts;
    const emblem = h('div', { className: 'pg-demo-end__emblem', 'aria-hidden': 'true' });
    emblem.innerHTML = emblemSvg(96, { id: 'pg-demo-emblem' });
    const store = url
      ? menuButton(tx, 'ui.demoEnd.getFull', { primary: true, onClick: () => openStore(url) })
      : null;
    const title = menuButton(tx, 'ui.demoEnd.titleScreen', { primary: !store, onClick: () => o.onTitle() });
    const panel = h(
      'div',
      { className: 'panel pg-menu-panel pg-demo-end__panel pop-in' },
      emblem,
      tx.text(h('h2', { className: 'pg-demo-end__line1', id: titleId }), 'ui.demoEnd.line1'),
      tx.text(h('p', { className: 'pg-demo-end__line2' }), 'ui.demoEnd.line2'),
      h('div', { className: 'pg-menu-list' }, store, title),
    );
    this.root = h(
      'div',
      {
        className: 'pg-screen pg-scrim pg-demo-end',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': titleId,
      },
      panel,
    );
    parent.appendChild(this.root);
    this.menu = new Menu({ root: panel, nav: 'vertical', onBack: () => o.onTitle() });
    playSfx('ui_open');
  }

  dispose(): void {
    this.menu.dispose();
    this.texts.dispose();
    this.root.remove();
  }
}

function openStore(url: string): void {
  try {
    window.open(url, '_blank', 'noopener,noreferrer');
  } catch (err) {
    console.warn('[demo end] could not open the store page', err);
  }
}
