/**
 * Keyboard and gamepad navigation for MY SATCHEL (GDD 2.15: every menu works with keyboard only, gamepad only
 * and touch only).
 *
 *  - Spatial focus moves (arrow keys, the move keys as bound, d-pad, left stick with auto-repeat) between the
 *    focus stops of the panel: the close button, the selected tab, and the cards / buttons of the page. Left and
 *    right on the tab bar switch tabs (ARIA tabs with automatic activation). Moves scroll the page body so the
 *    focused card is in view.
 *  - Tab pages: PageUp / PageDown, 1-5, LB / RB. Home / End on the tab bar.
 *  - Pad: A presses the focused button, B closes. (View and Menu reach the Satchel through Input actions.)
 * The gamepad is read straight from the Gamepad API once per fixed step (Input has no LB/RB actions); buttons
 * already held when the Satchel opens are ignored until released.
 */

export type NavDir = 'up' | 'down' | 'left' | 'right';
export type PadCommand = NavDir | 'activate' | 'back' | 'prevTab' | 'nextTab' | 'view' | 'menu';

export interface NavHooks {
  /** The tab buttons, in order. */
  tabs(): readonly HTMLElement[];
  stepTab(delta: -1 | 1): void;
  gotoTab(index: number): void;
  /** Where focus goes when nothing in the panel has it. */
  fallback(): HTMLElement | null;
}

const EDGE = 2;

/** Focus stops inside `root` that are visible now, in DOM order. */
export function focusStops(root: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const el of root.querySelectorAll<HTMLElement>('button, [tabindex]')) {
    if (el.tabIndex < 0 || (el instanceof HTMLButtonElement && el.disabled)) continue;
    if (el.closest('[hidden]') || el.getClientRects().length === 0) continue;
    out.push(el);
  }
  return out;
}

/** Scroll the nearest scrollable page body (`[data-scroll]`) so `el` is fully visible, without smooth motion. */
export function revealInBody(el: HTMLElement): void {
  const body = el.closest<HTMLElement>('[data-scroll]');
  if (!body) return;
  const r = el.getBoundingClientRect();
  const b = body.getBoundingClientRect();
  const m = 14;
  if (r.top < b.top + m || r.height > b.height - 2 * m) body.scrollTop -= b.top + m - r.top;
  else if (r.bottom > b.bottom - m) body.scrollTop += r.bottom - (b.bottom - m);
}

export function focusAndReveal(el: HTMLElement): void {
  el.focus({ preventScroll: true });
  revealInBody(el);
}

export class SatchelNav {
  private readonly root: HTMLElement;
  private readonly hooks: NavHooks;

  constructor(root: HTMLElement, hooks: NavHooks) {
    this.root = root;
    this.hooks = hooks;
  }

  /** Spatial move from the focused stop; left/right on a tab switch tabs. */
  move(dir: NavDir): void {
    const active = document.activeElement;
    const cur = active instanceof HTMLElement && this.root.contains(active) ? active : null;
    if (!cur || cur === this.root) {
      const f = this.hooks.fallback();
      if (f) focusAndReveal(f);
      return;
    }
    const tabs = this.hooks.tabs();
    if ((dir === 'left' || dir === 'right') && tabs.includes(cur)) {
      this.hooks.stepTab(dir === 'left' ? -1 : 1);
      return;
    }
    const stops = focusStops(this.root).filter((el) => el !== cur);
    const next = nearest(cur.getBoundingClientRect(), stops, dir) ?? this.linear(cur, dir);
    if (next) focusAndReveal(next);
  }

  /** Tab / Shift+Tab when Tab is not the Satchel key: cycle inside the panel. */
  cycle(backwards: boolean): void {
    const stops = focusStops(this.root);
    if (stops.length === 0) return;
    const i = stops.indexOf(document.activeElement as HTMLElement);
    const n = stops.length;
    const next = i < 0 ? (backwards ? n - 1 : 0) : (i + (backwards ? -1 : 1) + n) % n;
    focusAndReveal(stops[next]!);
  }

  /** Left/right in a single-column list: previous / next stop in reading order (not across the tab bar). */
  private linear(cur: HTMLElement, dir: NavDir): HTMLElement | null {
    if (dir !== 'left' && dir !== 'right') return null;
    const tabs = this.hooks.tabs();
    const stops = focusStops(this.root).filter((el) => !tabs.includes(el));
    const i = stops.indexOf(cur);
    if (i < 0) return null;
    return stops[i + (dir === 'left' ? -1 : 1)] ?? null;
  }
}

