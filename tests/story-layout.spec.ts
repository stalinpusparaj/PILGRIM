import { expect, test, type Page } from '@playwright/test';
import { waitForMode, watchConsole } from './support';
import { SETTINGS_KEY, SHOT_DIR, playSample, waitForFlow, type StoryWindow } from './story-support';

/**
 * Phase 3 review fixes (layout and legibility), with report screenshots in test-results/phase3a/
 * (`fix-<screen>-<lang>-<size>-<device>.png`):
 * - the title menu fits a laptop window with CONTINUE shown; when large text still runs past the bottom, a
 *   "more" arrow says so until the menu is scrolled to the end;
 * - the CHAPTER label passes WCAG AA; the opening narration follows Settings > Text size;
 * - phones: all five Settings tabs are in sight at XL; the demo-end heading keeps its words whole; the Satchel
 *   footer readout is never below 20 px;
 * - phones on their side: the question stays in view beside its answers; the Satchel tabs drop their labels
 *   at large text sizes instead of breaking words.
 */

type Lang = 'en' | 'ta';
type Size = 'M' | 'L' | 'XL';

/** Every page load in this test starts with these settings. */
async function settings(page: Page, lang: Lang, textSize: Size): Promise<void> {
  await page.addInitScript(
    ([key, l, s]) => localStorage.setItem(key, JSON.stringify({ lang: l, textSize: s })),
    [SETTINGS_KEY, lang, textSize] as const,
  );
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${SHOT_DIR}/fix-${name}.png` });
}

/** Shows CONTINUE as a save would (Title.setContinueAvailable). */
async function showContinue(page: Page): Promise<void> {
  await page.evaluate(() => {
    const b = document.querySelector<HTMLElement>('[data-key="ui.title.continue"]');
    if (b) b.hidden = false;
  });
  await page.waitForTimeout(300);
}

/** How far each title menu button runs past the bottom of its column (px), and whether the arrow shows. */
async function titleFit(page: Page): Promise<{ past: number[]; more: boolean }> {
  return page.evaluate(() => {
    const box = document.querySelector('.pg-title__main')!.getBoundingClientRect();
    const past = [...document.querySelectorAll<HTMLElement>('.pg-title__menu .pg-mbtn')]
      .filter((b) => !b.hidden)
      .map((b) => Math.round(b.getBoundingClientRect().bottom - box.bottom));
    return { past, more: !document.querySelector<HTMLElement>('.pg-title__more')!.hidden };
  });
}

/** WCAG contrast of an element's text colour on a background colour (both rgb() strings). */
function contrast(fg: string, bg: string): number {
  const lum = (rgb: string): number => {
    const [r, g, b] = (rgb.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map((v) => {
      const c = Number(v) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
  return (a! + 0.05) / (b! + 0.05);
}

async function fontPx(page: Page, selector: string): Promise<number> {
  return page
    .locator(selector)
    .first()
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('title fits with CONTINUE; CHAPTER label contrast; the opening follows the text size', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const problems = watchConsole(page);
    await settings(page, 'en', 'M');
    await page.goto('/');
    await waitForFlow(page, (p) => p.titleReady);
    await showContinue(page);
    const fit = await titleFit(page);
    expect(fit.past.length).toBe(5);
    expect(Math.max(...fit.past), JSON.stringify(fit)).toBeLessThanOrEqual(0);
    expect(fit.more).toBe(false);
    await page.waitForTimeout(900);
    await shot(page, 'title-continue-en-M-desktop');

    await page.locator('[data-key="ui.title.chapters"]').click();
    await waitForFlow(page, (p) => p.screen === 'chapters');
    const colours = await page
      .locator('.pg-chapter')
      .first()
      .evaluate((card) => ({
        fg: getComputedStyle(card.querySelector('.pg-chapter__number')!).color,
        // The label sits on its own gold ribbon (chapter-cards.css); its solid fallback colour is the backdrop.
        bg: getComputedStyle(card.querySelector('.pg-chapter__number')!).backgroundColor,
      }));
    expect(contrast(colours.fg, colours.bg)).toBeGreaterThanOrEqual(4.5);
    await page.waitForTimeout(400);
    await shot(page, 'chapters-en-M-desktop');
    await page.keyboard.press('Escape');
    await waitForFlow(page, (p) => p.screen === 'title');

    await page.locator('[data-key="ui.title.start"]').click();
    await waitForFlow(page, (p) => p.state === 'opening');
    const narrationM = await fontPx(page, '.pg-opening__text');
    await page.evaluate(() =>
      (
        (window as unknown as StoryWindow).__pilgrim.services.get('settings') as {
          set(k: string, v: string): void;
        }
      ).set('textSize', 'XL'),
    );
    await page.waitForTimeout(200);
    expect(await fontPx(page, '.pg-opening__text')).toBeCloseTo(narrationM * 1.45, 1);
    await page.waitForTimeout(3000);
    await shot(page, 'opening-en-XL-desktop');
    expect(problems, problems.join('\n')).toEqual([]);
  });

  test('title in Tamil at XL with CONTINUE: the whole menu, or the "more" arrow until scrolled', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const problems = watchConsole(page);
    await settings(page, 'ta', 'XL');
    await page.goto('/');
    await waitForFlow(page, (p) => p.titleReady);
    await showContinue(page);
    const fit = await titleFit(page);
    expect(Math.max(...fit.past) <= 8 || fit.more, JSON.stringify(fit)).toBe(true);
    await page.waitForTimeout(900);
    await shot(page, 'title-continue-ta-XL-desktop');
    expect(problems, problems.join('\n')).toEqual([]);
  });
});

test.describe('phone', () => {
  test.use({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });

  test('Tamil XL: the "more" arrow, every Settings tab in sight, whole words on the demo end', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const problems = watchConsole(page);
    await settings(page, 'ta', 'XL');
    await page.goto('/');
    await waitForFlow(page, (p) => p.titleReady);
    await showContinue(page);
    // The phone-fit title usually fits even Tamil XL; when it does not, the "more" arrow must show.
    const start = await titleFit(page);
    expect(start.more).toBe(Math.max(...start.past) > 0);
    await page.waitForTimeout(900);
    await shot(page, 'title-continue-ta-XL-phone');
    await page.locator('.pg-title__main').evaluate((el) => (el.scrollTop = el.scrollHeight));
    await page.waitForTimeout(300);
    const end = await titleFit(page);
    expect(end.more).toBe(false);
    expect(Math.max(...end.past)).toBeLessThanOrEqual(0);
    await page.locator('.pg-title__main').evaluate((el) => (el.scrollTop = 0));

    await page.locator('[data-key="ui.title.settings"]').tap();
    await waitForFlow(page, (p) => p.screen === 'settings');
    await expect(page.locator('.pg-settings')).toBeVisible();
    const outside = await page.evaluate(() => {
      const list = document.querySelector('.pg-settings__tablist')!.getBoundingClientRect();
      return [...document.querySelectorAll('.pg-settings__tab')]
        .map((t) => t.getBoundingClientRect())
        .filter((r) => r.left < list.left - 1 || r.right > list.right + 1 || r.width === 0).length;
    });
    expect(outside).toBe(0);
    await page.waitForTimeout(400);
    await shot(page, 'settings-ta-XL-phone');
    await page.keyboard.press('Escape');
    await waitForFlow(page, (p) => p.screen === 'title');

    await page.evaluate(() =>
      (
        (window as unknown as StoryWindow).__pilgrim.services.get('flow') as { showDemoEnd(): void }
      ).showDemoEnd(),
    );
    await waitForFlow(page, (p) => p.screen === 'demoEnd');
    expect(await fontPx(page, '.pg-demo-end__line1')).toBeLessThanOrEqual(412 * 0.09 + 0.5);
    await page.waitForTimeout(800);
    await shot(page, 'demo-end-ta-XL-phone');
    expect(problems, problems.join('\n')).toEqual([]);
  });

  test('the Satchel footer readout is body text (>= 20 px)', async ({ page }) => {
    test.setTimeout(60_000);
    const problems = watchConsole(page);
    await settings(page, 'en', 'M');
    await page.goto('/?chapter=test');
    await waitForMode(page);
    await page.keyboard.press('Tab');
    await expect(page.locator('.pg-satchel')).toBeVisible();
    expect(await fontPx(page, '.pg-satchel__count')).toBeGreaterThanOrEqual(20);
    await page.locator('.pg-satchel__tab').nth(1).tap();
    await page.waitForTimeout(400);
    await shot(page, 'satchel-promises-en-M-phone');
    expect(problems, problems.join('\n')).toEqual([]);
  });
});

test.describe('phone on its side', () => {
  test.use({ viewport: { width: 915, height: 412 }, hasTouch: true, isMobile: true });

  test('Tamil XL: the question stays beside its answers; Satchel tabs keep their words whole', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const problems = watchConsole(page);
    await settings(page, 'ta', 'XL');
    await page.goto('/?dialogue=test');
    await waitForMode(page);
    await playSample(page);
    for (let i = 0; i < 40; i++) {
      const phase = await page.evaluate(
        () =>
          ((window as unknown as StoryWindow).__pilgrim.services.get('dialogue') as { phase: string }).phase,
      );
      if (phase === 'choosing') break;
      if (phase === 'typing' || phase === 'shown') await page.touchscreen.tap(458, 60);
      await page.waitForTimeout(250);
    }
    await page.waitForTimeout(700);
    const hidden = await page.evaluate(() => {
      const panel = document.querySelector('.dlg-panel')!.getBoundingClientRect();
      const cut = (el: Element): number => {
        const r = el.getBoundingClientRect();
        return Math.round(Math.max(0, panel.top - r.top) + Math.max(0, r.bottom - panel.bottom));
      };
      return [
        cut(document.querySelector('.dlg-text')!),
        ...[...document.querySelectorAll('.dlg-choice')].map(cut),
      ];
    });
    expect(hidden).toEqual([0, 0, 0, 0]);
    await shot(page, 'dialogue-choices-ta-XL-landscape');

    await page.goto('/?chapter=test');
    await waitForMode(page);
    await page.keyboard.press('Tab');
    await expect(page.locator('.pg-satchel')).toBeVisible();
    await page.locator('.pg-satchel__tab').nth(1).tap();
    await page.waitForTimeout(400);
    await expect(page.locator('.pg-satchel__tabLabel').first()).toBeHidden();
    await expect(page.locator('.pg-satchel__pageTitle')).toBeVisible();
    await shot(page, 'satchel-promises-ta-XL-landscape');
    expect(problems, problems.join('\n')).toEqual([]);
  });
});
