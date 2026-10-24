/**
 * Input (GDD 2.6): keyboard + mouse with pointer lock, Gamepad API (standard mapping) and touch, mapped to
 * game Actions. Keyboard/mouse bindings are remappable; only the overrides are saved through Settings.
 *
 * Devices add and remove "sources" on actions at any time (see ActionTable); Loop calls beginStep() /
 * endStep() around every fixed step, so each press is seen by exactly one step and look deltas are
 * consumed once. Helpers live in InputActions.ts, Gamepad.ts and src/ui (Touch, ClickToPlay, Svg).
 */
import { events } from './Events';
import { services } from './Services';
import { FIXED_DT } from './Loop';
import { GamepadReader, radialDeadzone } from './Gamepad';
import {
  ActionTable,
  DEFAULT_BINDINGS,
  KeyCapture,
  PAD_BINDINGS,
  bindingOverrides,
  cloneBindings,
  codeMapOf,
  rebound,
  resolveBindings,
  sameBindings,
  type Action,
  type Bindings,
} from './InputActions';
import { PointerLockGate } from '../ui/ClickToPlay';
import { activatesControl, isFormField } from '../ui/dom';
import { MOUSE_HABIT_PX, clampMousePx, lookStep } from './input-look';
import { actionGlyph } from '../ui/Svg';
import { TOUCH_ACTIONS, TOUCH_RUN_EDGE, TouchControls, type TouchControlId } from '../ui/Touch';

export type { Action } from './InputActions';
export { ACTIONS, DEFAULT_BINDINGS, PAD_BINDINGS } from './InputActions';
export type InputDevice = 'kbm' | 'pad' | 'touch';
export type TouchButton = 'jump' | 'use' | 'pray' | 'sword' | 'shield';

declare module './Services' {
  interface ServiceMap {
    input: Input;
  }
}
declare module './Events' {
  interface EventMap {
    /** Key bindings changed (rebind, reset, or new values loaded from Settings). */
    'input:bindings': void;
  }
}

const PAD_SOURCES = PAD_BINDINGS.map(([button, actions]) => ({ button, actions, token: `p:${button}` }));
const TOUCH_IDS = Object.keys(TOUCH_ACTIONS) as TouchControlId[];
const TOUCH_DEADZONE = 0.12;
/** Touch response curve: a half push walks at ~1/3 speed, so small thumbs are not always at full speed. */
const TOUCH_CURVE = 1.6;
/** The knob must stay at the edge this long (s) before it counts as run: a quick flick only walks. */
const TOUCH_RUN_DELAY = 0.35;
/** Mouse events this soon after a touch are the browser's emulation of that touch. */
const TOUCH_MOUSE_GUARD_MS = 1000;

export class Input {
  /** -1..1, y = forward. Deadzoned, length <= 1. Updated in beginStep(). */
  readonly move = { x: 0, y: 0 };
  /** Radians since the last step, cameraSpeed and invertY applied. x > 0 turns right, y > 0 looks up. */
  readonly look = { x: 0, y: 0 };

  private readonly uiRoot: HTMLElement;
  private readonly actions = new ActionTable();
  private readonly capture: KeyCapture;
  private readonly lock: PointerLockGate;
  /** Pointer-lock fallback: a mouse button is held on the canvas, so movement turns the camera. */
  private dragLook = false;
  private readonly pad: GamepadReader;
  private readonly offs: Array<() => void> = [];
  private bindings = cloneBindings(DEFAULT_BINDINGS);
  private codeMap = codeMapOf(this.bindings);
  private bindingsLoaded = false;
  private writingSettings = false;
  private currentDevice: InputDevice;
  private gameplay = false;
  private touchButtons: TouchButton[] = ['jump', 'use'];
  private touch: TouchControls | null = null;
  private lastTouchAt = -Infinity;
  private readonly thumb = { x: 0, y: 0 };
  private touchEdgeTime = 0;
  private readonly mouseDelta = { x: 0, y: 0 };
  private mouseLookPx = 0;
  private readonly touchDelta = { x: 0, y: 0 };