/** Closest stop in a direction: gap along the axis, plus twice the miss across it (rows and columns win). */
function nearest(c: DOMRect, stops: readonly HTMLElement[], dir: NavDir): HTMLElement | null {
  const ccx = c.left + c.width / 2;
  const ccy = c.top + c.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of stops) {
    const r = el.getBoundingClientRect();
    const rcx = r.left + r.width / 2;
    const rcy = r.top + r.height / 2;
    let along: number;
    let across: number;
    if (dir === 'down' || dir === 'up') {
      const ok =
        dir === 'down'
          ? rcy > ccy + EDGE && r.bottom > c.bottom + EDGE
          : rcy < ccy - EDGE && r.top < c.top - EDGE;
      if (!ok) continue;
      along = Math.max(0, dir === 'down' ? r.top - c.bottom : c.top - r.bottom);
      across = Math.max(0, r.left - c.right, c.left - r.right);
      across += Math.abs(rcx - ccx) * 0.05;
    } else {
      const ok =
        dir === 'right'
          ? rcx > ccx + EDGE && r.right > c.right + EDGE
          : rcx < ccx - EDGE && r.left < c.left - EDGE;
      if (!ok) continue;
      along = Math.max(0, dir === 'right' ? r.left - c.right : c.left - r.right);
      across = Math.max(0, r.top - c.bottom, c.top - r.bottom);
      across += Math.abs(rcy - ccy) * 0.05;
    }
    const score = along + across * 2;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

// ----------------------------------------------------------------------------------------------- gamepad

const REPEAT_DELAY = 0.38;
const REPEAT_EVERY = 0.12;
const STICK_ON = 0.55;
/** Standard mapping: A, B, LB, RB, View, Menu, d-pad up/down/left/right. */
const BUTTONS: ReadonlyArray<readonly [number, PadCommand]> = [
  [0, 'activate'],
  [1, 'back'],
  [4, 'prevTab'],
  [5, 'nextTab'],
  [8, 'view'],
  [9, 'menu'],
  [12, 'up'],
  [13, 'down'],
  [14, 'left'],
  [15, 'right'],
];
const DIRS: readonly NavDir[] = ['up', 'down', 'left', 'right'];

function isDir(c: PadCommand): c is NavDir {
  return (DIRS as readonly string[]).includes(c);
}

function latestPad(): Gamepad | null {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return null;
  let pads: ReturnType<Navigator['getGamepads']>;
  try {
    pads = navigator.getGamepads();
  } catch {
    return null;
  }
  let best: Gamepad | null = null;
  for (const p of pads) if (p && p.connected && (!best || p.timestamp > best.timestamp)) best = p;
  return best;
}

/** Edge-triggered menu commands from the most recently used pad, with auto-repeat on directions. */
export class PadNav {
  private held = new Set<PadCommand>();
  /** Directions held (d-pad or stick) and their repeat clocks. */
  private readonly hold = new Map<NavDir, number>();
  private blocked = new Set<PadCommand>();

  /** Everything held right now counts as already handled (the press that opened the Satchel). */
  reset(): void {
    this.blocked = this.read();
    this.held = new Set(this.blocked);
    this.hold.clear();
  }

  /** Commands for this step (dt seconds). */
  poll(dt: number): PadCommand[] {
    const now = this.read();
    for (const c of [...this.blocked]) if (!now.has(c)) this.blocked.delete(c);
    const out: PadCommand[] = [];
    for (const c of now) {
      if (this.blocked.has(c)) continue;
      if (!this.held.has(c)) {
        out.push(c);
        if (isDir(c)) this.hold.set(c, REPEAT_DELAY);
      } else if (isDir(c)) {
        const left = (this.hold.get(c) ?? REPEAT_DELAY) - dt;
        if (left <= 0) out.push(c);
        this.hold.set(c, left <= 0 ? REPEAT_EVERY : left);
      }
    }
    for (const d of DIRS) if (!now.has(d)) this.hold.delete(d);
    this.held = now;
    return out;
  }

  private read(): Set<PadCommand> {
    const set = new Set<PadCommand>();
    const pad = latestPad();
    if (!pad) return set;
    for (const [i, cmd] of BUTTONS) if (pad.buttons[i]?.pressed) set.add(cmd);
    const x = pad.axes[0] ?? 0;
    const y = pad.axes[1] ?? 0;
    if (Math.hypot(x, y) > STICK_ON) {
      if (Math.abs(x) > Math.abs(y)) set.add(x > 0 ? 'right' : 'left');
      else set.add(y > 0 ? 'down' : 'up');
    }
    return set;
  }
}
