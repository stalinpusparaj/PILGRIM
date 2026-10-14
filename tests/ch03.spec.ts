import { expect, test, type Page } from '@playwright/test';
import { frames, waitForMode, watchConsole } from './support';
import { bubbleText, logged, waitSim, type PlayHandle, type PlayWindow } from './play-support';
import { spaceUntil, type RunnerHandle } from './story-support';

/**
 * CHAPTER III — THE WRONG HILL (src/chapters/ch03.ts, content/levels/ch03.json) played end to end by script on
 * `/?chapter=3&skipIntro=1`: the Wiseman talk (his hat flies off: the laugh) → the detour trigger ("You left the
 * Way", objective "Go to the village") → the village slides away as Christian nears it → under the mountain
 * (light dims, Burden grows twice) → Evangelist appears behind him, talks (choice 1) and leads back → rejoining
 * the Way restores Hope ("Back on the Way") → a waystone → the end trigger completes the chapter. Clean console,
 * build time under 2 s. Screenshots in test-results/phase4/ch03-*.png.
 */

const SHOTS = 'test-results/phase4';
interface Probe {
  key: string | null;
  chapter: number | null;
  ready: boolean;
  npcs: string[];
  talking: boolean;
  triggers: number;
}

interface V3 {
  x: number;
  y: number;
  z: number;
}

interface Ch03Play extends PlayHandle {
  readonly state: PlayHandle['state'] & { readonly objective: string | null; flag(key: string): unknown };
  readonly world: PlayHandle['world'] & {
    readonly buildMs: number;
    readonly sun: { intensity: number };
    readonly level: PlayHandle['world']['level'] & {
      readonly triggers: Array<{ id: string; at: [number, number, number] }>;
      readonly detours: Array<{ id: string; points: Array<[number, number, number]> }>;
    };
    readonly scene: { getObjectByName(n: string): { position: V3 } | undefined };
  };
}

type W = Omit<PlayWindow, '__pilgrim'> & {
  __pilgrim: Omit<PlayWindow['__pilgrim'], 'play' | 'services'> & {
    play: Ch03Play | null;
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
  'detour:entered',
  'burden:grew',
  'trigger:enter',
  'dialogue:end',
  'cutscene:end',
  'save:written',
  'npc:bark',
];

async function open(page: Page): Promise<void> {
  await page.goto('/?chapter=3&skipIntro=1');
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
    const p = (window as unknown as W).__pilgrim.play!;
    return {
      hope: p.state.hope,
      objective: p.state.objective,
      mode: p.player.mode,
      burden: p.player.character.burdenSize,
      sun: p.world.sun.intensity,
    };
  });

const flag = (page: Page, key: string): Promise<unknown> =>
  page.evaluate((k) => (window as unknown as W).__pilgrim.play!.state.flag(k), key);

const t = (page: Page, key: string): Promise<string> =>
  page.evaluate((k) => (window as unknown as W).__pilgrim.services.get('i18n').t(k), key);

/** Stands Christian on a level trigger (its centre), facing `facing` (yaw, 0 = +Z; default +X). */
async function toTrigger(page: Page, id: string, facing = Math.PI / 2): Promise<void> {
  await page.evaluate(
    ({ tid, yaw }) => {
      const play = (window as unknown as W).__pilgrim.play!;
      const tr = play.world.level.triggers.find((x) => x.id === tid);
      if (!tr) throw new Error(`no trigger ${tid}`);
      play.teleport(tr.at[0], tr.at[2], yaw);
    },
    { tid: id, yaw: facing },
  );
  await waitSim(page, 0.4);
}

async function waitTrigger(page: Page, id: string): Promise<void> {
  await expect
    .poll(() => logged(page, 'trigger:enter'), { timeout: 8000 })
    .toContainEqual(expect.objectContaining({ id }));
}

const toastKeys = async (page: Page): Promise<string[]> =>
  ((await logged(page, 'hud:toast')) as Array<{ key: string }>).map((x) => x.key);

async function waitTalk(page: Page, prefix: string, timeout = 20_000): Promise<void> {
  await page.waitForFunction(
    (pre) => {
      const r = (window as unknown as W).__pilgrim.services.tryGet('dialogue') as RunnerHandle | undefined;
      return r?.active === true && r.line !== null && r.line.key.startsWith(pre);
    },
    prefix,
    { timeout },
  );
}

/** Stands 3.2 m from the NPC, walks in with W until its Talk bubble is up, presses E. */
async function talkTo(page: Page, npcId: string): Promise<void> {
  await page.evaluate((id) => {
    const w = window as unknown as W;
    const chapters = w.__pilgrim.services.get('chapters') as {
      context: { npc(id: string): { position: V3 } | null };
    };
    const at = chapters.context.npc(id)!.position;
    const fromX = at.x - 3.2;
    w.__pilgrim.play!.teleport(fromX, at.z, Math.atan2(at.x - fromX, 0));
  }, npcId);
  await waitSim(page, 0.3);
  const focused = (): Promise<string | null> =>
    page.evaluate(
      () =>
        ((window as unknown as W).__pilgrim.services.get('interactables') as { focused: { id: string } | null })
          .focused?.id ?? null,
    );
  await page.keyboard.down('KeyW');
  const end = Date.now() + 8000;
  while ((await focused()) !== `talk:${npcId}` && Date.now() < end) await page.waitForTimeout(50);
  await page.keyboard.up('KeyW');
  expect(await focused()).toBe(`talk:${npcId}`);
  await page.keyboard.press('KeyE');
}

