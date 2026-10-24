/**
 * Gamepad API reader for Input (GDD 2.6, standard mapping, deadzone 0.18). Input polls it once per fixed
 * step; nothing is read while no pad is connected. With several pads, the most recently used one wins.
 */

export const PAD_DEADZONE = 0.18;
/** Raw stick deflection that marks the pad as the device in use. */
const PAD_ACTIVE = 0.5;
/** Analogue triggers (LT 6, RT 7) count as down past this value. */
const TRIGGER_DOWN = 0.35;
/** Buttons tracked by suppressHeld() (the standard mapping has 17). */
const MAX_BUTTONS = 31;
const NO_AXES: readonly number[] = Object.freeze([]);

export class GamepadReader {
  /** Left stick after the deadzone, y = up (forward). */
  readonly left = { x: 0, y: 0 };
  /** Right stick after the deadzone, y = up. */
  readonly right = { x: 0, y: 0 };
  /** A stick is pushed well past the deadzone this poll. */
  moved = false;

  private pad: Gamepad | null = null;
  private count = 0;
  /** Bit per button held through a release: it reads as up until the pad reports it up. */
  private suppressed = 0;
  private readonly onAllDisconnected: () => void;

  /** `onAllDisconnected` runs when the last pad goes, so held pad buttons can be released. */
  constructor(onAllDisconnected: () => void) {
    this.onAllDisconnected = onAllDisconnected;
    this.count = connectedPads().length; // pads the browser already exposes (e.g. after a reload)
    window.addEventListener('gamepadconnected', this.onChange);
    window.addEventListener('gamepaddisconnected', this.onChange);
  }

  /** Reads the active pad once per fixed step (allocation-free). Returns false when none is connected. */
  poll(): boolean {
    this.pad = this.count > 0 ? latestPad() : null;
    const axes = this.pad?.axes ?? NO_AXES;
    const lx = axes[0] ?? 0;
    const ly = axes[1] ?? 0;
    const rx = axes[2] ?? 0;
    const ry = axes[3] ?? 0;
    radialDeadzone(this.left, lx, -ly, PAD_DEADZONE);
    radialDeadzone(this.right, rx, -ry, PAD_DEADZONE);
    this.moved = Math.hypot(lx, ly) > PAD_ACTIVE || Math.hypot(rx, ry) > PAD_ACTIVE;
    for (let b = 0; this.suppressed !== 0 && b < MAX_BUTTONS; b++) {
      if ((this.suppressed & (1 << b)) !== 0 && !this.raw(b)) this.suppressed &= ~(1 << b);
    }
    return this.pad !== null;
  }

  /** Whether a standard-mapping button is down in the last poll (false while suppressed). */
  down(button: number): boolean {
    if (button < MAX_BUTTONS && (this.suppressed & (1 << button)) !== 0) return false;
    return this.raw(button);
  }

  /**
   * Buttons down right now read as up until they are let go. Input calls this when it releases everything
   * (blur, leaving gameplay): a button still held must not come back as a fresh press on the next poll.
   */
  suppressHeld(): void {
    const count = Math.min(this.pad?.buttons.length ?? 0, MAX_BUTTONS);
    for (let b = 0; b < count; b++) if (this.raw(b)) this.suppressed |= 1 << b;
  }

  dispose(): void {
    window.removeEventListener('gamepadconnected', this.onChange);
    window.removeEventListener('gamepaddisconnected', this.onChange);
    this.pad = null;
  }

  private raw(button: number): boolean {
    const b = this.pad?.buttons[button];
    if (!b) return false;
    return button === 6 || button === 7 ? b.value > TRIGGER_DOWN : b.pressed;
  }

  private readonly onChange = (): void => {
    this.count = connectedPads().length;
    if (this.count > 0) return;
    this.pad = null;
    this.suppressed = 0;
    this.onAllDisconnected();
  };
}

/**
 * Radial deadzone written into `out`, rescaled so the output starts at 0 just past the deadzone and reaches
 * length 1 at full tilt.
 */
export function radialDeadzone(out: { x: number; y: number }, x: number, y: number, deadzone: number): void {
  const len = Math.hypot(x, y);
  const scale = len <= deadzone ? 0 : Math.min(1, (len - deadzone) / (1 - deadzone)) / len;
  out.x = x * scale;
  out.y = y * scale;
}

/** Response curve on a deadzoned stick: length^power, same direction (a half push walks slowly). */
export function curveStick(v: { x: number; y: number }, power: number): void {
  const len = Math.hypot(v.x, v.y);
  if (len <= 0) return;
  const k = Math.pow(len, power) / len;
  v.x *= k;
  v.y *= k;
}

/** Browsers only offer gamepads to secure pages (https, localhost); elsewhere asking just logs a warning. */
function padsAvailable(): boolean {
  return typeof navigator.getGamepads === 'function' && (typeof isSecureContext === 'undefined' || isSecureContext);
}

/** The connected pad used most recently (highest timestamp), or null. */
function latestPad(): Gamepad | null {
  if (!padsAvailable()) return null;
  let pads: ReturnType<Navigator['getGamepads']>;
  try {
    pads = navigator.getGamepads();
  } catch {
    return null; // blocked by a permissions policy
  }
  let best: Gamepad | null = null;
  for (let i = 0; i < pads.length; i++) {
    const p = pads[i];
    if (p && p.connected && (!best || p.timestamp > best.timestamp)) best = p;
  }
  return best;
}

function connectedPads(): Gamepad[] {
  if (!padsAvailable()) return [];
  try {
    return navigator.getGamepads().filter((p): p is Gamepad => p !== null && p.connected);
  } catch {
    return []; // blocked by a permissions policy
  }
}
