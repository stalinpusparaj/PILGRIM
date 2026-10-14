import { expect, test, type Page } from '@playwright/test';
import { frames, waitForMode, watchConsole } from './support';
import { bubbleText, logged, waitSim, type PlayHandle, type PlayWindow } from './play-support';
import { spaceUntil, waitForFlow, type RunnerHandle } from './story-support';

/**
 * CHAPTER II — THE SLOUGH OF DESPOND (src/chapters/ch02.ts, content/levels/ch02.json) played end to end by
 * script on `/?chapter=2&skipIntro=1`: Pliable follows and chatters → the bog's edge: both sink, the boot goes
 * (mud_slurp, the boot prop) → Pliable climbs out and quits (choice 1) → alone (flag, extra Hope drain) →
 * the Promise reveals the steps → Help's hand from the mud: cutscene, Christian on the bank, the steps glow →
 * waystone → the end trigger completes the chapter. Clean console, build time under 2 s. Screenshots in
 * test-results/phase4/ch02-*.png.
 */

const SHOTS = 'test-results/phase4';
/** A second copy of every screenshot outside test-results (other specs running in parallel clear that folder). */
const SHOTS_COPY =
  '/private/tmp/claude-501/-Users-stalin-Documents-pilgrim/e86d5790-d184-4784-850d-ab551edff3ee/scratchpad/shots';

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
  await page.screenshot({ path: `${SHOTS_COPY}/${name}.png` });
}

interface Probe {
  key: string | null;
  chapter: number | null;
  ready: boolean;
  npcs: string[];
  companions: string[];
  talking: boolean;
  triggers: number;
}

interface Ch02Play extends PlayHandle {
  readonly state: PlayHandle['state'] & {
    readonly objective: string | null;
    flag(key: string): unknown;
  };
  readonly slough: PlayHandle['slough'] & { isRevealed(id: string): boolean };
  readonly world: PlayHandle['world'] & {
    readonly buildMs: number;
    readonly buildWorkMs: number;
    readonly level: PlayHandle['world']['level'] & {
      readonly triggers: Array<{ id: string; at: [number, number, number] }>;
      readonly zones: Array<{ id: string; type: string; x?: number; z?: number }>;
    };
    readonly scene: { getObjectByName(n: string): unknown };
  };
}

type W = Omit<PlayWindow, '__pilgrim'> & {
  __pilgrim: Omit<PlayWindow['__pilgrim'], 'play' | 'services'> & {
    play: Ch02Play | null;
    services: {
      get(key: 'i18n'): { t(key: string): string };
      get(key: string): unknown;
      tryGet(key: string): unknown;
    };
  };
};

const LOGGED = [
  'hud:toast',
  'chapter:complete',
  'slough:steps',
  'npc:bark',
  'sfx',
  'dialogue:end',
  'cutscene:end',
  'trigger:enter',
  'promise:collected',
  'save:written',
];

async function open(page: Page): Promise<void> {
  await page.goto('/?chapter=2&skipIntro=1');
  await waitForMode(page);
  await page.waitForFunction(() => (window as unknown as W).__pilgrim.play != null);
  await page.evaluate((names) => {
    const w = window as unknown as W;
    w.__log = [];
    for (const name of names) w.__pilgrim.events.on(name, (payload) => w.__log.push({ name, payload }));
  }, LOGGED);
  await page.addStyleTag({ content: '.pg-click-to-play { display: none !important; }' });
  await frames(page, 20);
}

const probe = (page: Page): Promise<Probe> =>
  page.evaluate(() =>
    ((window as unknown as W).__pilgrim.services.get('chapters') as { probe(): Probe }).probe(),
  );

const stateOf = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as W;
    const p = w.__pilgrim.play!;
    return {
      hope: p.state.hope,
      objective: p.state.objective,
      waystone: p.state.waystone,
      mode: p.player.mode,
      depth: p.slough.depth,
      sinking: p.slough.sinking,
      pos: { x: p.player.controller.position.x, z: p.player.controller.position.z },
    };
  });

