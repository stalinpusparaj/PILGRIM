import { expect, test, type Page } from '@playwright/test';
import { frames, waitForMode, watchConsole } from './support';
import { waitSim } from './play-support';
import { spaceUntil, waitForFlow } from './story-support';

/**
 * CHAPTER IV — THE WICKET GATE (src/chapters/ch04.ts on content/levels/ch04.json), played end to end by script on
 * `/?chapter=4&skipIntro=1`: the world builds in < 2 s; the objective is "Reach the gate"; standing in the open in
 * the approach field a volley of 4 arrows (Easy) comes with a whistle and thunks, hits Christian (bonk 'arrow',
 * Hope -5, toast) and he is set down behind the last cover rock he reached; near the wall the objective becomes
 * "Knock on the gate"; [E] Knock plays the pull-inside cutscene (knocks, a volley lands outside), then Goodwill's
 * talk (third answer: Hope +10, FRIENDS MET), the music turns calm with birdsong and the objective "Follow the
 * straight Way"; the end trigger completes the chapter. Clean console throughout. Screenshots in
 * test-results/phase4/ch04-*.png.
 */

interface V3 {
  x: number;
  y: number;
  z: number;
}

interface Ch04Window {
  __pilgrim: {
    modeReady?: boolean;
    play: {
      teleport(x: number, z: number, facing?: number): void;
      state: { hope: number; objective: string | null; flag(k: string): unknown; setHope(v: number): void };
      player: { mode: string; controller: { position: V3 } };
      world: {
        buildMs: number;
        level: {
          landmarks: Array<{ id: string; at?: [number, number, number]; rotY?: number }>;
          triggers: Array<{ id: string; at: [number, number, number]; script: string }>;
        };
      };
      zones: { inZone(type: string): boolean };
      interactables: { focused: { id: string } | null };
    } | null;
    services: { get(key: string): unknown; tryGet(key: string): unknown };
    events: { on(name: string, fn: (payload: unknown) => void): () => void };
  };
  __log: Array<{ name: string; payload: unknown }>;
}

const LOGGED = ['player:bonk', 'hud:toast', 'sfx', 'music:play', 'ambience:set', 'cutscene:end', 'chapter:complete'];
/** Report screenshots: test-results/phase4 (Playwright clears it per run), or PILGRIM_SHOTS when set. */
const SHOTS =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.['PILGRIM_SHOTS'] ??
  'test-results/phase4';

async function open(page: Page): Promise<void> {
  await page.goto('/?chapter=4&skipIntro=1');
  await waitForMode(page);
  await page.waitForFunction(() => (window as unknown as Ch04Window).__pilgrim.play != null);
  await waitForFlow(page, (p) => p.state === 'playing' && !p.loopPaused);
  await page.evaluate((names) => {
    const w = window as unknown as Ch04Window;
    w.__log = [];
    for (const n of names) w.__pilgrim.events.on(n, (payload) => w.__log.push({ name: n, payload }));
  }, LOGGED);
  await page.addStyleTag({ content: '.pg-click-to-play { display: none !important; }' });
  await frames(page, 20);
}

async function logged(page: Page, name: string): Promise<unknown[]> {
  return page.evaluate(
    (n) => (window as unknown as Ch04Window).__log.filter((e) => e.name === n).map((e) => e.payload),
    name,
  );
}

async function sfxCount(page: Page, id: string): Promise<number> {
  const all = (await logged(page, 'sfx')) as Array<{ id: string }>;
  return all.filter((s) => s.id === id).length;
}

async function state(page: Page) {
  return page.evaluate(() => {
    const play = (window as unknown as Ch04Window).__pilgrim.play!;
    const p = play.player.controller.position;
    return {
      hope: play.state.hope,
      objective: play.state.objective,
      mode: play.player.mode,
      x: p.x,
      z: p.z,
      inField: play.zones.inZone('volley'),
      inside: play.state.flag('ch04.insideGate'),
    };
  });
}

async function triggerAt(page: Page, id: string): Promise<[number, number, number]> {
  return page.evaluate(
    (tid) => (window as unknown as Ch04Window).__pilgrim.play!.world.level.triggers.find((t) => t.id === tid)!.at,
    id,
  );
}

async function teleport(page: Page, x: number, z: number, facing?: number): Promise<void> {
  await page.evaluate(
    ({ x, z, facing }) => (window as unknown as Ch04Window).__pilgrim.play!.teleport(x, z, facing),
    { x, z, facing },
  );
  await waitSim(page, 0.4);
}

