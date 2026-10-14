/**
 * MY SATCHEL (GDD 2.14, 2.6 "Tab / View / satchel icon, pauses the game"): THE ROLL, PROMISES, FRIENDS MET, MAP
 * and CARRIED, bound to the session GameState ('state' service).
 *
 *   const satchel = new SatchelUI({ map: () => ({ level: world.level, player: { x, z, heading } }) });
 *   if (input.pressed('satchel') && canOpen) await satchel.open();   // resolves when it closes
 *
 * - The caller decides when it may open. While open the loop is paused (`engine.loop.paused`), gameplay input is
 *   off, and the Satchel closes itself on the Satchel or Pause action (Tab / Esc / View / Menu, as bound), on B,
 *   on the close button or a tap on the scrim. Those presses are read in a loop System at order 990, after the
 *   game's systems, so the press that closes it can never reopen it in the same step.
 * - On close the loop's paused flag goes back to what it was (opened from the pause menu → still paused), and
 *   gameplay input comes back only if the game was running.
 * - Registers itself as the 'satchel' service. The pause menu's SATCHEL button goes through GameFlow:
 *   `flow.setScreen('satchel', satchelScreen())` (satchel-screen.ts).
 * - Events: 'satchel:opened' {tab}, 'satchel:tab' {tab}, 'satchel:closed', 'satchel:use' {id} (after closing,
 *   when a carried item's "Use" is pressed; e.g. the Key of Promise at a Doubting Castle lock).
 */
import '../audio/events';
import { events } from '../core/Events';
import { GameState } from '../core/GameState';
import type { System } from '../core/Loop';
import { services } from '../core/Services';
import { listen, uiRoot } from './dom';
import {
  applyChromeText,
  buildChrome,
  selectTabButton,
  updateFooter,
  type SatchelChrome,
} from './satchel-chrome';
import { renderCarried } from './satchel-carried';
import { renderFriends } from './satchel-friends';
import { renderMap } from './satchel-map';
import { SatchelControls, rafDriver } from './satchel-input';
import { PadNav, SatchelNav, focusAndReveal } from './satchel-nav';
import { cancelPortraits, loadPortrait } from './satchel-portraits';
import { renderPromises } from './satchel-promises';
import { renderRoll } from './satchel-roll';
import {
  SATCHEL_TABS,
  type PageResult,
  type SatchelMapContext,
  type SatchelTab,
  type SatchelView,
} from './satchel-view';
import './satchel.css';
import './satchel-pages.css';

export { SATCHEL_TABS, isSatchelTab } from './satchel-view';
export { openSatchel, satchelScreen, type SatchelScreenContext } from './satchel-screen';
export type { SatchelMapContext, SatchelPlayer, SatchelTab } from './satchel-view';

declare module '../core/Events' {
  interface EventMap {
    'satchel:opened': { tab: SatchelTab };
    'satchel:tab': { tab: SatchelTab };
    'satchel:closed': void;
    'satchel:use': { id: string };
  }
}
declare module '../core/Services' {
  interface ServiceMap {
    satchel: SatchelUI;
  }
}

export interface SatchelOptions {
  /** Default: the #ui root. */
  parent?: HTMLElement;
  /** Called on every open: the level and player for the MAP tab (null: "no map here"). */
  map?: () => SatchelMapContext | null;
  /** Whether a carried item can be used right now (shows "Use" on its card). Default: never. */
  canUse?: (itemId: string) => boolean;
  /** Whether gameplay input comes back when the Satchel closes over a running game (default true). */
  resumeGameplay?: () => boolean;
  /** Register as the 'satchel' service (default true). */
  register?: boolean;
}

/** Per-open extras; `level` / `player` here win over `options.map`. */
export interface SatchelOpenContext {
  level?: SatchelMapContext['level'];
  player?: SatchelMapContext['player'];
  canUse?: (itemId: string) => boolean;
}

/** After the game's own systems (and before the render at 1000). */
const SYSTEM_ORDER = 990;
const RENDERERS: Record<SatchelTab, (view: SatchelView) => PageResult> = {
  roll: renderRoll,
  promises: renderPromises,
  friends: renderFriends,
  map: renderMap,
  carried: renderCarried,
};
const RERENDER_EVENTS = [
  'promise:collected',
  'friend:met',
  'objective:changed',
  'roll:changed',
  'item:given',
  'item:taken',
  'gift:given',
  'detour:entered',
  'chapter:changed',
  'state:reset',
] as const;
interface Session {
  resolve: () => void;
  promise: Promise<void>;
  wasPaused: boolean;
  /** Close keys arrive as Input actions in the loop step (else straight from keydown). */
  viaLoop: boolean;
  restoreFocus: Element | null;
  map: SatchelMapContext | null;
  canUse: ((itemId: string) => boolean) | null;
  skipSteps: number;
  offs: Array<() => void>;
  timers: Set<number>;
  raf: number;
}

