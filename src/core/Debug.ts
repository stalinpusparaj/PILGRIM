/**
 * Developer panel (dev builds or `?debug=1` only; GDD 2.15 "Debug").
 *
 * A small plain-DOM panel in the top-right corner. Systems add readouts and controls through the API below;
 * every add* call returns a remove function so a chapter can take its controls away in dispose(). F1 toggles
 * the panel: it listens for the key on `window` itself so it works before Input exists (and follows the
 * remapped `debug` binding once installCoreDebug() hands it the Input). Debug text is developer-only English.
 */
import { events } from './Events';
import { services } from './Services';
import { debugEnabled, urlParams } from './Flags';
import type { Quality, QualityLevel } from './Quality';
import type { Engine } from './Engine';
import type { Input } from './Input';
import { h, listen, setText, setVisible } from '../ui/dom';

declare module './Services' {
  interface ServiceMap {
    debug: Debug;
  }
}

declare module './Events' {
  interface EventMap {
    /** The debug panel was shown or hidden (dev only). */
    'debug:toggled': { visible: boolean };
  }
}

/** Readouts and bound controls refresh at ~4 Hz, never per frame. */
const REFRESH_MS = 250;
const DEFAULT_HOTKEYS: readonly string[] = ['F1'];

export interface DebugOptions {
  /** Start visible. Defaults to `?debug=1`. */
  visible?: boolean;
  /** Where the panel is mounted. Defaults to document.body (outside #ui, so UI screens never clear it). */
  parent?: HTMLElement;
}

interface Readout {
  label: string;
  fn: () => string;
  value: HTMLElement;
  failed: boolean;
}

interface Group {
  el: HTMLDetailsElement;
  body: HTMLDivElement;
  items: number;
}

export class Debug {
  private readonly root: HTMLElement;
  private readonly readoutBox: HTMLDivElement;
  private readonly groupBox: HTMLDivElement;
  private readonly style: HTMLStyleElement;
  private readonly readouts = new Set<Readout>();
  /** Re-sync functions for controls that mirror external state (toggles, sliders). */
  private readonly syncs = new Set<() => void>();
  private readonly groups = new Map<string, Group>();
  private readonly offKey: () => void;
  private hotkeys: () => readonly string[] = () => DEFAULT_HOTKEYS;
  private timer: number | null = null;
  private shown = false;
  private disposed = false;

  constructor(opts: DebugOptions = {}) {
    this.style = h('style', { id: 'pilgrim-debug-style' }, PANEL_CSS);
    document.head.appendChild(this.style);

    const close = h(
      'button',
      { type: 'button', className: 'dbg-x', title: 'Close (F1)', 'aria-label': 'Close debug panel' },
      '×',
    );
    close.addEventListener('click', () => this.setVisible(false));

    this.readoutBox = h('div', { className: 'dbg-readouts' });
    this.groupBox = h('div', { className: 'dbg-groups' });
    this.root = h(
      'section',
      { className: 'dbg', 'aria-label': 'Debug panel', hidden: true },
      h(
        'header',
        { className: 'dbg-head' },
        h('strong', null, 'PILGRIM debug'),
        h('span', null, 'F1'),
        close,
      ),
      this.readoutBox,
      this.groupBox,
    );
    (opts.parent ?? document.body).appendChild(this.root);

    this.offKey = listen(window, 'keydown', this.onKeyDown);
    services.register('debug', this);
    this.setVisible(opts.visible ?? urlParams.debug);
  }

  get visible(): boolean {
    return this.shown;
  }

  /** F1. */
  toggle(): void {
    this.setVisible(!this.shown);
  }

  setVisible(visible: boolean): void {
    if (this.disposed || visible === this.shown) return;
    this.shown = visible;
    setVisible(this.root, visible);
    if (visible) {
      // Free the mouse so the panel can be used at once; through Input, so it does not count as Esc (pause).
      const input = services.tryGet('input');
      if (input) input.releasePointerLock();
      else if (document.pointerLockElement) document.exitPointerLock();
      this.refresh();
      this.timer = window.setInterval(() => this.refresh(), REFRESH_MS);
    } else if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    events.emit('debug:toggled', { visible });
  }

  /** Key codes that toggle the panel (e.g. the Input `debug` binding). An empty list falls back to F1. */
  setHotkeys(codes: () => readonly string[]): void {
    this.hotkeys = codes;
  }

  /** A live "label: value" line at the top of the panel. */
  addReadout(label: string, fn: () => string): () => void {
    const value = h('span', { className: 'dbg-v' });
    const row = h('div', { className: 'dbg-row' }, h('span', { className: 'dbg-k' }, label), value);
    const readout: Readout = { label, fn, value, failed: false };
    this.readouts.add(readout);
    this.readoutBox.appendChild(row);
    if (this.shown) this.updateReadout(readout);
    return once(() => {
      this.readouts.delete(readout);
      row.remove();
    });
  }

