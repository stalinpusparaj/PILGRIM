/**
 * Small adapters for other screens: `openSatchel()` (touch HUD icon, tools) and `satchelScreen()`, the GameFlow
 * screen factory behind the pause menu's SATCHEL button.
 */
import { services } from '../core/Services';
import type { SatchelTab } from './satchel-view';
import type { SatchelUI } from './SatchelUI';

/** Convenience for the pause menu and touch HUD: open the registered Satchel if there is one. */
export function openSatchel(tab?: SatchelTab): Promise<void> {
  return services.tryGet('satchel')?.open(tab) ?? Promise.resolve();
}

/** What GameFlow hands a screen factory (src/game/flow-types.ts ScreenContext; structural, no import). */
export interface SatchelScreenContext {
  readonly parent: HTMLElement;
  readonly from: string;
  close(): void;
}

/**
 * A GameFlow screen factory for the pause menu's SATCHEL button:
 * `flow.setScreen('satchel', satchelScreen())`. Opens the registered Satchel (or `get()`); when the Satchel closes
 * it calls `ctx.close()`, and the flow's `dispose()` closes the Satchel if it is still open.
 */
export function satchelScreen(get: () => SatchelUI | undefined = () => services.tryGet('satchel')) {
  return (ctx: SatchelScreenContext): { dispose(): void } => {
    const satchel = get();
    if (!satchel) {
      ctx.close();
      return { dispose: () => {} };
    }
    let live = true;
    void satchel.open().then(() => {
      if (!live) return;
      live = false;
      ctx.close();
    });
    return {
      dispose: () => {
        if (!live) return;
        live = false;
        satchel.close();
      },
    };
  };
}