export class SatchelUI {
  private readonly opts: SatchelOptions;
  private readonly c: SatchelChrome;
  private readonly nav: SatchelNav;
  private readonly controls: SatchelControls;
  private readonly pad = new PadNav();
  private current: SatchelTab = 'roll';
  private session: Session | null = null;
  private pageToken = 0;
  private spare: GameState | null = null;
  private disposed = false;

  constructor(opts: SatchelOptions = {}) {
    this.opts = opts;
    this.c = buildChrome(
      (tab) => this.selectTab(tab, true),
      () => this.close(),
    );
    this.nav = new SatchelNav(this.c.panel, {
      tabs: () => [...this.c.tabs.values()].map((p) => p.button),
      stepTab: (d) => this.stepTab(d),
      gotoTab: (i) => this.selectTab(SATCHEL_TABS[i] ?? this.current, true),
      fallback: () => this.c.tabs.get(this.current)?.button ?? null,
    });
    this.controls = new SatchelControls({
      nav: this.nav,
      root: this.c.root,
      panel: this.c.panel,
      close: () => this.close(),
      stepTab: (d) => this.stepTab(d),
      gotoTab: (i) => this.selectTab(SATCHEL_TABS[i] ?? this.current, true),
      tabCount: SATCHEL_TABS.length,
      viaLoop: () => this.session?.viaLoop ?? false,
    });
    // A tap on the dimmed scrim (outside the panel) closes; pointer use hides the keyboard focus style.
    this.c.root.addEventListener('click', (e) => {
      if (e.target === this.c.root) this.close();
    });
    this.c.root.addEventListener('pointerdown', () => this.c.root.classList.remove('is-nav'));
    if (opts.register !== false) services.register('satchel', this);
  }

  get isOpen(): boolean {
    return this.session !== null;
  }

  get tab(): SatchelTab {
    return this.current;
  }

  /** Opens on `tab` (default: the last one shown). Resolves when the Satchel closes. */
  open(tab?: SatchelTab, ctx?: SatchelOpenContext): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (tab) this.current = tab;
    if (this.session) {
      this.session.map = this.mapFor(ctx);
      if (ctx?.canUse) this.session.canUse = ctx.canUse;
      this.renderAll();
      this.focusTab();
      return this.session.promise;
    }
    const engine = services.tryGet('engine');
    const input = services.tryGet('input');
    let resolve!: () => void;
    const promise = new Promise<void>((r) => (resolve = r));
    const s: Session = {
      resolve,
      promise,
      wasPaused: engine?.loop.paused ?? false,
      viaLoop: !!engine && engine.loop.isRunning && !!input,
      restoreFocus: document.activeElement,
      map: this.mapFor(ctx),
      canUse: ctx?.canUse ?? null,
      skipSteps: 1,
      offs: [],
      timers: new Set(),
      raf: 0,
    };
    this.session = s;
    if (engine) engine.loop.paused = true;
    input?.setGameplayActive(false);

    (this.opts.parent ?? uiRoot()).appendChild(this.c.root);
    this.c.root.classList.toggle('is-pad', input?.device === 'pad');
    this.renderAll();
    this.focusTab();