const flag = (page: Page, key: string): Promise<unknown> =>
  page.evaluate((k) => (window as unknown as W).__pilgrim.play!.state.flag(k), key);

async function waitTalk(page: Page, graphKeyPrefix: string, timeout = 15_000): Promise<void> {
  await page.waitForFunction(
    (prefix) => {
      const r = (window as unknown as W).__pilgrim.services.tryGet('dialogue') as RunnerHandle | undefined;
      return r?.active === true && r.line !== null && r.line.key.startsWith(prefix);
    },
    graphKeyPrefix,
    { timeout },
  );
}

/** Teleports Christian to (x, z) facing `facing` (default along the Way). */
async function teleport(page: Page, x: number, z: number, facing?: number): Promise<void> {
  await page.evaluate(({ x, z, facing }) => (window as unknown as W).__pilgrim.play!.teleport(x, z, facing), {
    x,
    z,
    facing,
  });
  await waitSim(page, 0.25);
}

async function triggerAt(page: Page, id: string): Promise<[number, number, number]> {
  return page.evaluate(
    (tid) => (window as unknown as W).__pilgrim.play!.world.level.triggers.find((t) => t.id === tid)!.at,
    id,
  );
}

async function focusedId(page: Page): Promise<string | null> {
  return page.evaluate(
    () =>
      ((window as unknown as W).__pilgrim.services.get('interactables') as { focused: { id: string } | null })
        .focused?.id ?? null,
  );
}

