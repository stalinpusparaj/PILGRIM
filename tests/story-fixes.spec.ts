import { expect, test, type Page } from '@playwright/test';
import { waitForMode, watchConsole } from './support';
import {
  PAD,
  flowProbe,
  installFakePad,
  padTap,
  playSample,
  runnerState,
  spaceUntil,
  waitForFlow,
} from './story-support';

/**
 * Phase 3 review fixes (story and UI behaviour):
 * - a hidden tab under an open Satchel leaves no pause menu behind it (and still pauses without the Satchel);
 * - touch players can pause with GameFlow's own icon while the touch controls are hidden;
 * - a conversation over a chapter: pausing keeps the music ducked and the focus on the choices; Tab moves the
 *   choice highlight and Enter picks the highlighted one; Enter remapped to Skip reveals a line without leaving it;
 * - the dialogue skip button skips at once for a screen reader's activation; bubble lines are announced once;
 * - a cutscene and a conversation that overlap hand gameplay input back only when both are over; captions use
 *   the shared Text speed table;
 * - the opening goes back to the title with Escape and pad B; the Epilogue ends on the sequel card.
 */

/** Page-side helpers installed before every page load (services by key, module loading by path). */
interface FixWindow {
  __svc<T>(key: string): T;
  __load<T>(path: string): Promise<T>;
  __chose?: number[];
  __pilgrim: { engine: unknown; events: { emit(name: string, payload?: unknown): void } };
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as FixWindow & { __pilgrim: { services: { get(k: string): unknown } } };
    w.__svc = <T>(key: string): T => w.__pilgrim.services.get(key) as T;
    w.__load = <T>(path: string): Promise<T> => import(/* @vite-ignore */ path) as Promise<T>;
  });
});

/** Pretends the tab was hidden (or shown again): what the browser does when the player switches tabs. */
async function setHidden(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate((h) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (h ? 'hidden' : 'visible'),
    });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

/** A DialogueRunner + DialoguePanel over the running chapter, playing `test_evangelist` (no actors). */
async function startTalk(page: Page, panelOpts: Record<string, unknown> = {}): Promise<void> {
  await page.evaluate(async (opts) => {
    const w = window as unknown as FixWindow & {
      __pilgrim: { events: { on(n: string, fn: (p: unknown) => void): void } };
    };
    const D = await w.__load<{ DialogueRunner: new (host: unknown) => { play(id: string): void } }>(
      '/src/narrative/Dialogue.ts',
    );
    const P = await w.__load<{ DialoguePanel: new (r: unknown, o: unknown) => unknown }>(
      '/src/ui/DialoguePanel.ts',
    );
    const runner = new D.DialogueRunner({ actor: () => null });
    new P.DialoguePanel(runner, opts);
    const chose: number[] = [];
    w.__chose = chose;
    w.__pilgrim.events.on('dialogue:chose', (e) => chose.push((e as { index: number }).index));
    void runner.play('test_evangelist');
  }, panelOpts);
  await page.waitForFunction(() => {
    const r = (window as unknown as FixWindow).__svc<{ active: boolean; line: unknown }>('dialogue');
    return r.active && r.line !== null;
  });
}

async function gameplayOn(page: Page): Promise<boolean> {
  return page.evaluate(() => (window as unknown as FixWindow).__svc<{ gameplay: boolean }>('input').gameplay);
}

