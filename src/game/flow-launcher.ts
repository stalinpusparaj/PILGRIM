/**
 * Stand-ins the flow uses until the real modules plug in:
 * - the default chapter launcher opens the test world (src/world/TestWorld.ts, `content/levels/test.json`) for
 *   every chapter, so title → opening → "chapter" → pause → title can be played and tested before the
 *   ChapterManager exists; `?chapter=test` uses it on purpose;
 * - the default Settings screen is SettingsUI (loaded on first use).
 * GameFlow.setChapterLauncher() / setScreen() replace them. The Satchel lives in flow-satchel.ts.
 */
import type { Engine } from '../core/Engine';
import type { TestWorld } from '../world/TestWorld';
import type { ChapterHandle, ChapterLauncher, ScreenFactory } from './flow-types';

/** The level's own Christian walks the test world's Way; the Satchel's MAP marks him as the player. */
const TEST_WALKER = 'christian';

/**
 * The test world as a chapter. `onWorld` hears the world when it is on screen and null when it goes (the
 * `?chapter=test` mode runner exposes it as `window.__pilgrim.testWorld`).
 */
export function testWorldLauncher(
  engine: Engine,
  onWorld?: (world: TestWorld | null) => void,
): ChapterLauncher {
  return async () => {
    const { TestWorld } = await import('../world/TestWorld');
    const world = new TestWorld(engine);
    try {
      await world.start();
    } catch (err) {
      world.dispose();
      throw err;
    }
    onWorld?.(world);
    const handle: ChapterHandle = {
      gameplay: false, // the test world is a fly-through: no pointer lock, no touch controls
      satchelMap: () => {
        const built = world.current;
        if (!built) return null;
        const walker = built.npcs.get(TEST_WALKER)?.root;
        const player = walker
          ? {
              x: walker.position.x,
              z: walker.position.z,
              heading: { x: Math.sin(walker.rotation.y), z: Math.cos(walker.rotation.y) },
            }
          : null;
        return { level: built.level, player };
      },
      dispose: () => {
        onWorld?.(null);
        world.dispose();
      },
    };
    return handle;
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
