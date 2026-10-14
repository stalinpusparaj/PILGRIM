/**
 * Focus navigation for every menu screen (GDD 2.14 screens, GDD 2.15 Accessibility: "Playable with keyboard only,
 * gamepad only, or touch only").
 *
 *   const menu = new Menu({ root: panel, nav: 'vertical', onBack: () => close() });
 *   ...
 *   menu.dispose();
 *
 * - Items are the elements inside `root` with `data-menu-item` (see `menuButton()` in menu-screen.ts), in DOM
 *   order unless `items` is given. Hidden and `disabled` items are skipped; `aria-disabled` ones stay
 *   focusable so their state can be read.
 * - Keyboard: arrows move (index order on the main axis with wrap, spatial on the cross axis; 'grid' is
 *   spatial both ways), Tab / Shift+Tab cycle inside the menu (focus trap), Enter / Space activate the focused
 *   button natively (repeats ignored), E activates, Escape / Backspace = back, Home / End.
 * - Gamepad (menu-pad.ts): d-pad / left stick with repeat, A select, B back, Menu, LB / RB.
 * - Pointer: tap / click activate (native click), mouse hover moves the focus.
 * - Sounds: 'ui_click' when the focus moves, 'ui_choice' on activation, 'ui_close' on back.
 *
 * Menus stack: only the newest live menu reacts to keys and the pad. Disposing it hands control (and focus)
 * back to the one below. A screen that is not a Menu (Settings, Satchel) covers a menu with `suspend()`.
 */
import { events } from '../core/Events';
import type { SfxId } from '../audio/types';
import '../audio/events';
import { isFormField } from './dom';
import type { PadDir, PadSink } from './menu-pad';
import { menuStack } from './menu-stack';
import { KEY_DIRS, isUsable, scrollToShow, spatialNext } from './menu-nav';

export type MenuNav = 'vertical' | 'horizontal' | 'grid';
export type MenuDir = PadDir;

export interface MenuOptions {
  /** Element holding the items (and the hover / click listeners). */
  root: HTMLElement;
  /** Default 'vertical'. */
  nav?: MenuNav;
  /** Items in navigation order (default: `[data-menu-item]` inside root, DOM order). */
  items?: () => HTMLElement[];
  /** First focus (default: the first `[data-primary]` item, else the first item). */
  initial?: () => HTMLElement | null;
  /** Wrap around the ends (default true). */
  wrap?: boolean;
  /** Escape, Backspace, pad B. */
  onBack?: () => void;
  /** Pad Menu / Start. */
  onMenuButton?: () => void;
  /** Pad LB / RB and the [ ] keys: switch tabs. */
  onShoulder?: (dir: -1 | 1) => void;
  /** Sees every direction first (arrows, d-pad, stick); return true to keep it (e.g. scroll a text). */
  onNavigate?: (dir: MenuDir) => boolean;
  /** Play the UI sounds (default true). */
  sounds?: boolean;
  /** Focus the initial item now (default true). */
  autoFocus?: boolean;
}

const ITEM_SELECTOR = '[data-menu-item]';
const FOCUSED_CLASS = 'is-focused';
const HOVER_SOUND_GAP_MS = 60;

function sfx(id: SfxId, volume?: number): void {
  events.emit('sfx', volume === undefined ? { id } : { id, volume });
}

const noteInput = (): void => menuStack.noteInput();

export class Menu {
  /** True while a screen that is not a Menu covers this one. */
  suspended = false;
  readonly padSink: PadSink;

  private readonly opts: MenuOptions;
  private readonly nav: MenuNav;
  private readonly offs: Array<() => void> = [];
  private current: HTMLElement | null = null;
  private lastHoverSound = 0;
  private disposed = false;

