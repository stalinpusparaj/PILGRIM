import { expect, test, type Page } from '@playwright/test';
import { frames, waitForMode, watchConsole } from './support';

/**
 * Tamil phone QA (a 360 x 802 touch phone, like a 720p Android, in Tamil at text size M):
 * - every menu screen (title, CHAPTERS, the five Settings tabs, credits, pause, the five Satchel pages, the map, the
 *   name card) is shot and checked;
 * - every chapter (I-XIII, the Epilogue) is played by the autopilot (conversations, waystones, the fight) while an
 *   in-page layout checker watches #ui: visible text cut off inside its box, anything off the screen, or a text panel
 *   covering a touch control. Each new finding saves a screenshot.
 * Findings and screenshots: qa-results/tamil/ (QA lines in the test output). Run on its own: it takes several minutes.
 */

const SHOTS = 'qa-results/tamil'; // outside test-results/, which every Playwright run clears
const PHONE = { width: 360, height: 802 };
const CHAPTERS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', 'epilogue'];

interface Finding { where: string; issue: string; text: string; cls: string; shot: string }

test.use({ viewport: PHONE, deviceScaleFactor: 2, hasTouch: true, isMobile: true });

async function tamil(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      const raw = localStorage.getItem('pilgrim.settings.v1');
      const s = raw ? JSON.parse(raw) : {};
      localStorage.setItem('pilgrim.settings.v1', JSON.stringify({ ...s, lang: 'ta', textSize: 'M', voiceMode: 'off' }));
    } catch {
      /* storage blocked */
    }
  });
}

/** The layout checker: runs in the page every 400 ms and keeps unique findings in window.__qa. */
async function installChecker(page: Page, where: string): Promise<void> {
  await page.evaluate((label) => {
    type QA = { where: string; seen: Set<string>; found: Array<Record<string, string>>; timer: number };
    const w = window as unknown as { __qa?: QA };
    if (w.__qa) { w.__qa.where = label; return; }
    const qa: QA = { where: label, seen: new Set(), found: [], timer: 0 };
    w.__qa = qa;
    const vw = innerWidth, vh = innerHeight;
    const visible = (el: Element): boolean => {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      const cs = getComputedStyle(el);
      return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
    };
    const ownText = (el: Element): string =>
      [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent ?? '').join('').trim();
    const controls = (): DOMRect[] =>
      [...document.querySelectorAll('.pg-touch-btn, .pg-map__btn')].filter(visible).map((e) => e.getBoundingClientRect());
    const report = (el: Element, issue: string): void => {
      const text = (el.textContent ?? '').trim().slice(0, 60);
      const cls = typeof el.className === 'string' ? el.className : '';
      const key = `${issue}|${cls}|${text}`;
      if (qa.seen.has(key)) return;
      qa.seen.add(key);
      qa.found.push({ where: qa.where, issue, text, cls });
    };
    qa.timer = window.setInterval(() => {
      const ui = document.getElementById('ui');
      if (!ui) return;
      const ctrl = controls();
      for (const el of ui.querySelectorAll('*')) {
        if (!ownText(el) || !visible(el)) continue;
        const r = el.getBoundingClientRect();
        // Off the screen (scrollable menus excepted: their content scrolls into view).
        const scroller = el.closest('.panel, .pg-satchel__body, .pg-settings__body, .pg-chapters__list, .pg-credits__roll');
        if (!scroller && (r.left < -1 || r.right > vw + 1 || r.bottom > vh + 1 || r.top < -1)) report(el, 'off-screen');
        // Cut off inside its own box.
        const cs = getComputedStyle(el);
        const clips = cs.overflow !== 'visible' || cs.textOverflow === 'ellipsis';
        if (clips && (el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 4)) report(el, 'clipped');
        // Text panels covering a touch control (the controls' own labels excepted).
        if (!el.closest('.pg-touch, .pg-map') && ctrl.some((c) => r.left < c.right && c.left < r.right && r.top < c.bottom && c.top < r.bottom))
          report(el, 'covers-control');
      }
    }, 400);
  }, where);
}

