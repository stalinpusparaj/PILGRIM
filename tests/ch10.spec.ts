import { expect, test, type Page } from '@playwright/test';
import { frames, waitForMode, watchConsole } from './support';
import { waitSim } from './play-support';

/**
 * Chapter X beats (GDD 2.10), each played on `/?chapter=10&skipIntro=1`: the pride trip (running past Faithful),
 * Talkative's piled-up bubbles and the telling question, the fair's stalls ("Yes please" puts a slowing sack on
 * his back, "No thank you" does not), and the arrest → cage → trial (jury name cards) → chariot of light → night
 * sneak (a lantern catches him: back to the start) → Hopeful at the gate and the day back.
 * Screenshots: test-results/ch10/.
 */

const SHOTS = 'test-results/ch10';

interface Win {
  __log: Array<{ name: string; payload: unknown }>;
  __pilgrim: {
    events: { on(name: string, fn: (p: unknown) => void): () => void };
    services: { tryGet(key: string): unknown; get(key: string): unknown };
    play: {
      teleport(x: number, z: number, facing?: number): void;
      player: { speedScale: number; controller: { position: { x: number; z: number } } };
      state: { flag(k: string): unknown };
      world: {
        level: { triggers: Array<{ id: string; at: number[] }>; zones: Array<{ id: string; x?: number; z?: number }> };
        sun: { intensity: number };
      };
    } | null;
  };
}
interface Runner {
  active: boolean;
  phase: string;
  choose(i: number): void;
  skipScene(): void;
}

async function open(page: Page): Promise<void> {
  await page.goto('/?chapter=10&skipIntro=1');
  await waitForMode(page);
  await page.waitForFunction(() => (window as unknown as Win).__pilgrim.play != null, null, { timeout: 30_000 });
  await page.evaluate(() => {
    const w = window as unknown as Win;
    w.__log = [];
    for (const name of ['dialogue:start', 'hud:toast', 'trigger:enter', 'chapter:complete'])
      w.__pilgrim.events.on(name, (payload) => w.__log.push({ name, payload }));
  });
  await page.addStyleTag({ content: '.pg-click-to-play { display: none !important; }' });
  await frames(page, 20);
}

const logged = (page: Page, name: string): Promise<unknown[]> =>
  page.evaluate((n) => (window as unknown as Win).__log.filter((e) => e.name === n).map((e) => e.payload), name);
const flag = (page: Page, k: string): Promise<unknown> =>
  page.evaluate((key) => (window as unknown as Win).__pilgrim.play!.state.flag(key), k);

/** Answers every question with `pick(i)` (default the first) and skips lines until no talk runs for a moment. */
async function settle(page: Page, pick = 0): Promise<void> {
  let quiet = 0;
  for (let i = 0; i < 300 && quiet < 4; i++) {
    const busy = await page.evaluate((p) => {
      const r = (window as unknown as Win).__pilgrim.services.tryGet('dialogue') as Runner | undefined;
      if (!r?.active) return false;
      if (r.phase === 'choosing') r.choose(p);
      else r.skipScene();
      return true;
    }, pick);
    quiet = busy ? 0 : quiet + 1;
    await page.waitForTimeout(120);
  }
}

async function toTrigger(page: Page, id: string, dx = 0): Promise<void> {
  await page.evaluate(
    ({ id, dx }) => {
      const play = (window as unknown as Win).__pilgrim.play!;
      const t = play.world.level.triggers.find((x) => x.id === id)!;
      play.teleport(t.at[0]! + dx, t.at[2]!, Math.PI / 2);
    },
    { id, dx },
  );
  await waitSim(page, 0.4);
}

async function use(page: Page, id: string): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate((key) => {
        const i = (window as unknown as Win).__pilgrim.services.get('interactables') as { get(k: string): unknown };
        return i.get(key) != null;
      }, id),
    )
    .toBe(true);
  await page.evaluate((key) => {
    const i = (window as unknown as Win).__pilgrim.services.get('interactables') as {
      get(k: string): { onUse(): void };
    };
    i.get(key).onUse();
  }, id);
}

test('pride trip: running past Faithful trips Christian, Faithful helps him up and follows', async ({ page }) => {
  test.setTimeout(90_000);
  const problems = watchConsole(page);
  await open(page);
  await toTrigger(page, 'faithful_seen', 3);
  await expect.poll(() => logged(page, 'hud:toast')).toContainEqual({ key: 'ch10.toast.faithfulAhead' });
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');
  await expect
    .poll(async () => (await logged(page, 'dialogue:start')).map((d) => (d as { id: string }).id), { timeout: 20_000 })
    .toContain('ch10_pride');
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ShiftLeft');
  await page.screenshot({ path: `${SHOTS}/pride-trip.png` });
  await settle(page);
  await expect.poll(() => flag(page, 'ch10.faithfulJoined')).toBe(true);
  const companions = await page.evaluate(
    () => ((window as unknown as Win).__pilgrim.services.get('chapters') as { probe(): { companions: string[] } }).probe().companions,
  );
  expect(companions).toContain('faithful');
  expect(problems, problems.join('\n')).toEqual([]);
});