test('?chapter=test: a hidden tab under the Satchel leaves no pause menu behind it', async ({ page }) => {
  test.setTimeout(90_000);
  const problems = watchConsole(page);
  await page.goto('/?chapter=test');
  await waitForMode(page);
  await waitForFlow(page, (p) => p.state === 'playing');

  await page.keyboard.press('Tab');
  await waitForFlow(page, (p) => p.screen === 'satchel' && p.loopPaused);
  await setHidden(page, true);
  await page.waitForTimeout(150);
  expect(await flowProbe(page)).toMatchObject({ state: 'playing', screen: 'satchel', loopPaused: true });
  await expect(page.locator('.pg-pause')).toHaveCount(0);
  await setHidden(page, false);
  await page.waitForTimeout(150);
  expect(await flowProbe(page)).toMatchObject({ state: 'playing', screen: 'satchel', loopPaused: true });
  await page.locator('.pg-satchel__close').click();
  await waitForFlow(page, (p) => p.state === 'playing' && p.screen === 'none' && !p.loopPaused);

  // Without the Satchel a hidden tab still opens the pause menu and keeps the game paused (GDD 2.15).
  await setHidden(page, true);
  await waitForFlow(page, (p) => p.state === 'paused' && p.screen === 'pause');
  await setHidden(page, false);
  await page.waitForTimeout(150);
  expect(await flowProbe(page)).toMatchObject({ state: 'paused', screen: 'pause', loopPaused: true });
  expect(problems, problems.join('\n')).toEqual([]);
});

test.describe('touch', () => {
  test.use({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });

  test('the flow pause icon stands in for the hidden touch controls (fly-through, conversation)', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const problems = watchConsole(page);
    await page.goto('/?chapter=test');
    await waitForMode(page);
    await waitForFlow(page, (p) => p.state === 'playing');
    const icon = page.locator('.pg-flow-pause');
    await expect(icon).toBeVisible(); // the test world is a fly-through: no touch controls
    await expect(icon).toHaveAttribute('aria-label', 'Pause');
    await icon.tap();
    await waitForFlow(page, (p) => p.state === 'paused' && p.screen === 'pause');
    await expect(icon).toBeHidden();
    await page.locator('[data-key="ui.pause.resume"]').tap();
    await waitForFlow(page, (p) => p.state === 'playing' && !p.loopPaused);
    await expect(icon).toBeVisible();

    // A conversation covers the screen: the icon stays above it, clear of the skip ring, and still pauses.
    await startTalk(page);
    await expect(page.locator('.dlg-layer')).toBeVisible();
    const a = await icon.boundingBox();
    const b = await page.locator('.dlg-skip').boundingBox();
    const apart = (p: { x: number; y: number; width: number; height: number } | null, q: typeof p): boolean =>
      !!p &&
      !!q &&
      (p.x + p.width <= q.x || q.x + q.width <= p.x || p.y + p.height <= q.y || q.y + q.height <= p.y);
    expect(apart(a, b)).toBe(true);
    expect(apart(a, await page.locator('.dlg-panel').boundingBox())).toBe(true);
    const before = (await runnerState(page)).line?.node;
    await icon.tap();
    await waitForFlow(page, (p) => p.state === 'paused' && p.screen === 'pause');
    expect((await runnerState(page)).line?.node).toBe(before); // the tap did not move the talk on
    await page.locator('[data-key="ui.pause.resume"]').tap();
    await waitForFlow(page, (p) => p.state === 'playing');
    await expect(icon).toBeVisible();
    expect(problems, problems.join('\n')).toEqual([]);
  });
});

