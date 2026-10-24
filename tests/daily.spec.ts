/**
 * Coming back each day (DECISIONS #403): the first day stays quiet; from the next day Morning Manna opens over the
 * title with three tips, the Pilgrim's Path and today's quest, and the sun button opens it again; a quest finishes
 * with a toast and a gold stone; a full path gives a lantern colour that the HUD lantern wears; without the full
 * journey the map opens 3 times a day, then rests (with an unlock), and the journey makes it unlimited.
 */
import { expect, test, type Page } from '@playwright/test';
import { waitForFlow } from './story-support';
import { watchConsole } from './support';

interface DailyWindow {
  __pilgrim: {
    daily: {
      data: {
        stones: number;
        gold: number[];
        first: string;
        lantern: string;
        quest: { id: string; n: number; done: boolean } | null;
      };
      newcomer: boolean;
      mapLeft: number;
      reset(next?: Record<string, unknown>): void;
    };
    events: { emit(name: string, payload?: unknown): void };
    services: { get(k: string): { setVisible(v: boolean): void } };
  };
}

function day(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** A player who first came 5 days ago and last played yesterday. */
async function returning(page: Page, extra: Record<string, unknown> = {}): Promise<void> {
  await page.addInitScript(
    ({ first, last, extra }) => {
      if (sessionStorage.getItem('daily-seeded')) return;
      sessionStorage.setItem('daily-seeded', '1');
      localStorage.setItem(
        'pilgrim.daily.v1',
        JSON.stringify({
          v: 1,
          first,
          last,
          days: 4,
          stones: 4,
          gold: [1],
          gifts: [],
          lantern: 'gold',
          newGift: '',
          quest: null,
          map: { day: '', n: 0 },
          cardDay: '',
          welcomeDay: '',
          ...extra,
        }),
      );
    },
    { first: day(-5), last: day(-1), extra },
  );
}

/** The Android shell's store bridge, ready and not bought (the map is limited). */
async function storeNotOwned(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state = {
      status: 'ready',
      owned: false,
      confirmed: true,
      kind: '',
      event: '',
      products: { monthly: { price: '₹99.00' } },
    };
    (window as unknown as Record<string, unknown>).PilgrimBilling = {
      billingState: () => JSON.stringify(state),
      buy: () => {},
      restore: () => {},
      manageSubscription: () => {},
    };
  });
}

test('the first day is quiet: one stone lit, no card, no sun button, no quest', async ({ page }) => {
  const problems = watchConsole(page);
  await page.goto('/');
  await waitForFlow(page, (p) => p.titleReady);
  const d = await page.evaluate(() => (window as unknown as DailyWindow).__pilgrim.daily);
  expect(d.newcomer).toBe(true);
  expect(d.data.stones).toBe(1);
  expect(d.data.quest).toBeNull();
  await expect(page.locator('.pg-daily')).toHaveCount(0);
  await expect(page.locator('.pg-daily-btn')).toHaveCount(0);
  expect(problems, problems.join('\n')).toEqual([]);
});

test("next day: Morning Manna with 3 tips, the path and a quest; LET'S GO closes; the sun opens it again", async ({
  page,
}) => {
  const problems = watchConsole(page);
  await returning(page);
  await page.goto('/');
  const card = page.locator('.pg-daily');
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card.locator('.pg-daily__tip')).toHaveCount(3);
  await expect(card.locator('.pg-daily__tip--verse .pg-daily__ref')).not.toBeEmpty();
  await expect(card.locator('.pg-daily__stone.is-lit')).toHaveCount(5);
  await expect(card.locator('.pg-daily__stone.is-gold')).toHaveCount(1);
  await expect(card.locator('.pg-daily__quest')).toBeVisible();
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'test-results/daily/morning-manna.png' });
  await card.locator('[data-key="ui.daily.go"]').click();
  await expect(card).toHaveCount(0);
  await page.reload(); // once a day: it does not open by itself again
  await waitForFlow(page, (p) => p.titleReady);
  await page.waitForTimeout(1000);
  await expect(card).toHaveCount(0);
  await page.locator('.pg-daily-btn').click();
  await expect(card).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  await expect(page.locator('[data-key="ui.title.start"]')).toBeVisible();
  expect(problems, problems.join('\n')).toEqual([]);
});

