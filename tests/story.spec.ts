import { expect, test, type Page } from '@playwright/test';
import { waitForMode, watchConsole } from './support';
import {
  PAD,
  SETTINGS_KEY,
  flowProbe,
  focusedId,
  hope,
  installDialogueSpy,
  installFakePad,
  padTap,
  playSample,
  readSpy,
  spaceUntil,
  waitForFlow,
  type StoryWindow,
} from './story-support';

/**
 * Phase 3 story and UI acceptance (GDD 2.8, 2.14):
 * (a) `?dialogue=test` plays the sample conversation in English and Tamil: lines show, a choice is picked with
 *     key 2 and with a click, Hope moves by the chosen amount, the camera cuts between lines and babble plays;
 * (b) the title screen works keyboard-only and gamepad-only: CHAPTERS, SETTINGS (text size persists after a
 *     reload) and START (the opening narration);
 * (c) `?chapter=test` (through GameFlow): Tab opens MY SATCHEL with the five GDD tabs and footer, the Key card
 *     reads exactly "A key called Promise.", Esc opens the pause menu and its SATCHEL button;
 * (d) the language toggle puts every title string into Tamil without overflow at 375 px.
 */
const EN = {
  n1: 'Hello, friend! Why do you look so sad?',
  tabs: ['THE ROLL', 'PROMISES', 'FRIENDS MET', 'MAP', 'CARRIED'],
};
/** Tamil letters (U+0B80-U+0BFF). */
const TAMIL = /[஀-௿]/;

async function t(page: Page, key: string): Promise<string> {
  return page.evaluate(
    (k) =>
      ((window as unknown as StoryWindow).__pilgrim.services.get('i18n') as { t(k: string): string }).t(k),
    key,
  );
}

async function setLang(page: Page, lang: 'en' | 'ta'): Promise<void> {
  await page.evaluate(
    (l) =>
      (
        (window as unknown as StoryWindow).__pilgrim.services.get('i18n') as { setLang(l: string): void }
      ).setLang(l),
    lang,
  );
}

test('?dialogue=test plays the sample in English and Tamil: choices, Hope, camera cuts, babble', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const problems = watchConsole(page);
  await page.goto('/?dialogue=test');
  await waitForMode(page);
  await installDialogueSpy(page);
  const hope0 = await hope(page);

  // English, keyboard: Space through the lines, key 2 picks "polite" (+5).
  await playSample(page);
  await expect(page.locator('.dlg-panel .dlg-text')).toHaveText(EN.n1);
  await spaceUntil(page, (r) => r.phase === 'choosing');
  const choices = page.locator('.dlg-choices button');
  await expect(choices).toHaveCount(3);
  await expect(choices.nth(1)).toContainText(await t(page, 'test.choice.polite'));
  await page.keyboard.press('Digit2');
  await spaceUntil(page, (r) => !r.active);
  const en = await readSpy(page);
  expect(en.chose).toEqual([1]);
  expect(await hope(page)).toBe(hope0 + 5);
  expect(en.lines.map((l) => l.node)).toEqual(['n1', 'n2', 'n3', 'n4', 'n5', 'n6']);
  expect(en.lines.at(-1)?.bubble).toBe(true); // the last line is a world-space bubble
  // Camera cuts: over the shoulder → close-up → over the shoulder (the camera moved between lines).
  const moved = en.lines.slice(1).map((l, i) => Math.hypot(...l.cam.map((v, j) => v - en.lines[i]!.cam[j]!)));
  expect(Math.max(...moved)).toBeGreaterThan(0.5);
  // Babble: one voice per line, with the English text.
  expect(en.babble.length).toBeGreaterThanOrEqual(6);
  expect(en.babble).toContain(EN.n1);

  // Tamil, mouse: the same conversation, the "funny" choice clicked (+10).
  await page.waitForTimeout(1500); // "Play again" ignores presses for a moment after a conversation
  await page.locator('.dtest-langs button[lang="ta"]').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ta');
  const hope1 = await hope(page);
  await page.evaluate(() => {
    const spy = (window as unknown as StoryWindow).__spy!;
    spy.lines.length = spy.babble.length = spy.hope.length = spy.chose.length = 0;
  });
  await playSample(page);
  const ta1 = await t(page, 'test.evangelist.1');
  expect(ta1).toMatch(TAMIL);
  await expect(page.locator('.dlg-panel .dlg-text')).toHaveText(ta1);
  await expect(page.locator('.dlg-panel .dlg-name')).toHaveText(TAMIL);
  await spaceUntil(page, (r) => r.phase === 'choosing');
  await expect(choices.nth(2)).toContainText(await t(page, 'test.choice.funny'));
  await page.waitForTimeout(600); // choices arm after 0.45 s so a mashed key or tap never picks one unseen
  await choices.nth(2).click();
  await spaceUntil(page, (r) => !r.active);
  const ta = await readSpy(page);
  expect(ta.chose).toEqual([2]);
  expect(ta.hope).toContain(10);
  expect(await hope(page)).toBe(Math.min(100, hope1 + 10));
  expect(ta.lines.map((l) => l.node)).toEqual(['n1', 'n2', 'n3', 'n4', 'n5_funny', 'n6']);
  expect(ta.babble).toContain(ta1);
  expect(problems, problems.join('\n')).toEqual([]);
});

