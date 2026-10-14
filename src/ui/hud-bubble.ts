/**
 * Interaction bubble (GDD 2.14): floats over the focused interactable with its verb ("Talk", "Read the Roll")
 * and the button for the CURRENT device: a keycap of the 'use' binding (the 'jump' one when the interactable's
 * `action` is 'jump', e.g. Climb), the pad button badge, or the touch USE / JUMP icon. A ring fills while a
 * hold interaction is held (iron gate, 3 s).
 *
 * update() (fixed step) follows the focus and the hold; render(camera) projects the anchor every frame,
 * hides the bubble behind the camera or off screen, keeps it inside the safe area, and on touch lifts it
 * clear of the round buttons and corner icons. Scratch math objects only; DOM writes happen only when a
 * rounded pixel value changes.
 */
import * as THREE from 'three';
import { services } from '../core/Services';
import { DEFAULT_BINDINGS, type Action } from '../core/InputActions';
import { t } from '../core/I18n';
import { h, setText } from './dom';
import { actionGlyph } from './Svg';
import { ringSvg } from './hud-icons';
import { focusedInteractable, serviceHoldProgress, type FocusTarget } from './hud-focus';
import type { AvoidRects, Rect } from './hud-layout';

/** Bubble height above `pos` when the interactable gives none (about a head above an adult). */
const DEFAULT_HEIGHT = 1.9;
/** Gap between the bubble box and the anchor point (room for the tail), px. */
const TAIL_GAP = 14;
/** Min distance of the bubble from the screen edges (inside the safe area), px. */
const EDGE = 10;
/** NDC slack before an off-screen anchor hides the bubble (it is clamped in between). */
const NDC_SLACK = 1.08;
const NEAR = 0.05;
/** An 'interact:hold' progress value is trusted for this long, then the input hold time takes over. */
const HOLD_EVENT_TTL = 0.2;

export class InteractBubble {
  readonly el: HTMLDivElement;
  private readonly inner: HTMLDivElement;
  private readonly key: HTMLSpanElement;
  private readonly glyph: HTMLSpanElement;
  private readonly verb: HTMLSpanElement;
  private readonly tail: HTMLSpanElement;
  private readonly ringFill: SVGCircleElement;

  private target: FocusTarget | null = null;
  private shownVerb = '';
  private shownAction: Action | null = null;
  private glyphDirty = true;
  private sizeDirty = true;
  private width = 0;
  private height = 0;
  private on = false;
  private popFlip = false;
  private pressFlip = false;
  private holdEventValue = 0;
  private holdEventAge = Infinity;
  private progressShown = -1;
  private holding = false;
  private lastX = Number.NaN;
  private lastY = Number.NaN;
  private lastTail = Number.NaN;

  private readonly anchor = new THREE.Vector3();
  private readonly view = new THREE.Matrix4();

  constructor() {
    this.glyph = h('span', { className: 'hud-bubble__glyph' });
    this.key = h('span', { className: 'hud-bubble__key' });
    this.key.innerHTML = ringSvg();
    this.key.appendChild(this.glyph);
    this.ringFill = this.key.querySelector('.r-fill') as SVGCircleElement;
    this.verb = h('span', { className: 'hud-bubble__verb' });
    this.tail = h('span', { className: 'hud-bubble__tail' });
    this.inner = h('div', { className: 'hud-bubble__inner' }, this.key, this.verb, this.tail);
    this.el = h('div', { className: 'hud-bubble', 'aria-hidden': 'true' }, this.inner);
  }

  /** 'interact:focus' arrived: follow the service's focus now rather than on the next step. */
  onFocusEvent(): void {
    this.followFocus();
  }

  /** 'interact:hold' arrived with a progress value (0..1). */
  onHoldEvent(progress: number): void {
    this.holdEventValue = progress;
    this.holdEventAge = 0;
  }

  /** 'interact:use' arrived: a little squash so the child sees the press landed. */
  onUse(id: string): void {
    if (!this.target || id !== this.target.id) return;
    this.pressFlip = !this.pressFlip;
    this.inner.classList.remove(this.pressFlip ? 'press-b' : 'press-a');
    this.inner.classList.add(this.pressFlip ? 'press-a' : 'press-b');
  }

  /** Device or bindings changed: rebuild the glyph. Language changed: the verb too. */
  refresh(): void {
    this.glyphDirty = true;
    this.shownVerb = '';
  }

  /** Font size or viewport changed. */
  invalidateSize(): void {
    this.sizeDirty = true;
  }

  update(dt: number): void {
    this.holdEventAge += dt;
    this.followFocus();
    this.updateHold();
  }