test('Chapter II: Pliable sinks and quits, alone in the bog, Help pulls Christian out, the steps glow', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const problems = watchConsole(page);
  await open(page);
  await waitForFlow(page, (p) => p.state === 'playing');

  // ---------------------------------------------------------------------------------------- the world
  const p0 = await probe(page);
  expect(p0).toMatchObject({ key: '2', chapter: 2, ready: true, companions: ['pliable'], triggers: 3 });
  expect(p0.npcs).toEqual(expect.arrayContaining(['pliable', 'help']));
  const build = await page.evaluate(() => {
    const w = (window as unknown as W).__pilgrim.play!.world;
    return { ms: w.buildMs, work: w.buildWorkMs };
  });
  console.log(`ch02 build: ${build.ms.toFixed(0)} ms wall, ${build.work.toFixed(0)} ms work`);
  expect(build.work).toBeLessThan(2000);

  // ------------------------------------------------------------------------ Pliable chatters (start talk)
  await waitTalk(page, 'ch02.pliable.start');
  expect((await stateOf(page)).objective).toBe('ch02.objective.followWay');
  await expect(page.locator('.dlg-panel')).toContainText('Golden streets');
  await shot(page, 'ch02-01-start-talk');
  await spaceUntil(page, (r) => !r.active);
  expect((await stateOf(page)).mode).toBe('play');
  // A timed chatter bubble follows (9 s in).
  await waitSim(page, 9.5);
  const barks = (await logged(page, 'npc:bark')) as Array<{ id: string; key: string }>;
  expect(barks.map((b) => b.key)).toContain('ch02.bark.pliable.chat.1');
  await frames(page, 2);
  await shot(page, 'ch02-02-with-pliable');

  // ------------------------------------------------------------------- the bog: both sink, the boot goes
  const enter = await triggerAt(page, 'bog_enter');
  const facing = await page.evaluate(() => {
    const w = (window as unknown as W).__pilgrim.play!.world;
    const z = w.level.zones.find((zone) => zone.type === 'slough')!;
    const p = w.level.triggers.find((t) => t.id === 'bog_enter')!.at;
    return Math.atan2(z.x! - p[0], z.z! - p[2]);
  });
  await teleport(page, enter[0], enter[2], facing);
  await waitTalk(page, 'ch02.pliable.sink');
  expect(((await logged(page, 'trigger:enter')) as Array<{ id: string }>).map((t) => t.id)).toContain(
    'bog_enter',
  );
  await waitSim(page, 0.4);
  await shot(page, 'ch02-03-sinking');
  await spaceUntil(page, (r) => !r.active);
  expect(await flag(page, 'ch02.boot')).toBe(true);
  const sfx = (await logged(page, 'sfx')) as Array<{ id: string }>;
  expect(sfx.map((s) => s.id)).toContain('mud_slurp');
  expect(
    await page.evaluate(() =>
      (window as unknown as W).__pilgrim.play!.world.scene.getObjectByName('ch02:boot'),
    ),
  ).toBeTruthy();
  await frames(page, 6);
  await shot(page, 'ch02-04-boot');

  // ---------------------------------------------------- Pliable on the home bank quits; ask him to stay
  await waitTalk(page, 'ch02.pliable.quits', 20_000);
  await spaceUntil(page, (r) => r.phase === 'choosing');
  await page.waitForTimeout(600);
  await shot(page, 'ch02-05-quits-choice');
  await page.keyboard.press('Digit1');
  await spaceUntil(page, (r) => !r.active);
  expect(await flag(page, 'ch02.askedStay')).toBe(true);
  await expect.poll(() => flag(page, 'ch02.pliableGone')).toBe(true);
  expect(await flag(page, 'alone')).toBe(true);
  expect((await probe(page)).companions).toEqual([]);
  expect((await stateOf(page)).objective).toBe('ui.hud.objective.findSteps');

  // ------------------------------------------------------- alone: the lantern dims faster in the mud
  await page.evaluate(() => (window as unknown as W).__pilgrim.play!.state.setHope(80));
  await page.keyboard.down('KeyW');
  await waitSim(page, 1.6);
  await page.keyboard.up('KeyW');
  const s1 = await stateOf(page);
  expect(s1.sinking).toBe(true);
  expect(s1.depth).toBeGreaterThan(0.05);
  expect(s1.hope).toBeLessThan(80);
  await shot(page, 'ch02-06-alone');

  // -------------------------------------------------- the Promise (p03) in the bog reveals the steps
  const promiseAt = await page.evaluate(
    () => (window as unknown as W).__pilgrim.play!.world.level.promises.find((p) => p.id === 'p03')!.at,
  );
  await teleport(page, promiseAt[0] - 0.9, promiseAt[2], Math.PI / 2);
  await page.keyboard.down('KeyW');
  await expect
    .poll(() => page.evaluate(() => (window as unknown as W).__pilgrim.play!.state.hasPromise('p03')), {
      timeout: 8000,
    })
    .toBe(true);
  await page.keyboard.up('KeyW');
  const toasts = (await logged(page, 'hud:toast')) as Array<{ key: string }>;
  expect(toasts.map((t) => t.key)).toContain('ui.toast.promise');
  const stepsBefore = ((await logged(page, 'slough:steps')) as Array<{ id: string }>).length;
  console.log(`steps revealed before Help: ${stepsBefore}`);

  // ------------------------------------------------- Help: [E] Take his hand from the mud, the cutscene
  const help = await page.evaluate(() => {
    const w = window as unknown as W;
    const chapters = w.__pilgrim.services.get('chapters') as {
      context: { npc(id: string): { position: { x: number; z: number } } | null };
    };
    const at = chapters.context.npc('help')!.position;
    const z = w.__pilgrim.play!.world.level.zones.find((zone) => zone.type === 'slough')!;
    const dx = z.x! - at.x;
    const dz = z.z! - at.z;
    const len = Math.hypot(dx, dz) || 1;
    // 2.6 m from Help, on the bog side of him, facing him.
    return { x: at.x + (dx / len) * 2.6, z: at.z + (dz / len) * 2.6, facing: Math.atan2(-dx, -dz) };
  });
  await page.evaluate(() => (window as unknown as W).__pilgrim.play!.state.setHope(50));
  await teleport(page, help.x, help.z, help.facing);
  await expect.poll(() => focusedId(page), { timeout: 5000 }).toBe('take_hand');
  const verb = await page.evaluate(() =>
    (window as unknown as W).__pilgrim.services.get('i18n').t('ui.verb.takeHand'),
  );
  await expect.poll(() => bubbleText(page)).toContain(verb);
  await shot(page, 'ch02-07-take-hand');
  await page.keyboard.press('KeyE');
  await expect.poll(() => stateOf(page).then((s) => s.mode), { timeout: 5000 }).toBe('cutscene');
  await waitSim(page, 5.2);
  await shot(page, 'ch02-08-steps-glow');
  await expect.poll(() => logged(page, 'cutscene:end'), { timeout: 20_000 }).toHaveLength(1);
  const steps = (await logged(page, 'slough:steps')) as Array<{ id: string }>;
  expect(steps.map((s) => s.id)).toContain('bog_steps');
  expect(
    await page.evaluate(() => (window as unknown as W).__pilgrim.play!.slough.isRevealed('bog_steps')),
  ).toBe(true);
  // Pulled up onto the bank: out of the mud, next to the 'help_bank' spot.
  const bank = await page.evaluate(
    () =>
      (window as unknown as W).__pilgrim.play!.world.level.landmarks.find((l) => l.id === 'help_bank')!.at!,
  );
  const s2 = await stateOf(page);
  expect(Math.hypot(s2.pos.x - bank[0], s2.pos.z - bank[2])).toBeLessThan(1.5);
  expect(s2.sinking).toBe(false);
  const hopeAfterPull = s2.hope;
  await waitTalk(page, 'ch02.help');
  await shot(page, 'ch02-09-help-talk');
  await spaceUntil(page, (r) => !r.active);
  expect(await flag(page, 'ch02.handTaken')).toBe(true);
  expect(await flag(page, 'ch02.helped')).toBe(true);
  const s3 = await stateOf(page);
  // +20 from Help's talk on top of what the mud left (the drain stops on the bank).
  expect(s3.hope).toBeGreaterThanOrEqual(hopeAfterPull + 19);
  expect(s3.hope).toBeLessThanOrEqual(hopeAfterPull + 21);
  expect(s3.objective).toBe('ch02.objective.goOn');
  expect(s3.mode).toBe('play');

  // ------------------------------------------------------------------------- the waystone before the end
  const w2 = await page.evaluate(
    () => (window as unknown as W).__pilgrim.play!.world.level.waystones.find((w) => w.id === 'ch02_w2')!.at,
  );
  await page.evaluate(
    ({ x, z }) => {
      const play = (window as unknown as W).__pilgrim.play!;
      const c = play.world.ways.main.closest(x, z).point;
      const dx = x - c.x;
      const dz = z - c.z;
      const len = Math.hypot(dx, dz) || 1;
      play.teleport(x - (dx / len) * 1.6, z - (dz / len) * 1.6, Math.atan2(dx, dz));
    },
    { x: w2[0], z: w2[2] },
  );
  await waitSim(page, 0.4);
  await expect.poll(() => focusedId(page), { timeout: 5000 }).toBe('ch02_w2');
  await page.keyboard.press('KeyE');
  await expect.poll(() => logged(page, 'save:written'), { timeout: 5000 }).toContainEqual({ slot: 'auto' });
  expect((await stateOf(page)).waystone).toBe('ch02_w2');

  // ------------------------------------------------------------------------------------- the ending
  const end = await triggerAt(page, 'bog_end');
  await teleport(page, end[0], end[2]);
  await waitTalk(page, 'ch02.christian.end');
  await shot(page, 'ch02-10-end');
  // The flow moves on (and disposes this chapter) the moment the chapter completes: press Space until it does.
  const until = Date.now() + 20_000;
  while (((await logged(page, 'chapter:complete')) as unknown[]).length === 0) {
    if (Date.now() > until) throw new Error('the chapter never completed');
    await page.keyboard.press('Space');
    await page.waitForTimeout(220);
  }
  expect(await logged(page, 'chapter:complete')).toContainEqual({ chapter: 2 });
  // Reading the last waystone prefetches Chapter III's content; what that content logs is not this chapter's.
  const ours = problems.filter((p) => !p.includes('ch03'));
  expect(ours, ours.join('\n')).toEqual([]);
});