test('title screen, keyboard only: CHAPTERS, SETTINGS (text size persists), START', async ({ page }) => {
  test.setTimeout(90_000);
  const problems = watchConsole(page);
  await page.goto('/');
  await waitForFlow(page, (p) => p.titleReady);
  expect((await flowProbe(page)).focused).toBe('ui.title.start');

  await page.keyboard.press('ArrowDown');
  expect((await flowProbe(page)).focused).toBe('ui.title.chapters');
  await page.keyboard.press('Enter');
  await waitForFlow(page, (p) => p.screen === 'chapters');
  await expect(page.locator('.pg-chapters')).toBeVisible();
  await page.keyboard.press('Escape');
  await waitForFlow(page, (p) => p.screen === 'title' && p.focused === 'ui.title.chapters');

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await waitForFlow(page, (p) => p.screen === 'settings');
  await expect(page.locator('.pg-settings')).toBeVisible();
  await expect.poll(() => focusedId(page)).toBe('tab:general');
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => focusedId(page)).toBe('lang:select');
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => focusedId(page)).toBe('textSize:M');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('body')).toHaveClass(/text-L/);
  await page.keyboard.press('Escape');
  await waitForFlow(page, (p) => p.screen === 'title' && p.focused === 'ui.title.settings');

  await page.reload();
  await waitForFlow(page, (p) => p.titleReady);
  await expect(page.locator('body')).toHaveClass(/text-L/);
  expect(await page.evaluate((k) => localStorage.getItem(k) ?? '', SETTINGS_KEY)).toContain('"textSize":"L"');

  await page.keyboard.press('Home');
  expect((await flowProbe(page)).focused).toBe('ui.title.start');
  await page.keyboard.press('Enter');
  await waitForFlow(page, (p) => p.state === 'opening');
  await expect(page.locator('.pg-opening')).toBeVisible();
  await expect(page.locator('.pg-opening__text')).toContainText('As I walked through the wilderness');
  expect(problems, problems.join('\n')).toEqual([]);
});

test('title screen, gamepad only: CHAPTERS, SETTINGS, START', async ({ page }) => {
  test.setTimeout(90_000);
  const problems = watchConsole(page);
  await installFakePad(page);
  await page.goto('/');
  await waitForFlow(page, (p) => p.titleReady);

  await padTap(page, PAD.DOWN);
  expect((await flowProbe(page)).focused).toBe('ui.title.chapters');
  await padTap(page, PAD.A);
  await waitForFlow(page, (p) => p.screen === 'chapters');
  await padTap(page, PAD.RIGHT); // move among the chapter cards
  await padTap(page, PAD.B);
  await waitForFlow(page, (p) => p.screen === 'title' && p.focused === 'ui.title.chapters');

  await padTap(page, PAD.DOWN);
  await padTap(page, PAD.A);
  await waitForFlow(page, (p) => p.screen === 'settings');
  await expect.poll(() => focusedId(page)).toBe('tab:general');
  await padTap(page, PAD.DOWN);
  await padTap(page, PAD.DOWN);
  await expect.poll(() => focusedId(page)).toBe('textSize:M');
  await padTap(page, PAD.RIGHT);
  await expect(page.locator('body')).toHaveClass(/text-L/);
  await padTap(page, PAD.LEFT);
  await expect(page.locator('body')).toHaveClass(/text-M/);
  await padTap(page, PAD.B);
  await waitForFlow(page, (p) => p.screen === 'title' && p.focused === 'ui.title.settings');

  await padTap(page, PAD.UP);
  await padTap(page, PAD.UP);
  expect((await flowProbe(page)).focused).toBe('ui.title.start');
  await padTap(page, PAD.A);
  await waitForFlow(page, (p) => p.state === 'opening');
  await expect(page.locator('.pg-opening')).toBeVisible();
  expect(problems, problems.join('\n')).toEqual([]);
});

