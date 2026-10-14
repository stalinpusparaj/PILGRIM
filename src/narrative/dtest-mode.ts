/**
 * The `?dialogue=test` mode runner (src/modes.ts 'dialogueTest'; main.ts picks it when `urlParams.dialogue` is
 * 'test'). Like every URL param (GDD 2.15) it is ignored outside dev builds unless `?debug=1`. The scene itself
 * is a dynamic import, so the default mode does not ship it.
 */
import type { Engine } from '../core/Engine';
import type { ModeRunner } from '../modes';
import type { DialogueTestScene } from './DialogueTestScene';

/**
 * Starts the demo; the runner can be disposed at any time, even before `started` settles. `blank` leaves the
 * engine drawing an empty scene afterwards. The scene is exposed as `dialogueTest` (`window.__pilgrim`).
 */
export function dialogueTestRunner(engine: Engine, blank: (engine: Engine) => void): ModeRunner {
  let scene: DialogueTestScene | null = null;
  let ready = false;
  let disposed = false;
  const started = import('./DialogueTestScene').then(async ({ DialogueTestScene }) => {
    if (disposed) return;
    scene = new DialogueTestScene(engine);
    await scene.start();
    ready = !disposed;
  });
  return {
    kind: 'dialogueTest',
    started,
    get ready() {
      return ready && !disposed && (scene?.ready ?? false);
    },
    lab: null,
    testWorld: null,
    get dialogueTest() {
      return disposed ? null : scene;
    },
    setFov: () => {}, // the scene follows settings:changed itself
    dispose: () => {
      if (disposed) return;
      disposed = true;
      scene?.dispose();
      blank(engine);
    },
  };
}
