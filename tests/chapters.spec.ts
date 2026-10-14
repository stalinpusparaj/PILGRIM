import { expect, test, type Page } from '@playwright/test';
import { frames, gpuMemory, waitForMode, watchConsole } from './support';
import { openPlay, waitSim } from './play-support';
import { installDialogueSpy, readSpy, spaceUntil, waitForFlow, type DialogueSpy } from './story-support';

/**
 * Phase 3 chapters (src/world/ChapterManager.ts, src/chapters/): the test chapter on `?chapter=test`.
 * (1) Walk up to Evangelist, press E, play 'test_evangelist' by keyboard and pick the third answer: Hope moves by
 *     its +10, the camera cuts between lines, babble is spoken, the panel is in English; again in Tamil (the panel
 *     text is Tamil). Pliable follows as a companion. Clean console.
 * (2) Building and disposing the chapter 5 times through the ChapterManager keeps renderer.info.memory
 *     geometries / textures and events.count() at their baseline.
 * (3) title → START → opening → Chapter I: with no Chapter I script yet the test chapter plays in its place
 *     (ChapterManager fallback), with a clean console.
 */

interface ChapterProbe {
  key: string | null;
  chapter: number | null;
  ready: boolean;
  builds: number;
  npcs: string[];
  companions: string[];
  talking: boolean;
  cuts: number;
  triggers: number;
}

interface PlayLite {
  teleport(x: number, z: number, facing?: number): void;
  state: { hope: number; chapter: number; setHope(v: number): void; flag(key: string): unknown };
  player: { mode: string };
}

type ChapterWindow = Window & {
  __pilgrim: {
    play: PlayLite | null;
    services: { get(key: string): unknown; tryGet(key: string): unknown };
    events: { count(): number };
  };
};

async function probe(page: Page): Promise<ChapterProbe> {
  return page.evaluate(() =>
    (
      (window as unknown as ChapterWindow).__pilgrim.services.get('chapters') as { probe(): ChapterProbe }
    ).probe(),
  );
}

/** Stands Christian 3.2 m from Evangelist, walks him in with W until the Talk bubble is up, presses E. */
async function talkToEvangelist(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as ChapterWindow;
    const chapters = w.__pilgrim.services.get('chapters') as {
      context: { npc(id: string): { position: { x: number; z: number } } | null };
    };
    const at = chapters.context.npc('evangelist')!.position;
    const play = w.__pilgrim.play!;
    const fromX = at.x - 3.2;
    play.teleport(fromX, at.z, Math.atan2(at.x - fromX, 0));
  });
  await waitSim(page, 0.3);
  const focused = (): Promise<string | null> =>
    page.evaluate(
      () =>
        (
          (window as unknown as ChapterWindow).__pilgrim.services.get('interactables') as {
            focused: { id: string } | null;
          }
        ).focused?.id ?? null,
    );
  await page.keyboard.down('KeyW');
  const end = Date.now() + 8000;
  while ((await focused()) !== 'talk:evangelist' && Date.now() < end) await page.waitForTimeout(50);
  await page.keyboard.up('KeyW');
  expect(await focused()).toBe('talk:evangelist');
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => {
    const r = (window as unknown as ChapterWindow).__pilgrim.services.tryGet('dialogue') as
      { active: boolean; line: unknown } | undefined;
    return r?.active === true && r.line !== null;
  });
}

/** Plays the open conversation by keyboard, answering with key 3. */
async function answerThird(page: Page): Promise<void> {
  await spaceUntil(page, (r) => r.phase === 'choosing');
  await page.waitForTimeout(600); // the choices' arming delay
  await page.keyboard.press('Digit3');
  await spaceUntil(page, (r) => !r.active);
}

function camMoved(spy: DialogueSpy): number {
  let most = 0;
  for (let i = 1; i < spy.lines.length; i++) {
    const a = spy.lines[i - 1]!.cam;
    const b = spy.lines[i]!.cam;
    most = Math.max(most, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
  }
  return most;
}

async function hopeNow(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as ChapterWindow).__pilgrim.play!.state.hope);
}

