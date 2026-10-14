/**
 * Title screen (GDD 2.14 "Title screen"): the logo PILGRIM over THE NARROW WAY with our SVG emblem, the credit
 * line, START THE JOURNEY / CONTINUE (only with a save) / CHAPTERS / SETTINGS / CREDITS, the footer ("A story
 * adventure for kids and families" left, the version right) and the "English | தமிழ்" toggle top right, which
 * switches the language live. The 3D background (TitleScene) is drawn by the engine behind this layer; until it
 * is ready a painted dusk backdrop stands in, then fades away. The logo shrinks with the window's height so the
 * whole menu fits on laptop screens; when it still runs past the bottom (large text, a short window) a bobbing
 * "more" arrow sits at the bottom of the column until it is scrolled to the end (a click on it scrolls).
 *
 *   const title = new Title(uiRoot(), { start, continue: cont, chapters, settings, credits });
 *   title.setContinueAvailable(true);
 *   title.setSceneReady();
 *   ...
 *   title.dispose();
 */
import { i18n, type Lang } from '../core/I18n';
import { version as GAME_VERSION } from '../../package.json';
import { ART } from './art';
import { h } from './dom';
import { Menu } from './Menu';
import { Texts, menuButton, playSfx, uid } from './menu-screen';

export interface TitleHandlers {
  start(): void;
  continue(): void;
  chapters(): void;
  settings(): void;
  credits(): void;
}

/** Our own down chevron (the 48 grid of src/ui/Svg.ts). */
const MORE_ICON =
  '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" ' +
  'stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M13 18l11 11 11-11"/></svg>';

export class Title {
  readonly root: HTMLDivElement;
  private readonly texts: Texts;
  private readonly menu: Menu;
  private readonly continueBtn: HTMLButtonElement;
  private readonly emblem: HTMLDivElement;
  private readonly notice: HTMLParagraphElement;
  private readonly langButtons: Record<Lang, HTMLButtonElement>;
  private readonly menuButtons: HTMLButtonElement[];
  private readonly main: HTMLDivElement;
  private readonly more: HTMLDivElement;
  private readonly sizes: ResizeObserver | null;
  private noticeTimer = 0;
  private disposed = false;

  constructor(parent: HTMLElement, handlers: TitleHandlers) {
    this.texts = new Texts(() => this.onLang());
    const tx = this.texts;
    const headingId = uid('pg-title-logo');

    this.emblem = h('div', { className: 'pg-title__emblem' });
    const logo = h(
      'h1',
      { className: 'pg-title__logo', id: headingId },
      tx.text(h('span', { className: 'pg-title__word' }), 'ui.title.logoTop'),
      tx.text(h('span', { className: 'pg-title__sub' }), 'ui.title.logoBottom'),
    );
    const credit = tx.text(h('p', { className: 'pg-title__credit' }), 'ui.title.credit');

    const start = menuButton(tx, 'ui.title.start', { primary: true, onClick: () => handlers.start() });
    this.continueBtn = menuButton(tx, 'ui.title.continue', { onClick: () => handlers.continue() });
    this.continueBtn.hidden = true; // shown once a save is found
    const chapters = menuButton(tx, 'ui.title.chapters', { onClick: () => handlers.chapters() });
    const settings = menuButton(tx, 'ui.title.settings', { onClick: () => handlers.settings() });
    const credits = menuButton(tx, 'ui.title.credits', { onClick: () => handlers.credits() });
    this.menuButtons = [start, this.continueBtn, chapters, settings, credits];
    const nav = tx.attr(
      h('nav', { className: 'pg-title__menu' }, ...this.menuButtons),
      'aria-label',
      'ui.menu.main',
    );

    this.langButtons = { en: this.langButton('en'), ta: this.langButton('ta') };
    const lang = tx.attr(
      h(
        'div',
        { className: 'pg-title__lang', role: 'group' },
        this.langButtons.en,
        h('span', { className: 'pg-title__langbar', 'aria-hidden': 'true' }, '|'),
        this.langButtons.ta,
      ),
      'aria-label',
      'ui.title.lang.label',
    );

    this.notice = h('p', { className: 'pg-title__notice', role: 'status', 'aria-live': 'polite' });
    const footer = h(
      'footer',
      { className: 'pg-title__footer' },
      tx.text(h('span', { className: 'pg-title__tagline' }), 'ui.title.tagline'),
      tx.text(h('span', { className: 'pg-title__version' }), 'ui.title.version', { version: GAME_VERSION }),
    );

    this.more = h('div', {
      className: 'pg-title__more ui-interactive',
      'aria-hidden': 'true', // keyboard and pad focus scroll the menu themselves
      hidden: true,
      onClick: () => this.main.scrollBy({ top: this.main.clientHeight * 0.6, behavior: 'smooth' }),
    });
    this.more.innerHTML = MORE_ICON;
    const head = h('header', { className: 'pg-title__head' }, this.emblem, logo, credit);
    this.main = h('div', { className: 'pg-title__main' }, head, nav, this.notice, this.more);
    this.root = h(
      'div',
      { className: 'pg-screen pg-title', 'aria-labelledby': headingId },
      h('div', { className: 'pg-title__backdrop', 'aria-hidden': 'true' }),
      h('div', { className: 'pg-title__shade', 'aria-hidden': 'true' }),
      this.main,
      footer,
      lang,
    );
    this.renderEmblem();
    this.syncLang();
    parent.appendChild(this.root);
    // The menu's size changes with CONTINUE, the language, the text size and the window.
    this.main.addEventListener('scroll', this.updateMore, { passive: true });
    this.sizes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(this.updateMore);
    for (const el of [this.main, head, nav]) this.sizes?.observe(el);
    this.updateMore();
    this.menu = new Menu({
      root: this.root,
      nav: 'vertical',
      items: () => [...this.menuButtons, this.langButtons.en, this.langButtons.ta],
    });
  }

