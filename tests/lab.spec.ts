import { expect, test, type Page } from '@playwright/test';
import { SHOT_DIR, frames, gpuMemory, waitForMode, watchConsole, type PilgrimHandle } from './support';

/**
 * Phase 1 Character Lab (`?lab=1`, GDD 2.12): boots clean, every recipe builds as ONE draw call (face included),
 * every clip and expression plays, the lineup builds, a crowd of 100 costs under 10 draw calls (shadows
 * included), and restarting the Lab gives back every GPU geometry and texture. Also saves the report
 * screenshots to test-results/phase1/.
 */
test.describe.configure({ mode: 'serial' });

// Loose typings for src/gen/lab-probe.ts (window.__pilgrim.lab).
interface RecipeStats {
  id: string;
  meshCalls: number;
  drawCalls: number;
  triangles: number;
  meshes: number;
  hasGlow: boolean;
  height: number;
  buildMs: number;
}
interface ExerciseResult {
  id: string;
  clips: number;
  expressions: number;
  lowestBone: number;
  blinks: number;
  slip: Record<string, number>;
  issues: string[];
}
interface CrowdStats {
  instances: number;
  meshes: number;
  drawCalls: number;
  drawCallsWithShadows: number;
  triangles: number;
}
interface LabProbe {
  ready(): boolean;
  recipeIds(): string[];
  clipNames(): string[];
  expressions(): string[];
  select(id: string): void;
  view(v: 'turntable' | 'lineup'): void;
  shot(s: 'close' | 'gameplay' | 'wide'): void;
  crowd(on: boolean): void;
  play(name: string): void;
  expression(e: string): void;
  talking(on: boolean): void;
  burden(size: number): void;
  setRepeat(on: boolean): void;
  turn(angle: number): void;
  lineupBuilt(): number;
  current(): { id: string; clip: string; overlay: string | null; height: number } | null;
  poseFinite(): boolean;
  measureRecipe(id: string): RecipeStats;
  exercise(id: string): ExerciseResult;
  measureCrowd(): CrowdStats | null;
}
type LabWindow = Window & { __pilgrim: PilgrimHandle & { lab: LabProbe | null } };

/** Runs `fn(probe, arg)` in the page against the current Lab probe (fetched fresh: a restart replaces it). */
async function lab<T, A = undefined>(page: Page, fn: (probe: LabProbe, arg: A) => T, arg?: A): Promise<T> {
  const handle = await page.evaluateHandle(() => {
    const probe = (window as unknown as LabWindow).__pilgrim.lab;
    if (!probe) throw new Error('window.__pilgrim.lab is not available');
    return probe;
  });
  try {
    // The function is serialised into the page; only its parameter types are widened here.
    const run = fn as unknown as (probe: LabProbe, a: unknown) => T;
    return (await handle.evaluate(run, arg as unknown)) as T;
  } finally {
    await handle.dispose();
  }
}

async function openLab(page: Page): Promise<string[]> {
  const problems = watchConsole(page);
  await page.goto('/?lab=1');
  await waitForMode(page);
  await frames(page, 10);
  return problems;
}

async function hidePanel(page: Page): Promise<void> {
  await page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('.lab');
    if (panel) panel.style.display = 'none';
  });
}

test('?lab=1 boots with a clean console and shows the first character', async ({ page }) => {
  const problems = await openLab(page);
  const current = await lab(page, (p) => p.current());
  expect(current?.id).toBe('christian_burdened');
  expect(current?.height ?? 0).toBeGreaterThan(1.2);
  expect(await lab(page, (p) => p.poseFinite())).toBe(true);
  await frames(page, 30);
  expect(problems, problems.join('\n')).toEqual([]);
});

test('every recipe builds, and each character mesh is exactly one draw call', async ({ page }) => {
  const problems = await openLab(page);
  const ids = await lab(page, (p) => p.recipeIds());
  expect(ids.length).toBeGreaterThanOrEqual(20);
  for (const required of [
    'christian_burdened',
    'christian_free',
    'christian_armour',
    'christiana',
    'evangelist',
  ]) {
    expect(ids).toContain(required);
  }
  for (const id of [
    'obstinate',
    'pliable',
    'help',
    'son_1',
    'son_2',
    'son_3',
    'son_4',
    'wiseman',
    'goodwill',
  ])
    expect(ids).toContain(id);
  expect(ids.filter((id) => id.startsWith('crowd_')).length).toBeGreaterThanOrEqual(8);

  const stats: RecipeStats[] = [];
  for (const id of ids) {
    const s = await lab(page, (p, recipe) => p.measureRecipe(recipe), id);
    stats.push(s);
    // The whole character (body, clothes, props, Burden and every face part) is one SkinnedMesh = 1 call.
    expect(s.meshCalls, `${id}: main mesh draw calls`).toBe(1);
    // Only recipes with glowing bits (candle, lantern, forehead dot) add one tiny glow mesh.
    expect(s.drawCalls, `${id}: total draw calls`).toBe(s.hasGlow ? 2 : 1);
    expect(s.triangles, `${id}: triangles`).toBeLessThan(2500);
    expect(s.height, `${id}: height`).toBeGreaterThan(0.6);
    // The live Lab builds it too (turntable).
    await lab(page, (p, recipe) => p.select(recipe), id);
    expect(await lab(page, (p) => p.current()?.id), `${id}: selected`).toBe(id);
  }
  await frames(page, 10);
  console.log(
    'recipes:',
    stats
      .map((s) => `${s.id} ${s.triangles} tris ${s.drawCalls} call(s) ${s.buildMs.toFixed(1)} ms`)
      .join('; '),
  );
  expect(problems, problems.join('\n')).toEqual([]);
});

