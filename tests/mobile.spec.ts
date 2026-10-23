import { expect, test, type Page } from '@playwright/test';
import { frames, waitForMode, watchConsole } from './support';
import { waitSim } from './play-support';

/**
 * Phones (GDD 2.1: "must run well on a budget Android phone"; 2.6 touch controls; 2.15 budgets), under Playwright's
 * mobile emulation (phone viewport, touch, isMobile) at Pixel 7 and iPhone 13 sizes:
 * - every chapter loads with the touch controls, the phone quality preset (lighter scatter, <= 80 draw calls),
 *   at most 80 draw calls on screen and a clean console;
 * - Chapter XII on touch: the USE button raises the looking glass, a finger held on the screen steadies it; the
 *   badge card, the sleepy meter and the objective fit on screen without overlapping the corner icons;
 * - Chapter V: the scribe's name card fits the screen.
 * Screenshots: test-results/mobile/<phone>-*.png.
 */

const PHONES = [
  { name: 'pixel7', viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625 },
  { name: 'iphone13', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 },
] as const;
const CHAPTERS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', 'epilogue'];
const MOBILE_DRAW_CALLS = 80;

interface Win {
  __log: string[];
  __pilgrim: {
    events: { on(n: string, f: (p: unknown) => void): () => void };
    services: { tryGet(k: string): unknown; get(k: string): unknown };
    engine: { stats: { drawCalls: number; triangles: number } };
    play: {
      teleport(x: number, z: number, facing?: number): void;
      player: { mode: string };
      state: { data: { achievements: string[] }; playerName: string };
      world: { level: { triggers: Array<{ id: string; at: number[] }> }; ways: { main: { sample(t: number): { x: number; z: number } } } };
    } | null;
  };
}

async function open(page: Page, chapter: string): Promise<void> {
  await page.goto(`/?chapter=${chapter}&skipIntro=1`);
  await waitForMode(page);
  await page.waitForFunction(() => (window as unknown as Win).__pilgrim.play != null, null, { timeout: 60_000 });
  await page.evaluate(() => {
    const w = window as unknown as Win;
    w.__log = [];
    w.__pilgrim.events.on('hud:toast', (p) => w.__log.push((p as { key: string }).key));
  });
  await frames(page, 20);
}

/** Settles any conversation (first answer, skipped through). */
async function settle(page: Page): Promise<void> {
  let quiet = 0;
  for (let i = 0; i < 200 && quiet < 4; i++) {
    const busy = await page.evaluate(() => {
      const r = (window as unknown as Win).__pilgrim.services.tryGet('dialogue') as
        | { active: boolean; phase: string; choose(i: number): void; skipScene(): void }
        | undefined;
      if (!r?.active) return false;
      if (r.phase === 'choosing') r.choose(0);
      else r.skipScene();
      return true;
    });
    quiet = busy ? 0 : quiet + 1;
    await page.waitForTimeout(120);
  }
}

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