  /** CONTINUE appears only when a save exists (GDD 2.14). */
  setContinueAvailable(on: boolean): void {
    if (this.disposed || this.continueBtn.hidden === !on) return;
    this.continueBtn.hidden = !on;
    if (!on && this.menu.focused === this.continueBtn) this.menu.focusInitial();
  }

  get continueAvailable(): boolean {
    return !this.continueBtn.hidden;
  }

  /** The 3D background is on screen: fade the painted backdrop away. */
  setSceneReady(): void {
    this.root.classList.add('is-scene-ready');
  }

  /**
   * Another screen covers the title (CHAPTERS, CREDITS, SETTINGS): the logo and menu hide and go inert, the 3D
   * background keeps drifting. `external` = a screen that is not a Menu (Settings): the title menu must stop
   * reading keys and the pad until it is uncovered.
   */
  setCovered(covered: boolean, external = false): void {
    if (this.disposed) return;
    this.root.classList.toggle('is-covered', covered);
    this.root.toggleAttribute('inert', covered);
    if (covered && external) this.menu.suspend();
    else if (!covered) {
      if (this.menu.suspended) this.menu.resume();
      else this.menu.restoreFocus();
    }
  }

  /** A short message under the menu (e.g. a chapter that could not load). */
  showNotice(key: string, ms = 6000): void {
    if (this.disposed) return;
    this.texts.unbind(this.notice);
    this.texts.text(this.notice, key);
    window.clearTimeout(this.noticeTimer);
    this.noticeTimer = window.setTimeout(() => {
      this.texts.unbind(this.notice);
      this.notice.textContent = '';
    }, ms);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.clearTimeout(this.noticeTimer);
    this.sizes?.disconnect();
    this.main.removeEventListener('scroll', this.updateMore);
    this.menu.dispose();
    this.texts.dispose();
    this.root.remove();
  }

  /** Shows the "more" arrow while the last menu button runs past the bottom of the column (by more than a sliver). */
  private readonly updateMore = (): void => {
    const last = this.menuButtons.filter((b) => !b.hidden).pop();
    if (!last) return;
    const more = last.getBoundingClientRect().bottom > this.main.getBoundingClientRect().bottom + 8;
    if (this.more.hidden === !more) return;
    this.more.hidden = !more;
  };

  private langButton(lang: Lang): HTMLButtonElement {
    const key = `ui.title.lang.${lang}`;
    const b = h('button', {
      type: 'button',
      className: 'pg-title__langbtn',
      lang,
      dataset: { menuItem: '', key },
      onClick: () => {
        if (i18n.lang === lang) return;
        playSfx('ui_open');
        i18n.setLang(lang);
      },
    });
    this.texts.text(b, key);
    return b;
  }

  private onLang(): void {
    this.renderEmblem();
    this.syncLang();
  }

  private syncLang(): void {
    for (const lang of ['en', 'ta'] as const) {
      this.langButtons[lang].setAttribute('aria-pressed', String(i18n.lang === lang));
    }
  }

  private renderEmblem(): void {
    // Our own generated SVG; the only text in it (the accessible name) is escaped by emblemSvg().
    // The painted app icon (public/art/); the SVG emblem stays the favicon source for gen-icons.
    this.emblem.replaceChildren(h('img', { src: ART.icon, alt: i18n.t('ui.title.emblem'), draggable: false }));
  }
}
