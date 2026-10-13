import { expect, test, type Page } from '@playwright/test';
import { SHOT_DIR, frames, gpuMemory, waitForMode, watchConsole, type PilgrimHandle } from './support';

/**
 * Phase 1 test world (`?chapter=test`, built from content/levels/test.json): builds with a clean console in
 * under 2 s, the loading bar moves while it builds (time-sliced, never frozen), the gameplay view stays inside the
 * GDD 2.15 desktop budget (< 150 draw calls, < 300k triangles), and building + disposing it 5 times does not
 * grow the renderer's GPU geometries or textures. Also saves the report screenshots to test-results/phase1/.
 */
test.describe.configure({ mode: 'serial' });

/** GDD 2.15 desktop budget. */
const BUDGET = { buildMs: 2000, drawCalls: 150, triangles: 300_000 };

interface WorldInfo {
  buildMs: number;
  buildWorkMs: number;
  colliders: number;
  npcs: number;
  progress: number[];
  cameraMode: string;
}
interface TestWorldHandle {
  readonly ready: boolean;
  readonly progressLog: number[];
  readonly cameraMode: string;
  readonly current: {
    buildMs: number;
    buildWorkMs: number;
    colliders: unknown[];
    npcs: Map<string, unknown>;
  } | null;
  setCameraMode(mode: 'follow' | 'orbit' | 'overview'): void;
  rebuild(): Promise<void>;
}
type WorldWindow = Window & { __pilgrim: PilgrimHandle & { testWorld: TestWorldHandle | null } };

async function worldInfo(page: Page): Promise<WorldInfo> {
  return page.evaluate(() => {
    const tw = (window as unknown as WorldWindow).__pilgrim.testWorld;
    const w = tw?.current;
    if (!tw || !w) throw new Error('the test world is not built');
    return {
      buildMs: w.buildMs,
      buildWorkMs: w.buildWorkMs,
      colliders: w.colliders.length,
      npcs: w.npcs.size,
      progress: [...tw.progressLog],
      cameraMode: tw.cameraMode,
    };
  });
}

