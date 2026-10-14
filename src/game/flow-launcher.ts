/**
 * What the flow plugs in by default:
 * - the chapter launcher is the ChapterManager (src/world/ChapterManager.ts, its own chunk, loaded on the first
 *   chapter): every chapter's script on its level; a chapter with no script yet plays the test chapter;
 *   `?chapter=test` forces the test script (`{ script: 'test' }`);
 * - the default Settings screen is SettingsUI (loaded on first use).
 * GameFlow.setChapterLauncher() / setScreen() replace them. The Satchel lives in flow-satchel.ts.
 */
import type { Engine } from '../core/Engine';
import type { ChapterManager, ChapterManagerOptions } from '../world/ChapterManager';
import type { ChapterLauncher, ScreenFactory } from './flow-types';

/**
 * A launcher backed by one ChapterManager (made on the first launch). `onManager` hears it once it exists (the
 * mode runner exposes its session and dev probe to tests).
 */
export function chapterLauncher(
  engine: Engine,
  opts: ChapterManagerOptions & { onManager?: (m: ChapterManager) => void } = {},
): ChapterLauncher {
  let manager: ChapterManager | null = null;
  return async (chapter, waystone, state) => {
    if (!manager) {
      const { ChapterManager } = await import('../world/ChapterManager');
      manager ??= new ChapterManager(engine, { script: opts.script });
      opts.onManager?.(manager);
    }
    return manager.launch(chapter, waystone, state);
  };
}

/** Settings > SettingsUI.open() resolves when the player leaves the screen. */
export const settingsScreen: ScreenFactory = (ctx) => {
  let disposed = false;
  let dispose: (() => void) | null = null;
  import('../ui/SettingsUI')
    .then(({ SettingsUI }) => {
      if (disposed) return;
      const ui = new SettingsUI(ctx.parent);
      dispose = () => ui.dispose();
      ui.open().then(
        () => ctx.close(),
        () => ctx.close(),
      );
    })
    .catch((err: unknown) => {
      console.error('[flow] the settings screen could not open', err);
      ctx.close();
    });
  return {
    dispose: () => {
      disposed = true;
      dispose?.();
    },
  };
};
