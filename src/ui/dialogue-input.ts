/**
 * Keyboard and gamepad input for the conversation panel (src/ui/DialoguePanel.ts), read from the Input actions
 * once per fixed step (presses are latched per step, GDD 2.6):
 *
 * - Lines: Space / A ('skip') or E / X ('use') = finish the typing, a second press moves on. Holding Space or A
 *   (or the on-screen skip button) for 1 s skips the scene; the ring shows the hold after a short moment so a
 *   normal tap never flashes it.
 * - Choices: 1 / 2 / 3 pick directly; arrows, W/S, the d-pad or the stick move the highlight (with key repeat);
 *   Space / A / E / X confirm the highlighted one. Confirm presses are ignored for a moment after the choices
 *   appear, so a child mashing Space through the lines does not pick one without seeing it.
 */
import type { System } from '../core/Loop';
import { services } from '../core/Services';
import type { Action } from '../core/Input';

export interface DialogueInputHandlers {
  /** 'lines' | 'choices' | null (nothing to do: no conversation, or between lines). */
  mode(): 'lines' | 'choices' | null;
  /** Space / E / A on a line. */
  advance(): void;
  /** Number key on choices (slot 0..2). */
  pick(slot: number): void;
  /** Confirm on choices (the highlighted one). */
  confirm(): void;
  /** Move the choice highlight by +-1. */
  move(delta: number): void;
  /** Hold-to-skip progress (0..1), and whether a hold is in progress. */
  hold(progress: number, holding: boolean): void;
  /** The hold reached 1 s. */
  skipScene(): void;
}

/** GDD 2.6: hold Space 1 s to skip the scene. */
export const SKIP_HOLD_SEC = 1;
/** The ring appears only after this long, so taps never flash it. */
const RING_DELAY = 0.18;
/** Confirm presses are ignored this long after choices appear. */
export const CHOICE_ARM_SEC = 0.45;
const STICK_ON = 0.55;
const STICK_OFF = 0.3;
const REPEAT_FIRST = 0.42;
const REPEAT_NEXT = 0.16;
const CHOICE_ACTIONS: readonly Action[] = ['choice1', 'choice2', 'choice3'];

export class DialogueInput implements System {
  /** The touch / mouse skip button is held (set by the view). */
  pointerHold = false;
  private pointerHoldTime = 0;
  private holdLatched = false;
  private choicesFor = 0;
  private navDir = 0;
  private navWait = 0;
  private lastMode: 'lines' | 'choices' | null = null;

  constructor(private readonly on: DialogueInputHandlers) {}

  update(dt: number): void {
    const input = services.tryGet('input');
    const mode = this.on.mode();
    if (mode !== this.lastMode) {
      this.lastMode = mode;
      this.choicesFor = 0;
      this.navDir = 0;
    }
    this.pointerHoldTime = this.pointerHold ? this.pointerHoldTime + dt : 0;
    if (!input || mode === null) {
      this.reportHold(0, false);
      return;
    }
    if (mode === 'choices') {
      this.reportHold(0, false);
      this.updateChoices(dt);
      return;
    }
    // Lines.
    if (input.pressed('skip') || input.pressed('use')) this.on.advance();
    const held = Math.max(input.holdTime('skip'), this.pointerHoldTime);
    if (held <= 0) this.holdLatched = false;
    if (this.holdLatched) {
      this.reportHold(0, false);
      return;
    }
    const progress = held > RING_DELAY ? held / SKIP_HOLD_SEC : 0;
    this.reportHold(progress, held > RING_DELAY);
    if (held >= SKIP_HOLD_SEC) {
      this.holdLatched = true;
      this.reportHold(0, false);
      this.on.skipScene();
    }
  }

  /** True while choice confirms are still ignored (pointer picks use it too). */
  get choicesArming(): boolean {
    return this.lastMode === 'choices' && this.choicesFor < CHOICE_ARM_SEC;
  }

  private updateChoices(dt: number): void {
    const input = services.tryGet('input');
    if (!input) return;
    this.choicesFor += dt;
    for (let i = 0; i < CHOICE_ACTIONS.length; i++) {
      if (input.pressed(CHOICE_ACTIONS[i])) {
        this.on.pick(i);
        return;
      }
    }
    if ((input.pressed('skip') || input.pressed('use')) && this.choicesFor >= CHOICE_ARM_SEC) {
      this.on.confirm();
      return;
    }
    // A key or d-pad press moves at once (even a tap shorter than one step); holding repeats. The stick (and
    // held keys, which feed the same move vector) move on crossing the threshold, then repeat.
    const down = input.pressed('moveBack') || input.pressed('moveRight') ? 1 : 0;
    const up = input.pressed('moveForward') || input.pressed('moveLeft') ? 1 : 0;
    if (down || up) {
      this.navDir = down - up; // both in one step cancel out
      this.navWait = REPEAT_FIRST;
      if (this.navDir !== 0) this.on.move(this.navDir);
      return;
    }
    const y = input.move.y;
    const x = input.move.x;
    const axis = Math.abs(y) >= Math.abs(x) ? -y : x; // up = previous, down = next
    const dir = axis > STICK_ON ? 1 : axis < -STICK_ON ? -1 : Math.abs(axis) < STICK_OFF ? 0 : this.navDir;
    if (dir === 0) {
      this.navDir = 0;
      return;
    }
    if (dir !== this.navDir) {
      this.navDir = dir;
      this.navWait = REPEAT_FIRST;
      this.on.move(dir);
      return;
    }
    this.navWait -= dt;
    if (this.navWait <= 0) {
      this.navWait = REPEAT_NEXT;
      this.on.move(dir);
    }
  }

  private reportHold(progress: number, holding: boolean): void {
    this.on.hold(progress, holding);
  }
}
