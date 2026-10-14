/**
 * Focus navigation for the Settings overlay: keyboard arrows and the gamepad move a visible focus between the
 * controls (GDD 2.15 Accessibility: playable with keyboard only or gamepad only).
 *
 * - `moveFocus(root, dir)` is spatial: Up / Down go to the nearest tabbable control above / below (same
 *   column first, so the key list moves straight down), Left / Right to the nearest one on the same line.
 * - `PadNav` polls the Gamepad API once per animation frame while the overlay is open: d-pad or left stick =
 *   directions (with key-repeat), A = accept, B = back, LB / RB = previous / next tab. Buttons already held
 *   when it starts (the A press that opened the screen) count only after they are let go.
 *
 * Input (src/core/Input.ts) also reads the pad for gameplay actions; menus are not gameplay, so the two never
 * compete for a press.
 */

export type NavDir = 'up' | 'down' | 'left' | 'right';

const TABBABLE = 'button, [href], input, select, textarea, [tabindex]';

/** Controls Tab would reach inside `root`: visible, enabled, tabindex >= 0. */
export function tabbables(root: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const el of root.querySelectorAll<HTMLElement>(TABBABLE)) {
    if (el.tabIndex < 0 || el.matches(':disabled') || el.closest('[hidden], [inert]')) continue;
    if (el.getClientRects().length === 0) continue;
    out.push(el);
  }
  return out;
}

/** Focuses `el` and scrolls it into view inside its scroll container. */
export function focusInto(el: HTMLElement): void {
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

/** Moves focus one step in `dir`. Returns false when there is nothing that way (focus stays). */
export function moveFocus(root: HTMLElement, dir: NavDir): boolean {
  const items = tabbables(root);
  const from = document.activeElement;
  if (!(from instanceof HTMLElement) || !items.includes(from)) {
    const first = dir === 'up' ? items[items.length - 1] : items[0];
    if (first) focusInto(first);
    return first !== undefined;
  }
  const a = from.getBoundingClientRect();
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of items) {
    if (el === from || el.contains(from) || from.contains(el)) continue;
    const score = scoreFor(a, el.getBoundingClientRect(), dir);
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  if (best) focusInto(best);
  return best !== null;
}

/** Lower is better; Infinity = not in that direction. */
function scoreFor(a: DOMRect, b: DOMRect, dir: NavDir): number {
  const acx = a.left + a.width / 2;
  const acy = a.top + a.height / 2;
  const bcx = b.left + b.width / 2;
  const bcy = b.top + b.height / 2;
  if (dir === 'up' || dir === 'down') {
    const dy = dir === 'down' ? bcy - acy : acy - bcy;
    const beyond = dir === 'down' ? b.bottom > a.bottom + 1 : b.top < a.top - 1;
    if (dy <= 4 || !beyond) return Infinity;
    const dxGap = Math.max(0, b.left - a.right, a.left - b.right);
    return dy + dxGap * 2 + Math.abs(bcx - acx) * 0.05;
  }
  const dx = dir === 'right' ? bcx - acx : acx - bcx;
  const beyond = dir === 'right' ? b.right > a.right + 1 : b.left < a.left - 1;
  const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  if (dx <= 4 || !beyond || overlap <= 0) return Infinity;
  return dx;
}

// ------------------------------------------------------------------------------------------------ gamepad

export interface PadNavHandlers {
  /** Any press below (before it is handled): the pad is the device in use. */
  used(): void;
  dir(dir: NavDir): void;
  accept(): void;
  back(): void;
  /** LB = -1, RB = +1. */
  shoulder(delta: -1 | 1): void;
}

type PadKey = NavDir | 'a' | 'b' | 'lb' | 'rb';
const PAD_KEYS: readonly PadKey[] = ['up', 'down', 'left', 'right', 'a', 'b', 'lb', 'rb'];
const STICK = 0.5;
const REPEAT_FIRST_MS = 380;
const REPEAT_MS = 110;

export class PadNav {
  private raf = 0;
  private readonly down = new Set<PadKey>();
  /** Held when the overlay opened: ignored until released. */
  private readonly stale = new Set<PadKey>();
  private readonly repeatAt = new Map<PadKey, number>();
  private readonly on: PadNavHandlers;
  private readonly now = new Set<PadKey>();

  constructor(on: PadNavHandlers) {
    this.on = on;
    this.read(this.now);
    for (const k of this.now) this.stale.add(k);
    this.raf = requestAnimationFrame(this.tick);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private readonly tick = (time: number): void => {
    this.raf = requestAnimationFrame(this.tick);
    const now = this.now;
    this.read(now);
    for (const k of PAD_KEYS) {
      const isDown = now.has(k);
      if (!isDown) {
        this.down.delete(k);
        this.stale.delete(k);
        continue;
      }
      if (this.stale.has(k)) continue;
      if (!this.down.has(k)) {
        this.down.add(k);
        this.repeatAt.set(k, time + REPEAT_FIRST_MS);
        this.fire(k);
      } else if (isDir(k) && time >= (this.repeatAt.get(k) ?? Infinity)) {
        this.repeatAt.set(k, time + REPEAT_MS);
        this.fire(k);
      }
    }
  };

  private fire(k: PadKey): void {
    this.on.used();
    if (isDir(k)) this.on.dir(k);
    else if (k === 'a') this.on.accept();
    else if (k === 'b') this.on.back();
    else this.on.shoulder(k === 'lb' ? -1 : 1);
  }

  /** Logical buttons down on the most recently used pad (standard mapping). */
  private read(out: Set<PadKey>): void {
    out.clear();
    const pad = latestPad();
    if (!pad) return;
    const btn = (i: number): boolean => pad.buttons[i]?.pressed ?? false;
    const x = pad.axes[0] ?? 0;
    const y = pad.axes[1] ?? 0;
    const stickX = Math.abs(x) > Math.abs(y);
    if (btn(12) || (!stickX && y < -STICK)) out.add('up');
    if (btn(13) || (!stickX && y > STICK)) out.add('down');
    if (btn(14) || (stickX && x < -STICK)) out.add('left');
    if (btn(15) || (stickX && x > STICK)) out.add('right');
    if (btn(0)) out.add('a');
    if (btn(1)) out.add('b');
    if (btn(4)) out.add('lb');
    if (btn(5)) out.add('rb');
  }
}

function isDir(k: PadKey): k is NavDir {
  return k === 'up' || k === 'down' || k === 'left' || k === 'right';
}

function latestPad(): Gamepad | null {
  if (typeof navigator.getGamepads !== 'function') return null;
  let pads: ReturnType<Navigator['getGamepads']>;
  try {
    pads = navigator.getGamepads();
  } catch {
    return null; // blocked by a permissions policy
  }
  let best: Gamepad | null = null;
  for (const p of pads) {
    if (p && p.connected && (!best || p.timestamp > best.timestamp)) best = p;
  }
  return best;
}
