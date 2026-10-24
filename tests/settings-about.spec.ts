/**
 * Settings > About, the language dropdown and the new-version notice (DECISIONS #397), with a stand-in for the
 * Android shell's calls (window.PilgrimNative) installed before the game starts.
 */
import { expect, test, type Page } from '@playwright/test';
import { SETTINGS_KEY, waitForFlow } from './story-support';
import { watchConsole } from './support';

interface Opened { __opened: string[] }

async function boot(page: Page, update: number | null): Promise<void> {
  await page.addInitScript((update) => {
    const w = window as unknown as Opened & Record<string, unknown>;
    w.__opened = [];
    w.PilgrimNative = {
      vibrate() {},
      thermalStatus: () => 0,
      openStore: () => w.__opened.push('store'),
      share: () => w.__opened.push('share'),
      hasLink: (n: string) => n === 'more',
      openLink: (n: string) => w.__opened.push(`link:${n}`),
      checkUpdate: () => {
        if (update) setTimeout(() => (w.__pilgrimNative as { update(c: number): void }).update(update), 50);
      },
    };
  }, update);
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

test('About: rate opens the store, more games behind the grown-up check, creators, version', async ({ page }) => {
  const problems = watchConsole(page);
  await boot(page, null);
  await page.locator('[data-key="ui.title.settings"]').click();
  await page.locator('[data-focus-id="tab:about"]').click();
  const actions = page.locator('.pg-set-action');
  await expect(actions).toHaveText([/Rate/, /Share/, /More games/, /Game creators/]);
  await expect(page.locator('.pg-set-row', { hasText: 'Version' })).toContainText(/v\d+\.\d+\.\d+/);
  await page.screenshot({ path: 'test-results/settings/about.png' });

  // Rate opens the store at once; More games asks a grown-up first (a wrong answer opens nothing).
  await actions.filter({ hasText: 'Rate' }).click();
  await expect(page.locator('.pg-gate')).toHaveCount(0);
  await actions.filter({ hasText: 'More games' }).click();
  const q = (await page.locator('.pg-gate__question').textContent()) ?? '';
  const [a, b] = (q.match(/\d+/g) ?? []).map(Number);
  await page.locator('.pg-gate__answer').filter({ hasNotText: new RegExp(`^${a! + b!}$`) }).first().click();
  await expect(page.locator('.pg-gate')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as Opened).__opened)).toEqual(['store']);

  await actions.filter({ hasText: 'More games' }).click();
  await answerGate(page);
  expect(await page.evaluate(() => (window as unknown as Opened).__opened)).toEqual(['store', 'link:more']);

  await actions.filter({ hasText: 'Game creators' }).click();
  await expect(page.locator('.pg-credits--over')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.pg-credits--over')).toHaveCount(0);
  await expect(page.locator('.pg-settings')).toBeVisible();
  expect(problems, problems.join('\n')).toEqual([]);
});

test('language dropdown lists all twelve languages and switches the game', async ({ page }) => {
  const problems = watchConsole(page);
  await boot(page, null);
  await page.locator('[data-key="ui.title.settings"]').click();
  const select = page.locator('select.pg-set-select');
  await expect(select.locator('option')).toHaveCount(12);
  await select.selectOption('hi');
  await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
  await expect(page.locator('body')).toHaveClass(/lang-hi/);
  expect(await page.evaluate((k) => localStorage.getItem(k) ?? '', SETTINGS_KEY)).toContain('"lang":"hi"');
  await select.selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  expect(problems, problems.join('\n')).toEqual([]);
});

test('a newer version shows on the title with Update and Skip; Skip is remembered for that version', async ({ page }) => {
  const problems = watchConsole(page);
  await boot(page, 99);
  const banner = page.locator('.pg-update');
  await expect(banner).toBeVisible();
  await page.setViewportSize({ width: 360, height: 802 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'test-results/settings/update-banner-phone.png' });
  await banner.locator('.pg-update__now').click();
  await answerGate(page);
  expect(await page.evaluate(() => (window as unknown as Opened).__opened)).toEqual(['store']);
  await page.locator('[data-key="ui.title.settings"]').click();
  await page.locator('[data-focus-id="tab:about"]').click();
  await expect(page.locator('.pg-set-action').first()).toContainText('new version');
  await page.keyboard.press('Escape');
  await banner.locator('.pg-update__skip').click();
  await expect(banner).toHaveCount(0);
  await page.reload();
  await waitForFlow(page, (p) => p.titleReady);
  await page.waitForTimeout(500);
  await expect(page.locator('.pg-update')).toHaveCount(0);
  expect(problems, problems.join('\n')).toEqual([]);
});
