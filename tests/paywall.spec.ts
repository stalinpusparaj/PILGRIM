/**
 * The full journey (DECISIONS #402) with a stand-in for the Android shell's RevenueCat bridge
 * (window.PilgrimBilling): Chapters I-IV free, V+ behind the paywall; buying (after the grown-up check) opens
 * everything and goes on; a remembered purchase keeps the journey open offline; Settings > About offers
 * Unlock, then Manage subscription.
 */
import { expect, test, type Page } from '@playwright/test';
import { waitForFlow } from './story-support';
import { watchConsole } from './support';

interface Stub {
  __buys: string[];
  __push(patch: Record<string, unknown>): void;
}

async function boot(page: Page, start: { status: string; owned?: boolean; confirmed?: boolean }, cached = false): Promise<void> {
  await page.addInitScript(
    ({ start, cached }) => {
      if (cached) localStorage.setItem('pilgrim.entitlement.v1', '1');
      const w = window as unknown as Stub & Record<string, unknown>;
      let state: Record<string, unknown> = {
        status: start.status,
        owned: start.owned ?? false,
        confirmed: start.confirmed ?? start.status === 'ready',
        kind: start.owned ? 'subscription' : '',
        event: '',
        products:
          start.status === 'ready'
            ? {
                monthly: { price: '₹99.00', period: 'P1M', trial: 'P3D' },
                yearly: { price: '₹499.00', period: 'P1Y', trial: 'P3D' },
                lifetime: { price: '₹399.00' },
              }
            : {},
      };
      w.__buys = [];
      w.__push = (patch) => {
        state = { ...state, ...patch };
        const hooks = w.__pilgrimNative as { billing?(json: string): void } | undefined;
        hooks?.billing?.(JSON.stringify(state));
      };
      w.PilgrimBilling = {
        billingState: () => JSON.stringify(state),
        buy: (plan: string) => {
          w.__buys.push(plan);
          setTimeout(() => w.__push({ owned: true, confirmed: true, kind: plan === 'lifetime' ? 'lifetime' : 'subscription', event: 'purchased' }), 50);
        },
        restore: () => setTimeout(() => w.__push({ event: 'restored' }), 50),
        manageSubscription: () => w.__buys.push('manage'),
      };
    },
    { start, cached },
  );
  await page.goto('/?debug=1');
  await waitForFlow(page, (p) => p.titleReady);
  await page.evaluate(() =>
    (window as unknown as { __pilgrim: { services: { get(k: string): { setVisible(v: boolean): void } } } }).__pilgrim.services
      .get('debug')
      .setVisible(false),
  );
}

async function answerGate(page: Page): Promise<void> {
  const q = (await page.locator('.pg-gate__question').textContent()) ?? '';
  const [a, b] = (q.match(/\d+/g) ?? []).map(Number);
  await page.locator('.pg-gate__answer', { hasText: new RegExp(`^${a! + b!}$`) }).click();
}

test('Chapters V+ are locked; a locked chapter opens the paywall; buying after the grown-up check opens it', async ({ page }) => {
  const problems = watchConsole(page);
  await boot(page, { status: 'ready' });
  await page.locator('[data-key="ui.title.chapters"]').click();
  const card = (n: number) => page.locator(`.pg-chapter[data-chapter="${n}"]`);
  await expect(card(4)).not.toHaveAttribute('data-lock', 'demo');
  await expect(card(5)).toHaveAttribute('data-lock', 'demo');
  await expect(card(5)).toContainText('Unlock the full journey');
  await card(5).click();
  const wall = page.locator('.pg-paywall');
  await expect(wall).toBeVisible();
  await expect(wall.locator('.pg-paywall__plan')).toHaveCount(3);
  await expect(wall.locator('.pg-paywall__plan--yearly')).toContainText('₹499.00 / year');
  await expect(wall.locator('.pg-paywall__plan--yearly')).toContainText('3-day free trial');
  await expect(wall.locator('.pg-paywall__plan--lifetime')).toContainText('₹399.00 once');
  await expect(wall.locator('.pg-paywall__legal')).toContainText('renew automatically');
  await page.waitForTimeout(700); // the fade-in
  await page.screenshot({ path: 'test-results/paywall/paywall.png' });
  await wall.locator('.pg-paywall__plan--yearly').click();
  await answerGate(page);
  await waitForFlow(page, (p) => p.chapter === 5 && (p.state === 'loading' || p.state === 'playing'), 90_000);
  expect(await page.evaluate(() => (window as unknown as Stub).__buys)).toEqual(['yearly']);
  expect(await page.evaluate(() => localStorage.getItem('pilgrim.entitlement.v1'))).toBe('1');
  expect(problems, problems.join('\n')).toEqual([]);
});