test("a quest finishes with a toast and today's gold stone; a full path gives a lantern the HUD wears", async ({
  page,
}) => {
  const problems = watchConsole(page);
  await returning(page, { stones: 6, cardDay: day(0) });
  await page.goto('/?chapter=test');
  await waitForFlow(page, (p) => p.state === 'playing', 90_000);
  const quest = await page.evaluate(() => (window as unknown as DailyWindow).__pilgrim.daily.data.quest);
  expect(quest).not.toBeNull();
  const need: Record<string, [string, number]> = {
    promise: ['promise:collected', 1],
    waystone: ['waystone:read', 1],
    talk: ['dialogue:end', 3],
    jump: ['player:jump', 10],
    read: ['promise:read', 1],
  };
  const [event, count] = need[quest!.id]!;
  await page.evaluate(
    ({ event, count }) => {
      const w = window as unknown as DailyWindow;
      for (let i = 0; i < count; i++) w.__pilgrim.events.emit(event, { id: 'x' });
    },
    { event, count },
  );
  const after = await page.evaluate(() => (window as unknown as DailyWindow).__pilgrim.daily.data);
  expect(after.quest?.done).toBe(true);
  expect(after.stones).toBe(7);
  expect(after.gold).toContain(6);
  await expect(page.locator('.hud-toast', { hasText: 'Quest done!' })).toBeVisible({ timeout: 10_000 });
  // The seventh stone gave the first lantern colour; choosing it turns the HUD flame.
  await page.evaluate(() =>
    (
      window as unknown as { __pilgrim: { daily: { setLantern(id: string): void } } }
    ).__pilgrim.daily.setLantern('rose'),
  );
  const hue = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--lantern-hue').trim(),
  );
  expect(hue).toBe('-55deg');
  expect(problems, problems.join('\n')).toEqual([]);
});

test.describe('the map on a phone', () => {
  test.use({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });

  test('without the full journey the map opens 3 times a day, then rests with an unlock', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const problems = watchConsole(page);
    await storeNotOwned(page);
    await page.goto('/?chapter=test');
    await waitForFlow(page, (p) => p.state === 'playing', 90_000);
    await page.addStyleTag({ content: '.pg-click-to-play { display: none !important; }' });
    const button = page.locator('.pg-map__btn');
    const map = page.locator('.pg-map');
    await expect(page.locator('.pg-map__left')).toHaveText('3');
    for (let i = 0; i < 3; i++) {
      await button.tap();
      await expect(map).toHaveClass(/is-open/);
      await expect(map).not.toHaveClass(/is-rest/);
      await page.locator('.pg-map__close').tap();
      await expect(map).not.toHaveClass(/is-open/);
    }
    await expect(page.locator('.pg-map__left')).toHaveText('0');
    await button.tap();
    await expect(map).toHaveClass(/is-rest/);
    await expect(page.locator('.hud-minimap__rest-text')).toContainText('resting until tomorrow');
    await page.screenshot({ path: 'test-results/daily/map-resting.png' });
    await page.locator('.pg-map__unlock').tap();
    await expect(page.locator('.pg-paywall')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.pg-paywall')).toHaveCount(0);
    expect(problems, problems.join('\n')).toEqual([]);
  });

  test('with the full journey (or no store) the map has no daily limit', async ({ page }) => {
    const problems = watchConsole(page);
    await page.goto('/?chapter=test');
    await waitForFlow(page, (p) => p.state === 'playing', 90_000);
    await page.addStyleTag({ content: '.pg-click-to-play { display: none !important; }' });
    await expect(page.locator('.pg-map__left')).toBeHidden();
    for (let i = 0; i < 5; i++) {
      await page.locator('.pg-map__btn').tap();
      await expect(page.locator('.pg-map')).not.toHaveClass(/is-rest/);
      await page.locator('.pg-map__close').tap();
    }
    expect(await page.evaluate(() => (window as unknown as DailyWindow).__pilgrim.daily.mapLeft)).toBe(
      Infinity,
    );
    expect(problems, problems.join('\n')).toEqual([]);
  });
});
