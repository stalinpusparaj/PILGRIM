/**
 * On-screen touch controls (GDD 2.6 "Touch").
 *
 * - Floating joystick on the left half: the stick is centred where the thumb lands (the drawn base stays
 *   inside the screen near an edge), the knob clamps to the radius, pushing it to the edge means run.
 * - Drag on the right half = look.
 * - Big round buttons bottom-right (>= 72 px): JUMP, USE, PRAY, SWORD, SHIELD (setButtons picks which).
 * - Satchel icon top-left, pause icon top-right.
 *
 * Multi-touch safe: the stick, the look drag and every button track their own pointerId. Input owns this
 * object, reads `stick` each fixed step and receives buttons and look deltas through TouchHost.
 */
import { events } from '../core/Events';
import { t } from '../core/I18n';
import type { Action, TouchButton } from '../core/Input';
import { icon, type IconName } from './Svg';

export type TouchControlId = TouchButton | 'satchel' | 'pause';

/** Actions each control drives. JUMP also skips, like Space and pad A. Control ids double as icon names. */
export const TOUCH_ACTIONS: Readonly<Record<TouchControlId, readonly Action[]>> = {
  jump: ['jump', 'skip'],
  use: ['use'],
  pray: ['pray'],
  sword: ['sword'],
  shield: ['shield'],
  satchel: ['satchel'],
  pause: ['pause'],
};

export interface TouchHost {
  onButton(id: TouchControlId, down: boolean): void;
  /** Look drag in CSS pixels since the last move event. */
  onLook(dxPx: number, dyPx: number): void;
}

/** Knob travel in px. */
const STICK_RADIUS = 64;
/** Knob pushed this far (0..1 of the radius) counts as run. */
export const TOUCH_RUN_EDGE = 0.9;
/** Draw the joystick base at least this far from the screen edges, in px (the stick centre is not moved). */
const EDGE_MARGIN = 12;

/** Round-button slots, measured from the safe-area bottom-right corner (px). Jump sits in the corner. */
const ROUND_SLOTS: Record<TouchButton, { size: number; right: number; bottom: number }> = {
  jump: { size: 96, right: 24, bottom: 24 },
  use: { size: 78, right: 147, bottom: 33 },
  sword: { size: 78, right: 116, bottom: 116 },
  pray: { size: 78, right: 33, bottom: 147 },
  shield: { size: 78, right: 227, bottom: 113 },
};
const ROUND_IDS = Object.keys(ROUND_SLOTS) as TouchButton[];
const ICON_SIZE = 72;

const STYLE_ID = 'pg-touch-style';
const CSS = `
.pg-touch{position:fixed;inset:0;z-index:5;pointer-events:none;user-select:none;-webkit-user-select:none;
  -webkit-touch-callout:none;-webkit-tap-highlight-color:transparent}
.pg-touch[hidden],.pg-touch-btn[hidden]{display:none}
.pg-touch-zone{position:absolute;top:0;bottom:0;width:50%;pointer-events:auto;touch-action:none}
.pg-touch-stick{position:absolute;left:0;top:0;width:${STICK_RADIUS * 2}px;height:${STICK_RADIUS * 2}px;
  margin:-${STICK_RADIUS}px 0 0 -${STICK_RADIUS}px;border-radius:50%;box-sizing:border-box;
  background:rgba(255,248,234,.16);border:3px solid rgba(255,248,234,.55);pointer-events:none;opacity:0;
  transition:opacity 120ms}
.pg-touch-stick:not(.on){left:92px;top:auto;bottom:32px;opacity:.38;margin:0;transform:none!important}
.pg-touch-stick.on{opacity:1}
.pg-touch-knob{position:absolute;left:50%;top:50%;width:60px;height:60px;margin:-30px 0 0 -30px;
  border-radius:50%;background:rgba(255,248,234,.9);box-shadow:0 3px 10px rgba(28,20,34,.35)}
.pg-touch-stick.run .pg-touch-knob{background:#ffd27a}
.pg-touch-btn{position:absolute;box-sizing:border-box;margin:0;padding:0;pointer-events:auto;touch-action:none;
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;border-radius:50%;
  border:3px solid rgba(255,248,234,.75);background:rgba(28,20,34,.45);color:#fff8ea;font-family:inherit;
  font-size:13px;font-weight:800;letter-spacing:.04em;line-height:1;text-transform:uppercase;
  box-shadow:0 4px 12px rgba(28,20,34,.35);transition:transform 80ms,background-color 80ms}
.pg-touch-btn.down{transform:scale(.92);background:rgba(242,179,61,.7)}
.pg-touch-btn svg{width:44%;height:44%}
.pg-touch-btn.small svg{width:56%;height:56%}
`;
let styleUsers = 0;