  /** `uiRoot` hosts the touch controls and the "Click to play" overlay (default `#ui`). */
  constructor(canvas: HTMLCanvasElement, uiRoot?: HTMLElement) {
    this.uiRoot = uiRoot ?? document.getElementById('ui') ?? document.body;
    this.currentDevice = matchMedia('(pointer: coarse)').matches ? 'touch' : 'kbm';
    this.capture = new KeyCapture(); // first, so a captured key never reaches the handlers below
    this.lock = new PointerLockGate(canvas, this.uiRoot, this.onUnlock);
    this.pad = new GamepadReader(() => this.actions.release('p:'));
    this.loadBindings();

    this.listen(window, 'keydown', this.onKeyDown, true);
    this.listen(window, 'keyup', this.onKeyUp, true);
    this.listen(window, 'pointerdown', this.onAnyPointer, true);
    this.listen(window, 'mouseup', this.onMouseUp);
    this.listen(window, 'blur', this.releaseAll);
    this.listen(document, 'mousemove', this.onMouseMove);
    this.listen(document, 'visibilitychange', () => document.hidden && this.releaseAll());
    this.listen(canvas, 'mousedown', this.onCanvasMouseDown);
    this.listen(canvas, 'contextmenu', (e) => e.preventDefault()); // right mouse = shield
    this.offs.push(
      events.on('settings:changed', () => {
        if (!this.writingSettings) this.loadBindings();
      }),
    );
    this.refreshUi();
    services.register('input', this);
  }

  /** Last device used; 'input:device' is emitted on change. */
  get device(): InputDevice {
    return this.currentDevice;
  }

  get pointerLocked(): boolean {
    return this.lock.locked;
  }

  /** True once the mouse has really turned the camera this session (keyboard-only players never do). */
  get mouseLooks(): boolean {
    return this.mouseLookPx >= MOUSE_HABIT_PX;
  }

  held(a: Action): boolean {
    return this.actions.held(a);
  }

  /** True for exactly one fixed step after the press. */
  pressed(a: Action): boolean {
    return this.actions.pressed(a);
  }

  released(a: Action): boolean {
    return this.actions.released(a);
  }

  /** Seconds held, counted in fixed steps (0 when not held). */
  holdTime(a: Action): number {
    return this.actions.holdTime(a);
  }

  /** Shift / pad B / touch joystick pushed to the edge. */
  runHeld(): boolean {
    return this.actions.held('run');
  }

  /** Prompt glyph (HTML) for an action on the current device: keycap, mouse, pad badge or touch icon. */
  glyph(a: Action): string {
    const pad = PAD_BINDINGS.find(([, actions]) => actions.includes(a));
    const touchId = TOUCH_IDS.find((id) => TOUCH_ACTIONS[id].includes(a)) ?? null;
    return actionGlyph(this.currentDevice, this.bindings[a], pad?.[0], touchId);
  }

  /** Desktop only, needs a user gesture. Until it succeeds, gameplay shows the "Click to play" overlay. */
  requestPointerLock(): void {
    this.lock.request();
  }

  /** Frees the mouse on purpose (debug panel, overlays): unlike Esc, this does not count as a pause press. */
  releasePointerLock(): void {
    this.lock.release();
  }

  /** False in menus and cutscenes: releases held input and the pointer lock, hides touch controls. */
  setGameplayActive(active: boolean): void {
    if (active === this.gameplay) return;
    this.gameplay = active;
    // Presses made in menus must not leak into gameplay; leaving gameplay releases everything held.
    if (active) this.actions.dropPending();
    else this.releaseAll();
    this.refreshUi();
  }

  /** Which round touch buttons show (combat buttons only when needed). */
  setTouchButtons(buttons: TouchButton[]): void {
    this.touchButtons = [...buttons];
    this.touch?.setButtons(this.touchButtons);
  }

  getBindings(a: Action): string[] {
    return [...this.bindings[a]];
  }

  /**
   * Binds `code` to an action and saves. `slot` 0 replaces the primary key, a slot past the end adds one.
   * A key already used by another action moves here (no key is ever bound to two actions); that action
   * gets the replaced key, or a free default key. Returns false, changing nothing, when the action would be
   * left with no key at all (or `code` is not a key): the Controls screen then asks the player.
   */
  rebind(a: Action, code: string, slot = 0): boolean {
    const next = rebound(this.bindings, a, code, slot);
    if (next === null) return false;
    if (next !== this.bindings) this.applyBindings(next, true);
    return true;
  }