async function takeFindings(page: Page, all: Finding[]): Promise<void> {
  const fresh = await page.evaluate(() => {
    const qa = (window as unknown as { __qa?: { found: Array<Record<string, string>> } }).__qa;
    return qa ? qa.found.splice(0) : [];
  });
  for (const f of fresh) {
    const shot = `${SHOTS}/${String(all.length).padStart(3, '0')}-${f.where}-${f.issue}.png`;
    await page.screenshot({ path: shot });
    all.push({ ...(f as unknown as Finding), shot });
  }
}

/** The F1 developer panel is not part of the game's UI. */
async function hideDebug(page: Page): Promise<void> {
  await page.evaluate(() =>
    ((window as unknown as { __pilgrim: { services: { tryGet(k: string): unknown } } }).__pilgrim.services.tryGet('debug') as
      | { setVisible(v: boolean): void }
      | undefined)?.setVisible(false),
  );
}

/** Settles any conversation (first answer, skipped through). */
async function settle(page: Page): Promise<void> {
  let quiet = 0;
  for (let i = 0; i < 200 && quiet < 4; i++) {
    const busy = await page.evaluate(() => {
      const r = (window as unknown as { __pilgrim: { services: { tryGet(k: string): unknown } } }).__pilgrim.services.tryGet('dialogue') as
        | { active: boolean; phase: string; choose(i: number): void; skipScene(): void }
        | undefined;
      if (!r?.active) return false;
      if (r.phase === 'choosing') r.choose(0);
      else r.skipScene();
      return true;
    });
    quiet = busy ? 0 : quiet + 1;
    await page.waitForTimeout(150);
  }
}

async function open(page: Page, chapter: string): Promise<void> {
  await page.goto(`/?chapter=${chapter}&skipIntro=1`);
  await waitForMode(page);
  await hideDebug(page);
  await page.waitForFunction(() => (window as unknown as { __pilgrim: { play: unknown } }).__pilgrim.play != null, null, { timeout: 60_000 });
  await frames(page, 20);
  await touchFirst(page);
}

/** A real finger on the look half (nothing there to press), so the game is in its touch layout like on a phone. */
async function touchFirst(page: Page): Promise<void> {
  await page.touchscreen.tap(PHONE.width * 0.75, PHONE.height * 0.45);
  await page.waitForTimeout(300);
}