test('?chapter=test: Tab opens MY SATCHEL (five tabs, footer, Key card), Esc opens the pause menu', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const problems = watchConsole(page);
  await page.goto('/?chapter=test');
  await waitForMode(page);
  await waitForFlow(page, (p) => p.state === 'playing');

  await page.keyboard.press('Tab');
  await waitForFlow(page, (p) => p.screen === 'satchel' && p.loopPaused);
  const satchel = page.locator('.pg-satchel');
  await expect(satchel).toBeVisible();
  await expect(satchel.locator('.pg-satchel__title')).toHaveText('MY SATCHEL');
  await expect(satchel.locator('.pg-satchel__tabLabel')).toHaveText(EN.tabs);
  await expect(satchel.locator('.pg-satchel__count').first()).toHaveText('Promises: 0 of 24');
  await expect(satchel.locator('.pg-satchel__count--detours')).toHaveText('Detours: 0');
  await page.keyboard.press('Tab'); // the Satchel key closes it again
  await waitForFlow(page, (p) => p.screen === 'none' && !p.loopPaused);
  await expect(satchel).toHaveCount(0);

  // The Key of Promise arrives quietly (GDD 2.7.6); its card reads exactly the GDD line, nothing else.
  await page.evaluate(() => {
    const s = (window as unknown as StoryWindow).__pilgrim.services.get('state') as {
      giveGift(id: string, quiet: boolean): void;
    };
    s.giveGift('key_promise', true);
  });
  await page.keyboard.press('Tab');
  await waitForFlow(page, (p) => p.screen === 'satchel' && p.loopPaused);
  await satchel.locator('.pg-satchel__tab').nth(4).click();
  const key = satchel.locator('[data-key="item:key_promise"]');
  await expect(key.locator('.pg-satchel__itemLine')).toHaveText('A key called Promise.');
  await expect(key.locator('.pg-satchel__itemName')).toHaveCount(0);
  await page.keyboard.press('Escape'); // Esc closes the Satchel too
  await waitForFlow(page, (p) => p.screen === 'none' && !p.loopPaused);

  // Pause: Esc opens it over the paused game; SATCHEL opens the Satchel over it; KEEP GOING resumes.
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await waitForFlow(page, (p) => p.screen === 'pause' && p.loopPaused);
  await expect(page.locator('.pg-pause .pg-pause__title')).toHaveText('PAUSED');
  await page.locator('[data-key="ui.pause.satchel"]').click();
  await waitForFlow(page, (p) => p.screen === 'satchel' && p.state === 'paused');
  await expect(satchel).toBeVisible();
  await page.waitForTimeout(200); // a press in the Satchel's first step is ignored (it may be the opening one)
  await page.keyboard.press('Tab');
  await waitForFlow(page, (p) => p.screen === 'pause');
  await page.locator('[data-key="ui.pause.resume"]').click();
  await waitForFlow(page, (p) => p.state === 'playing' && p.screen === 'none' && !p.loopPaused);
  expect(problems, problems.join('\n')).toEqual([]);
});

test.describe('phone', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('the language toggle puts every title string into Tamil without overflow at 375 px', async ({
    page,
  }) => {
    const problems = watchConsole(page);
    await page.goto('/');
    await waitForFlow(page, (p) => p.titleReady);
    await page.locator('.pg-title__langbtn[lang="ta"]').click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'ta');
    const keys = ['ui.title.start', 'ui.title.chapters', 'ui.title.settings', 'ui.title.credits'];
    for (const key of keys) {
      await expect(page.locator(`.pg-title [data-key="${key}"]`)).toHaveText(await t(page, key));
      expect(await t(page, key)).toMatch(TAMIL);
    }
    for (const [sel, key] of [
      ['.pg-title__credit', 'ui.title.credit'],
      ['.pg-title__tagline', 'ui.title.tagline'],
    ] as const) {
      expect(await t(page, key)).toMatch(TAMIL);
      await expect(page.locator(sel)).toHaveText(await t(page, key));
    }
    const overflow = await page.evaluate(() => {
      const bad: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>(
        '.pg-title button, .pg-title p, .pg-title span',
      )) {
        if (el.getClientRects().length === 0 || getComputedStyle(el).display === 'inline') continue;
        if (el.scrollWidth > el.clientWidth + 1) bad.push(`${el.className}: ${el.textContent}`);
        const r = el.getBoundingClientRect();
        if (r.left < -1 || r.right > window.innerWidth + 1) bad.push(`off-screen ${el.className}`);
      }
      if (document.documentElement.scrollWidth > window.innerWidth) bad.push('page scrolls sideways');
      return bad;
    });
    expect(overflow, overflow.join('\n')).toEqual([]);
    await setLang(page, 'en');
    await expect(page.locator('.pg-title [data-key="ui.title.start"]')).toHaveText('START THE JOURNEY');
    expect(problems, problems.join('\n')).toEqual([]);
  });
});
