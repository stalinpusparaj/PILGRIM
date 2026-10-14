/**
 * Key and pad commands for MY SATCHEL, turned into focus moves, tab changes and closing (see satchel-nav.ts for
 * the spatial focus model).
 *
 * Keyboard: arrows and the bound move keys move focus; Tab (when not the Satchel key) cycles inside the panel;
 * PageUp / PageDown and 1-5 change page; Home / End on the tab bar. The Satchel and Pause keys (Tab and Esc by
 * default, as rebound) close it: straight from keydown when no engine loop runs, otherwise through the Input
 * actions in the loop step (so the closing press cannot reopen it in the same step).
 * Pad: A presses the focused button, B closes, LB / RB change page, d-pad / stick move focus.
 */
import type { System } from '../core/Loop';
import { services } from '../core/Services';
import type { NavDir, PadCommand, SatchelNav } from './satchel-nav';

export interface ControlHooks {
  nav: SatchelNav;
  /** The scrim root (gets `is-nav` / `is-pad` for the visible focus style) and the dialog panel. */
  root: HTMLElement;
  panel: HTMLElement;
  close(): void;
  stepTab(delta: -1 | 1): void;
  gotoTab(index: number): void;
  tabCount: number;
  /** True while close keys are read as Input actions in the loop step. */
  viaLoop(): boolean;
}

const KEY_DIRS: Readonly<Record<string, NavDir>> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};
const MOVE_DIRS: ReadonlyArray<readonly ['moveForward' | 'moveBack' | 'moveLeft' | 'moveRight', NavDir]> = [
  ['moveForward', 'up'],
  ['moveBack', 'down'],
  ['moveLeft', 'left'],
  ['moveRight', 'right'],
];

export class SatchelControls {
  private readonly hk: ControlHooks;

  constructor(hooks: ControlHooks) {
    this.hk = hooks;
  }

  /** window keydown while the Satchel is open. */
  readonly onKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const input = services.tryGet('input');
    const closeCodes = input
      ? [...input.getBindings('satchel'), ...input.getBindings('pause')]
      : ['Tab', 'Escape'];
    if (closeCodes.includes(e.code)) {
      e.preventDefault(); // Tab must not move focus out of the dialog
      if (!this.hk.viaLoop() && !e.repeat) this.hk.close();
      return;
    }
    const dir =
      KEY_DIRS[e.code] ??
      (input ? MOVE_DIRS.find(([a]) => input.getBindings(a).includes(e.code))?.[1] : undefined);
    let handled = true;
    if (dir) this.hk.nav.move(dir);
    else if (e.code === 'Tab') this.hk.nav.cycle(e.shiftKey);
    else if (e.code === 'PageUp' || e.code === 'PageDown') this.hk.stepTab(e.code === 'PageUp' ? -1 : 1);
    else if (
      (e.code === 'Home' || e.code === 'End') &&
      document.activeElement?.getAttribute('role') === 'tab'
    ) {
      this.hk.gotoTab(e.code === 'Home' ? 0 : this.hk.tabCount - 1);
    } else if (/^(Digit|Numpad)[1-9]$/.test(e.code) && Number(e.code.slice(-1)) <= this.hk.tabCount) {
      this.hk.gotoTab(Number(e.code.slice(-1)) - 1);
    } else handled = false;
    if (handled) {
      e.preventDefault();
      this.hk.root.classList.add('is-nav');
    }
  };

  /** One gamepad command (from PadNav.poll). */
  pad(cmd: PadCommand): void {
    this.hk.root.classList.add('is-nav', 'is-pad');
    switch (cmd) {
      case 'activate': {
        // A on a button presses it; on a card, the card's own button (Read / Use) if it has one.
        const el = document.activeElement;
        if (!(el instanceof HTMLElement) || !this.hk.panel.contains(el)) return;
        const button = el instanceof HTMLButtonElement ? el : el.querySelector<HTMLButtonElement>('button');
        if (button && !button.disabled) button.click();
        return;
      }
      case 'back':
        this.hk.close();
        return;
      case 'view':
      case 'menu':
        if (!this.hk.viaLoop()) this.hk.close(); // otherwise the Satchel / Pause action closes it in the step
        return;
      case 'prevTab':
        this.hk.stepTab(-1);
        return;
      case 'nextTab':
        this.hk.stepTab(1);
        return;
      default:
        this.hk.nav.move(cmd);
    }
  }
}

/** Without a running engine loop (tests, tools): drive a System from animation frames. Returns the stop. */
export function rafDriver(system: System): () => void {
  let id = 0;
  let last = performance.now();
  const tick = (now: number): void => {
    system.update?.(Math.min(0.1, Math.max(0, (now - last) / 1000)));
    last = now;
    id = requestAnimationFrame(tick);
  };
  id = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(id);
}
