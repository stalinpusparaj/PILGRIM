/**
 * Pause menu (GDD 2.14 "Pause - PAUSED"): KEEP GOING, SATCHEL, SETTINGS, CONTROLS, TITLE SCREEN (with the
 * confirm "Go back to the title? You'll restart from your last waystone." YES / NO).
 *
 * The screen only draws and navigates; GameFlow pauses the loop, ducks the music and opens Satchel / Settings
 * (other modules) on request. Escape / pad B go back one step (from the root: keep going); the pad Menu button
 * closes the whole menu from anywhere ("Esc / Menu toggles").
 *
 *   const pause = new Pause(uiRoot(), { resume, satchel, settings, quitToTitle });
 *   pause.setCovered(true);   // Settings or the Satchel is open on top
 *   pause.dispose();
 */
import { h } from './dom';
import { Menu } from './Menu';
import { Confirm } from './menu-confirm';
import { ControlsCard } from './menu-controls';
import { Texts, menuButton, playSfx, uid } from './menu-screen';

export interface PauseHandlers {
  resume(): void;
  satchel(): void;
  settings(): void;
  quitToTitle(): void;
}

export type PauseView = 'root' | 'controls' | 'confirm';

export class Pause {
  readonly root: HTMLDivElement;
  private readonly texts = new Texts();
  private readonly panel: HTMLDivElement;
  private readonly menu: Menu;
  private readonly controlsBtn: HTMLButtonElement;
  private readonly quitBtn: HTMLButtonElement;
  private sub: ControlsCard | Confirm | null = null;
  private currentView: PauseView = 'root';
  private disposed = false;

  constructor(
    parent: HTMLElement,
    private readonly handlers: PauseHandlers,
  ) {
    const titleId = uid('pg-pause');
    const tx = this.texts;
    const resume = menuButton(tx, 'ui.pause.resume', { primary: true, icon: 'play', onClick: () => handlers.resume() });
    const satchel = menuButton(tx, 'ui.pause.satchel', { icon: 'satchel', onClick: () => handlers.satchel() });
    const settings = menuButton(tx, 'ui.pause.settings', { icon: 'gear', onClick: () => handlers.settings() });
    this.controlsBtn = menuButton(tx, 'ui.pause.controls', { icon: 'pad', onClick: () => this.show('controls') });
    this.quitBtn = menuButton(tx, 'ui.pause.titleScreen', { icon: 'home', onClick: () => this.show('confirm') });
    this.panel = h(
      'div',
      { className: 'panel pg-menu-panel pg-pause__panel pop-in' },
      tx.text(h('h2', { className: 'pg-menu-title pg-pause__title', id: titleId }), 'ui.pause.title'),
      h('div', { className: 'pg-menu-list' }, resume, satchel, settings, this.controlsBtn, this.quitBtn),
    );
    this.root = h(
      'div',
      {
        className: 'pg-screen pg-scrim pg-pause',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': titleId,
      },
      this.panel,
    );
    parent.appendChild(this.root);
    this.menu = new Menu({
      root: this.panel,
      nav: 'vertical',
      onBack: () => handlers.resume(),
      onMenuButton: () => handlers.resume(),
    });
    playSfx('ui_open');
  }

  get view(): PauseView {
    return this.currentView;
  }

  /** Satchel or Settings (screens of their own) cover the pause menu: hide it and stop reading input. */
  setCovered(covered: boolean): void {
    if (this.disposed) return;
    this.root.hidden = covered;
    if (covered) this.menu.suspend();
    else this.menu.resume();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.sub?.dispose();
    this.sub = null;
    this.menu.dispose();
    this.texts.dispose();
    this.root.remove();
  }

  private show(view: PauseView): void {
    if (this.disposed || view === this.currentView) return;
    this.sub?.dispose();
    this.sub = null;
    this.currentView = view;
    this.panel.hidden = view !== 'root';
    if (view === 'root') return; // the root menu takes the focus back as the sub-menu goes
    playSfx('ui_open');
    const close = (): void => this.handlers.resume();
    if (view === 'controls') {
      this.sub = new ControlsCard(this.root, {
        onBack: () => this.back(this.controlsBtn),
        onMenuButton: close,
      });
    } else {
      this.sub = new Confirm(this.root, {
        textKey: 'ui.pause.confirm.text',
        yesKey: 'ui.pause.confirm.yes',
        noKey: 'ui.pause.confirm.no',
        onYes: () => this.handlers.quitToTitle(),
        onNo: () => this.back(this.quitBtn),
        onMenuButton: close,
      });
    }
  }

  private back(focus: HTMLElement): void {
    this.show('root');
    this.menu.focus(focus, false);
  }
}
