import { expect, test, type Page } from '@playwright/test';
import { waitForMode, watchConsole } from './support';
import {
  SETTINGS_KEY,
  SHOT_DIR,
  installDialogueSpy,
  playSample,
  spaceUntil,
  waitForFlow,
  type StoryWindow,
} from './story-support';

/**
 * Phase 3 report screenshots (test-results/phase3a/), desktop 1280×720 and phone 412×915 (touch), English and
 * Tamil: title, opening, chapter select, credits, settings, demo end, pause, every Satchel page, the dialogue
 * panel with its choices and a world-space speech bubble. Each run also checks the console stays clean.
 * Names: `<screen>[-ta]-<desktop|phone>.png`.
 */

const SATCHEL_TABS = ['roll', 'promises', 'friends', 'map', 'carried'] as const;

/** Starts every page load in `lang` (the stored Settings), keeping anything else already stored. */
async function startIn(page: Page, lang: 'en' | 'ta'): Promise<void> {
  await page.addInitScript(
    ([key, l]) => {
      const raw = localStorage.getItem(key);
      const data = (raw ? JSON.parse(raw) : {}) as Record<string, unknown>;
      data['lang'] = l;
      localStorage.setItem(key, JSON.stringify(data));
    },
    [SETTINGS_KEY, lang] as const,
  );
}

/** A small session so the Satchel pages show content: goals, Promises, friends, gifts, a detour. */
async function fillSession(page: Page): Promise<void> {
  await page.evaluate(() => {
    const s = (window as unknown as StoryWindow).__pilgrim.services.get('state') as Record<
      string,
      (...args: unknown[]) => unknown
    >;
    s['give']!('note');
    s['setObjective']!('ui.hud.objective.followLight');
    s['setObjective']!('ui.hud.objective.findSteps');
    for (const id of ['p01', 'p02', 'p03']) s['collectPromise']!(id);
    s['readPromise']!('p02');
    for (const id of ['evangelist', 'obstinate', 'pliable', 'help']) s['meet']!(id);
    s['giveGift']!('key_promise', true);
    s['enterDetour']!('hill_path');
    s['setHope']!(70);
  });
}

function shooter(
  lang: 'en' | 'ta',
  device: 'desktop' | 'phone',
): (page: Page, screen: string) => Promise<void> {
  return async (page, screen) => {
    await page.screenshot({ path: `${SHOT_DIR}/${screen}${lang === 'ta' ? '-ta' : ''}-${device}.png` });
  };
}

for (const device of ['desktop', 'phone'] as const) {
  test.describe(device, () => {
    if (device === 'phone')
      test.use({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });
    else test.use({ viewport: { width: 1280, height: 720 } });

    for (const lang of ['en', 'ta'] as const) {
      test(`screens (${lang})`, async ({ page }) => {
        test.setTimeout(180_000);
        const problems = watchConsole(page);
        const shot = shooter(lang, device);
        await startIn(page, lang);

        // Title and the screens it opens.
        await page.goto('/');
        await waitForFlow(page, (p) => p.titleReady);
        await page.waitForTimeout(1200); // the painted backdrop fades out
        await shot(page, 'title');
        await page.locator('[data-key="ui.title.chapters"]').click();
        await waitForFlow(page, (p) => p.screen === 'chapters');
        await page.waitForTimeout(500);
        await shot(page, 'chapters');
        await page.keyboard.press('Escape');
        await waitForFlow(page, (p) => p.screen === 'title');
        await page.locator('[data-key="ui.title.credits"]').click();
        await waitForFlow(page, (p) => p.screen === 'credits');
        await page.waitForTimeout(1500);
        await shot(page, 'credits');
        await page.keyboard.press('Escape');
        await waitForFlow(page, (p) => p.screen === 'title');
        await page.locator('[data-key="ui.title.settings"]').click();
        await waitForFlow(page, (p) => p.screen === 'settings');
        await expect(page.locator('.pg-settings')).toBeVisible();
        await page.waitForTimeout(400);
        await shot(page, 'settings');
        await page.locator('[data-focus-id="tab:text"]').click();
        await page.waitForTimeout(300);
        await shot(page, 'settings-text');
        await page.keyboard.press('Escape');
        await waitForFlow(page, (p) => p.screen === 'title');
        await page.locator('[data-key="ui.title.start"]').click();
        await waitForFlow(page, (p) => p.state === 'opening');
        await page.waitForTimeout(3500);
        await shot(page, 'opening');
        await page.evaluate(() =>
          (
            (window as unknown as StoryWindow).__pilgrim.services.get('flow') as { showDemoEnd(): void }
          ).showDemoEnd(),
        );
        await waitForFlow(page, (p) => p.screen === 'demoEnd');
        await page.waitForTimeout(800);
        await shot(page, 'demo-end');

        // A chapter (the test world through the flow): pause and every Satchel page.
        await page.goto('/?chapter=test');
        await waitForMode(page);
        await fillSession(page);
        await page.keyboard.press('Escape');
        await waitForFlow(page, (p) => p.screen === 'pause');
        await page.waitForTimeout(400);
        await shot(page, 'pause');
        await page.locator('[data-key="ui.pause.satchel"]').click();
        await expect(page.locator('.pg-satchel')).toBeVisible();
        const tabs = page.locator('.pg-satchel__tab');
        for (let i = 0; i < SATCHEL_TABS.length; i++) {
          await tabs.nth(i).click();
          await page.waitForTimeout(i === 2 ? 900 : 350); // FRIENDS MET draws portraits one per frame
          await shot(page, `satchel-${SATCHEL_TABS[i]}`);
        }

        // The dialogue demo: the panel with its choices, then the last line in a world-space bubble.
        await page.goto('/?dialogue=test');
        await waitForMode(page);
        await installDialogueSpy(page);
        await playSample(page);
        await spaceUntil(page, (r) => r.phase === 'choosing');
        await page.waitForTimeout(600);
        await shot(page, 'dialogue-choices');
        await page.keyboard.press('Digit1');
        await spaceUntil(page, (r) => r.line?.bubble === true && r.phase === 'shown');
        await page.waitForTimeout(400);
        await shot(page, 'dialogue-bubble');
        await spaceUntil(page, (r) => !r.active);
        expect(problems, problems.join('\n')).toEqual([]);
      });
    }
  });
}
