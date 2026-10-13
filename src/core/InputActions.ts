/**
 * The action model behind Input (GDD 2.6: "All keys remappable. Settings saved."):
 * - the action list, default key bindings and the gamepad map;
 * - loading stored overrides and the rebind rule (a key is never bound to two actions);
 * - ActionTable: held sources and step-latched press/release edges per action;
 * - KeyCapture for the "Press a key..." screen.
 * Split out of Input.ts to keep files under 400 lines; Input.ts re-exports the public names.
 */

export type Action =
  | 'moveForward'
  | 'moveBack'
  | 'moveLeft'
  | 'moveRight'
  | 'run'
  | 'jump'
  | 'use'
  | 'pray'
  | 'sword'
  | 'shield'
  | 'satchel'
  | 'pause'
  | 'skip'
  | 'choice1'
  | 'choice2'
  | 'choice3'
  | 'debug';

/** Binding codes per action: KeyboardEvent.code values, or 'Mouse<button>' for mouse buttons. */
export type Bindings = Record<Action, string[]>;

/** Keyboard/mouse defaults (GDD 2.6). Treat as read-only: copy with cloneBindings(). */
export const DEFAULT_BINDINGS: Record<Action, string[]> = {
  moveForward: ['KeyW', 'ArrowUp'],
  moveBack: ['KeyS', 'ArrowDown'],
  moveLeft: ['KeyA', 'ArrowLeft'],
  moveRight: ['KeyD', 'ArrowRight'],
  run: ['ShiftLeft'],
  jump: ['Space'],
  use: ['KeyE'],
  pray: ['KeyQ'],
  sword: ['Mouse0'],
  shield: ['Mouse2'],
  satchel: ['Tab'],
  pause: ['Escape'],
  skip: ['Space'],
  choice1: ['Digit1'],
  choice2: ['Digit2'],
  choice3: ['Digit3'],
  debug: ['F1'],
};

/** Every action, in the order the Controls screen lists them (the order of DEFAULT_BINDINGS). */
export const ACTIONS: readonly Action[] = Object.keys(DEFAULT_BINDINGS) as Action[];

/**
 * Standard-mapping gamepad buttons (GDD 2.6): A jump/skip, B run (hold), X use, Y pray, LT shield, RT sword,
 * View satchel, Menu pause, and the d-pad as move. Not remappable.
 */
export const PAD_BINDINGS: ReadonlyArray<readonly [button: number, actions: readonly Action[]]> = [
  [0, ['jump', 'skip']],
  [1, ['run']],
  [2, ['use']],
  [3, ['pray']],
  [6, ['shield']],
  [7, ['sword']],
  [8, ['satchel']],
  [9, ['pause']],
  [12, ['moveForward']],
  [13, ['moveBack']],
  [14, ['moveLeft']],
  [15, ['moveRight']],
];

/** Actions that may share a key because they never apply at the same moment (Space = jump and skip). */
const SHARED_KEYS: ReadonlyArray<readonly Action[]> = [['jump', 'skip']];
/** Same limits Settings applies to stored bindings. */
const CODE_PATTERN = /^[A-Za-z0-9_]{1,32}$/;
const MAX_CODES = 4;

export function isBindingCode(code: string): boolean {
  return CODE_PATTERN.test(code);
}

export function cloneBindings(src: Readonly<Record<Action, readonly string[]>>): Bindings {
  return Object.fromEntries(ACTIONS.map((a) => [a, [...src[a]]])) as Bindings;
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((c, i) => c === b[i]);
}

export function sameBindings(a: Bindings, b: Bindings): boolean {
  return ACTIONS.every((x) => sameList(a[x], b[x]));
}

/**
 * Only the actions that differ from the defaults: what Settings stores. Bindings from rebound() never leave
 * an action empty, so resolveBindings(bindingOverrides(b)) gives back exactly `b`.
 */
export function bindingOverrides(b: Bindings): Partial<Bindings> {
  const out: Partial<Bindings> = {};
  for (const a of ACTIONS) {
    if (b[a].length > 0 && !sameList(b[a], DEFAULT_BINDINGS[a])) out[a] = [...b[a]];
  }
  return out;
}

/** Binding code → the actions it drives (Space drives both jump and skip). */
export function codeMapOf(b: Bindings): Map<string, Action[]> {
  const map = new Map<string, Action[]>();
  for (const a of ACTIONS) {
    for (const code of b[a]) map.set(code, [...(map.get(code) ?? []), a]);
  }
  return map;
}