test('every character plays every animation and expression, and blinks', async ({ page }) => {
  const problems = await openLab(page);
  const ids = await lab(page, (p) => p.recipeIds());
  // Offscreen: every recipe runs every clip, expression, talking and the Burden spring through update().
  const worstSlip: Record<string, [string, number]> = {};
  for (const id of ids) {
    const r = await lab(page, (p, recipe) => p.exercise(recipe), id);
    expect(r.issues, `${id}: ${r.issues.join('; ')}`).toEqual([]);
    expect(r.clips).toBe(22);
    expect(r.expressions).toBe(8);
    expect(r.lowestBone, `${id}: a bone sank below the ground`).toBeGreaterThan(-0.15);
    // Blinks every 2-5 s: at least two in 12 s of idle.
    expect(r.blinks, `${id}: blinks in 12 s`).toBeGreaterThanOrEqual(2);
    // Planted feet stay planted at the GDD 2.7.1 speeds (share of body speed at mid-stance; it was 0.6-1.0).
    for (const [clip, slip] of Object.entries(r.slip)) {
      expect(slip, `${id}: ${clip} foot slide`).toBeLessThan(clip === 'burdenedWalk' ? 0.15 : 0.25);
      if (slip > (worstSlip[clip]?.[1] ?? -1)) worstSlip[clip] = [id, slip];
    }
  }
  console.log(
    'worst foot slide:',
    Object.entries(worstSlip)
      .map(([clip, [id, v]]) => `${clip} ${(v * 100).toFixed(0)}% (${id})`)
      .join(', '),
  );

  // Live in the Lab: play every clip and expression on burdened Christian.
  await lab(page, (p) => p.select('christian_burdened'));
  const clips = await lab(page, (p) => p.clipNames());
  for (const clip of clips) {
    await lab(page, (p, name) => p.play(name), clip);
    await frames(page, 8);
    const cur = await lab(page, (p) => p.current());
    expect([cur?.clip, cur?.overlay], `clip ${clip}`).toContain(clip);
    expect(await lab(page, (p) => p.poseFinite()), `clip ${clip}: finite pose`).toBe(true);
  }
  for (const e of await lab(page, (p) => p.expressions())) {
    await lab(page, (p, ex) => p.expression(ex), e);
    await frames(page, 4);
  }
  await lab(page, (p) => {
    p.talking(true);
    p.burden(1.6);
  });
  await frames(page, 30);
  await lab(page, (p) => {
    p.talking(false);
    p.burden(1);
  });
  await frames(page, 10);
  expect(problems, problems.join('\n')).toEqual([]);
});

test('the lineup builds every recipe, and a crowd of 100 costs under 10 draw calls', async ({ page }) => {
  const problems = await openLab(page);
  await hidePanel(page);
  const total = (await lab(page, (p) => p.recipeIds())).length;
  await lab(page, (p) => p.view('lineup'));
  await expect.poll(() => lab(page, (p) => p.lineupBuilt()), { timeout: 20_000 }).toBe(total);

  // Screenshot 1: the lineup at the gameplay camera distance (4.5 m back, 2.2 m up; GDD 2.5).
  await lab(page, (p) => {
    p.select('christian_armour');
    p.shot('gameplay');
  });
  await frames(page, 70);
  await page.screenshot({ path: `${SHOT_DIR}/lab-lineup.png` });
  await lab(page, (p) => p.shot('wide'));
  await frames(page, 70);
  await page.screenshot({ path: `${SHOT_DIR}/lab-lineup-wide.png` });

  // Crowd of 100: 8 body types = 8 instanced meshes, plus one shared shadow proxy when shadows are on.
  await lab(page, (p) => {
    p.view('turntable');
    p.crowd(true);
  });
  await frames(page, 70);
  const crowd = await lab(page, (p) => p.measureCrowd());
  expect(crowd).not.toBeNull();
  expect(crowd!.instances).toBe(100);
  expect(crowd!.drawCalls).toBeLessThan(10);
  expect(crowd!.drawCallsWithShadows).toBeLessThan(10);
  console.log('crowd:', JSON.stringify(crowd));
  await page.screenshot({ path: `${SHOT_DIR}/lab-crowd.png` });
  expect(problems, problems.join('\n')).toEqual([]);
});

test('Christian close-up, and restarting the Lab frees its GPU memory', async ({ page }) => {
  const problems = await openLab(page);
  await hidePanel(page);
  await lab(page, (p) => {
    p.select('christian_burdened');
    p.shot('close');
    p.turn(-0.75);
  });
  await frames(page, 60);
  await page.screenshot({ path: `${SHOT_DIR}/lab-closeup.png` });

  const before = await gpuMemory(page);
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => (window as unknown as LabWindow).__pilgrim.restartMode());
    await waitForMode(page);
    await frames(page, 10);
  }
  const after = await gpuMemory(page);
  expect(after.geometries, `geometries ${before.geometries} → ${after.geometries}`).toBeLessThanOrEqual(
    before.geometries,
  );
  expect(after.textures, `textures ${before.textures} → ${after.textures}`).toBeLessThanOrEqual(
    before.textures,
  );
  expect(await page.locator('.lab').count()).toBe(1);
  expect(problems, problems.join('\n')).toEqual([]);
});