async function choose(page: Page, digit: number): Promise<void> {
  await spaceUntil(page, (r) => r.phase === 'choosing');
  await page.waitForTimeout(600); // the choices' arming delay
  await page.keyboard.press(`Digit${digit}`);
}

test('Chapter III plays end to end: Wiseman, the sunny detour, the mountain, Evangelist leads back, the end', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const problems = watchConsole(page);
  await open(page);

  // ---- the world
  const p0 = await probe(page);
  expect(p0).toMatchObject({ key: '3', chapter: 3, ready: true });
  expect(p0.npcs).toEqual(expect.arrayContaining(['wiseman', 'evangelist']));
  const buildMs = await page.evaluate(() => (window as unknown as W).__pilgrim.play!.world.buildMs);
  console.log(`ch03 build ${buildMs.toFixed(0)} ms`);
  expect(buildMs).toBeLessThan(2000);
  expect(await t(page, 'ch03.wiseman.1')).toMatch(/^Good day/);
  const s0 = await stateOf(page);
  expect(s0.objective).toBe('ch03.objective.followWay');
  expect(await flag(page, 'ch03.phase')).toBe('start');
  await page.screenshot({ path: `${SHOTS}/ch03-start.png` });

  // ---- the detour is story-mandatory: the Way's end and the side road do nothing before the Wiseman talk
  await toTrigger(page, 'ch03_end');
  await waitTrigger(page, 'ch03_end');
  await waitSim(page, 1.5);
  expect(await logged(page, 'chapter:complete')).toEqual([]);
  expect((await stateOf(page)).objective).toBe('ch03.objective.talkWiseman');
  expect(await flag(page, 'ch03.phase')).toBe('start');
  await toTrigger(page, 'ch03_detour_start');
  await waitTrigger(page, 'ch03_detour_start');
  await waitSim(page, 1);
  expect(await logged(page, 'detour:entered')).toEqual([]);
  expect(await flag(page, 'ch03.phase')).toBe('start');

  // ---- Mr. Worldly Wiseman at the fork: the talk, the hat, the funny answer
  await toTrigger(page, 'ch03_fork_near');
  await waitTrigger(page, 'ch03_fork_near');
  await talkTo(page, 'wiseman');
  await waitTalk(page, 'ch03.wiseman');
  expect((await probe(page)).talking).toBe(true);
  await waitSim(page, 3.0); // the first gust takes his hat at 2.4 s
  await page.screenshot({ path: `${SHOTS}/ch03-wiseman-hat.png` });
  await spaceUntil(page, (r) => r.phase === 'choosing');
  await waitSim(page, 1.6); // the hat lands and he pats it
  expect(Number(await flag(page, 'ch03.hatFlights'))).toBeGreaterThanOrEqual(1);
  await page.screenshot({ path: `${SHOTS}/ch03-wiseman-choices.png` });
  await page.evaluate(() => (window as unknown as W).__pilgrim.play!.state.setHope(50)); // room for the +5
  const hopeBefore = (await stateOf(page)).hope;
  await choose(page, 3);
  await spaceUntil(page, (r) => !r.active);
  expect(await flag(page, 'ch03.answer')).toBe('funny');
  expect(await flag(page, 'ch03.wisemanTold')).toBe(true);
  expect((await stateOf(page)).hope).toBe(hopeBefore + 5);
  await waitSim(page, 0.3);
  const s1 = await stateOf(page);
  expect(s1.mode).toBe('play');
  expect(s1.objective).toBe('ch03.objective.goToVillage');

  // ---- the detour: "You left the Way"
  await toTrigger(page, 'ch03_detour_start');
  await waitTrigger(page, 'ch03_detour_start');
  await expect.poll(() => logged(page, 'detour:entered')).toContainEqual({ id: 'wrong_hill' });
  expect(await toastKeys(page)).toContain('ui.toast.leftWay');
  expect(await flag(page, 'ch03.phase')).toBe('detour');
  await page.screenshot({ path: `${SHOTS}/ch03-sunny-road.png` });

  // ---- the village never gets closer: walk toward it and it slides up the road
  const doorAt = (): Promise<V3> =>
    page.evaluate(() => {
      const d = (window as unknown as W).__pilgrim.play!.world.scene.getObjectByName('ch03:village_door')!;
      return { x: d.position.x, y: d.position.y, z: d.position.z };
    });
  const door0 = await doorAt();
  await page.evaluate(() => {
    const play = (window as unknown as W).__pilgrim.play!;
    const tr = play.world.level.triggers.find((x) => x.id === 'village_door')!;
    const road = play.world.level.detours.find((d) => d.id === 'wrong_hill')!;
    const before = road.points[3]!; // the road point just before the village's first spot
    const dx = tr.at[0] - before[0];
    const dz = tr.at[2] - before[2];
    play.teleport(before[0], before[2], Math.atan2(dx, dz));
  });
  await waitSim(page, 2.5);
  const door1 = await doorAt();
  const slid = Math.hypot(door1.x - door0.x, door1.z - door0.z);
  console.log(`village slid ${slid.toFixed(1)} m`);
  expect(slid).toBeGreaterThan(3);
  expect(door1.z).toBeGreaterThan(door0.z);
  await page.screenshot({ path: `${SHOTS}/ch03-village-slides.png` });

  // ---- under the mountain: dark, flickers, the Burden grows
  const sunBefore = s1.sun;
  const burdenBefore = s1.burden;
  await toTrigger(page, 'ch03_under_mountain', 0); // facing the mountain (+Z)
  await waitTrigger(page, 'ch03_under_mountain');
  await expect.poll(() => logged(page, 'burden:grew')).toHaveLength(1);
  expect(await flag(page, 'ch03.phase')).toBe('mountain');
  await waitSim(page, 3);
  const s2 = await stateOf(page);
  expect(s2.sun).toBeLessThan(sunBefore * 0.8);
  expect(s2.burden).toBeGreaterThan(burdenBefore + 0.2);
  await page.screenshot({ path: `${SHOTS}/ch03-mountain.png` });

  // ---- deeper: the second growth, Evangelist appears behind and talks
  await toTrigger(page, 'ch03_deeper', 0);
  await waitTrigger(page, 'ch03_deeper');
  await expect.poll(() => logged(page, 'burden:grew')).toHaveLength(2);
  await expect.poll(() => flag(page, 'ch03.phase')).toBe('evangelist');
  await waitTalk(page, 'ch03.evangelist', 30_000);
  await page.screenshot({ path: `${SHOTS}/ch03-evangelist.png` });
  await page.evaluate(() => (window as unknown as W).__pilgrim.play!.state.setHope(40));
  const hope2 = (await stateOf(page)).hope;
  await choose(page, 1);
  await spaceUntil(page, (r) => !r.active);
  expect(await flag(page, 'ch03.sorry')).toBe(true);
  expect(await flag(page, 'ch03.evangelistFound')).toBe(true);
  expect((await stateOf(page)).hope).toBeGreaterThanOrEqual(hope2 + 5 - 1);
  await expect.poll(() => flag(page, 'ch03.phase')).toBe('leading');
  expect((await stateOf(page)).objective).toBe('ui.hud.objective.backToWay');
  await waitSim(page, 1.5);
  await page.screenshot({ path: `${SHOTS}/ch03-lead-back.png` });

  // ---- rejoining the Way: Hope comes back
  const hope3 = (await stateOf(page)).hope;
  await toTrigger(page, 'ch03_rejoin');
  await expect.poll(() => flag(page, 'ch03.rejoined'), { timeout: 8000 }).toBe(true);
  expect(await toastKeys(page)).toContain('ui.toast.backOnWay');
  expect((await stateOf(page)).hope).toBeGreaterThanOrEqual(Math.min(100, hope3 + 30) - 2);
  await waitSim(page, 3);
  expect((await stateOf(page)).sun).toBeGreaterThan(sunBefore * 0.8);
  await page.screenshot({ path: `${SHOTS}/ch03-back-on-way.png` });

  // ---- the last waystone, then the end
  await page.evaluate(() => {
    const play = (window as unknown as W).__pilgrim.play!;
    const w = play.world.level.waystones.find((x) => x.id === 'ch03_w3')!;
    const c = play.world.ways.main.closest(w.at[0], w.at[2]).point;
    const dx = w.at[0] - c.x;
    const dz = w.at[2] - c.z;
    const len = Math.hypot(dx, dz) || 1;
    play.teleport(w.at[0] - (dx / len) * 1.6, w.at[2] - (dz / len) * 1.6, Math.atan2(dx, dz));
  });
  await waitSim(page, 0.5);
  await expect.poll(() => bubbleText(page)).toContain(await t(page, 'ui.verb.read'));
  await page.keyboard.press('KeyE');
  await expect.poll(() => logged(page, 'save:written'), { timeout: 5000 }).toContainEqual({ slot: 'auto' });
  await waitSim(page, 2.5);

  await toTrigger(page, 'ch03_end');
  await expect
    .poll(async () => (await logged(page, 'trigger:enter')).filter((e) => (e as { id: string }).id === 'ch03_end'))
    .toHaveLength(2);
  await waitSim(page, 1.8);
  await page.screenshot({ path: `${SHOTS}/ch03-end.png` });
  await expect.poll(() => logged(page, 'chapter:complete'), { timeout: 12_000 }).toContainEqual({ chapter: 3 });
  expect(problems, problems.join('\n')).toEqual([]);
});
