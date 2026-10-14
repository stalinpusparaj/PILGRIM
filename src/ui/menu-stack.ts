/**
 * The stack of open menus (Menu.ts): only the newest live, unsuspended menu reads keys and the pad. Owns the
 * window key listener and the menu gamepad poll while any menu is open, the input modality (does the focus
 * ring show) and the time of the last menu input (GameFlow's pause-key debounce).
 */
import { MenuPad, type PadSink } from './menu-pad';

export type Modality = 'key' | 'pad' | 'mouse' | 'touch';

export interface StackEntry {
  readonly suspended: boolean;
  readonly padSink: PadSink;
  /** Returns true when the key was used (the event is then default-prevented). */
  handleKey(e: KeyboardEvent): boolean;
  restoreFocus(): void;
}

const stack: StackEntry[] = [];
let lastInputAt = -Infinity;
let modality: Modality = startModality();
let offGlobal: Array<() => void> = [];
const pad = new MenuPad(() => active()?.padSink ?? null);

function startModality(): Modality {
  try {
    return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? 'touch' : 'key';
  } catch {
    return 'key';
  }
}

function active(): StackEntry | null {
  const m = stack[stack.length - 1];
  return m && !m.suspended ? m : null;
}

export const menuStack = {
  active,
  get depth(): number {
    return stack.length;
  },
  get modality(): Modality {
    return modality;
  },
  setModality(m: Modality): void {
    modality = m;
  },
  noteInput(): void {
    lastInputAt = performance.now();
  },
  sinceLastInput(): number {
    return performance.now() - lastInputAt;
  },
  /** Buttons held right now must be let go before they count (the active menu changed). */
  reprime(): void {
    pad.reprime();
  },
  push(entry: StackEntry): void {
    stack.push(entry);
    pad.reprime();
    if (stack.length === 1) installGlobal();
  },
  pop(entry: StackEntry): void {
    const i = stack.indexOf(entry);
    if (i < 0) return;
    const wasTop = i === stack.length - 1;
    stack.splice(i, 1);
    pad.reprime();
    if (stack.length === 0) uninstallGlobal();
    else if (wasTop) active()?.restoreFocus();
  },
};

function installGlobal(): void {
  const onKey = (e: KeyboardEvent): void => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    modality = 'key';
    const menu = active();
    if (!menu || !menu.handleKey(e)) return;
    e.preventDefault();
    menuStack.noteInput();
  };
  const onPointer = (e: PointerEvent): void => {
    modality = e.pointerType === 'mouse' ? 'mouse' : 'touch';
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('pointerdown', onPointer, true);
  offGlobal = [
    () => window.removeEventListener('keydown', onKey),
    () => window.removeEventListener('pointerdown', onPointer, true),
  ];
  pad.start();
}

function uninstallGlobal(): void {
  for (const off of offGlobal.splice(0)) off();
  pad.stop();
}