  constructor(opts: MenuOptions) {
    this.opts = opts;
    this.nav = opts.nav ?? 'vertical';
    const root = opts.root;
    const on = <K extends keyof HTMLElementEventMap>(
      type: K,
      fn: (e: HTMLElementEventMap[K]) => void,
      capture = false,
    ): void => {
      root.addEventListener(type, fn, capture);
      this.offs.push(() => root.removeEventListener(type, fn, capture));
    };
    on('focusin', (e) => {
      const item = this.itemOf(e.target);
      if (item) this.mark(item);
    });
    on('pointermove', (e) => {
      if (e.pointerType !== 'mouse' || !this.isActive) return;
      const item = this.itemOf(e.target);
      if (item && item !== this.current) {
        const now = performance.now();
        const sound = now - this.lastHoverSound > HOVER_SOUND_GAP_MS;
        this.lastHoverSound = now;
        this.focus(item, sound);
      }
    });
    // Capture: the sound plays before the item's own handler, which may close this menu.
    on(
      'click',
      (e) => {
        const item = this.itemOf(e.target);
        if (!item || item.getAttribute('aria-disabled') === 'true') return;
        noteInput();
        if (this.opts.sounds !== false) sfx('ui_choice');
      },
      true,
    );
    this.padSink = {
      move: (dir) => {
        menuStack.setModality('pad');
        noteInput();
        this.move(dir);
      },
      select: () => {
        menuStack.setModality('pad');
        noteInput();
        this.activate();
      },
      back: () => {
        menuStack.setModality('pad');
        noteInput();
        this.back();
      },
      menu: () => {
        noteInput();
        this.opts.onMenuButton?.();
      },
      shoulder: (dir) => {
        noteInput();
        this.opts.onShoulder?.(dir);
      },
    };
    menuStack.push(this);
    if (opts.autoFocus !== false) this.focusInitial();
  }

  /** Milliseconds since any menu last handled a key, pad button or click (pause-key debounce in GameFlow). */
  static sinceLastInput(): number {
    return menuStack.sinceLastInput();
  }

  /** Number of live menus (tests, leak checks). */
  static get depth(): number {
    return menuStack.depth;
  }

  /** The newest live, unsuspended menu. */
  static get active(): Menu | null {
    const m = menuStack.active();
    return m instanceof Menu ? m : null;
  }

  get isActive(): boolean {
    return !this.disposed && menuStack.active() === this;
  }

  get root(): HTMLElement {
    return this.opts.root;
  }

  get focused(): HTMLElement | null {
    return this.current;
  }

  /** Navigable items right now (visible, not `disabled`). */
  items(): HTMLElement[] {
    const all = this.opts.items
      ? this.opts.items()
      : [...this.opts.root.querySelectorAll<HTMLElement>(ITEM_SELECTOR)];
    return all.filter(isUsable);
  }

  focusInitial(): void {
    const items = this.items();
    const wanted = this.opts.initial?.() ?? items.find((el) => el.hasAttribute('data-primary')) ?? items[0];
    if (wanted && isUsable(wanted)) this.focus(wanted, false);
  }

  /** Focuses an item (shows the ring for keyboard / pad / mouse players). */
  focus(el: HTMLElement | null, sound = true): void {
    if (!el || this.disposed) return;
    const moved = el !== this.current;
    this.mark(el);
    const showRing = menuStack.modality !== 'touch';
    el.focus({ preventScroll: true, focusVisible: showRing } as FocusOptions);
    scrollToShow(el, this.opts.root);
    if (moved && sound && this.opts.sounds !== false) sfx('ui_click', 0.6);
  }

  /** Moves the focus one step; returns false when nothing lies that way. */
  move(dir: MenuDir): boolean {
    if (this.opts.onNavigate?.(dir)) return true;
    const items = this.items();
    if (items.length === 0) return false;
    const from = this.current && items.includes(this.current) ? this.current : null;
    if (!from) {
      this.focusInitial();
      return true;
    }
    const next = this.pick(items, from, dir);
    if (!next || next === from) return false;
    this.focus(next);
    return true;
  }

  /** Clicks the focused item (keyboard E, pad A). */
  activate(el: HTMLElement | null = this.current): void {
    if (!el || !isUsable(el)) return;
    el.click();
  }

  back(): void {
    if (!this.opts.onBack) return;
    if (this.opts.sounds !== false) sfx('ui_close');
    this.opts.onBack();
  }