  addButton(group: string, label: string, fn: () => void): () => void {
    const btn = h('button', { type: 'button', className: 'dbg-btn' }, label);
    btn.addEventListener('click', () => guard(label, fn));
    return this.addToGroup(group, btn, null);
  }

  addToggle(group: string, label: string, get: () => boolean, set: (v: boolean) => void): () => void {
    const box = h('input', { type: 'checkbox' });
    box.addEventListener('change', () => {
      guard(label, () => set(box.checked));
      sync();
    });
    const sync = (): void => {
      const v = read(label, get);
      if (v !== undefined) box.checked = v;
    };
    sync();
    return this.addToGroup(group, h('label', { className: 'dbg-ctl' }, box, h('span', null, label)), sync);
  }

  addSlider(
    group: string,
    label: string,
    min: number,
    max: number,
    step: number,
    get: () => number,
    set: (v: number) => void,
  ): () => void {
    const digits = step > 0 && step < 1 ? Math.min(4, Math.ceil(-Math.log10(step) - 1e-9)) : 0;
    const out = h('output', { className: 'dbg-v' });
    const range = h('input', { type: 'range', min: String(min), max: String(max), step: String(step) });
    range.addEventListener('input', () => {
      const v = Number(range.value);
      guard(label, () => set(v));
      setText(out, v.toFixed(digits));
    });
    const sync = (): void => {
      const v = read(label, get);
      if (v === undefined) return;
      // Leave the thumb alone while the user is dragging or keyboard-adjusting it.
      if (document.activeElement !== range) range.value = String(v);
      setText(out, v.toFixed(digits));
    };
    sync();
    const ctl = h(
      'label',
      { className: 'dbg-ctl dbg-slider' },
      h('span', { className: 'dbg-k' }, label),
      range,
      out,
    );
    return this.addToGroup(group, ctl, sync);
  }

  /** Re-read every readout and bound control now (also runs on the 4 Hz timer while visible). */
  refresh(): void {
    for (const r of this.readouts) this.updateReadout(r);
    for (const sync of this.syncs) sync();
  }

  dispose(): void {
    if (this.disposed) return;
    if (this.shown) this.setVisible(false);
    this.disposed = true;
    this.offKey();
    this.root.remove();
    this.style.remove();
    this.readouts.clear();
    this.syncs.clear();
    this.groups.clear();
    if (services.tryGet('debug') === this) services.unregister('debug');
  }

  // -------------------------------------------------------------------------------------------------------

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.isHotkey(e.code)) return;
    e.preventDefault(); // F1 opens browser help otherwise
    if (!e.repeat) this.toggle();
  };

  private isHotkey(code: string): boolean {
    let codes: readonly string[] = DEFAULT_HOTKEYS;
    try {
      const bound = this.hotkeys();
      if (bound.length > 0) codes = bound;
    } catch {
      // Input not ready or disposed: keep F1 working.
    }
    return codes.includes(code);
  }

  private updateReadout(r: Readout): void {
    let text: string;
    try {
      text = r.fn();
      r.failed = false;
    } catch (err) {
      text = 'error';
      if (!r.failed) console.warn(`[debug] readout "${r.label}" threw`, err);
      r.failed = true;
    }
    setText(r.value, text);
  }

  private addToGroup(name: string, el: HTMLElement, sync: (() => void) | null): () => void {
    let group = this.groups.get(name);
    if (!group) {
      const body = h('div', { className: 'dbg-body' });
      const details = h('details', { className: 'dbg-group', open: true }, h('summary', null, name), body);
      this.groupBox.appendChild(details);
      group = { el: details, body, items: 0 };
      this.groups.set(name, group);
    }
    const g = group;
    g.items++;
    g.body.appendChild(el);
    if (sync) this.syncs.add(sync);
    return once(() => {
      el.remove();
      if (sync) this.syncs.delete(sync);
      if (--g.items === 0 && this.groups.get(name) === g) {
        g.el.remove();
        this.groups.delete(name);
      }
    });
  }
}

/** Construct the panel only when debugging is enabled (DEV or `?debug=1`); otherwise returns null. */
export function createDebug(opts?: DebugOptions): Debug | null {
  if (!debugEnabled) return null;
  return services.tryGet('debug') ?? new Debug(opts);
}

const QUALITY_BUTTONS: ReadonlyArray<[QualityLevel, string]> = [
  ['low', 'Low'],
  ['medium', 'Medium'],
  ['high', 'High'],
];

/**
 * Phase 0 readouts and controls. Safe to call unconditionally: without a registered Debug it does nothing.
 * Returns a function that removes everything it added.
 */
