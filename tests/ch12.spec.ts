import { expect, test, type Page } from '@playwright/test';
import { frames, waitForMode, watchConsole } from './support';
import { waitSim } from './play-support';

/**
 * Chapter XII's activities (GDD 2.10): the five runaway lambs follow Christian into the fold ("Good Shepherd"
 * badge and its medal card); the looking glass wobbles until Pray is held, then shows the Celestial Gate ("Far
 * Sight") and comes down by itself; on the Enchanted Ground the sleepy meter fills, nudges toward Hopeful and,
 * full, puts Christian to sleep back at the waystone. Screenshots: test-results/ch12/.
 */

interface Win {
  __log: Array<{ name: string; payload: unknown }>;
  __pilgrim: {
    events: { on(n: string, f: (p: unknown) => void): () => void };
    services: { tryGet(k: string): unknown; get(k: string): unknown };
    engine: { loop: { timeScale: number }; camera: { fov: number } };
    play: {
      teleport(x: number, z: number, facing?: number): void;
      player: { mode: string };
      state: { flag(k: string): unknown; data: { achievements: string[] } };
      world: {
        level: { zones: Array<{ id: string; x?: number; z?: number }>; triggers: Array<{ id: string; at: number[] }> };
        ways: { main: { sample(t: number): { x: number; z: number } } };
      };
    } | null;
  };
}

const SHOTS = 'test-results/ch12';

async function open(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      const raw = localStorage.getItem('pilgrim.settings.v1');
      const s = raw ? JSON.parse(raw) : {};
      localStorage.setItem('pilgrim.settings.v1', JSON.stringify({ ...s, difficulty: 'normal' }));
    } catch {
      /* storage blocked */
    }
  });
  await page.goto('/?chapter=12&skipIntro=1');
  await waitForMode(page);
  await page.waitForFunction(() => (window as unknown as Win).__pilgrim.play != null, null, { timeout: 30_000 });
  await page.evaluate(() => {
    const w = window as unknown as Win;
    w.__log = [];
    for (const name of ['hud:toast', 'achievement:unlocked'])
      w.__pilgrim.events.on(name, (payload) => w.__log.push({ name, payload }));
  });
  await page.addStyleTag({ content: '.pg-click-to-play { display: none !important; }' });
  await frames(page, 20);
}

const toasts = (page: Page): Promise<string[]> =>
  page.evaluate(() =>
    (window as unknown as Win).__log.filter((e) => e.name === 'hud:toast').map((e) => (e.payload as { key: string }).key),
  );
const badges = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as unknown as Win).__pilgrim.play!.state.data.achievements);
const goToZone = (page: Page, id: string, dz = 0): Promise<void> =>
  page.evaluate(
    ([zid, off]) => {
      const play = (window as unknown as Win).__pilgrim.play!;
      const z = play.world.level.zones.find((x) => x.id === zid)!;
      play.teleport(z.x!, z.z! + (off as number));
    },
    [id, dz] as const,
  );

test('five lambs follow Christian into the fold: Good Shepherd', async ({ page }) => {
  test.setTimeout(120_000);
  const problems = watchConsole(page);
  await open(page);
  for (const id of ['lamb_5', 'lamb_1', 'lamb_2', 'lamb_3', 'lamb_4']) {
    await goToZone(page, id);
    await waitSim(page, 0.6);
  }
  await expect.poll(() => toasts(page)).toContain('ch12.toast.lambFound');
  expect((await toasts(page)).filter((k) => k === 'ch12.toast.lambFound')).toHaveLength(5);
  await waitSim(page, 3);
  await page.screenshot({ path: `${SHOTS}/lambs-following.png` });
  // Walk them home: stand in the fold's opening until the line catches up.
  await goToZone(page, 'sheep_fold', 1);
  await expect.poll(() => badges(page), { timeout: 60_000 }).toContain('goodShepherd');
  expect(await toasts(page)).toContain('ch12.toast.flockHome');
  await expect(page.locator('.pg-badge-card')).toContainText('Good Shepherd');
  await page.evaluate(() => {
    const play = (window as unknown as Win).__pilgrim.play!;
    const z = play.world.level.zones.find((x) => x.id === 'sheep_fold')!;
    play.teleport(z.x!, z.z! + 6, Math.PI); // face the fold
  });
  await waitSim(page, 2);
  await page.screenshot({ path: `${SHOTS}/flock-home.png` });
  expect(await page.evaluate(() => (window as unknown as Win).__pilgrim.play!.state.flag('ch12.lambsHome'))).toBe(5);
  expect(problems, problems.join('\n')).toEqual([]);
});

test('the looking glass wobbles until Pray is held, then shows the Celestial Gate', async ({ page }) => {
  test.setTimeout(90_000);
  const problems = watchConsole(page);
  await open(page);
  const fov = await page.evaluate(() => (window as unknown as Win).__pilgrim.engine.camera.fov);
  await page.evaluate(() => {
    const play = (window as unknown as Win).__pilgrim.play!;
    const t = play.world.level.triggers.find((x) => x.id === 'viewpoint_reach')!;
    play.teleport(t.at[0]!, t.at[2]! + 2);
  });
  await waitSim(page, 0.5);
  await page.evaluate(() =>
    ((window as unknown as Win).__pilgrim.services.get('interactables') as { get(i: string): { onUse(): void } })
      .get('looking_glass_use')
      .onUse(),
  );
  await expect(page.locator('.pg-glass')).toBeVisible();
  await waitSim(page, 1);
  expect(await page.evaluate(() => (window as unknown as Win).__pilgrim.engine.camera.fov)).toBeLessThan(15);
  await page.screenshot({ path: `${SHOTS}/glass-wobble.png` });
  await page.keyboard.down('KeyQ');
  await expect(page.locator('.pg-glass.is-seen')).toBeVisible({ timeout: 15_000 });
  await waitSim(page, 0.8);
  await page.screenshot({ path: `${SHOTS}/glass-gate.png` });
  await page.keyboard.up('KeyQ');
  await expect(page.locator('.pg-glass')).toHaveCount(0, { timeout: 15_000 });
  expect(await badges(page)).toContain('farSight');
  await waitSim(page, 1);
  expect(await page.evaluate(() => (window as unknown as Win).__pilgrim.play!.player.mode)).toBe('play');
  expect(await page.evaluate(() => (window as unknown as Win).__pilgrim.engine.camera.fov)).toBeGreaterThan(fov - 6);
  expect(problems, problems.join('\n')).toEqual([]);
});

test('the Enchanted Ground: the sleepy meter fills, nudges toward Hopeful, and full puts him to sleep', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const problems = watchConsole(page);
  await open(page);
  await page.evaluate(() => {
    const w = (window as unknown as Win).__pilgrim;
    const p = w.play!.world.ways.main.sample(0.8);
    w.play!.teleport(p.x, p.z);
    w.engine.loop.timeScale = 4;
  });
  await expect(page.locator('.pg-sleepy.is-on')).toBeVisible();
  await expect.poll(() => toasts(page), { timeout: 30_000 }).toContain('ch12.toast.tooSleepy');
  await page.screenshot({ path: `${SHOTS}/sleepy-meter.png` });
  await expect.poll(() => toasts(page), { timeout: 30_000 }).toContain('ch12.toast.fellAsleep');
  await page.evaluate(() => ((window as unknown as Win).__pilgrim.engine.loop.timeScale = 1));
  await expect.poll(() => page.locator('.pg-sleepy').getAttribute('aria-valuenow')).toBe('0');
  expect(problems, problems.join('\n')).toEqual([]);
});