test('Chapter IV end to end: arrows, cover rocks, the knock, Goodwill, the straight Way', async ({ page }) => {
  test.setTimeout(300_000);
  const problems = watchConsole(page);
  await open(page);

  const buildMs = await page.evaluate(() => (window as unknown as Ch04Window).__pilgrim.play!.world.buildMs);
  console.log(`ch04 built in ${buildMs.toFixed(0)} ms`);
  expect(buildMs).toBeLessThan(2000);
  expect((await state(page)).objective).toBe('ui.hud.objective.reachGate');
  await page.screenshot({ path: `${SHOTS}/ch04-start.png` });

  // Reach rock 3 (its lee trigger), then stand in the open halfway to rock 4 and wait for a volley.
  const lee3 = await triggerAt(page, 'lee_3');
  const lee4 = await triggerAt(page, 'lee_4');
  await teleport(page, lee3[0], lee3[2]);
  await waitSim(page, 0.6);
  const open4 = { x: (lee3[0] + lee4[0]) / 2, z: (lee3[2] + lee4[2]) / 2 - 1.0 };
  await page.evaluate(() => (window as unknown as Ch04Window).__pilgrim.play!.state.setHope(80));
  await teleport(page, open4.x, open4.z);
  expect((await state(page)).inField).toBe(true);
  await expect.poll(() => sfxCount(page, 'arrow_whistle'), { timeout: 20_000 }).toBeGreaterThan(0);
  await page.screenshot({ path: `${SHOTS}/ch04-warning.png` });
  await expect
    .poll(() => logged(page, 'player:bonk'), { timeout: 60_000 })
    .toContainEqual({ reason: 'arrow' });
  await waitSim(page, 0.5);
  await page.screenshot({ path: `${SHOTS}/ch04-bonk.png` });
  await waitSim(page, 1.2);
  const afterHit = await state(page);
  console.log(`hit at (${open4.x.toFixed(1)}, ${open4.z.toFixed(1)}) → back at (${afterHit.x.toFixed(1)}, ${afterHit.z.toFixed(1)})`);
  expect(afterHit.hope).toBe(75);
  expect(afterHit.mode).toBe('play');
  expect(Math.hypot(afterHit.x - lee3[0], afterHit.z - lee3[2])).toBeLessThan(1.5); // behind the last rock
  expect(await logged(page, 'hud:toast')).toContainEqual({ key: 'ui.toast.bonk' });
  const thunks = await sfxCount(page, 'arrow_thunk');
  const whistles = await sfxCount(page, 'arrow_whistle');
  console.log(`${whistles} volleys, ${thunks} arrows landed`);
  expect(thunks).toBeGreaterThanOrEqual(4); // Easy: 4 arrows per volley
  const tension = (await logged(page, 'music:play')) as Array<{ id: string; state?: string }>;
  expect(tension).toContainEqual(expect.objectContaining({ id: 'tension' }));

  // Near the wall: the objective changes; stand at the door and knock.
  const near = await triggerAt(page, 'gate_near');
  await teleport(page, near[0], near[2]);
  await expect.poll(async () => (await state(page)).objective).toBe('ui.hud.objective.knockGate');
  const gate = await page.evaluate(() => {
    const lm = (window as unknown as Ch04Window).__pilgrim.play!.world.level.landmarks.find(
      (l) => l.id === 'wicket_gate',
    )!;
    return { x: lm.at![0], z: lm.at![2], rotY: lm.rotY ?? 0 };
  });
  const fx = Math.sin(gate.rotY);
  const fz = Math.cos(gate.rotY);
  await teleport(page, gate.x + fx * 2.2, gate.z + fz * 2.2, Math.atan2(-fx, -fz));
  await page.keyboard.down('KeyW');
  await expect
    .poll(
      () => page.evaluate(() => (window as unknown as Ch04Window).__pilgrim.play!.interactables.focused?.id ?? null),
      { timeout: 8000 },
    )
    .toBe('knock');
  await page.keyboard.up('KeyW');
  await page.screenshot({ path: `${SHOTS}/ch04-knock.png` });
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(2600);
  await page.screenshot({ path: `${SHOTS}/ch04-pulled.png` });
  await expect
    .poll(() => logged(page, 'cutscene:end'), { timeout: 20_000 })
    .toContainEqual(expect.objectContaining({ id: 'ch04_pulled_inside' }));
  expect(await sfxCount(page, 'knock')).toBeGreaterThanOrEqual(3);
  expect(await sfxCount(page, 'arrow_thunk')).toBeGreaterThanOrEqual(thunks + 5); // the volley behind him

  // Goodwill's talk, answered with the sack joke (key 3): Hope +10.
  await page.waitForFunction(() => {
    const r = (window as unknown as Ch04Window).__pilgrim.services.tryGet('dialogue') as
      { active: boolean; line: unknown } | undefined;
    return r?.active === true && r.line !== null;
  });
  const hopeBefore = (await state(page)).hope;
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/ch04-goodwill.png` });
  await spaceUntil(page, (r) => r.phase === 'choosing');
  await page.waitForTimeout(600);
  await page.keyboard.press('Digit3');
  await spaceUntil(page, (r) => !r.active);
  await waitSim(page, 0.5);
  const inside = await state(page);
  expect(inside.hope).toBe(hopeBefore + 10);
  expect(inside.inside).toBe(true);
  expect(inside.inField).toBe(false);
  expect(inside.objective).toBe('ui.hud.objective.followStraightWay');
  expect(inside.mode).toBe('play');
  expect((inside.x - gate.x) * -fx + (inside.z - gate.z) * -fz).toBeGreaterThan(1); // through the gate
  expect(await page.evaluate(() => (window as unknown as Ch04Window).__pilgrim.play!.state.flag('met.goodwill'))).toBe(true);
  const music = (await logged(page, 'music:play')) as Array<{ id: string; state?: string }>;
  expect(music.at(-1)).toEqual(expect.objectContaining({ id: 'pilgrim', state: 'calm' }));
  expect(await logged(page, 'ambience:set')).toContainEqual(expect.objectContaining({ id: 'birdsong' }));
  await page.screenshot({ path: `${SHOTS}/ch04-garden.png` });

  // No arrows inside the wall; the end trigger completes the chapter.
  const whistlesInside = await sfxCount(page, 'arrow_whistle');
  await waitSim(page, 6);
  expect(await sfxCount(page, 'arrow_whistle')).toBe(whistlesInside);
  const end = await triggerAt(page, 'ch04_end');
  await teleport(page, end[0] - 4, end[2], Math.PI / 2);
  await page.keyboard.down('KeyW');
  await expect.poll(() => logged(page, 'chapter:complete'), { timeout: 15_000 }).toContainEqual({ chapter: 4 });
  await page.keyboard.up('KeyW');
  expect(problems, problems.join('\n')).toEqual([]);
});
