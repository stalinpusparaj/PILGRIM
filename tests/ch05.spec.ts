import { expect, test, type Page } from '@playwright/test';
import { frames, waitForMode, watchConsole } from './support';
import { waitSim } from './play-support';

/**
 * Chapter V's six toy-puzzles (GDD 2.10 Ch V table): three lamps light the portrait; sweeping raises dust and only
 * the jug settles it; sitting beside Patience gives Hope and the "Patient Heart" badge; the oil-pourer behind the
 * wall; the name given to the scribe is kept and written on the Roll; the iron cage will not open. Every room ends
 * in its lesson and the chapter completes. Screenshots: test-results/ch05/.
 */

interface Win {
  __log: Array<{ name: string; payload: unknown }>;
  __pilgrim: {
    events: { on(n: string, f: (p: unknown) => void): () => void };
    services: { tryGet(k: string): unknown; get(k: string): unknown };
    play: {
      teleport(x: number, z: number, facing?: number): void;
      state: { hope: number; playerName: string; data: { achievements: string[] }; flag(k: string): unknown };
      world: { level: { triggers: Array<{ id: string; at: number[] }> } };
    } | null;
  };
}
interface Runner {
  active: boolean;
  phase: string;
  choose(i: number): void;
  skipScene(): void;
}

const SHOTS = 'test-results/ch05';

async function settle(page: Page, choice = 0): Promise<void> {
  let quiet = 0;
  for (let i = 0; i < 300 && quiet < 4; i++) {
    const busy = await page.evaluate((c) => {
      const r = (window as unknown as Win).__pilgrim.services.tryGet('dialogue') as Runner | undefined;
      if (!r?.active) return false;
      if (r.phase === 'choosing') r.choose(c);
      else r.skipScene();
      return true;
    }, choice);
    quiet = busy ? 0 : quiet + 1;
    await page.waitForTimeout(120);
  }
}

async function enter(page: Page, trigger: string, choice = 0): Promise<void> {
  await page.evaluate((id) => {
    const play = (window as unknown as Win).__pilgrim.play!;
    const t = play.world.level.triggers.find((x) => x.id === id)!;
    play.teleport(t.at[0]!, t.at[2]!, Math.PI / 2);
  }, trigger);
  await waitSim(page, 0.5);
  await settle(page, choice);
}

async function use(page: Page, id: string): Promise<void> {
  const has = (): Promise<boolean> =>
    page.evaluate(
      (k) => ((window as unknown as Win).__pilgrim.services.get('interactables') as { get(i: string): unknown }).get(k) != null,
      id,
    );
  await expect.poll(has, { message: `interactable ${id}` }).toBe(true);
  await page.evaluate(
    (k) =>
      ((window as unknown as Win).__pilgrim.services.get('interactables') as { get(i: string): { onUse(): void } })
        .get(k)
        .onUse(),
    id,
  );
  await waitSim(page, 0.3);
}

const toasts = (page: Page): Promise<string[]> =>
  page.evaluate(() =>
    (window as unknown as Win).__log.filter((e) => e.name === 'hud:toast').map((e) => (e.payload as { key: string }).key),
  );
const doneRooms = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const s = (window as unknown as Win).__pilgrim.play!.state;
    return [1, 2, 3, 4, 5, 6].filter((n) => s.flag(`ch05.room${n}Done`) === true).length;
  });

test('the Interpreter\'s six rooms are puzzles, each ending in its lesson', async ({ page }) => {
  test.setTimeout(150_000);
  const problems = watchConsole(page);
  await page.goto('/?chapter=5&skipIntro=1');
  await waitForMode(page);
  await page.waitForFunction(() => (window as unknown as Win).__pilgrim.play != null, null, { timeout: 30_000 });
  await page.evaluate(() => {
    const w = window as unknown as Win;
    w.__log = [];
    for (const name of ['hud:toast', 'chapter:complete', 'achievement:unlocked'])
      w.__pilgrim.events.on(name, (payload) => w.__log.push({ name, payload }));
  });
  await page.addStyleTag({ content: '.pg-click-to-play { display: none !important; }' });
  await frames(page, 20);
  await enter(page, 'house_arrive');

  // 1. Three lamps: the lesson waits until all are lit.
  await enter(page, 'room1_look');
  await use(page, 'room1_lamp_0');
  await use(page, 'room1_lamp_1');
  expect(await doneRooms(page)).toBe(0);
  await use(page, 'room1_lamp_2');
  await settle(page);
  expect(await toasts(page)).toContain('ch05.toast.lampLit');
  await expect.poll(() => doneRooms(page)).toBe(1);
  await page.screenshot({ path: `${SHOTS}/room1-lamps.png` });

  // 2. Sweep → dust; the jug appears only after sweeping and settles it.
  await enter(page, 'room2_look');
  const jugBefore = await page.evaluate(
    () => ((window as unknown as Win).__pilgrim.services.get('interactables') as { get(i: string): unknown }).get('room2_jug') != null,
  );
  expect(jugBefore).toBe(false);
  await use(page, 'room2_sweep');
  expect(await toasts(page)).toContain('ch05.toast.dustWorse');
  await waitSim(page, 1);
  await page.screenshot({ path: `${SHOTS}/room2-dust.png` });
  await use(page, 'room2_jug');
  await settle(page);
  await expect.poll(() => doneRooms(page)).toBe(2);

  // 3. Patience: Hope +5 and a badge.
  const hope = await page.evaluate(() => (window as unknown as Win).__pilgrim.play!.state.hope);
  await enter(page, 'room3_look', 1);
  await expect.poll(() => doneRooms(page)).toBe(3);
  expect(await page.evaluate(() => (window as unknown as Win).__pilgrim.play!.state.hope)).toBeGreaterThanOrEqual(
    Math.min(100, hope + 5),
  );
  expect(await page.evaluate(() => (window as unknown as Win).__pilgrim.play!.state.data.achievements)).toContain(
    'patientHeart',
  );

  // 4. Behind the wall.
  await enter(page, 'room4_look');
  await use(page, 'room4_oil');
  await settle(page);
  await expect.poll(() => doneRooms(page)).toBe(4);

  // 5. A name for the scribe, typed into the card, kept in the save.
  await enter(page, 'room5_look');
  await use(page, 'room5_name');
  await expect(page.locator('.pg-name__field')).toBeFocused();
  await page.screenshot({ path: `${SHOTS}/room5-name.png` });
  await page.keyboard.type('Asha  <b>');
  await page.keyboard.press('Enter');
  await expect(page.locator('.pg-name')).toHaveCount(0);
  await settle(page);
  expect(await page.evaluate(() => (window as unknown as Win).__pilgrim.play!.state.playerName)).toBe('Asha b');
  expect(await toasts(page)).toContain('ch05.toast.nameWritten');
  await expect.poll(() => doneRooms(page)).toBe(5);

  // 6. The cage will not open.
  await enter(page, 'room6_look');
  await use(page, 'room6_open');
  expect(await toasts(page)).toContain('ch05.toast.cageShut');
  await settle(page);
  await expect.poll(() => doneRooms(page)).toBe(6);

  await enter(page, 'ch05_end');
  await expect
    .poll(async () => {
      await settle(page);
      return page.evaluate(() => (window as unknown as Win).__log.some((e) => e.name === 'chapter:complete'));
    })
    .toBe(true);
  expect(problems, problems.join('\n')).toEqual([]);
});