test('a conversation over a chapter: pause keeps the duck and the focus; Tab + Enter pick the highlighted choice', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const problems = watchConsole(page);
  await page.goto('/?chapter=test');
  await waitForMode(page);
  await waitForFlow(page, (p) => p.state === 'playing');
  await startTalk(page, { restoreGameplay: false });
  const ducked = (): Promise<boolean> =>
    page.evaluate(
      () => (window as unknown as FixWindow).__svc<{ flags: { ducked: boolean } }>('audio').flags.ducked,
    );
  expect(await ducked()).toBe(true);
  await spaceUntil(page, (r) => r.phase === 'choosing');
  await page.waitForTimeout(600); // past the choices' arming delay

  // Esc (pause), Esc (keep going): the music stays ducked and the focus is back in the conversation.
  await page.keyboard.press('Escape');
  await waitForFlow(page, (p) => p.screen === 'pause');
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await waitForFlow(page, (p) => p.state === 'playing' && p.screen === 'none');
  expect(await ducked()).toBe(true);
  expect(await page.evaluate(() => !!document.activeElement?.closest('.dlg-layer'))).toBe(true);

  // Tab twice: the highlight and the focus are on the third choice; Enter picks exactly that one.
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  const focus = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('.dlg-choice')];
    return {
      highlighted: buttons.findIndex((b) => b.classList.contains('is-focused')),
      focused: buttons.indexOf(document.activeElement as Element),
    };
  });
  expect(focus).toEqual({ highlighted: 2, focused: 2 });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => ((window as unknown as FixWindow).__chose ?? []).length > 0);
  expect(await page.evaluate(() => (window as unknown as FixWindow).__chose)).toEqual([2]);

  // Enter remapped to Skip: one press reveals the typing line and leaves it on screen.
  await page.waitForFunction(
    () => (window as unknown as FixWindow).__svc<{ phase: string }>('dialogue').phase === 'typing',
  );
  await page.evaluate(() =>
    (window as unknown as FixWindow)
      .__svc<{ rebind(a: string, code: string, slot: number): boolean }>('input')
      .rebind('skip', 'Enter', 0),
  );
  const node = (await runnerState(page)).line?.node;
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  expect(await runnerState(page)).toMatchObject({ phase: 'shown', line: { node } });
  await page.evaluate(() =>
    (window as unknown as FixWindow).__svc<{ resetBindings(): void }>('input').resetBindings(),
  );
  await spaceUntil(page, (r) => !r.active);
  expect(await ducked()).toBe(false);
  expect(problems, problems.join('\n')).toEqual([]);
});

test('?dialogue=test: the skip button skips at once without a hold; each line is announced once', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const problems = watchConsole(page);
  await page.goto('/?dialogue=test');
  await waitForMode(page);
  await playSample(page);
  // Tab reaches the skip button; Space on it is still a plain press (the line), never a scene skip.
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.classList.contains('dlg-skip'))).toBe(true);
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  expect((await runnerState(page)).line?.node).toBe('n1');
  // A screen reader's activation is a click with no pointer behind it: the scene skips to the question.
  await page.evaluate(() => (document.querySelector('.dlg-skip') as HTMLButtonElement).click());
  await page.waitForFunction(
    () => (window as unknown as FixWindow).__svc<{ phase: string }>('dialogue').phase === 'choosing',
  );
  expect((await runnerState(page)).line?.node).toBe('n4');
  await page.waitForTimeout(600);
  await page.keyboard.press('Digit1');
  await spaceUntil(page, (r) => r.line?.bubble === true && r.phase === 'shown');
  const said = await page.evaluate(() => ({
    panel: document.querySelector('.dlg-layer > .sr-only')?.textContent ?? '',
    bubble: [...document.querySelectorAll('.dlg-bubbles .sr-only')].map((el) => el.textContent),
  }));
  expect(said.panel).toBe('Christian: Here I go!');
  expect(said.bubble).toEqual([]); // the bubble stays silent: no second announcement
  await spaceUntil(page, (r) => !r.active);
  expect(problems, problems.join('\n')).toEqual([]);
});