test('finishing Chapter IV shows the paywall; Maybe later goes to the title', async ({ page }) => {
  test.setTimeout(120_000);
  const problems = watchConsole(page);
  await boot(page, { status: 'ready' });
  await page.evaluate(() =>
    (window as unknown as { __pilgrim: { services: { get(k: string): { startChapter(n: number): Promise<void> } } } }).__pilgrim.services
      .get('flow')
      .startChapter(4),
  );
  await waitForFlow(page, (p) => p.state === 'playing', 90_000);
  await page.evaluate(() =>
    (window as unknown as { __pilgrim: { services: { get(k: string): { completeChapter(n: number): void } } } }).__pilgrim.services
      .get('flow')
      .completeChapter(4),
  );
  await expect(page.locator('.pg-paywall')).toBeVisible();
  await page.locator('[data-key="ui.paywall.later"]').click();
  await waitForFlow(page, (p) => p.state === 'title');
  expect(problems, problems.join('\n')).toEqual([]);
});

test('offline: a remembered purchase keeps the journey open', async ({ page }) => {
  const problems = watchConsole(page);
  await boot(page, { status: 'offline', confirmed: false }, true);
  await page.locator('[data-key="ui.title.chapters"]').click();
  await expect(page.locator('.pg-chapter[data-chapter="5"]')).not.toHaveAttribute('data-lock', 'demo');
  expect(problems, problems.join('\n')).toEqual([]);
});

test('offline with no remembered purchase: the paywall says to connect', async ({ page }) => {
  const problems = watchConsole(page);
  await boot(page, { status: 'offline', confirmed: false });
  await page.evaluate(() =>
    (window as unknown as { __pilgrim: { services: { get(k: string): { startChapter(n: number): Promise<void> } } } }).__pilgrim.services
      .get('flow')
      .startChapter(6),
  );
  await expect(page.locator('.pg-paywall__wait')).toContainText('Connect to the internet');
  expect(problems, problems.join('\n')).toEqual([]);
});

test('Settings > About: Unlock, then Manage subscription once subscribed; Restore', async ({ page }) => {
  const problems = watchConsole(page);
  await boot(page, { status: 'ready' });
  await page.locator('[data-key="ui.title.settings"]').click();
  await page.locator('[data-focus-id="tab:about"]').click();
  await expect(page.locator('.pg-set-action').first()).toContainText('Unlock the full journey');
  await page.locator('.pg-set-action').first().click();
  await expect(page.locator('.pg-paywall--over')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.pg-paywall')).toHaveCount(0);
  await expect(page.locator('.pg-settings')).toBeVisible();
  await page.evaluate(() => (window as unknown as Stub).__push({ owned: true, confirmed: true, kind: 'subscription' }));
  await page.locator('[data-focus-id="tab:general"]').click();
  await page.locator('[data-focus-id="tab:about"]').click();
  await expect(page.locator('.pg-set-action').first()).toContainText('Manage subscription');
  await page.locator('.pg-set-action').first().click();
  expect(await page.evaluate(() => (window as unknown as Stub).__buys)).toEqual(['manage']);
  expect(problems, problems.join('\n')).toEqual([]);
});