function shareKeys(a: Action, b: Action): boolean {
  return SHARED_KEYS.some((group) => group.includes(a) && group.includes(b));
}

function isTaken(map: Bindings, code: string, owner: Action): boolean {
  return ACTIONS.some((x) => x !== owner && !shareKeys(x, owner) && map[x].includes(code));
}

/** Every action has a key, and no key drives two actions except a shared pair (Space = jump and skip). */
function isConsistent(b: Bindings): boolean {
  const owners = new Map<string, Action>();
  for (const a of ACTIONS) {
    if (b[a].length === 0) return false;
    for (const code of b[a]) {
      const owner = owners.get(code);
      if (owner !== undefined && !shareKeys(owner, a)) return false;
      owners.set(code, a);
    }
  }
  return true;
}

/**
 * Defaults overlaid with stored overrides. Overrides win: their keys are removed from actions still on
 * their defaults. Stored data that rebound() could never have produced (an action left with no key, one
 * key on two actions) is damaged, so the defaults are used instead of a half-working layout.
 */
export function resolveBindings(raw: unknown): Bindings {
  const out = cloneBindings(DEFAULT_BINDINGS);
  if (typeof raw !== 'object' || raw === null) return out;
  const overridden = new Set<Action>();
  for (const a of ACTIONS) {
    const value: unknown = (raw as Record<string, unknown>)[a];
    if (!Array.isArray(value)) continue;
    const codes = (value as unknown[]).filter((c): c is string => typeof c === 'string' && isBindingCode(c));
    if (codes.length === 0) continue; // an action always keeps at least one key
    out[a] = [...new Set(codes)].slice(0, MAX_CODES);
    overridden.add(a);
  }
  for (const a of overridden) {
    for (const b of ACTIONS) {
      if (overridden.has(b) || shareKeys(a, b)) continue;
      out[b] = out[b].filter((c) => !out[a].includes(c));
    }
  }
  return isConsistent(out) ? out : cloneBindings(DEFAULT_BINDINGS);
}

/**
 * Bindings with `code` in slot `slot` of action `a` (0 = primary; a slot past the end appends). Returns
 * `current` itself when the key is already there, and null when the change is refused.
 *
 * A key used by another action moves here. If that leaves the other action with no key at all, it gets a
 * spare key: this slot's old key (a swap), else its first default key that is still free. When there is no
 * spare (e.g. Jump moved onto E while Space stays on Skip, or a key added to a second slot), the rebind is
 * refused, so no action ever silently loses all its keys; the Controls screen asks the player instead.
 */
export function rebound(current: Bindings, a: Action, code: string, slot: number): Bindings | null {
  if (!ACTIONS.includes(a) || !isBindingCode(code)) return null;
  const next = cloneBindings(current);
  const list = next[a];
  const i = Math.max(0, Math.min(Math.floor(slot) || 0, list.length, MAX_CODES - 1));
  const old = list[i];
  const dup = list.indexOf(code);
  if (dup === i || (dup >= 0 && old === undefined)) return current; // already there
  if (dup >= 0 && old !== undefined) list[dup] = old; // swap two slots of the same action
  if (old === undefined) list.push(code);
  else list[i] = code;
  for (const b of ACTIONS) {
    if (b === a || shareKeys(a, b) || !next[b].includes(code)) continue;
    next[b] = next[b].filter((c) => c !== code);
    if (next[b].length > 0) continue;
    const candidates = old === undefined ? DEFAULT_BINDINGS[b] : [old, ...DEFAULT_BINDINGS[b]];
    const spare = candidates.find((c) => !isTaken(next, c, b));
    if (spare === undefined) return null;
    next[b] = [spare];
  }
  return next;
}

// ------------------------------------------------------------------------------------ action state

interface ActionState {
  readonly sources: Set<string>;
  pendingPress: boolean;
  pendingRelease: boolean;
  pressed: boolean;
  released: boolean;
  holdTime: number;
}

/**
 * Held sources and step-latched edges per action. Devices call set() at any time with a source token
 * ('k:KeyW', 'p:0', 't:jump'): the first source in latches a pending press, the last one out a pending
 * release. latch() before a fixed step publishes them and clearEdges() after it drops them, so each edge
 * is seen by exactly one fixed step, however many frames (or steps per frame) pass.
 */
export class ActionTable {
  private readonly states = Object.fromEntries(
    ACTIONS.map((a): [Action, ActionState] => [
      a,
      {
        sources: new Set(),
        pendingPress: false,
        pendingRelease: false,
        pressed: false,
        released: false,
        holdTime: 0,
      },
    ]),
  ) as Record<Action, ActionState>;
  /** The same states as a list, built once: the per-step loops below must not allocate. */
  private readonly list: readonly ActionState[] = ACTIONS.map((a) => this.states[a]);

