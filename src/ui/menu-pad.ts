/**
 * Gamepad reader for menus (GDD 2.6 "Gamepad", 2.15 "Playable with ... gamepad only"). Menus run while the game
 * loop may be paused or not running at all (title screen), so they poll `navigator.getGamepads()` in their own
 * animation frame while at least one menu is open, instead of relying on Input's fixed-step poll.
 *
 * D-pad or left stick move the focus (first move at once, then repeats after a short delay), A selects, B goes
 * back, LB / RB switch tabs and Menu (Start) is passed on for screens that toggle with it (pause).
 * Buttons held while a menu opens are ignored until they are let go ("primed"), so the A press that opened a
 * screen never also activates the first button of the next one.
 */

export type PadDir = 'up' | 'down' | 'left' | 'right';

export interface PadSink {
  move(dir: PadDir): void;
  select(): void;
  back(): void;
  menu(): void;
  shoulder(dir: -1 | 1): void;
}

/** Standard-mapping buttons. */
const BTN = { a: 0, b: 1, lb: 4, rb: 5, menu: 9, up: 12, down: 13, left: 14, right: 15 } as const;
/** Stick deflection that counts as a direction (menus want a deliberate push, not the 0.18 gameplay deadzone). */
const STICK_DIR = 0.5;
const REPEAT_DELAY_MS = 380;
const REPEAT_MS = 130;
const TRACKED = 16;

export class MenuPad {
  private raf = 0;
  private primed = false;
  private prevMask = 0;
  private dir: PadDir | null = null;
  private nextRepeat = 0;

  constructor(private readonly sink: () => PadSink | null) {}

  get running(): boolean {
    return this.raf !== 0;
  }

  start(): void {
    if (this.raf !== 0 || typeof requestAnimationFrame !== 'function') return;
    this.primed = false;
    this.raf = requestAnimationFrame(this.tick);
  }

  stop(): void {
    if (this.raf !== 0) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.primed = false;
  }

  /** The active menu changed: buttons held right now must be let go before they count. */
  reprime(): void {
    this.primed = false;
  }

  private readonly tick = (now: number): void => {
    this.raf = requestAnimationFrame(this.tick);
    const sink = this.sink();
    const pad = latestPad();
    if (!sink || !pad) {
      this.primed = false;
      this.dir = null;
      return;
    }
    let mask = 0;
    for (let b = 0; b < TRACKED; b++) if (pad.buttons[b]?.pressed) mask |= 1 << b;
    const dir = readDir(pad, mask);
    if (!this.primed) {
      this.primed = true;
      this.prevMask = mask;
      this.dir = dir; // a held direction must be released (or changed) before it moves the focus
      this.nextRepeat = now + REPEAT_DELAY_MS;
      return;
    }
    const pressed = mask & ~this.prevMask;
    this.prevMask = mask;

    if (dir !== this.dir) {
      this.dir = dir;
      if (dir) {
        this.nextRepeat = now + REPEAT_DELAY_MS;
        sink.move(dir);
      }
    } else if (dir && now >= this.nextRepeat) {
      this.nextRepeat = now + REPEAT_MS;
      sink.move(dir);
    }
    // Only one action per frame: a screen change made by one must not receive the next.
    if (pressed & (1 << BTN.a)) sink.select();
    else if (pressed & (1 << BTN.b)) sink.back();
    else if (pressed & (1 << BTN.menu)) sink.menu();
    else if (pressed & (1 << BTN.lb)) sink.shoulder(-1);
    else if (pressed & (1 << BTN.rb)) sink.shoulder(1);
  };
}

function readDir(pad: Gamepad, mask: number): PadDir | null {
  if (mask & (1 << BTN.up)) return 'up';
  if (mask & (1 << BTN.down)) return 'down';
  if (mask & (1 << BTN.left)) return 'left';
  if (mask & (1 << BTN.right)) return 'right';
  const x = pad.axes[0] ?? 0;
  const y = pad.axes[1] ?? 0;
  if (Math.hypot(x, y) < STICK_DIR) return null;
  if (Math.abs(x) > Math.abs(y)) return x > 0 ? 'right' : 'left';
  return y > 0 ? 'down' : 'up';
}

/** The connected pad used most recently, or null (no API, blocked by a permissions policy, none connected). */
function latestPad(): Gamepad | null {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function' || !isSecureContext) return null; // gamepads only on secure pages
  let pads: ReturnType<Navigator['getGamepads']>;
  try {
    pads = navigator.getGamepads();
  } catch {
    return null;
  }
  let best: Gamepad | null = null;
  for (let i = 0; i < pads.length; i++) {
    const p = pads[i];
    if (p && p.connected && (!best || p.timestamp > best.timestamp)) best = p;
  }
  return best;
}
