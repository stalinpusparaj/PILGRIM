import type { Page } from '@playwright/test';

/**
 * Shared helpers for the Phase 1 specs (lab.spec.ts, world.spec.ts): console capture, frame waits and the loose
 * typings of what `window.__pilgrim` exposes (src/main.ts). The project has no @types/node (GDD 2.3), so Node
 * built-ins are loaded by name like in smoke.spec.ts.
 */

export interface MemoryInfo {
  geometries: number;
  textures: number;
}

export interface EngineHandle {
  stats: { drawCalls: number; triangles: number; geometries: number; textures: number };
  renderer: { info: { memory: MemoryInfo } };
}

export interface PilgrimHandle {
  ready?: boolean;
  modeReady?: boolean;
  engine?: EngineHandle | null;
  restartMode(): Promise<void>;
}

/** Where the Phase 1 report screenshots go (Playwright clears test-results/ at the start of each run). */
export const SHOT_DIR = 'test-results/phase1';

/**
 * Collects console errors and warnings plus page errors. Vite's own client messages are debug-level and are not
 * collected. Driver chatter Chrome forwards from the GPU process ("[.WebGL-...] GL Driver Message", e.g. a
 * ReadPixels stall note) is not from our code and is ignored; three.js shader warnings are kept (they start
 * with "THREE.").
 */
export function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (msg) => {
    const type = msg.type();
    if (type !== 'error' && type !== 'warning') return;
    const text = msg.text();
    if (text.startsWith('[.WebGL-') && text.includes('GL Driver Message')) return;
    problems.push(`console.${type}: ${text}`);
  });
  page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
  return problems;
}

/** Waits until the current mode is on screen (Lab first character / test world built and shown). */
export async function waitForMode(page: Page, timeout = 60_000): Promise<void> {
  await page.waitForFunction(
    () => (window as unknown as { __pilgrim?: PilgrimHandle }).__pilgrim?.modeReady === true,
    undefined,
    { timeout },
  );
}

/** Lets `n` animation frames run. */
export async function frames(page: Page, n: number): Promise<void> {
  await page.evaluate(
    (count) =>
      new Promise<void>((done) => {
        let left = count;
        const tick = (): void => {
          if (--left <= 0) done();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    n,
  );
}

/** renderer.info.memory right now. */
export async function gpuMemory(page: Page): Promise<MemoryInfo> {
  return page.evaluate(() => {
    const engine = (window as unknown as { __pilgrim: PilgrimHandle }).__pilgrim.engine;
    if (!engine) throw new Error('no engine');
    const m = engine.renderer.info.memory;
    return { geometries: m.geometries, textures: m.textures };
  });
}