/** Highest draw calls and triangles over `n` rendered frames. */
async function peakStats(page: Page, n: number): Promise<{ drawCalls: number; triangles: number }> {
  return page.evaluate(
    (count) =>
      new Promise<{ drawCalls: number; triangles: number }>((done) => {
        const engine = (window as unknown as WorldWindow).__pilgrim.engine;
        const peak = { drawCalls: 0, triangles: 0 };
        let left = count;
        const tick = (): void => {
          if (engine) {
            peak.drawCalls = Math.max(peak.drawCalls, engine.stats.drawCalls);
            peak.triangles = Math.max(peak.triangles, engine.stats.triangles);
          }
          if (--left <= 0) done(peak);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    n,
  );
}

async function setCamera(page: Page, mode: 'follow' | 'orbit' | 'overview'): Promise<void> {
  await page.evaluate((m) => (window as unknown as WorldWindow).__pilgrim.testWorld?.setCameraMode(m), mode);
}

test('?chapter=test builds in under 2 s with a clean console, and the loading bar kept moving', async ({
  page,
}) => {
  const problems = watchConsole(page);
  await page.goto('/?chapter=test');
  await waitForMode(page);
  const info = await worldInfo(page);
  console.log(
    `test world: build ${info.buildMs.toFixed(0)} ms (work ${info.buildWorkMs.toFixed(0)} ms), ` +
      `${info.colliders} colliders, ${info.npcs} NPCs, ${info.progress.length} progress updates`,
  );
  expect(info.buildMs).toBeLessThan(BUDGET.buildMs);
  expect(info.npcs).toBe(4);
  expect(info.colliders).toBeGreaterThan(50);

  // The bar got many updates before reaching 100% (time-sliced build), and only ever moved forward.
  const beforeEnd = info.progress.filter((p) => p < 1);
  expect(beforeEnd.length).toBeGreaterThanOrEqual(10);
  expect(new Set(beforeEnd.map((p) => Math.round(p * 20))).size).toBeGreaterThanOrEqual(5);
  for (let i = 1; i < info.progress.length; i++) {
    expect(info.progress[i]!).toBeGreaterThanOrEqual(info.progress[i - 1]!);
  }
  expect(info.progress.at(-1)).toBe(1);
  await expect(page.locator('#ui [role="progressbar"]')).toHaveCount(0, { timeout: 5_000 });

  await frames(page, 60);
  expect(problems, problems.join('\n')).toEqual([]);
});

test('the gameplay view stays inside the desktop budget', async ({ page }) => {
  const problems = watchConsole(page);
  await page.goto('/?chapter=test');
  await waitForMode(page);
  await setCamera(page, 'follow');
  await frames(page, 90); // the follow camera eases in; Christian walks a few steps
  const peak = await peakStats(page, 120);
  console.log(`gameplay view peak: ${peak.drawCalls} draw calls, ${peak.triangles} triangles`);
  expect(peak.drawCalls).toBeGreaterThan(0);
  expect(peak.drawCalls).toBeLessThan(BUDGET.drawCalls);
  expect(peak.triangles).toBeLessThan(BUDGET.triangles);
  await page.screenshot({ path: `${SHOT_DIR}/test-world.png` });

  await setCamera(page, 'overview');
  await frames(page, 90);
  const wide = await peakStats(page, 30);
  console.log(`overview: ${wide.drawCalls} draw calls, ${wide.triangles} triangles`);
  await page.screenshot({ path: `${SHOT_DIR}/test-world-wide.png` });
  expect(problems, problems.join('\n')).toEqual([]);
});

test('on Low (no shadow map) every character still stands on a blob shadow', async ({ page }) => {
  const problems = watchConsole(page);
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('pilgrim.settings.v1', JSON.stringify({ quality: 'low' })));
  await page.goto('/?chapter=test');
  await waitForMode(page);
  await setCamera(page, 'follow');
  await frames(page, 90);
  const state = await page.evaluate(() => {
    const w = window as unknown as WorldWindow & {
      __pilgrim: { engine: { renderer: { shadowMap: { enabled: boolean } } } };
    };
    const world = w.__pilgrim.testWorld?.current as unknown as {
      npcs: Map<string, unknown>;
      blobs: { mesh: { count: number; visible: boolean } };
    } | null;
    if (!world) throw new Error('the test world is not built');
    return {
      shadowMap: w.__pilgrim.engine.renderer.shadowMap.enabled,
      blobs: world.blobs.mesh.count,
      visible: world.blobs.mesh.visible,
      npcs: world.npcs.size,
    };
  });
  console.log(
    `Low: shadow map ${state.shadowMap ? 'on' : 'off'}, ${state.blobs} blob shadows, ${state.npcs} NPCs`,
  );
  expect(state.shadowMap).toBe(false);
  expect(state.visible).toBe(true);
  // GDD 2.11: blob shadows under every character on all qualities (NPCs near enough to be drawn, the walker).
  expect(state.blobs).toBeGreaterThanOrEqual(2);
  await page.screenshot({ path: `${SHOT_DIR}/test-world-low.png` });
  await page.evaluate(() => localStorage.removeItem('pilgrim.settings.v1'));
  expect(problems, problems.join('\n')).toEqual([]);
});

test('building and disposing the test world 5 times does not grow GPU memory', async ({ page }) => {
  test.setTimeout(120_000);
  const problems = watchConsole(page);
  await page.goto('/?chapter=test');
  await waitForMode(page);
  await frames(page, 30);
  const baseline = await gpuMemory(page);
  const samples = [baseline];
  for (let i = 0; i < 5; i++) {
    if (i % 2 === 0) {
      // F1 "Rebuild world": dispose the World, build it again.
      await page.evaluate(() => (window as unknown as WorldWindow).__pilgrim.testWorld?.rebuild());
    } else {
      // Whole mode: dispose the TestWorld (loading screen, camera rig, debug controls) and start a new one.
      await page.evaluate(() => (window as unknown as WorldWindow).__pilgrim.restartMode());
    }
    await waitForMode(page);
    await frames(page, 30);
    samples.push(await gpuMemory(page));
  }
  console.log('GPU memory per build:', samples.map((m) => `${m.geometries}g/${m.textures}t`).join(' → '));
  const last = samples.at(-1)!;
  expect(last.geometries).toBeLessThanOrEqual(baseline.geometries);
  expect(last.textures).toBeLessThanOrEqual(baseline.textures);
  // One loading screen at most is left in the DOM.
  expect(await page.locator('#ui [role="progressbar"]').count()).toBeLessThanOrEqual(1);
  expect(problems, problems.join('\n')).toEqual([]);
});