  /**
   * Places the bubble. `vw`/`vh` are the HUD size in CSS px; `avoid` holds the safe-area insets and, on
   * touch, the rectangles of the round buttons and corner icons.
   */
  render(camera: THREE.Camera, visible: boolean, vw: number, vh: number, avoid: AvoidRects): void {
    const target = this.target;
    if (!visible || !target || vw <= 0 || vh <= 0) {
      this.setOn(false);
      return;
    }
    if (this.glyphDirty || this.shownVerb !== target.verb) this.fillContent(target);

    camera.updateMatrixWorld();
    this.view.copy(camera.matrixWorld).invert();
    const p = this.anchor.set(target.pos.x, target.pos.y + (target.height ?? DEFAULT_HEIGHT), target.pos.z);
    p.applyMatrix4(this.view);
    if (p.z > -NEAR) {
      this.setOn(false);
      return;
    }
    p.applyMatrix4(camera.projectionMatrix);
    if (p.x < -NDC_SLACK || p.x > NDC_SLACK || p.y < -NDC_SLACK || p.y > NDC_SLACK) {
      this.setOn(false);
      return;
    }
    // Visibility must be on before measuring (visibility:hidden still lays out, so sizes are valid).
    this.setOn(true);
    if (this.sizeDirty) this.measure();

    const ax = (p.x * 0.5 + 0.5) * vw;
    const ay = (-p.y * 0.5 + 0.5) * vh;
    const w = this.width;
    const bh = this.height;
    const minX = avoid.left + EDGE;
    const maxX = vw - avoid.right - EDGE - w;
    const minY = avoid.top + EDGE;
    const maxY = vh - avoid.bottom - EDGE - bh;
    let x = clamp(ax - w * 0.5, minX, Math.max(minX, maxX));
    let y = clamp(ay - bh - TAIL_GAP, minY, Math.max(minY, maxY));
    if (avoid.touch) {
      y = dodge(x, y, w, bh, avoid.buttons, minY);
      y = dodgeDown(x, y, w, bh, avoid.corners, Math.max(minY, maxY));
    }
    const rx = Math.round(x);
    const ry = Math.round(y);
    if (rx !== this.lastX || ry !== this.lastY) {
      this.lastX = rx;
      this.lastY = ry;
      this.el.style.transform = `translate3d(${rx}px,${ry}px,0)`;
    }
    // The tail keeps pointing at the object even when the box is clamped to an edge.
    const tail = Math.round(clamp(ax - x, 20, Math.max(20, w - 20)));
    if (tail !== this.lastTail) {
      this.lastTail = tail;
      this.tail.style.left = `${tail}px`;
    }
  }

  private followFocus(): void {
    const next = focusedInteractable();
    if (next === this.target) return;
    const changed = !next || !this.target || next.id !== this.target.id;
    this.target = next;
    if (next && changed) {
      this.popFlip = !this.popFlip;
      this.inner.classList.remove(this.popFlip ? 'pop-b' : 'pop-a');
      this.inner.classList.add(this.popFlip ? 'pop-a' : 'pop-b');
    }
    this.holdEventAge = Infinity;
  }

  private fillContent(target: FocusTarget): void {
    const action: Action = target.action ?? 'use';
    if (this.glyphDirty || action !== this.shownAction) {
      const input = services.tryGet('input');
      this.glyph.innerHTML = input
        ? input.glyph(action)
        : actionGlyph('kbm', DEFAULT_BINDINGS[action], undefined, null);
      this.shownAction = action;
      this.glyphDirty = false;
      const device = input?.device ?? 'kbm';
      this.el.dataset.device = device;
    }
    setText(this.verb, t(target.verb));
    this.shownVerb = target.verb;
    this.sizeDirty = true;
  }

  private updateHold(): void {
    const target = this.target;
    const seconds = target?.holdSeconds ?? 0;
    let progress = 0;
    if (target && seconds > 0) {
      const fromService = serviceHoldProgress();
      if (fromService !== null) progress = fromService;
      else if (this.holdEventAge <= HOLD_EVENT_TTL) progress = this.holdEventValue;
      else {
        const input = services.tryGet('input');
        const action: Action = target.action ?? 'use';
        progress = input ? Math.min(1, input.holdTime(action) / seconds) : 0;
      }
    }
    const holding = !!target && seconds > 0;
    if (holding !== this.holding) {
      this.holding = holding;
      this.el.classList.toggle('is-hold', holding);
    }
    const pct = Math.round(progress * 100);
    if (pct === this.progressShown) return;
    this.progressShown = pct;
    this.ringFill.style.strokeDashoffset = String(100 - pct);
    this.el.classList.toggle('is-full', pct >= 100);
  }

  private measure(): void {
    this.width = this.el.offsetWidth;
    this.height = this.el.offsetHeight;
    this.sizeDirty = false;
  }

  private setOn(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    this.el.classList.toggle('is-on', on);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Moves the box up above any rectangle it overlaps (touch round buttons). */
function dodge(x: number, y: number, w: number, bh: number, rects: readonly Rect[], minY: number): number {
  for (const r of rects) {
    if (r.w <= 0 || x + w <= r.x || x >= r.x + r.w || y + bh <= r.y || y >= r.y + r.h) continue;
    y = Math.max(minY, r.y - bh - EDGE);
  }
  return y;
}

/** Moves the box down below any rectangle it overlaps (touch corner icons). */
function dodgeDown(
  x: number,
  y: number,
  w: number,
  bh: number,
  rects: readonly Rect[],
  maxY: number,
): number {
  for (const r of rects) {
    if (r.w <= 0 || x + w <= r.x || x >= r.x + r.w || y + bh <= r.y || y >= r.y + r.h) continue;
    y = Math.min(maxY, r.y + r.h + EDGE);
  }
  return y;
}