  /** A screen that is not a Menu now covers this one: stop reacting until resume(). */
  suspend(): void {
    this.suspended = true;
    menuStack.reprime();
  }

  resume(): void {
    if (this.disposed) return;
    this.suspended = false;
    menuStack.reprime();
    this.restoreFocus();
  }

  /** Puts the focus back on the last focused item (when a menu above closes). */
  restoreFocus(): void {
    const items = this.items();
    if (this.current && items.includes(this.current)) this.focus(this.current, false);
    else this.focusInitial();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const off of this.offs.splice(0)) off();
    this.current?.classList.remove(FOCUSED_CLASS);
    this.current = null;
    menuStack.pop(this);
  }

  // ------------------------------------------------------------------------------------------- internals

  /** Keyboard handling for the active menu; returns true when the key was used. */
  handleKey(e: KeyboardEvent): boolean {
    const inField = isFormField(e.target);
    switch (e.code) {
      case 'Escape':
        if (!this.opts.onBack) return false;
        this.back();
        return true;
      case 'Backspace':
        if (inField || !this.opts.onBack) return false;
        this.back();
        return true;
      case 'ArrowUp':
      case 'ArrowDown':
      case 'ArrowLeft':
      case 'ArrowRight':
        if (inField) return false;
        this.move(KEY_DIRS[e.code]);
        return true;
      case 'Tab':
        this.cycle(e.shiftKey ? -1 : 1);
        return true;
      case 'Home':
      case 'End': {
        const items = this.items();
        this.focus(e.code === 'Home' ? (items[0] ?? null) : (items[items.length - 1] ?? null));
        return true;
      }
      case 'BracketLeft':
      case 'BracketRight':
        if (!this.opts.onShoulder) return false;
        this.opts.onShoulder(e.code === 'BracketLeft' ? -1 : 1);
        return true;
      case 'Enter':
      case 'NumpadEnter':
      case 'Space': {
        if (e.repeat) return true; // holding Enter must not click again and again
        const onItem = this.itemOf(e.target);
        if (onItem) return false; // the focused button activates natively
        if (inField) return false;
        this.activate();
        return true;
      }
      case 'KeyE':
        if (inField || e.repeat) return false;
        this.activate();
        return true;
      default:
        return false;
    }
  }

  private cycle(step: 1 | -1): void {
    const items = this.items();
    if (items.length === 0) return;
    const i = this.current ? items.indexOf(this.current) : -1;
    const next = i < 0 ? 0 : (i + step + items.length) % items.length;
    this.focus(items[next] ?? null);
  }

  private pick(items: HTMLElement[], from: HTMLElement, dir: MenuDir): HTMLElement | null {
    const wrap = this.opts.wrap !== false;
    const vertical = dir === 'up' || dir === 'down';
    const step = dir === 'down' || dir === 'right' ? 1 : -1;
    const mainAxis = (this.nav === 'vertical' && vertical) || (this.nav === 'horizontal' && !vertical);
    const i = items.indexOf(from);
    const byIndex = (): HTMLElement | null => {
      const j = i + step;
      if (j >= 0 && j < items.length) return items[j] ?? null;
      return wrap ? (items[(j + items.length) % items.length] ?? null) : null;
    };
    if (mainAxis) return byIndex();
    const spatial = spatialNext(items, from, dir);
    if (spatial) return spatial;
    // Grids fall back to reading order across row ends (Right at a row end → next row).
    return this.nav === 'grid' && !vertical ? byIndex() : null;
  }

  private itemOf(target: EventTarget | null): HTMLElement | null {
    if (!(target instanceof Element)) return null;
    const item = target.closest<HTMLElement>(ITEM_SELECTOR);
    return item && this.opts.root.contains(item) ? item : null;
  }

  private mark(el: HTMLElement): void {
    if (this.current && this.current !== el) this.current.classList.remove(FOCUSED_CLASS);
    this.current = el;
    el.classList.toggle(FOCUSED_CLASS, menuStack.modality !== 'touch');
  }
}