for (const phone of PHONES) {
  test.describe(`${phone.name}`, () => {
    test.use({ viewport: phone.viewport, deviceScaleFactor: phone.deviceScaleFactor, hasTouch: true, isMobile: true });

    test(`every chapter loads on a ${phone.name} with touch controls and within the mobile draw-call budget`, async ({
      page,
    }) => {
      test.setTimeout(300_000);
      const problems = watchConsole(page);
      const report: string[] = [];
      for (const ch of CHAPTERS) {
        await open(page, ch);
        const preset = await page.evaluate(
          () => ((window as unknown as Win).__pilgrim.services.get('quality') as { preset: { maxDrawCalls: number; drawDistance: number } }).preset,
        );
        expect(preset.maxDrawCalls).toBeLessThanOrEqual(MOBILE_DRAW_CALLS);
        expect(preset.drawDistance).toBeLessThanOrEqual(160);
        await expect(page.locator('.pg-touch-btn[data-id="jump"]')).toBeVisible();
        let peak = 0;
        for (let i = 0; i < 6; i++) {
          peak = Math.max(peak, await page.evaluate(() => (window as unknown as Win).__pilgrim.engine.stats.drawCalls));
          await page.waitForTimeout(250);
        }
        report.push(`${ch}:${peak}`);
        expect(peak, `chapter ${ch} draw calls`).toBeLessThanOrEqual(MOBILE_DRAW_CALLS);
        if (phone.name === 'pixel7') await page.screenshot({ path: `test-results/mobile/${phone.name}-ch${ch}.png` });
      }
      console.log(`${phone.name} draw calls ${report.join(' ')}`);
      expect(problems, problems.join('\n')).toEqual([]);
    });

    test(`Chapter XII on a ${phone.name}: touch looking glass, badge card and sleepy meter fit the screen`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      const problems = watchConsole(page);
      await open(page, '12');
      await page.evaluate(() => {
        const play = (window as unknown as Win).__pilgrim.play!;
        const t = play.world.level.triggers.find((x) => x.id === 'viewpoint_reach')!;
        play.teleport(t.at[0]!, t.at[2]! + 2, Math.PI); // facing the sign, as a player walking up to it
      });
      await waitSim(page, 1);
      await settle(page);
      await expect
        .poll(() =>
          page.evaluate(
            () => ((window as unknown as Win).__pilgrim.services.get('interactables') as { focused: { id: string } | null }).focused?.id ?? null,
          ),
        )
        .toBe('looking_glass_use');
      const use = page.locator('.pg-touch-btn[data-id="use"]');
      await expect(use).toBeVisible();
      const ub = (await use.boundingBox())!;
      await page.touchscreen.tap(ub.x + ub.width / 2, ub.y + ub.height / 2);
      await expect(page.locator('.pg-glass.is-touch')).toBeVisible();
      await page.screenshot({ path: `test-results/mobile/${phone.name}-glass.png` });
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 150, y: 300 }] });
      await expect(page.locator('.pg-glass.is-seen')).toBeVisible({ timeout: 15_000 });
      await page.screenshot({ path: `test-results/mobile/${phone.name}-glass-gate.png` });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect(page.locator('.pg-glass')).toHaveCount(0, { timeout: 15_000 });
      const card = page.locator('.pg-badge-card');
      await expect(card).toContainText('Far Sight');
      const cb = (await card.boundingBox())!;
      expect(cb.x).toBeGreaterThanOrEqual(0);
      expect(cb.x + cb.width).toBeLessThanOrEqual(phone.viewport.width);
      await page.screenshot({ path: `test-results/mobile/${phone.name}-badge.png` });

      // The sleepy meter: on screen, clear of the objective and the corner icons.
      await page.evaluate(() => {
        const w = (window as unknown as Win).__pilgrim;
        const p = w.play!.world.ways.main.sample(0.8);
        w.play!.teleport(p.x, p.z);
      });
      await waitSim(page, 1.5);
      const meter = page.locator('.pg-sleepy.is-on');
      await expect(meter).toBeVisible();
      await page.screenshot({ path: `test-results/mobile/${phone.name}-sleepy.png` });
      const mb = (await meter.boundingBox())!;
      expect(mb.x + mb.width).toBeLessThanOrEqual(phone.viewport.width);
      const objective = page.locator('.hud-objective');
      if (await objective.isVisible()) expect(overlaps(mb, (await objective.boundingBox())!)).toBe(false);
      for (const icon of await page.locator('.pg-touch-btn[data-id="satchel"], .pg-touch-btn[data-id="pause"]').all())
        if (await icon.isVisible()) expect(overlaps(mb, (await icon.boundingBox())!)).toBe(false);
      expect(problems, problems.join('\n')).toEqual([]);
    });

    test(`Chapter V on a ${phone.name}: the scribe's name card fits the screen`, async ({ page }) => {
      test.setTimeout(90_000);
      const problems = watchConsole(page);
      await open(page, '5');
      await page.evaluate(() => {
        const play = (window as unknown as Win).__pilgrim.play!;
        const t = play.world.level.triggers.find((x) => x.id === 'room5_look')!;
        play.teleport(t.at[0]!, t.at[2]!, Math.PI / 2);
      });
      await waitSim(page, 0.5);
      await settle(page);
      await page.evaluate(() =>
        ((window as unknown as Win).__pilgrim.services.get('interactables') as { get(i: string): { onUse(): void } })
          .get('room5_name')
          .onUse(),
      );
      const cardEl = page.locator('.pg-name__card');
      await expect(cardEl).toBeVisible();
      const b = (await cardEl.boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(phone.viewport.width);
      expect(b.y + b.height).toBeLessThanOrEqual(phone.viewport.height);
      await page.screenshot({ path: `test-results/mobile/${phone.name}-name.png` });
      await page.locator('.pg-name__field').fill('Asha');
      await page.locator('.pg-name__btn--ok').tap();
      await expect(page.locator('.pg-name')).toHaveCount(0);
      expect(await page.evaluate(() => (window as unknown as Win).__pilgrim.play!.state.playerName)).toBe('Asha');
      expect(problems, problems.join('\n')).toEqual([]);
    });
  });
}