test('Talkative: his bubbles pile up; only the telling question sends him off', async ({ page }) => {
  test.setTimeout(90_000);
  const problems = watchConsole(page);
  await open(page);
  await toTrigger(page, 'talkative_meets');
  await expect.poll(() => page.locator('.dlg-bubble__box').count(), { timeout: 10_000 }).toBeGreaterThanOrEqual(3);
  await page.screenshot({ path: `${SHOTS}/talkative-pile.png` });
  // First answer each time: the two easy questions (each offered once), then the telling one.
  await expect
    .poll(
      async () => {
        await settle(page);
        return flag(page, 'ch10.talkativeDone');
      },
      { timeout: 40_000 },
    )
    .toBe(true);
  expect(await flag(page, 'ch10.askedTalk')).toBe(true);
  expect(await flag(page, 'ch10.askedHeaven')).toBe(true);
  await expect.poll(() => logged(page, 'hud:toast')).toContainEqual({ key: 'ch10.toast.talkativeLeaves' });
  expect(problems, problems.join('\n')).toEqual([]);
});

test('fair stalls: "Yes please" adds a sack that slows him, "No thank you" does not', async ({ page }) => {
  test.setTimeout(90_000);
  const problems = watchConsole(page);
  await open(page);
  await toTrigger(page, 'fair_enter', 4);
  const scale = (): Promise<number> => page.evaluate(() => (window as unknown as Win).__pilgrim.play!.player.speedScale);
  expect(await scale()).toBe(1);
  await use(page, 'stall_games');
  await settle(page, 0); // Yes please
  await expect.poll(scale).toBeCloseTo(0.9, 5);
  await expect.poll(() => logged(page, 'hud:toast')).toContainEqual({ key: 'ch10.toast.bag' });
  await use(page, 'stall_sweets');
  await settle(page, 1); // No thank you
  expect(await flag(page, 'ch10.no.sweets')).toBe(true);
  await waitSim(page, 0.3);
  expect(await scale()).toBeCloseTo(0.9, 5);
  await page.screenshot({ path: `${SHOTS}/fair-sack.png` });
  expect(problems, problems.join('\n')).toEqual([]);
});

test('arrest, trial and jury, chariot of light, night sneak past the lanterns, Hopeful at the gate', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const problems = watchConsole(page);
  await open(page);
  const sun = (): Promise<number> => page.evaluate(() => (window as unknown as Win).__pilgrim.play!.world.sun.intensity);
  const day = await sun();
  await toTrigger(page, 'buy_truth');
  await expect.poll(async () => (await logged(page, 'dialogue:start')).length, { timeout: 10_000 }).toBeGreaterThan(0);
  // Through the cage and the witnesses until the jury's name cards pop up.
  await expect
    .poll(
      async () => {
        await settle(page);
        return page.locator('.ch10-jury__card').filter({ hasText: /\S/ }).count();
      },
      { timeout: 60_000 },
    )
    .toBeGreaterThan(0);
  await page.screenshot({ path: `${SHOTS}/jury-card.png` });
  await expect
    .poll(
      async () => {
        await settle(page);
        return flag(page, 'ch10.faithfulGone');
      },
      { timeout: 90_000 },
    )
    .toBe(true);
  expect(await sun()).toBeLessThan(day * 0.5);
  await page.screenshot({ path: `${SHOTS}/night-sneak.png` });

  // Into a lantern's light: caught, back to the start of the section.
  const caught = (): Promise<number> =>
    page.evaluate(
      () =>
        (window as unknown as Win).__log.filter((e) => e.name === 'hud:toast' && (e.payload as { key: string }).key.startsWith('ch10.toast.caught'))
          .length,
    );
  await page.evaluate(() => {
    const w = window as unknown as Win;
    const n = (w.__pilgrim.services.get('chapters') as { context: { npc(id: string): { position: { x: number; z: number } } | null } })
      .context.npc('watchman_1')!;
    w.__pilgrim.play!.teleport(n.position.x + 0.5, n.position.z);
  });
  await expect.poll(caught, { timeout: 5000 }).toBeGreaterThan(0);
  const start = await page.evaluate(() => {
    const w = window as unknown as Win;
    const z = w.__pilgrim.play!.world.level.zones.find((x) => x.id === 'sneak_start')!;
    const p = w.__pilgrim.play!.player.controller.position;
    return Math.hypot(p.x - z.x!, p.z - z.z!);
  });
  expect(start).toBeLessThan(1.5);

  await toTrigger(page, 'hopeful_joins');
  await expect
    .poll(
      async () => {
        await settle(page);
        return flag(page, 'ch10.escaped');
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  await waitSim(page, 4.5);
  expect(await sun()).toBeGreaterThan(day * 0.9);
  await toTrigger(page, 'ch10_end');
  await expect.poll(() => logged(page, 'chapter:complete'), { timeout: 15_000 }).toContainEqual({ chapter: 10 });
  expect(problems, problems.join('\n')).toEqual([]);
});