    this.pad.reset();
    const system: System = { updateWhenPaused: true, update: (dt) => this.step(dt) };
    s.offs.push(engine?.loop.isRunning ? engine.loop.add(system, SYSTEM_ORDER) : rafDriver(system));
    s.offs.push(listen(window, 'keydown', this.controls.onKey));
    for (const name of RERENDER_EVENTS) s.offs.push(events.on(name, () => this.queueRender()));
    s.offs.push(
      events.on('lang:changed', () => this.queueRender()),
      events.on('hope:changed', () => updateFooter(this.c, this.state())),
      events.on('promise:read', () => updateFooter(this.c, this.state())),
      events.on('input:device', ({ device }) => this.c.root.classList.toggle('is-pad', device === 'pad')),
    );
    events.emit('sfx', { id: 'ui_open' });
    events.emit('satchel:opened', { tab: this.current });
    return promise;
  }

  close(): void {
    const s = this.session;
    if (!s) return;
    this.session = null;
    this.pageToken++;
    for (const off of s.offs.splice(0)) off();
    for (const id of s.timers) window.clearTimeout(id);
    cancelPortraits();
    if (s.raf) cancelAnimationFrame(s.raf);
    this.c.root.remove();
    this.c.root.classList.remove('is-nav');
    const engine = services.tryGet('engine');
    if (engine) engine.loop.paused = s.wasPaused;
    if (!s.wasPaused) services.tryGet('input')?.setGameplayActive(this.opts.resumeGameplay?.() ?? true);
    if (s.restoreFocus instanceof HTMLElement && s.restoreFocus.isConnected) {
      s.restoreFocus.focus({ preventScroll: true });
    }
    if (!this.disposed) events.emit('sfx', { id: 'ui_close' });
    events.emit('satchel:closed');
    s.resolve();
  }

  /** Switch page while open (or choose the page the next open() shows). */
  showTab(tab: SatchelTab): void {
    this.selectTab(tab, this.isOpen);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.close();
    this.c.root.remove();
    if (services.tryGet('satchel') === this) services.unregister('satchel');
  }

  // ------------------------------------------------------------------------------------------- render

  private state(): GameState {
    return services.tryGet('state') ?? (this.spare ??= new GameState());
  }

  private mapFor(ctx?: SatchelOpenContext): SatchelMapContext | null {
    if (ctx && ctx.level !== undefined) return { level: ctx.level, player: ctx.player ?? null };
    return this.opts.map?.() ?? null;
  }

  private renderAll(): void {
    applyChromeText(this.c, this.current);
    selectTabButton(this.c, this.current);
    this.renderPage();
  }

  private renderPage(): void {
    const s = this.session;
    if (!s) return;
    const token = ++this.pageToken;
    cancelPortraits(); // faces still queued for the page being replaced
    const state = this.state();
    const view: SatchelView = {
      state,
      map: s.map,
      alive: () => this.session === s && this.pageToken === token,
      canUse: (id) => (s.canUse ?? this.opts.canUse)?.(id) === true,
      readPromise: (id) => this.readPromise(state, id),
      useItem: (id) => this.useItem(id),
      portrait: (recipe, expr) => loadPortrait(recipe, expr),
      later: (fn, ms) => {
        const timer = window.setTimeout(() => {
          s.timers.delete(timer);
          fn();
        }, ms);
        s.timers.add(timer);
      },
    };
    this.c.page.replaceChildren(RENDERERS[this.current](view).el);
    updateFooter(this.c, state);
  }

  /** Re-render once per frame at most after state changes, keeping the focused stop (by data-key) and scroll. */
  private queueRender(): void {
    const s = this.session;
    if (!s || s.raf) return;
    s.raf = requestAnimationFrame(() => {
      s.raf = 0;
      if (this.session !== s) return;
      const active = document.activeElement;
      const key =
        active instanceof HTMLElement && this.c.panel.contains(active) ? active.dataset['key'] : undefined;
      const scroll = this.c.body.scrollTop;
      this.renderAll();
      this.c.body.scrollTop = scroll;
      const again = key ? this.c.panel.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`) : null;
      if (again) again.focus({ preventScroll: true });
      else if (key) this.focusTab();
    });
  }

  private selectTab(tab: SatchelTab, focus: boolean): void {
    if (tab === this.current) {
      if (focus && this.session) this.focusTab();
      return;
    }
    this.current = tab;
    if (!this.session) return;
    selectTabButton(this.c, tab);
    this.renderPage();
    this.c.body.scrollTop = 0;
    if (focus) this.focusTab();
    events.emit('sfx', { id: 'ui_click' });
    events.emit('satchel:tab', { tab });
  }

  private stepTab(delta: -1 | 1): void {
    const i = SATCHEL_TABS.indexOf(this.current);
    const next = SATCHEL_TABS[(i + delta + SATCHEL_TABS.length) % SATCHEL_TABS.length]!;
    this.selectTab(next, true);
  }

  private focusTab(): void {
    const button = this.c.tabs.get(this.current)?.button;
    if (button) focusAndReveal(button);
  }

  // ------------------------------------------------------------------------------------------ actions

  private readPromise(state: GameState, id: string): number {
    const gained = state.readPromise(id);
    events.emit('sfx', { id: gained > 0 ? 'promise_chime' : 'ui_click' });
    if (gained > 0) events.emit('sfx', { id: 'sparkle', volume: 0.6 });
    updateFooter(this.c, state);
    return gained;
  }

  private useItem(id: string): void {
    events.emit('sfx', { id: 'ui_click' });
    this.close();
    events.emit('satchel:use', { id });
  }

  // -------------------------------------------------------------------------------------------- input

  /** Loop step (fixed 60 Hz, also while paused): close presses and the gamepad. */
  private step(dt: number): void {
    const s = this.session;
    if (!s) return;
    if (s.skipSteps > 0) {
      s.skipSteps--;
      this.pad.reset();
      return;
    }
    const input = services.tryGet('input');
    if (s.viaLoop && input && (input.pressed('satchel') || input.pressed('pause'))) {
      this.close();
      return;
    }
    for (const cmd of this.pad.poll(dt)) {
      if (this.session !== s) return;
      this.controls.pad(cmd);
    }
  }
}