test('Tamil phone QA: menu screens', async ({ page }) => {
  test.setTimeout(240_000);
  const problems = watchConsole(page);
  const all: Finding[] = [];
  await tamil(page);
  await page.goto('/');
  await waitForMode(page);
  await hideDebug(page);
  await frames(page, 30);
  await touchFirst(page);
  await installChecker(page, 'title');
  const shot = async (name: string): Promise<void> => {
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${SHOTS}/screen-${name}.png` });
    await takeFindings(page, all);
  };
  await shot('title');
  const buttons = page.locator('.pg-title__menu [data-menu-item]:not([hidden])');
  const count = await buttons.count();
  for (let i = 1; i < count; i++) {
    await installChecker(page, `title-item${i}`);
    await buttons.nth(i).tap();
    await shot(`title-item${i}`);
    // Settings: every tab.
    const tabs = page.locator('.pg-settings__tab');
    for (let k = 0; k < (await tabs.count()); k++) {
      await installChecker(page, `settings-tab${k}`);
      await tabs.nth(k).tap();
      await shot(`settings-tab${k}`);
      await page.locator('.pg-settings__body, .pg-settings').first().evaluate((el) => el.scrollTo?.(0, 1e5));
      await shot(`settings-tab${k}-end`);
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    await page.keyboard.press('Escape').catch(() => undefined);
    await page.goto('/');
    await waitForMode(page);
    await hideDebug(page);
    await frames(page, 20);
    await installChecker(page, 'title');
  }

  // In play: pause, the Satchel's five pages, the map, the name card.
  await open(page, '5');
  await installChecker(page, 'play');
  await page.waitForTimeout(1500);
  await settle(page);
  await page.waitForTimeout(1000);
  await shot('play');
  await installChecker(page, 'map');
  await page.locator('.pg-map__btn').tap();
  await shot('map');
  await page.locator('.pg-map__close').tap();
  await installChecker(page, 'pause');
  await page.locator('.pg-touch-btn[data-id="pause"]').tap();
  await shot('pause');
  await page.evaluate(() => ((window as unknown as { __pilgrim: { services: { get(k: string): unknown } } }).__pilgrim.services.get('flow') as { resume(): void }).resume());
  await page.waitForTimeout(800);
  await installChecker(page, 'satchel');
  await page.locator('.pg-touch-btn[data-id="satchel"]').tap();
  await page.waitForTimeout(800);
  const pages = page.locator('.pg-satchel__tab');
  for (let k = 0; k < (await pages.count()); k++) {
    await installChecker(page, `satchel-tab${k}`);
    await pages.nth(k).tap();
    await shot(`satchel-tab${k}`);
  }
  await page.keyboard.press('Tab');
  await page.waitForTimeout(500);
  await installChecker(page, 'name');
  await page.evaluate(() => {
    const play = (window as unknown as { __pilgrim: { play: { teleport(x: number, z: number, f?: number): void; world: { level: { triggers: Array<{ id: string; at: number[] }> } } } } }).__pilgrim.play;
    const t = play.world.level.triggers.find((x) => x.id === 'room5_look')!;
    play.teleport(t.at[0]!, t.at[2]!, Math.PI / 2);
  });
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    const s = (window as unknown as { __pilgrim: { services: { get(k: string): unknown } } }).__pilgrim.services;
    const d = s.get('dialogue') as { active: boolean; skipScene(): void };
    if (d.active) d.skipScene();
  });
  await page.waitForTimeout(1500);
  await shot('dialogue');
  console.log(`menu findings: ${all.length}`);
  console.log(`QA findings-menus ${JSON.stringify(all, null, 1)}`);
  expect(problems.filter((p) => !p.includes('Failed to load')), problems.join('\n')).toEqual([]);
});

for (const ch of CHAPTERS) {
  test(`Tamil phone QA: chapter ${ch} played through`, async ({ page }) => {
    test.setTimeout(420_000);
    const all: Finding[] = [];
    await tamil(page);
    await open(page, ch);
    await installChecker(page, `ch${ch}`);
    await page.evaluate(() => {
      const w = window as unknown as {
        __autopilot: { start(p: Record<string, unknown>): void };
        __pilgrim: { engine: { loop: { timeScale: number } }; events: { on(n: string, f: (p: unknown) => void): () => void } };
        __done?: boolean;
        __shots?: string[];
      };
      w.__done = false;
      w.__shots = [];
      w.__pilgrim.events.on('chapter:complete', () => (w.__done = true));
      for (const n of ['dialogue:line', 'hud:toast', 'objective:changed', 'cutscene:start', 'achievement:unlocked'])
        w.__pilgrim.events.on(n, () => w.__shots!.push(n));
      w.__pilgrim.engine.loop.timeScale = 2;
      w.__autopilot.start({ waystones: true, fight: true, followGuide: true, useAll: true });
    });
    const seen = new Map<string, number>();
    const deadline = Date.now() + 360_000;
    while (Date.now() < deadline) {
      await page.waitForTimeout(1200);
      const state = await page.evaluate(() => {
        const w = window as unknown as { __done?: boolean; __shots?: string[] };
        return { done: !!w.__done, shots: (w.__shots ?? []).splice(0) };
      });
      // A sample shot of each kind of moment (the first three of each), for the visual review.
      for (const kind of new Set(state.shots)) {
        const n = (seen.get(kind) ?? 0) + 1;
        seen.set(kind, n);
        if (n <= 3) {
          await page.waitForTimeout(500);
          await page.screenshot({ path: `${SHOTS}/ch${ch}-${kind.replace(':', '_')}-${n}.png` });
        }
      }
      await takeFindings(page, all);
      if (state.done) break;
    }
    const done = await page.evaluate(() => !!(window as unknown as { __done?: boolean }).__done);
    const status = await page.evaluate(() => (window as unknown as { __autopilot: { status(): unknown } }).__autopilot.status());
    console.log(`QA findings-ch${ch} ${JSON.stringify({ done, status, findings: all }, null, 1)}`);
    console.log(`ch${ch}: done=${done} findings=${all.length}`);
  });
}