  held(a: Action): boolean {
    return this.states[a].sources.size > 0;
  }

  pressed(a: Action): boolean {
    return this.states[a].pressed;
  }

  released(a: Action): boolean {
    return this.states[a].released;
  }

  holdTime(a: Action): number {
    return this.states[a].holdTime;
  }

  set(a: Action, token: string, down: boolean): void {
    const s = this.states[a];
    if (down === s.sources.has(token)) return;
    if (down) {
      if (s.sources.size === 0) s.pendingPress = true;
      s.sources.add(token);
    } else {
      s.sources.delete(token);
      if (s.sources.size === 0) s.pendingRelease = true;
    }
  }

  /** Releases every source whose token starts with `prefix` ('' = everything). */
  release(prefix: string): void {
    for (const a of ACTIONS) {
      for (const token of [...this.states[a].sources]) {
        if (token.startsWith(prefix)) this.set(a, token, false);
      }
    }
  }

  /** A press and a release with no source behind them (pause when the pointer lock is lost). */
  tap(a: Action): void {
    this.states[a].pendingPress = true;
    this.states[a].pendingRelease = true;
  }

  /** Forgets edges no step has seen yet, so presses made in menus do not leak into gameplay. */
  dropPending(): void {
    for (const s of this.list) {
      s.pendingPress = false;
      if (s.sources.size > 0) s.pendingRelease = false;
    }
  }

  /** Before a fixed step: publish pending edges and advance hold times by `dt`. */
  latch(dt: number): void {
    for (let i = 0; i < this.list.length; i++) {
      const s = this.list[i];
      s.pressed = s.pendingPress;
      s.released = s.pendingRelease;
      s.pendingPress = false;
      s.pendingRelease = false;
      s.holdTime = s.sources.size > 0 ? s.holdTime + dt : 0;
    }
  }

  /** After a fixed step: its edges are spent. */
  clearEdges(): void {
    for (let i = 0; i < this.list.length; i++) {
      const s = this.list[i];
      s.pressed = false;
      s.released = false;
    }
  }
}

// ----------------------------------------------------------------------------------------- capture

/** Ignore the click that opened the prompt; swallow the click a captured mouse button produces. */
const CAPTURE_GUARD_MS = 200;
const CLICK_SWALLOW_MS = 600;

/**
 * Waits for the next key or mouse button. Listens on window in the capture phase and stops the event, so
 * neither the game nor the remap screen also reacts to it. Construct before other window key listeners.
 */
export class KeyCapture {
  private pending: { resolve: (code: string) => void; since: number } | null = null;
  private swallowUntil = 0;
  private readonly offs: Array<() => void> = [];

  constructor() {
    this.listen('keydown', this.onKey);
    this.listen('pointerdown', this.onPointer);
    for (const type of ['mousedown', 'click', 'auxclick', 'contextmenu']) this.listen(type, this.onSwallow);
  }

  get active(): boolean {
    return this.pending !== null;
  }

  /** Resolves with a key code or 'Mouse<n>', or '' when cancelled (Esc, a newer capture, dispose). */
  next(): Promise<string> {
    this.finish('');
    return new Promise((resolve) => {
      this.pending = { resolve, since: performance.now() };
    });
  }

  dispose(): void {
    this.finish('');
    for (const off of this.offs.splice(0)) off();
  }

  private finish(code: string): void {
    const pending = this.pending;
    this.pending = null;
    pending?.resolve(code);
  }

  private listen<E extends Event>(type: string, fn: (e: E) => void): void {
    const handler = (e: Event): void => fn(e as E);
    window.addEventListener(type, handler, true);
    this.offs.push(() => window.removeEventListener(type, handler, true));
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    if (!this.pending) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (!e.repeat) this.finish(e.code === 'Escape' || !isBindingCode(e.code) ? '' : e.code);
  };

  private readonly onPointer = (e: PointerEvent): void => {
    const pending = this.pending;
    const now = performance.now();
    if (!pending || e.pointerType !== 'mouse' || e.button < 0 || e.button > 2) return;
    if (now - pending.since < CAPTURE_GUARD_MS) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    this.swallowUntil = now + CLICK_SWALLOW_MS;
    this.finish(`Mouse${e.button}`);
  };

  private readonly onSwallow = (e: Event): void => {
    if (performance.now() > this.swallowUntil) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
}
