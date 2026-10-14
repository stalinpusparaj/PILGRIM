/**
 * A small yes / no question on a panel (Pause > TITLE SCREEN: "Go back to the title? You'll restart from your last
 * waystone." YES / NO). NO has the first focus, so a quick double press never throws progress away; Escape and
 * pad B answer NO.
 */
import { h } from './dom';
import { Menu } from './Menu';
import { Texts, menuButton, uid } from './menu-screen';

export interface ConfirmOptions {
  textKey: string;
  yesKey: string;
  noKey: string;
  onYes(): void;
  onNo(): void;
  /** Pad Menu / Start (the pause menu closes altogether). */
  onMenuButton?: () => void;
}

export class Confirm {
  readonly root: HTMLDivElement;
  private readonly texts = new Texts();
  private readonly menu: Menu;

  constructor(parent: HTMLElement, o: ConfirmOptions) {
    const textId = uid('pg-confirm');
    const yes = menuButton(this.texts, o.yesKey, { onClick: () => o.onYes(), className: 'pg-confirm__yes' });
    const no = menuButton(this.texts, o.noKey, { primary: true, onClick: () => o.onNo() });
    this.root = h(
      'div',
      {
        className: 'panel pg-menu-panel pg-confirm pop-in',
        role: 'alertdialog',
        'aria-modal': 'true',
        'aria-describedby': textId,
      },
      this.texts.text(h('p', { className: 'pg-confirm__text', id: textId }), o.textKey),
      h('div', { className: 'pg-confirm__row' }, yes, no),
    );
    parent.appendChild(this.root);
    this.menu = new Menu({
      root: this.root,
      nav: 'horizontal',
      initial: () => no,
      onBack: () => o.onNo(),
      ...(o.onMenuButton ? { onMenuButton: o.onMenuButton } : {}),
    });
  }

  dispose(): void {
    this.menu.dispose();
    this.texts.dispose();
    this.root.remove();
  }
}