test('?chapter=test: overlapping cutscene and conversation give input back only when both are over', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const problems = watchConsole(page);
  await page.goto('/?chapter=test');
  await waitForMode(page);
  await waitForFlow(page, (p) => p.state === 'playing');
  await page.evaluate(async () => {
    const w = window as unknown as FixWindow & { __pilgrim: { services: { tryGet(k: string): unknown } } };
    const C = await w.__load<{ CutscenePlayer: new (engine: unknown) => unknown }>(
      '/src/narrative/Cutscene.ts',
    );
    if (!w.__pilgrim.services.tryGet('cutscene')) new C.CutscenePlayer(w.__pilgrim.engine);
  });
  const playScene = (seconds: number): Promise<void> =>
    page.evaluate((s) => {
      const cutscenes = (window as unknown as FixWindow).__svc<{ play(def: unknown): Promise<unknown> }>(
        'cutscene',
      );
      void cutscenes.play({ id: `overlap_${s}`, duration: s });
    }, seconds);
  const sceneOver = (): Promise<unknown> =>
    page.waitForFunction(
      () => !(window as unknown as FixWindow).__svc<{ playing: boolean }>('cutscene').playing,
    );
  const stopTalk = (): Promise<void> =>
    page.evaluate(() => (window as unknown as FixWindow).__svc<{ stop(): void }>('dialogue').stop());

  // 1) A cutscene ends while the conversation is still up: input stays off until the talk ends.
  await startTalk(page, { restoreGameplay: true });
  await playScene(0.4);
  await sceneOver();
  expect(await gameplayOn(page)).toBe(false);
  await stopTalk();
  expect(await gameplayOn(page)).toBe(true);

  // 2) A conversation ends inside a cutscene: input stays off until the cutscene ends.
  await playScene(1.5);
  await page.evaluate(() => {
    void (window as unknown as FixWindow)
      .__svc<{ play(id: string): Promise<void> }>('dialogue')
      .play('test_evangelist');
  });
  await page.waitForFunction(
    () => (window as unknown as FixWindow).__svc<{ active: boolean }>('dialogue').active,
  );
  await stopTalk();
  expect(await gameplayOn(page)).toBe(false);
  await sceneOver();
  expect(await gameplayOn(page)).toBe(true);
  await page.evaluate(() =>
    (window as unknown as FixWindow)
      .__svc<{ setGameplayActive(on: boolean): void }>('input')
      .setGameplayActive(false),
  );

  // Captions read the one Text speed table: Slow is 20 characters per second there too.
  const caption = await page.evaluate(async () => {
    const w = window as unknown as FixWindow;
    const { Captions } = await w.__load<{
      Captions: new (host: HTMLElement) => { say(a: null, k: string, o: object): void; dispose(): void };
    }>('/src/narrative/cutscene-caption.ts');
    const { revealTimes } = await w.__load<{ revealTimes(text: string, cps: number): { end: number } }>(
      '/src/audio/babblePlan.ts',
    );
    w.__svc<{ set(k: string, v: string): void }>('settings').set('textSpeed', 'slow');
    const captions = new Captions(document.createElement('div'));
    captions.say(null, 'ui.end.awoke', {});
    const end = (captions as unknown as { line: { revealEnd: number } }).line.revealEnd;
    captions.dispose();
    const text = w.__svc<{ t(k: string): string }>('i18n').t('ui.end.awoke');
    return { end, slow: revealTimes(text, 20).end };
  });
  expect(caption.end).toBeCloseTo(caption.slow, 5);
  expect(problems, problems.join('\n')).toEqual([]);
});

test('the opening backs out to the title (Escape, pad B); the Epilogue ends on the sequel card', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const problems = watchConsole(page);
  await installFakePad(page);
  await page.goto('/');
  await waitForFlow(page, (p) => p.titleReady);
  await page.locator('[data-key="ui.title.start"]').click();
  await waitForFlow(page, (p) => p.state === 'opening');
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  await waitForFlow(page, (p) => p.state === 'title' && p.screen === 'title');
  await page.locator('[data-key="ui.title.start"]').click();
  await waitForFlow(page, (p) => p.state === 'opening');
  await page.waitForTimeout(400);
  await padTap(page, PAD.B);
  await waitForFlow(page, (p) => p.state === 'title' && p.screen === 'title');

  // The Epilogue's end: "CHRISTIANA'S JOURNEY - coming soon" as a title card, then the credits (GDD 2.10).
  await page.evaluate(() => {
    void (window as unknown as FixWindow)
      .__svc<{ startChapter(n: number): Promise<void> }>('flow')
      .startChapter(14);
  });
  await waitForFlow(page, (p) => p.state === 'playing' && p.chapter === 14);
  await page.evaluate(() =>
    (window as unknown as FixWindow).__pilgrim.events.emit('chapter:complete', { chapter: 14 }),
  );
  await waitForFlow(page, (p) => p.screen === 'sequelCard');
  await expect(page.locator('.pg-end__title')).toHaveText("CHRISTIANA'S JOURNEY");
  await expect(page.locator('.pg-end__line')).toHaveText('coming soon');
  await page.locator('.pg-end__card').click();
  await waitForFlow(page, (p) => p.screen === 'credits');
  await expect(page.locator('.pg-credits')).not.toContainText("CHRISTIANA'S JOURNEY");
  expect(problems, problems.join('\n')).toEqual([]);
});