test('?chapter=test: Evangelist conversation with choices, cuts, babble and Hope, in English and Tamil', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const problems = watchConsole(page);
  await openPlay(page);
  await waitForFlow(page, (p) => p.state === 'playing');
  const p0 = await probe(page);
  expect(p0).toMatchObject({ key: 'test', companions: ['pliable'], triggers: 1 });
  expect(p0.npcs).toEqual(expect.arrayContaining(['evangelist', 'pliable', 'obstinate', 'help']));

  for (const lang of ['en', 'ta'] as const) {
    await page.evaluate((l) => {
      const w = window as unknown as ChapterWindow;
      (w.__pilgrim.services.get('i18n') as { setLang(l: string): void }).setLang(l);
      w.__pilgrim.play!.state.setHope(50);
      delete (window as unknown as { __spy?: unknown }).__spy;
    }, lang);
    await installDialogueSpy(page);
    await talkToEvangelist(page);
    expect((await probe(page)).talking).toBe(true);
    expect(await page.evaluate(() => document.body.classList.contains('lang-ta'))).toBe(lang === 'ta');
    const panel = (await page.locator('.dlg-panel').textContent()) ?? '';
    const expected = await page.evaluate(() =>
      ((window as unknown as ChapterWindow).__pilgrim.services.get('i18n') as { t(k: string): string }).t(
        'test.evangelist.1',
      ),
    );
    if (lang === 'ta') expect(expected).toMatch(/[஀-௿]/);
    else expect(expected).toBe('Hello, friend! Why do you look so sad?');
    await expect(page.locator('.dlg-panel')).toContainText(expected.slice(0, 6));
    await page.waitForTimeout(800);
    await page.screenshot({ path: `test-results/phase3/chapter-talk-${lang}.png` });
    expect(panel.length).toBeGreaterThan(0);

    await answerThird(page);
    const spy = await readSpy(page);
    console.log(
      `${lang}: ${spy.lines.length} lines (${spy.lines.map((l) => l.node).join(' ')}), ${spy.babble.length} babble ` +
        `calls, Hope ${spy.hope.join(', ')}, largest cut ${camMoved(spy).toFixed(2)} m`,
    );
    expect(spy.chose).toEqual([2]);
    expect(spy.hope).toContain(10);
    expect(await hopeNow(page)).toBe(60);
    expect(spy.lines.map((l) => l.node)).toEqual(['n1', 'n2', 'n3', 'n4', 'n5_funny', 'n6']);
    expect(camMoved(spy)).toBeGreaterThan(0.5); // a camera cut between lines
    expect(spy.babble.length).toBeGreaterThanOrEqual(5);
    const after = await probe(page);
    expect(after.talking).toBe(false);
    expect(after.cuts).toBeGreaterThanOrEqual(3);
    // Everything is back: Christian plays again, the follow camera has the view.
    expect(await page.evaluate(() => (window as unknown as ChapterWindow).__pilgrim.play!.player.mode)).toBe(
      'play',
    );
    await waitSim(page, 0.3);
  }
  expect(
    await page.evaluate(() =>
      (window as unknown as ChapterWindow).__pilgrim.play!.state.flag('met.evangelist'),
    ),
  ).toBe(true);
  expect(problems, problems.join('\n')).toEqual([]);
});

test('building and disposing the test chapter 5 times keeps GPU memory and listeners flat', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const problems = watchConsole(page);
  await page.goto('/?chapter=test');
  await waitForMode(page);
  await frames(page, 30);
  const listeners = (): Promise<number> =>
    page.evaluate(() => (window as unknown as ChapterWindow).__pilgrim.events.count());
  const baseline = { ...(await gpuMemory(page)), events: await listeners() };
  const samples = [baseline];
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() =>
      (
        (window as unknown as ChapterWindow).__pilgrim.services.get('chapters') as {
          restart(): Promise<void>;
        }
      ).restart(),
    );
    await waitForMode(page);
    await frames(page, 30);
    samples.push({ ...(await gpuMemory(page)), events: await listeners() });
  }
  console.log(
    'per build (geometries/textures/listeners):',
    samples.map((m) => `${m.geometries}g/${m.textures}t/${m.events}e`).join(' → '),
  );
  expect((await probe(page)).builds).toBe(6);
  const last = samples.at(-1)!;
  expect(last.geometries).toBeLessThanOrEqual(baseline.geometries);
  expect(last.textures).toBeLessThanOrEqual(baseline.textures);
  expect(last.events).toBe(baseline.events);
  expect(problems, problems.join('\n')).toEqual([]);
});

test('title → START → opening → Chapter I plays the test chapter in its place (no script yet)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const problems = watchConsole(page);
  await page.goto('/');
  await waitForFlow(page, (p) => p.titleReady);
  await page.locator('[data-key="ui.title.start"]').click();
  await waitForFlow(page, (p) => p.state === 'opening');
  const end = Date.now() + 60_000;
  for (;;) {
    const p = await page.evaluate(() =>
      (
        (window as unknown as ChapterWindow).__pilgrim.services.get('flow') as { probe(): { state: string } }
      ).probe(),
    );
    if (p.state === 'playing') break;
    if (Date.now() > end) throw new Error(`the opening never handed over: ${JSON.stringify(p)}`);
    await page.keyboard.press('Space');
    await page.waitForTimeout(400);
  }
  await waitForFlow(page, (p) => p.state === 'playing' && p.chapter === 1 && !p.loopPaused);
  const p = await probe(page);
  expect(p).toMatchObject({ key: 'test', chapter: 1, ready: true });
  expect(await page.evaluate(() => (window as unknown as ChapterWindow).__pilgrim.play!.state.chapter)).toBe(
    1,
  );
  await frames(page, 30);
  expect(problems, problems.join('\n')).toEqual([]);
});
