/**
 * The Settings screen (GDD 2.14 "Settings"): Graphics, Gameplay, Audio, Text and Controls tabs over a scrim,
 * bound live to src/core/Settings.ts. Every change applies at once and is saved by Settings; main.ts, I18n,
 * Input and the audio engine follow `settings:changed` themselves.
 *
 *   const settingsUI = new SettingsUI();
 *   await settingsUI.open();                     // from the title screen or the pause menu
 *   await settingsUI.open({ tab: 'controls' });  // Pause > CONTROLS
 *
 * - Keyboard: Tab / arrows move focus (focus stays inside), Left / Right change an option, a slider or the tab
 *   (when the tab row has focus), Enter / Space press, Esc goes back.
 * - Gamepad: d-pad / left stick move and change, A presses, B goes back, LB / RB switch tabs (settings-nav.ts).
 * - Touch: big buttons and sliders; the panel scrolls.
 * - The language switch rebuilds the screen in place, keeping the focused control.
 *
 * While the screen is open, Esc and pad buttons are still seen by Input (it listens first, on window), so the
 * caller should ignore its own back / pause handling until open() resolves.
 */
import './settings.css';
import './settings-phone.css';
import { events } from '../core/Events';
import { services } from '../core/Services';
import type { InputDevice } from '../core/Input';
import { h, listen, uiRoot } from './dom';
import { ControlsTab } from './settings-controls';
import { focusInto, moveFocus, PadNav, tabbables, type NavDir } from './settings-nav';
import { VolumePreview } from './settings-preview';
import { isSettingsTab, rowsFor, SETTINGS_TABS, type SettingsTab, type VolumeKey } from './settings-rows';
import { buildSettingsView, tabElementId, type SettingsView } from './settings-view';
import { buildWidget, type Widget } from './settings-widgets';

export { SETTINGS_TABS, type SettingsTab } from './settings-rows';

export interface SettingsOpenOptions {
  /** 'general' (default) | 'sound' | 'controls' | 'advanced' | 'about'. Unknown values open General. */
  tab?: string;
}

const ARROWS: Record<NavDir, string> = {
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
};
const KEY_DIRS: Readonly<Record<string, NavDir>> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

export class SettingsUI {
  private readonly parent: HTMLElement;
  private readonly preview = new VolumePreview();
  private view: SettingsView | null = null;
  private tab: SettingsTab = 'general';
  private widgets: Widget[] = [];
  private controls: ControlsTab | null = null;
  private offs: Array<() => void> = [];
  private pad: PadNav | null = null;
  private closed: Promise<void> | null = null;
  private resolveClosed: (() => void) | null = null;
  private returnFocus: HTMLElement | null = null;
  /** Device the glyphs and the capture prompt are shown for (Input's, or 'pad' once PadNav sees a press). */
  private device: InputDevice = 'kbm';
  private disposed = false;

  constructor(parent: HTMLElement = uiRoot()) {
    this.parent = parent;
  }

  get isOpen(): boolean {
    return this.view !== null;
  }

  get currentTab(): SettingsTab {
    return this.tab;
  }

  /** Shows the screen (or switches tab if it is already open). Resolves when it closes. */
  open(opts: SettingsOpenOptions = {}): Promise<void> {
    if (this.disposed) return Promise.resolve();
    const tab = isSettingsTab(opts.tab) ? opts.tab : 'general';
    if (this.view && this.closed) {
      this.selectTab(tab, true);
      return this.closed;
    }
    this.tab = tab;
    const active = document.activeElement;
    this.returnFocus = active instanceof HTMLElement && active !== document.body ? active : null;
    services.tryGet('input')?.releasePointerLock(); // a menu needs the mouse (not a pause press)
    this.device = inputDevice();
    this.build(null);
    this.subscribe();
    this.pad = new PadNav({
      used: () => this.applyDevice('pad'),
      dir: (d) => this.padDir(d),
      accept: () => this.padAccept(),
      back: () => (this.controls?.isCapturing ? this.controls.cancelCapture() : this.close()),
      shoulder: (delta) => this.cycleTab(delta),
    });
    events.emit('sfx', { id: 'ui_open' });
    this.closed = new Promise<void>((resolve) => {
      this.resolveClosed = resolve;
    });
    return this.closed;
  }