  resetBindings(): void {
    this.applyBindings(cloneBindings(DEFAULT_BINDINGS), true);
  }

  /** For the "Press a key..." UI. Resolves with a key code or 'Mouse<n>', or '' when cancelled (Esc). */
  captureNextKey(): Promise<string> {
    return this.capture.next();
  }

  /** Called by Loop before each fixed step: polls the pad and publishes edges, move and look. */
  beginStep(): void {
    if (!this.bindingsLoaded) this.loadBindings();
    this.pollPad();
    const stick = this.touch?.visible ? this.touch.stick : null;
    radialDeadzone(this.thumb, stick?.x ?? 0, stick?.y ?? 0, TOUCH_DEADZONE);
    const mag = Math.hypot(this.thumb.x, this.thumb.y);
    if (mag > 0) {
      const k = Math.pow(mag, TOUCH_CURVE) / mag;
      this.thumb.x *= k;
      this.thumb.y *= k;
    }
    const atEdge = stick !== null && Math.hypot(stick.x, stick.y) >= TOUCH_RUN_EDGE;
    this.touchEdgeTime = atEdge ? this.touchEdgeTime + FIXED_DT : 0;
    this.actions.set('run', 't:stick', this.touchEdgeTime >= TOUCH_RUN_DELAY);
    this.actions.latch(FIXED_DT);
    this.updateMove();
    this.updateLook();
  }

  /** Called by Loop after each fixed step: edges and look belonged to that step only. */
  endStep(): void {
    this.actions.clearEdges();
    this.look.x = 0;
    this.look.y = 0;
  }

  dispose(): void {
    for (const off of this.offs.splice(0)) off();
    this.capture.dispose();
    this.lock.dispose();
    this.pad.dispose();
    this.touch?.dispose();
    this.touch = null;
    if (services.tryGet('input') === this) services.unregister('input');
  }

  // -------------------------------------------------------------------------------------- internals

  private updateMove(): void {
    let x = this.axis('moveRight', 'moveLeft');
    let y = this.axis('moveForward', 'moveBack');
    if (x !== 0 && y !== 0) {
      x *= Math.SQRT1_2;
      y *= Math.SQRT1_2;
    }
    x += this.pad.left.x + this.thumb.x;
    y += this.pad.left.y + this.thumb.y;
    const len = Math.hypot(x, y);
    this.move.x = len > 1 ? x / len : x;
    this.move.y = len > 1 ? y / len : y;
  }

  private updateLook(): void {
    const settings = services.tryGet('settings');
    const cameraSpeed = settings?.get('cameraSpeed') ?? 1;
    const speed = Number.isFinite(cameraSpeed) ? cameraSpeed : 1;
    const invert = settings?.get('invertY') ? -1 : 1;
    lookStep(this.look, this.mouseDelta, this.touchDelta, this.pad.right, speed, invert);
    this.mouseDelta.x = this.mouseDelta.y = 0;
    this.touchDelta.x = this.touchDelta.y = 0;
  }

  private axis(pos: Action, neg: Action): number {
    return (this.actions.held(pos) ? 1 : 0) - (this.actions.held(neg) ? 1 : 0);
  }

  private pollPad(): void {
    if (!this.pad.poll()) return;
    let active = this.pad.moved;
    for (let i = 0; i < PAD_SOURCES.length; i++) {
      const { button, actions, token } = PAD_SOURCES[i];
      const down = this.pad.down(button);
      active ||= down;
      for (let j = 0; j < actions.length; j++) this.actions.set(actions[j], token, down);
    }
    if (active) this.setDevice('pad');
  }

  private setCode(code: string, down: boolean): void {
    for (const a of this.codeMap.get(code) ?? []) this.actions.set(a, `k:${code}`, down);
  }

  /**
   * Blur, hidden tab, leaving gameplay. Pad buttons still held read as up until they are let go: the pad is
   * polled every step, so they would otherwise come straight back as a second press (Menu reopening pause).
   */
  private readonly releaseAll = (): void => {
    this.pad.suppressHeld();
    this.actions.release('');
  };

  private setDevice(device: InputDevice): void {
    if (device === this.currentDevice) return;
    this.currentDevice = device;
    events.emit('input:device', { device });
    this.refreshUi();
  }