interface ButtonEntry {
  readonly el: HTMLButtonElement;
  readonly label: HTMLSpanElement | null;
  pointer: number | null;
}

export class TouchControls {
  /** Raw knob offset, -1..1 per axis, length <= 1, y = forward (up). Zero when the thumb is lifted. */
  readonly stick = { x: 0, y: 0 };

  private readonly host: TouchHost;
  private readonly root: HTMLDivElement;
  private readonly base: HTMLDivElement;
  private readonly knob: HTMLDivElement;
  private readonly buttons = new Map<TouchControlId, ButtonEntry>();
  private readonly offs: Array<() => void> = [];
  private stickPointer: number | null = null;
  private readonly stickOrigin = { x: 0, y: 0 };
  private lookPointer: number | null = null;
  private readonly lookLast = { x: 0, y: 0 };
  private shown = false;

  constructor(parent: HTMLElement, host: TouchHost) {
    this.host = host;
    if (styleUsers++ === 0 && !document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    this.root = div('pg-touch');
    this.root.hidden = true;
    const left = div('pg-touch-zone');
    left.style.left = '0';
    const right = div('pg-touch-zone');
    right.style.right = '0';
    this.base = div('pg-touch-stick');
    this.knob = div('pg-touch-knob');
    this.base.appendChild(this.knob);
    this.root.append(left, right, this.base);

    for (const id of ROUND_IDS) {
      const slot = ROUND_SLOTS[id];
      const el = this.addButton(id, id, true);
      Object.assign(el.style, {
        width: `${slot.size}px`,
        height: `${slot.size}px`,
        right: `calc(${slot.right}px + env(safe-area-inset-right, 0px))`,
        bottom: `calc(${slot.bottom}px + env(safe-area-inset-bottom, 0px))`,
      });
    }
    const corner = (id: 'satchel' | 'pause', side: 'left' | 'right'): void => {
      const el = this.addButton(id, id, false);
      el.classList.add('small');
      Object.assign(el.style, {
        width: `${ICON_SIZE}px`,
        height: `${ICON_SIZE}px`,
        top: 'calc(14px + env(safe-area-inset-top, 0px))',
        [side]: `calc(14px + env(safe-area-inset-${side}, 0px))`,
      });
    };
    corner('satchel', 'left');
    corner('pause', 'right');

    this.on(left, 'pointerdown', this.onStickDown);
    this.on(left, 'pointermove', this.onStickMove);
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      this.on(left, type, this.onStickUp);
      this.on(right, type, this.onLookUp);
    }
    this.on(right, 'pointerdown', this.onLookDown);
    this.on(right, 'pointermove', this.onLookMove);
    this.on(this.root, 'contextmenu', (e) => e.preventDefault());
    this.offs.push(events.on('lang:changed', () => this.refreshLabels()));

    this.refreshLabels();
    parent.appendChild(this.root);
  }

  get visible(): boolean {
    return this.shown;
  }

  /** Hiding releases everything that is held, so nothing stays stuck down. */
  setVisible(visible: boolean): void {
    if (visible === this.shown) return;
    this.shown = visible;
    this.root.hidden = !visible;
    if (!visible) this.releaseAll();
  }

  /** Which round buttons show (combat buttons only when needed). Satchel and pause always show. */
  setButtons(list: readonly TouchButton[]): void {
    for (const id of ROUND_IDS) {
      const entry = this.buttons.get(id);
      if (!entry) continue;
      const show = list.includes(id);
      if (!show) this.releaseButton(id);
      entry.el.hidden = !show;
    }
  }

  dispose(): void {
    this.releaseAll();
    for (const off of this.offs.splice(0)) off();
    this.root.remove();
    if (--styleUsers === 0) document.getElementById(STYLE_ID)?.remove();
  }

  // ------------------------------------------------------------------------------------------- build

