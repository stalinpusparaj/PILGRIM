import { expect, test } from '@playwright/test';
import { frames, waitForMode, watchConsole } from './support';
import { waitSim } from './play-support';

/**
 * Chapter XI beats 6-7 (GDD 2.10): past the stile the storm comes (darker sky, rain, the guide points to the big
 * tree); sheltering there the pilgrims fall asleep, and they wake at Giant Despair's dungeon door, where the
 * dungeon's story starts. Screenshots: test-results/ch11/.
 */

interface Win {
  __log: Array<{ name: string; payload: unknown }>;
  __pilgrim: {
    events: { on(n: string, f: (p: unknown) => void): () => void };
    services: { tryGet(k: string): unknown };
    play: {
      teleport(x: number, z: number, facing?: number): void;
      player: { controller: { position: { x: number; z: number } } };
      state: { flag(k: string): unknown; objective: string | null };
      world: { level: { triggers: Array<{ id: string; at: number[] }> } };
    } | null;
  };
}

test('the storm, the shelter, a sleep and Giant Despair\'s dungeon', async ({ page }) => {
  test.setTimeout(90_000);
  const problems = watchConsole(page);
  await page.goto('/?chapter=11&skipIntro=1');
  await waitForMode(page);
  await page.waitForFunction(() => (window as unknown as Win).__pilgrim.play != null, null, { timeout: 30_000 });
  await page.evaluate(() => {
    const w = window as unknown as Win;
    w.__log = [];
    for (const name of ['hud:toast', 'trigger:enter', 'dialogue:start'])
      w.__pilgrim.events.on(name, (payload) => w.__log.push({ name, payload }));
  });
  await page.addStyleTag({ content: '.pg-click-to-play { display: none !important; }' });
  await frames(page, 20);
  const goTo = (id: string, dz = 0): Promise<void> =>
    page.evaluate(
      ([tid, off]) => {
        const play = (window as unknown as Win).__pilgrim.play!;
        const t = play.world.level.triggers.find((x) => x.id === tid)!;
        play.teleport(t.at[0]!, t.at[2]! + (off as number), Math.PI);
      },
      [id, dz] as const,
    );
  await goTo('storm_trigger');
  await waitSim(page, 3.5);
  expect(await page.evaluate(() => (window as unknown as Win).__pilgrim.play!.state.objective)).toBe(
    'ch11.objective.shelter',
  );
  const guide = await page.evaluate(() => {
    const g = (window as unknown as Win).__pilgrim.services.tryGet('guide') as { custom: boolean };
    return g.custom;
  });
  expect(guide).toBe(true);
  await page.screenshot({ path: 'test-results/ch11/storm.png' });

  await goTo('shelter_reach');
  await waitSim(page, 2);
  await page.screenshot({ path: 'test-results/ch11/asleep.png' });
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Win).__pilgrim.play!.state.flag('ch11.carried')), {
      timeout: 20_000,
    })
    .toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as Win).__log.some(
          (e) => e.name === 'dialogue:start' && (e.payload as { id: string }).id === 'ch11_giant_stomp',
        ),
      ),
    )
    .toBe(true);
  const keys = await page.evaluate(() =>
    (window as unknown as Win).__log.filter((e) => e.name === 'hud:toast').map((e) => (e.payload as { key: string }).key),
  );
  expect(keys).toEqual(expect.arrayContaining(['ch11.toast.storm', 'ch11.toast.asleep', 'ch11.toast.carried']));
  await expect(page.locator('.pg-fade')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/ch11/dungeon.png' });
  expect(problems, problems.join('\n')).toEqual([]);
});