  private refreshUi(): void {
    const showTouch = this.gameplay && this.currentDevice === 'touch';
    if (showTouch && !this.touch) {
      this.touch = new TouchControls(this.uiRoot, {
        onButton: (id, down) => {
          for (const a of TOUCH_ACTIONS[id]) this.actions.set(a, `t:${id}`, down);
        },
        onLook: (dx, dy) => {
          this.touchDelta.x += dx;
          this.touchDelta.y += dy;
        },
      });
      this.touch.setButtons(this.touchButtons);
    }
    this.touch?.setVisible(showTouch);
    this.lock.sync(this.gameplay, this.currentDevice);
  }

  private loadBindings(): void {
    const settings = services.tryGet('settings');
    if (!settings) return;
    this.bindingsLoaded = true;
    const next = resolveBindings(settings.get('bindings'));
    if (!sameBindings(next, this.bindings)) this.applyBindings(next, false);
  }

  private applyBindings(next: Bindings, persist: boolean): void {
    this.actions.release('k:'); // keys held under the old map could never be released otherwise
    this.bindings = next;
    this.codeMap = codeMapOf(next);
    if (persist) {
      this.writingSettings = true;
      try {
        services.tryGet('settings')?.set('bindings', bindingOverrides(next));
      } finally {
        this.writingSettings = false;
      }
    }
    events.emit('input:bindings');
  }

  private listen<E extends Event>(on: EventTarget, type: string, fn: (e: E) => void, capture = false): void {
    const handler = (e: Event): void => fn(e as E);
    on.addEventListener(type, handler, capture);
    this.offs.push(() => on.removeEventListener(type, handler, capture));
  }

  // --------------------------------------------------------------------------------- DOM handlers

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'F1') e.preventDefault(); // browser help
    if (!e.code || isFormField(e.target)) return;
    this.setDevice('kbm');
    if (!this.codeMap.has(e.code)) return;
    // Tab, Space, arrows (any bound key) must not move focus or scroll during gameplay; a focused button ("Click to
    // play") keeps only Space / Enter, so Tab can never send focus out of the page.
    if (this.gameplay && !e.ctrlKey && !e.metaKey && !e.altKey && !activatesControl(e)) e.preventDefault();
    if (e.repeat || e.metaKey) return; // macOS drops keyups while Cmd is held: never latch those
    this.setCode(e.code, true);
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    if (e.key === 'Meta') this.actions.release('k:');
    this.setCode(e.code, false);
  };

  private readonly onCanvasMouseDown = (e: MouseEvent): void => {
    if (performance.now() - this.lastTouchAt < TOUCH_MOUSE_GUARD_MS) return;
    if (e.button === 1) e.preventDefault(); // no middle-click autoscroll
    if (this.gameplay && this.lock.supported && !this.lock.locked && !this.lock.fallback) {
      this.lock.request(); // this click only grabs the mouse
      return;
    }
    if (this.lock.fallback && this.gameplay) this.dragLook = true; // no lock: holding a button and moving looks
    this.setCode(`Mouse${e.button}`, true);
  };

  private readonly onMouseUp = (e: MouseEvent): void => {
    if (e.buttons === 0) this.dragLook = false;
    this.setCode(`Mouse${e.button}`, false);
  };

  private readonly onMouseMove = (e: MouseEvent): void => {
    const looking = this.lock.locked || (this.dragLook && this.gameplay && e.buttons !== 0);
    if (!looking || (e.movementX === 0 && e.movementY === 0)) return;
    const dx = clampMousePx(e.movementX);
    const dy = clampMousePx(e.movementY);
    this.mouseDelta.x += dx;
    this.mouseDelta.y += dy;
    this.mouseLookPx = Math.min(1e6, this.mouseLookPx + Math.abs(dx) + Math.abs(dy));
    this.setDevice('kbm');
  };

  private readonly onAnyPointer = (e: PointerEvent): void => {
    if (e.pointerType !== 'mouse') this.lastTouchAt = performance.now();
    this.setDevice(e.pointerType === 'mouse' ? 'kbm' : 'touch');
  };

  private readonly onUnlock = (unexpected: boolean): void => {
    this.mouseDelta.x = this.mouseDelta.y = 0;
    if (unexpected) this.actions.tap('pause'); // Esc or alt-tab released the mouse mid-game
  };
}
