import { expect, test, type Page } from '@playwright/test';
import { frames, waitForMode, watchConsole } from './support';
import { waitSim } from './play-support';

/**
 * Engagement (badges, curiosity nudges, the journey line) and the Easy lantern floor:
 * - the journey line shows the real chapter count and this land's Promises found;
 * - "Something glows nearby..." once when Christian passes close to a hidden Promise; reading a waystone tells how
 *   many of this land's Promises are found;
 * - a badge unlock shows a toast, adds journey points and appears earned in MY SATCHEL > THE ROLL;
 * - Chapter X's detectors: racing past Faithful ("Oops-a-daisy!"), no to every stall looked at, an uncaught sneak;
 * - on Easy a drain zone never takes Hope below 10; on Normal it does.
 */

interface Win {
  __log: Array<{ name: string; payload: unknown }>;
  __pilgrim: {
    events: { on(n: string, f: (p: unknown) => void): () => void; emit(n: string, p?: unknown): void };
    services: { tryGet(k: string): unknown; get(k: string): unknown };
    play: {
      teleport(x: number, z: number, facing?: number): void;
      state: {
        hope: number;
        setHope(n: number): void;
        setFlag(k: string, v: unknown): void;
        unlock(id: string): void;
        data: { achievements: string[] };
        flag(k: string): unknown;
      };
      world: { level: { triggers: Array<{ id: string; at: number[] }>; promises: Array<{ id: string; at: number[] }> } };
    } | null;
  };
}

async function open(page: Page, chapter: string): Promise<void> {
  await page.goto(`/?chapter=${chapter}&skipIntro=1`);
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

test('journey line, Promise nudges and badges with their toast, points and Satchel page', async ({ page }) => {
  test.setTimeout(90_000);
  const problems = watchConsole(page);
  await open(page, '9');
  await expect(page.locator('.journey-stats')).toContainText('9 / 13');
  await expect(page.locator('.journey-stats')).toContainText('0 of 2');

  // Walk past a hidden Promise without taking it: one "Something glows nearby...".
  await page.evaluate(() => {
    const play = (window as unknown as Win).__pilgrim.play!;
    const p = play.world.level.promises[0]!;
    play.teleport(p.at[0]! + 6, p.at[2]!);
  });
  await waitSim(page, 0.6);
  await expect.poll(() => toasts(page)).toContain('ui.toast.promiseNear');
  await waitSim(page, 0.6);
  expect((await toasts(page)).filter((k) => k === 'ui.toast.promiseNear')).toHaveLength(1);

  // A waystone read reports this land's Promises.
  await page.evaluate(() => {
    const w = (window as unknown as Win).__pilgrim;
    (w.services.get('waystones') as { read(id: string): void }).read('ch09_w1');
  });
  await expect.poll(() => toasts(page)).toContain('ui.toast.promisesHere');

  // A badge: toast, journey points, the Satchel page.
  const score = (): Promise<unknown> => page.evaluate(() => (window as unknown as Win).__pilgrim.play!.state.flag('journey.score'));
  const before = Number((await score()) ?? 0);
  await page.evaluate(() => (window as unknown as Win).__pilgrim.play!.state.unlock('brightLantern'));
  await expect.poll(() => toasts(page)).toContain('ui.toast.badge');
  await expect.poll(async () => Number(await score())).toBeGreaterThanOrEqual(before + 75);
  await page.keyboard.press('Tab');
  await expect(page.locator('.pg-satchel__awards')).toContainText('1 of 12');
  await expect(page.locator('[data-key="badge:brightLantern"]')).not.toHaveClass(/is-locked/);
  await expect(page.locator('[data-key="badge:unshaken"]')).toHaveClass(/is-locked/);
  expect(problems, problems.join('\n')).toEqual([]);
});

test('Chapter X badges: no to every stall, and an uncaught sneak', async ({ page }) => {
  test.setTimeout(60_000);
  const problems = watchConsole(page);
  await open(page, '10');
  await page.evaluate(() => {
    const w = (window as unknown as Win).__pilgrim;
    const s = w.play!.state;
    s.setFlag('ch10.no.games', true);
    s.setFlag('ch10.no.hats', true);
    s.setFlag('ch10.escaped', true); // never caught in this chapter
    w.events.emit('chapter:complete', { chapter: 10 });
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          ((window as unknown as Win).__pilgrim.services.get('state') as { data: { achievements: string[] } }).data
            .achievements,
      ),
    )
    .toEqual(expect.arrayContaining(['noThankYou', 'unseen']));
  expect(problems, problems.join('\n')).toEqual([]);
});

for (const difficulty of ['easy', 'normal'] as const) {
  test(`the lantern floor on ${difficulty}: a drain zone ${difficulty === 'easy' ? 'stops at 10' : 'goes on to 0'}`, async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const problems = watchConsole(page);
    await page.addInitScript((d) => {
      try {
        const raw = localStorage.getItem('pilgrim.settings.v1');
        const s = raw ? JSON.parse(raw) : {};
        localStorage.setItem('pilgrim.settings.v1', JSON.stringify({ ...s, difficulty: d }));
      } catch {
        /* storage blocked */
      }
    }, difficulty);
    await open(page, '9');
    await page.evaluate(() => {
      const play = (window as unknown as Win).__pilgrim.play!;
      const t = play.world.level.triggers.find((x) => x.id === 'ember_pit_near')!;
      play.teleport(t.at[0]! - 2, t.at[2]!);
      play.state.setHope(14);
    });
    await waitSim(page, 6);
    const hope = await page.evaluate(() => (window as unknown as Win).__pilgrim.play!.state.hope);
    if (difficulty === 'easy') expect(hope).toBeGreaterThanOrEqual(10);
    else expect(hope).toBeLessThan(10);
    expect(problems.filter((p) => !p.includes('I SHALL ARISE')), problems.join('\n')).toEqual([]);
  });
}