  /** Back to whoever opened it (focus returns there too). */
  close(): void {
    if (!this.view) return;
    this.teardown();
    events.emit('sfx', { id: 'ui_close' });
    const back = this.returnFocus;
    this.returnFocus = null;
    if (back?.isConnected) back.focus({ preventScroll: true });
    this.finish();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.view) this.teardown();
    this.returnFocus = null;
    this.preview.dispose();
    this.finish();
  }

  // ----------------------------------------------------------------------------------------------- building

  /** Builds the overlay. `focusId` restores focus after a rebuild (language change); null focuses the tab. */
  private build(focusId: string | null, pop = true): SettingsView {
    const view = buildSettingsView(
      { back: () => this.close(), tab: (id) => this.selectTab(id, true), tabKey: this.onTabKey },
      pop,
    );
    this.view = view;
    // Back from the pad glyphs once a pointer is used (Input, listening first, already knows which one).
    view.root.addEventListener('pointerdown', () => this.applyDevice(inputDevice()));
    this.parent.appendChild(view.root);
    this.renderBody();
    this.applyDevice(this.device);
    const target = focusId ? view.root.querySelector<HTMLElement>(`[data-focus-id="${focusId}"]`) : null;
    focusInto(target ?? this.tabButton(this.tab) ?? view.body);
    return view;
  }

  /** Fills the tab panel for the current tab. */
  private renderBody(): void {
    const view = this.view;
    if (!view) return;
    this.clearBody();
    for (const b of view.tabs) {
      const on = b.dataset.focusId === `tab:${this.tab}`;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    view.body.setAttribute('aria-labelledby', tabElementId(this.tab));
    if (this.tab === 'controls') {
      this.controls = new ControlsTab(view.panel, this.device);
      view.body.appendChild(this.controls.el);
    } else {
      const host = { volumeReleased: (key: VolumeKey) => this.preview.schedule(key) };
      this.widgets = rowsFor(this.tab).map((spec) => buildWidget(spec, host));
      view.body.appendChild(
        h(
          'div',
          { className: 'pg-set-rows' },
          this.widgets.map((w) => w.el),
        ),
      );
    }
    view.body.scrollTop = 0;
  }

  private clearBody(): void {
    this.controls?.dispose();
    this.controls = null;
    this.widgets = [];
    this.view?.body.replaceChildren();
  }

  /** Rebuilds every string in place (language change), keeping the tab and the focused control. */
  private rebuild(): void {
    if (!this.view) return;
    const active = document.activeElement;
    const focusId = active instanceof HTMLElement ? (active.dataset.focusId ?? null) : null;
    const nav = this.view.root.classList.contains('is-nav');
    this.clearBody();
    this.view.root.remove();
    this.view = null;
    const view = this.build(focusId, false);
    if (nav) view.root.classList.add('is-nav');
  }

  private teardown(): void {
    for (const off of this.offs.splice(0)) off();
    this.pad?.dispose();
    this.pad = null;
    this.preview.dispose();
    this.clearBody();
    this.view?.root.remove();
    this.view = null;
  }

  private finish(): void {
    const resolve = this.resolveClosed;
    this.resolveClosed = null;
    this.closed = null;
    resolve?.();
  }

  private subscribe(): void {
    const sync = (): void => {
      for (const w of this.widgets) w.sync();
    };
    this.offs.push(
      events.on('settings:changed', sync),
      events.on('quality:changed', sync),
      events.on('lang:changed', () => this.rebuild()),
      events.on('input:bindings', () => this.controls?.refresh()),
      events.on('input:device', ({ device }) => this.applyDevice(device)),
      // On document, so a screen underneath that listens on window never sees the keys handled here.
      listen(document, 'keydown', this.onKey),
    );
  }

  private applyDevice(device: InputDevice): void {
    this.device = device;
    const view = this.view;
    if (!view) return;
    const pad = device === 'pad';
    for (const el of view.padOnly) el.hidden = !pad;
    for (const el of view.nonPad) el.hidden = pad;
    this.controls?.setDevice(device);
  }

  // --------------------------------------------------------------------------------------------------- tabs

  private tabButton(id: SettingsTab): HTMLButtonElement | null {
    return this.view?.tabs.find((b) => b.dataset.focusId === `tab:${id}`) ?? null;
  }

  private selectTab(id: SettingsTab, focusTab: boolean): void {
    if (!this.view) return;
    if (id !== this.tab) {
      this.tab = id;
      this.renderBody();
      events.emit('sfx', { id: 'ui_click' });
    }
    const button = this.tabButton(id);
    if (focusTab && button) focusInto(button);
  }

  private cycleTab(delta: -1 | 1): void {
    if (this.controls?.isCapturing) return;
    const i = SETTINGS_TABS.indexOf(this.tab);
    const next = SETTINGS_TABS[(i + delta + SETTINGS_TABS.length) % SETTINGS_TABS.length];
    this.markNav();
    if (next) this.selectTab(next, true);
  }

  private readonly onTabKey = (e: KeyboardEvent): void => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const i = SETTINGS_TABS.indexOf(this.tab);
    let next: SettingsTab | undefined;
    if (e.key === 'ArrowLeft') next = SETTINGS_TABS[Math.max(0, i - 1)];
    else if (e.key === 'ArrowRight') next = SETTINGS_TABS[Math.min(SETTINGS_TABS.length - 1, i + 1)];
    else if (e.key === 'Home') next = SETTINGS_TABS[0];
    else if (e.key === 'End') next = SETTINGS_TABS[SETTINGS_TABS.length - 1];
    if (!next) return;
    e.preventDefault();
    e.stopPropagation(); // handled: the screen's arrow navigation must not move focus too
    this.markNav();
    this.selectTab(next, true);
  };

  // ---------------------------------------------------------------------------------------- keyboard and pad

  private readonly onKey = (e: KeyboardEvent): void => {
    const view = this.view;
    // Rows and tabs stop the arrows they use. defaultPrevented is not checked: Input prevents the default
    // of bound keys whenever gameplay is active.
    if (!view || this.controls?.isCapturing) return;
    if (e.isTrusted) this.applyDevice(inputDevice()); // a real key: leave the pad glyphs
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.close();
      return;
    }
    if (e.key === 'Tab') {
      e.stopPropagation();
      this.trapTab(e, view.root);
      return;
    }
    const dir = KEY_DIRS[e.key];
    if (!dir) return;
    e.preventDefault(); // no page scroll, no native slider step on Up / Down
    e.stopPropagation();
    this.markNav();
    moveFocus(view.root, dir);
  };

  /** Keeps Tab focus inside the overlay. */
  private trapTab(e: KeyboardEvent, root: HTMLElement): void {
    const items = tabbables(root);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    const active = document.activeElement;
    const inside = active instanceof Node && root.contains(active);
    if (e.shiftKey && (!inside || active === first)) {
      e.preventDefault();
      focusInto(last);
    } else if (!e.shiftKey && (!inside || active === last)) {
      e.preventDefault();
      focusInto(first);
    }
  }

  /** Pad directions go through the same key handlers (code '' so Input ignores them). */
  private padDir(dir: NavDir): void {
    const view = this.view;
    if (!view || this.controls?.isCapturing) return;
    this.markNav();
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !view.root.contains(active)) {
      moveFocus(view.root, dir);
      return;
    }
    active.dispatchEvent(new KeyboardEvent('keydown', { key: ARROWS[dir], bubbles: true, cancelable: true }));
  }

  private padAccept(): void {
    const view = this.view;
    if (!view || this.controls?.isCapturing) return;
    this.markNav();
    const active = document.activeElement;
    if (active instanceof HTMLButtonElement && view.root.contains(active) && !active.disabled) active.click();
  }

  /** Shows the focus ring for keyboard-arrow and pad navigation (pointer input hides it again). */
  private markNav(): void {
    this.view?.root.classList.add('is-nav');
  }
}

function inputDevice(): InputDevice {
  return services.tryGet('input')?.device ?? 'kbm';
}
