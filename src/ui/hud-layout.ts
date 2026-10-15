/**
 * Screen geometry the HUD needs outside CSS: the HUD size, the safe-area insets (notches, home indicator) and,
 * on touch, where the round buttons and the satchel/pause corner icons sit (read from src/ui/Touch.ts's DOM,
 * read-only) so the interaction bubble never covers them. Cached; refreshed on resize, device change and
 * about once a second on touch (combat buttons come and go). Rect objects are preallocated and reused.
 */
import { h } from './dom';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AvoidRects {
  /** Safe-area insets, CSS px. */
  top: number;
  right: number;
  bottom: number;
  left: number;
  /** True while the touch controls are the input device. */
  touch: boolean;
  /** Visible round touch buttons (unused slots have w = 0). */
  readonly buttons: Rect[];
  /** Visible corner icons (satchel, pause). */
  readonly corners: Rect[];
}

const BUTTON_SLOTS = 8;
const CORNER_SLOTS = 4;
const TOUCH_SCAN_SECONDS = 1;

function rects(n: number): Rect[] {
  const out: Rect[] = [];
  for (let i = 0; i < n; i++) out.push({ x: 0, y: 0, w: 0, h: 0 });
  return out;
}

export class HudLayout {
  readonly avoid: AvoidRects = {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    touch: false,
    buttons: rects(BUTTON_SLOTS),
    corners: rects(CORNER_SLOTS),
  };
  width = 0;
  height = 0;
  private readonly root: HTMLElement;
  private readonly probe: HTMLDivElement;
  private dirty = true;
  private scanIn = 0;

  constructor(root: HTMLElement) {
    this.root = root;
    this.probe = h('div', { className: 'hud-safe-probe', 'aria-hidden': 'true' });
    root.appendChild(this.probe);
  }

  /** Resize, orientation, text size or device changed. */
  invalidate(): void {
    this.dirty = true;
    this.scanIn = 0;
  }

  setTouch(touch: boolean): void {
    if (touch === this.avoid.touch) return;
    this.avoid.touch = touch;
    this.invalidate();
  }

  update(dt: number): void {
    this.scanIn -= dt;
    if (this.scanIn <= 0) this.dirty = true;
  }

  /** Called before the bubble is placed; does the DOM reads only when something changed. */
  ensure(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.width = this.root.clientWidth;
    this.height = this.root.clientHeight;
    const cs = getComputedStyle(this.probe);
    this.avoid.top = parseFloat(cs.paddingTop) || 0;
    this.avoid.right = parseFloat(cs.paddingRight) || 0;
    this.avoid.bottom = parseFloat(cs.paddingBottom) || 0;
    this.avoid.left = parseFloat(cs.paddingLeft) || 0;
    this.scanTouch();
  }

  private scanTouch(): void {
    const { buttons, corners } = this.avoid;
    let nb = 0;
    let nc = 0;
    this.scanIn = TOUCH_SCAN_SECONDS;
    if (this.avoid.touch) {
      const origin = this.root.getBoundingClientRect();
      for (const el of document.querySelectorAll<HTMLElement>('.pg-touch-btn')) {
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        const small = el.classList.contains('small');
        const slot = small
          ? nc < CORNER_SLOTS
            ? corners[nc++]
            : null
          : nb < BUTTON_SLOTS
            ? buttons[nb++]
            : null;
        if (!slot) continue;
        slot.x = r.left - origin.left;
        slot.y = r.top - origin.top;
        slot.w = r.width;
        slot.h = r.height;
      }
    }
    const minimap = this.root.querySelector<HTMLElement>('.hud-minimap');
    if (minimap && !minimap.hidden && nc < CORNER_SLOTS) {
      const origin = this.root.getBoundingClientRect();
      const r = minimap.getBoundingClientRect();
      const slot = corners[nc++]!;
      slot.x = r.left - origin.left; slot.y = r.top - origin.top;
      slot.w = r.width; slot.h = r.height;
    }
    for (let i = nb; i < BUTTON_SLOTS; i++) buttons[i]!.w = 0;
    for (let i = nc; i < CORNER_SLOTS; i++) corners[i]!.w = 0;
  }
}