export function installCoreDebug(
  engine: Engine,
  quality: Quality,
  input: Input,
  debug: Debug | undefined = services.tryGet('debug'),
): () => void {
  if (!debug) return () => {};
  const d = debug;
  const loop = engine.loop;
  const removers: Array<() => void> = [
    d.addReadout('FPS', () => engine.stats.fps.toFixed(0)),
    d.addReadout('Frame ms', () => engine.stats.frameMs.toFixed(2)),
    d.addReadout('Draw calls', () => `${engine.stats.drawCalls} / ${quality.preset.maxDrawCalls}`),
    d.addReadout('Triangles', () => engine.stats.triangles.toLocaleString('en-US')),
    d.addReadout('Geo / Tex', () => `${engine.stats.geometries} / ${engine.stats.textures}`),
    d.addReadout('Quality', () => quality.preset.level),
    d.addReadout('Input', () => `${input.device}${input.pointerLocked ? ' (locked)' : ''}`),
    d.addReadout('Sim time', () => `${loop.elapsed.toFixed(1)} s`),
    d.addSlider('Time', 'Time scale', 0, 2, 0.05, () => loop.timeScale, setter(loop, 'timeScale')),
    d.addButton('Time', 'Normal speed', () => {
      loop.timeScale = 1;
    }),
    d.addToggle('Time', 'Pause loop', () => loop.paused, setter(loop, 'paused')),
    ...QUALITY_BUTTONS.map(([level, label]) =>
      // quality.set() emits 'quality:changed'; main.ts applies the (touch-adapted) preset plus the Shadows
      // setting to the Engine from that one listener, so the panel does not call engine.applyQuality itself.
      d.addButton('Quality', label, () => quality.set(level)),
    ),
  ];
  d.setHotkeys(() => input.getBindings('debug'));
  return () => {
    for (const remove of removers) remove();
    d.setHotkeys(() => DEFAULT_HOTKEYS);
  };
}

// ---------------------------------------------------------------------------------------------------------

/** Wrap a remover so calling it twice is harmless. */
function once(fn: () => void): () => void {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    fn();
  };
}

/** Run a control callback; a throwing debug control should not take the panel down with it. */
function guard(label: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    console.error(`[debug] control "${label}" threw`, err);
  }
}

/** Write-through setter for a debug control bound to a plain property. */
function setter<T extends object, K extends keyof T>(target: T, key: K): (v: T[K]) => void {
  return (v) => {
    target[key] = v;
  };
}

function read<T>(label: string, get: () => T): T | undefined {
  try {
    return get();
  } catch (err) {
    console.warn(`[debug] getter for "${label}" threw`, err);
    return undefined;
  }
}

const PANEL_CSS = `
.dbg { position: fixed; z-index: 10000; box-sizing: border-box; width: 268px; max-width: calc(100vw - 16px);
  top: calc(8px + env(safe-area-inset-top, 0px)); right: calc(8px + env(safe-area-inset-right, 0px));
  max-height: calc(100vh - 16px); max-height: calc(100dvh - 16px); padding: 6px 8px 8px;
  overflow-y: auto; overscroll-behavior: contain; touch-action: pan-y; pointer-events: auto;
  background: rgba(14, 12, 20, 0.84); color: #e9e6f2; border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px; box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45); user-select: none; -webkit-user-select: none;
  font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  scrollbar-width: thin; scrollbar-color: rgba(255, 255, 255, 0.3) transparent; }
.dbg[hidden] { display: none; }
.dbg * { box-sizing: border-box; font: inherit; }
.dbg :focus-visible { outline: 2px solid #7ab8ff; outline-offset: 1px; }
.dbg-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.dbg-head strong { flex: 1; font-weight: 700; color: #ffd27a; }
.dbg-head span { opacity: 0.55; }
.dbg-x { width: 22px; height: 22px; padding: 0; line-height: 1; border: 0; border-radius: 4px;
  background: transparent; color: inherit; cursor: pointer; font-size: 16px; }
.dbg-row { display: flex; justify-content: space-between; gap: 8px; padding: 1px 0; }
.dbg-k { opacity: 0.7; white-space: nowrap; }
.dbg-v { font-variant-numeric: tabular-nums; text-align: right; color: #ffffff; min-width: 3.5em; }
.dbg-group { margin-top: 6px; border-top: 1px solid rgba(255, 255, 255, 0.12); padding-top: 4px; }
.dbg-group > summary { cursor: pointer; color: #ffd27a; padding: 2px 0; }
.dbg-body { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px 0 2px; }
.dbg-btn { padding: 3px 8px; border: 1px solid rgba(255, 255, 255, 0.25); border-radius: 4px;
  background: rgba(255, 255, 255, 0.08); color: inherit; cursor: pointer; }
.dbg-x:hover, .dbg-btn:hover { background: rgba(255, 255, 255, 0.18); }
.dbg-btn:active { background: rgba(255, 210, 122, 0.35); }
.dbg-ctl { display: flex; align-items: center; gap: 6px; width: 100%; cursor: pointer; }
.dbg-ctl input { margin: 0; accent-color: #ffd27a; }
.dbg-slider input { flex: 1; min-width: 0; }
`;