  private addButton(id: TouchControlId, iconName: IconName, labelled: boolean): HTMLButtonElement {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'pg-touch-btn';
    el.dataset.id = id;
    el.innerHTML = icon(iconName, '100%');
    let label: HTMLSpanElement | null = null;
    if (labelled) {
      label = document.createElement('span');
      label.setAttribute('aria-hidden', 'true');
      el.appendChild(label);
    }
    const entry: ButtonEntry = { el, label, pointer: null };
    this.buttons.set(id, entry);

    this.on(el, 'pointerdown', (e) => {
      e.preventDefault();
      if (entry.pointer !== null) return;
      entry.pointer = e.pointerId;
      capturePointer(el, e.pointerId);
      el.classList.add('down');
      this.host.onButton(id, true);
    });
    const up = (e: PointerEvent): void => {
      if (e.pointerId === entry.pointer) this.releaseButton(id);
    };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) this.on(el, type, up);
    // Activation without a pointer (switch access, screen readers) arrives as a click with detail 0.
    this.on(el, 'click', (e) => {
      if (e.detail !== 0 || entry.pointer !== null) return;
      this.host.onButton(id, true);
      this.host.onButton(id, false);
    });
    this.root.appendChild(el);
    return el;
  }

  private refreshLabels(): void {
    for (const [id, entry] of this.buttons) {
      const text = t(`ui.touch.${id}`);
      entry.el.setAttribute('aria-label', text);
      if (entry.label) entry.label.textContent = text;
    }
  }

  private on<K extends keyof HTMLElementEventMap>(
    el: HTMLElement,
    type: K,
    fn: (e: HTMLElementEventMap[K]) => void,
  ): void {
    el.addEventListener(type, fn);
    this.offs.push(() => el.removeEventListener(type, fn));
  }

  // ---------------------------------------------------------------------------------------- joystick

  private readonly onStickDown = (e: PointerEvent): void => {
    e.preventDefault();
    if (this.stickPointer !== null) return;
    this.stickPointer = e.pointerId;
    capturePointer(e.currentTarget, e.pointerId);
    // The stick is centred exactly where the thumb lands, so touching down never moves the player. Only
    // the drawn base is kept inside the screen near an edge; the knob shows the deflection from its centre.
    this.stickOrigin.x = e.clientX;
    this.stickOrigin.y = e.clientY;
    const r = STICK_RADIUS + EDGE_MARGIN;
    const baseX = clamp(e.clientX, r, Math.max(r, window.innerWidth - r));
    const baseY = clamp(e.clientY, r, Math.max(r, window.innerHeight - r));
    this.base.style.transform = `translate(${baseX}px, ${baseY}px)`;
    this.base.classList.add('on');
    this.updateStick(e.clientX, e.clientY);
  };

  private readonly onStickMove = (e: PointerEvent): void => {
    if (e.pointerId === this.stickPointer) this.updateStick(e.clientX, e.clientY);
  };

  private readonly onStickUp = (e: PointerEvent): void => {
    if (e.pointerId === this.stickPointer) this.resetStick();
  };

  private updateStick(px: number, py: number): void {
    let dx = px - this.stickOrigin.x;
    let dy = py - this.stickOrigin.y;
    const len = Math.hypot(dx, dy);
    if (len > STICK_RADIUS) {
      dx *= STICK_RADIUS / len;
      dy *= STICK_RADIUS / len;
    }
    this.stick.x = dx / STICK_RADIUS;
    this.stick.y = -dy / STICK_RADIUS;
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    this.base.classList.toggle('run', Math.hypot(this.stick.x, this.stick.y) >= TOUCH_RUN_EDGE);
  }

  private resetStick(): void {
    this.stickPointer = null;
    this.stick.x = 0;
    this.stick.y = 0;
    this.knob.style.transform = '';
    this.base.classList.remove('on', 'run');
  }

  // -------------------------------------------------------------------------------------------- look

  private readonly onLookDown = (e: PointerEvent): void => {
    e.preventDefault();
    if (this.lookPointer !== null) return;
    this.lookPointer = e.pointerId;
    capturePointer(e.currentTarget, e.pointerId);
    this.lookLast.x = e.clientX;
    this.lookLast.y = e.clientY;
  };

  private readonly onLookMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.lookPointer) return;
    this.host.onLook(e.clientX - this.lookLast.x, e.clientY - this.lookLast.y);
    this.lookLast.x = e.clientX;
    this.lookLast.y = e.clientY;
  };

  private readonly onLookUp = (e: PointerEvent): void => {
    if (e.pointerId === this.lookPointer) this.lookPointer = null;
  };

  // ----------------------------------------------------------------------------------------- release

  private releaseButton(id: TouchControlId): void {
    const entry = this.buttons.get(id);
    if (!entry || entry.pointer === null) return;
    entry.pointer = null;
    entry.el.classList.remove('down');
    this.host.onButton(id, false);
  }

  private releaseAll(): void {
    this.resetStick();
    this.lookPointer = null;
    for (const id of this.buttons.keys()) this.releaseButton(id);
  }
}

function div(className: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = className;
  return el;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** Keep receiving a finger's moves after it slides off the element. Throws if the pointer is already gone. */
function capturePointer(target: EventTarget | null, pointerId: number): void {
  if (!(target instanceof Element)) return;
  try {
    target.setPointerCapture(pointerId);
  } catch {
    // Pointer already released; the up/cancel handlers keep state consistent.
  }
}
