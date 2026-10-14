import { expect, test, type Page } from '@playwright/test';
import { frames, waitForMode, watchConsole } from './support';
import { waitSim } from './play-support';
import { spaceUntil, waitForFlow } from './story-support';

/**
 * Chapter I — The City of Destruction (src/chapters/ch01.ts, content/levels/ch01.json, content/dialogue/ch01.json),
 * played end to end by script on `/?chapter=1&skipIntro=1`: the Book ([E] Read → the Burden grows), the day talk
 * with Christiana (a choice), the town square (neighbours' bubbles, the homeward objective), the evening talk, the
 * gate (Evangelist walks up, the note, "Follow the shining light"), the family-calls cutscene, the chase (Obstinate
 * home, Pliable a companion), the fields bark, and the ending talk → 'chapter:complete' {chapter: 1}. World build
 * under 2 s, clean console. Screenshots: test-results/phase4/ch01-*.png.
 */

const SHOTS = 'test-results/phase4';

interface Vec3 {
  x: number;
  y: number;
  z: number;
}
interface LevelLite {
  landmarks: Array<{ id: string; type: string; at?: [number, number, number]; rotY?: number }>;
  zones: Array<{ id: string; type: string; x?: number; z?: number }>;
  triggers: Array<{ id: string; at: [number, number, number] }>;
  npcs: Array<{ id: string; at?: [number, number, number] }>;
  waystones: Array<{ id: string; at: [number, number, number] }>;
}
interface PlayLite {
  teleport(x: number, z: number, facing?: number): void;
  state: {
    hope: number;
    objective: string | null;
    flag(key: string): unknown;
    has(id: string): boolean;
    setHope(v: number): void;
  };
  player: { mode: string; controller: { position: Vec3 }; character: { burdenSize: number } };
  world: { level: LevelLite; buildMs: number };
}
interface Probe {
  key: string | null;
  level: string | null;
  chapter: number | null;
  ready: boolean;
  npcs: string[];
  companions: string[];
  talking: boolean;
  triggers: number;
}
type W = Window & {
  __pilgrim: {
    play: PlayLite | null;
    services: { get(key: string): unknown; tryGet(key: string): unknown };
    events: { on(name: string, fn: (p?: unknown) => void): () => void };
    engine: { loop: { elapsed: number } } | null;
  };
  __log: Array<{ name: string; payload: unknown }>;
};

const LOGGED = ['chapter:complete', 'hud:toast', 'burden:grew', 'item:given', 'cutscene:start', 'cutscene:end'];

async function open(page: Page): Promise<void> {
  await page.goto('/?chapter=1&skipIntro=1');
  await waitForMode(page);
  await page.waitForFunction(() => (window as unknown as W).__pilgrim.play != null);
  await waitForFlow(page, (p) => p.state === 'playing' && !p.loopPaused);
  await page.evaluate((names) => {
    const w = window as unknown as W;
    w.__log = [];
    for (const name of names) w.__pilgrim.events.on(name, (payload) => w.__log.push({ name, payload }));
  }, LOGGED);
  await page.addStyleTag({ content: '.pg-click-to-play { display: none !important; }' });
  await frames(page, 20);
}

const probe = (page: Page): Promise<Probe> =>
  page.evaluate(() => ((window as unknown as W).__pilgrim.services.get('chapters') as { probe(): Probe }).probe());

const level = (page: Page): Promise<LevelLite> =>
  page.evaluate(() => (window as unknown as W).__pilgrim.play!.world.level);

const objective = (page: Page): Promise<string | null> =>
  page.evaluate(() => (window as unknown as W).__pilgrim.play!.state.objective);

const flag = (page: Page, key: string): Promise<unknown> =>
  page.evaluate((k) => (window as unknown as W).__pilgrim.play!.state.flag(k), key);

const logged = (page: Page, name: string): Promise<unknown[]> =>
  page.evaluate(
    (n) => (window as unknown as W).__log.filter((e) => e.name === n).map((e) => e.payload),
    name,
  );

const toasts = async (page: Page): Promise<string[]> =>
  (await logged(page, 'hud:toast')).map((p) => (p as { key: string }).key);

async function teleport(page: Page, x: number, z: number, facing?: number): Promise<void> {
  await page.evaluate(([x, z, f]) => (window as unknown as W).__pilgrim.play!.teleport(x, z, f), [x, z, facing] as const);
  await waitSim(page, 0.4);
}

/** Puts Christian `dist` m from (x, z) on the -x side, facing it. */
async function standBefore(page: Page, x: number, z: number, dist: number): Promise<void> {
  const fromX = x - dist;
  await teleport(page, fromX, z, Math.atan2(x - fromX, 0));
}

const focusedId = (page: Page): Promise<string | null> =>
  page.evaluate(
    () =>
      ((window as unknown as W).__pilgrim.services.get('interactables') as { focused: { id: string } | null })
        .focused?.id ?? null,
  );

/** Waits for the given interactable to be in focus (a short walk forward helps the hysteresis), presses E. */
async function useFocused(page: Page, id: string): Promise<void> {
  const end = Date.now() + 6000;
  while ((await focusedId(page)) !== id && Date.now() < end) {
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(80);
    await page.keyboard.up('KeyW');
    await page.waitForTimeout(80);
  }
  expect(await focusedId(page)).toBe(id);
  await page.keyboard.press('KeyE');
}

async function waitTalk(page: Page, timeout = 20_000): Promise<void> {
  await page.waitForFunction(
    () => {
      const r = (window as unknown as W).__pilgrim.services.tryGet('dialogue') as
        | { active: boolean; line: unknown }
        | undefined;
      return r?.active === true && r.line !== null;
    },
    undefined,
    { timeout },
  );
}

/** Plays the open talk by keyboard; answers each question with `answers` in turn (1-based keys). */
async function playTalk(page: Page, answers: number[] = []): Promise<void> {
  const left = [...answers];
  for (;;) {
    const r = await spaceUntil(page, (s) => s.phase === 'choosing' || !s.active);
    if (!r.active) return;
    await page.waitForTimeout(600); // the choices' arming delay
    await page.keyboard.press(`Digit${left.shift() ?? 1}`);
    await page.waitForTimeout(250);
  }
}

async function waitCutsceneEnd(page: Page, count: number, timeout = 30_000): Promise<void> {
  await page.waitForFunction(
    (n) => (window as unknown as W).__log.filter((e) => e.name === 'cutscene:end').length >= n,
    count,
    { timeout },
  );
}

/** Plays the ending talk (no questions) with Space until 'chapter:complete' is logged: the flow then moves on
 *  and the chapter's dialogue runner goes with it, so the runner is only read while it is still registered. */
async function playUntilComplete(page: Page, timeout = 30_000): Promise<void> {
  const end = Date.now() + timeout;
  for (;;) {
    const done = await page.evaluate(() => {
      const w = window as unknown as W;
      if (w.__log.some((e) => e.name === 'chapter:complete')) return true;
      const r = w.__pilgrim.services.tryGet('dialogue') as { active: boolean; phase: string } | undefined;
      return r ? r.phase : 'gone';
    });
    if (done === true) return;
    if (Date.now() > end) throw new Error(`the ending never completed (runner: ${String(done)})`);
    if (done === 'typing' || done === 'shown') await page.keyboard.press('Space');
    await page.waitForTimeout(220);
  }
}

function at(list: Array<{ id: string; at?: [number, number, number] }>, id: string): [number, number, number] {
  const e = list.find((x) => x.id === id);
  if (!e?.at) throw new Error(`no "${id}" in the level`);
  return e.at;
}
function zone(lv: LevelLite, id: string): { x: number; z: number } {
  const z = lv.zones.find((x) => x.id === id);
  if (!z || typeof z.x !== 'number' || typeof z.z !== 'number') throw new Error(`no zone "${id}"`);
  return { x: z.x, z: z.z };
}

test('Chapter I plays end to end: Book, family, town, Evangelist, the family calls, the chase, the Way', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const problems = watchConsole(page);
  await open(page);

  const p0 = await probe(page);
  expect(p0).toMatchObject({ key: '1', level: 'ch01', chapter: 1, ready: true, companions: [], triggers: 5 });
  expect(p0.npcs).toEqual(
    expect.arrayContaining(['christiana', 'son_1', 'son_4', 'evangelist', 'obstinate', 'pliable', 'crowd_1', 'crowd_8']),
  );
  const buildMs = await page.evaluate(() => (window as unknown as W).__pilgrim.play!.world.buildMs);
  console.log(`ch01 world built in ${buildMs.toFixed(0)} ms`);
  expect(buildMs).toBeLessThan(2000);
  expect(await objective(page)).toBe('ch01.objective.readBook');
  const lv = await level(page);
  await page.screenshot({ path: `${SHOTS}/ch01-01-home.png` });

  // 1. The Book: [E] Read, he reads it aloud, the Burden boings bigger.
  const book = at(lv.landmarks, 'book');
  await standBefore(page, book[0], book[2], 1.7);
  await useFocused(page, 'book');
  await waitTalk(page);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${SHOTS}/ch01-02-book.png` });
  await playTalk(page);
  await waitSim(page, 0.6);
  expect(await flag(page, 'ch01.readBook')).toBe(true);
  expect(await flag(page, 'burden.size')).toBeCloseTo(1.3, 5);
  expect(await logged(page, 'burden:grew')).toHaveLength(1);
  expect(await toasts(page)).toContain('ch01.toast.burden');
  expect(await objective(page)).toBe('ch01.objective.talkFamily');
  expect(await focusedId(page)).not.toBe('book');

  // 2. Day: Christiana and the boys (second answer: "But what if the Book is right?", Hope +5).
  await page.evaluate(() => (window as unknown as W).__pilgrim.play!.state.setHope(50)); // room for the +5s
  const hope0 = 50;
  const christiana = at(lv.npcs, 'christiana');
  await teleport(page, christiana[0], christiana[2] - 2.4, 0);
  await useFocused(page, 'talk:christiana');
  await waitTalk(page);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/ch01-03-family-day.png` });
  await playTalk(page, [2]);
  await waitSim(page, 0.5);
  expect(await flag(page, 'ch01.dayTalk')).toBe(true);
  expect(await page.evaluate(() => (window as unknown as W).__pilgrim.play!.state.hope)).toBe(hope0 + 5);
  expect(await objective(page)).toBe('ch01.objective.walkTown');
  expect(await flag(page, 'met.christiana')).toBe(true);

  // 3. The town: a neighbour reacts with a bubble; the square turns him homeward.
  const laugher = at(lv.npcs, 'crowd_3');
  await teleport(page, laugher[0] - 2.2, laugher[2], Math.PI / 2);
  await waitSim(page, 1.0);
  const bubbles = await page.locator('.dlg-bubble').count();
  expect(bubbles).toBeGreaterThan(0);
  await page.screenshot({ path: `${SHOTS}/ch01-04-town.png` });
  const square = at(lv.triggers, 'ch01_square');
  await teleport(page, square[0], square[2], Math.PI / 2);
  await waitSim(page, 0.5);
  expect(await objective(page)).toBe('ch01.objective.goHome');
  expect(await toasts(page)).toContain('ch01.toast.neighbours');

  // 4. Evening at the door (first answer: "I cannot sleep", Hope +5).
  const home = at(lv.triggers, 'ch01_home');
  await teleport(page, home[0], home[2], Math.PI);
  await waitTalk(page);
  await playTalk(page, [1]);
  await waitSim(page, 0.5);
  expect(await flag(page, 'ch01.eveningTalk')).toBe(true);
  expect(await flag(page, 'ch01.brave')).toBe(true);
  expect(await objective(page)).toBe('ch01.objective.toGate');

  // 5. Outside the gate: Evangelist walks up (third answer, the funny one), the note, the far light.
  const gateOut = at(lv.triggers, 'ch01_gate_out');
  await teleport(page, gateOut[0], gateOut[2], Math.PI / 2);
  await page.waitForFunction(() => (window as unknown as W).__pilgrim.play!.player.mode === 'locked');
  await page.screenshot({ path: `${SHOTS}/ch01-05-gate.png` });
  await waitTalk(page, 30_000);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${SHOTS}/ch01-06-evangelist.png` });
  await playTalk(page, [3]);
  await waitSim(page, 0.3);
  expect(await flag(page, 'ch01.funny')).toBe(true);
  expect(await flag(page, 'ch01.metEvangelist')).toBe(true);
  expect(await page.evaluate(() => (window as unknown as W).__pilgrim.play!.state.has('note'))).toBe(true);
  expect(await toasts(page)).toContain('ch01.toast.note');
  expect(await objective(page)).toBe('ui.hud.objective.followLight');

  // 6. The family calls from the door; Christian covers his ears and runs (a cutscene).
  await page.waitForFunction(() => (window as unknown as W).__log.some((e) => e.name === 'cutscene:start'));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/ch01-07-family-calls.png` });
  await page.waitForTimeout(4500);
  await page.screenshot({ path: `${SHOTS}/ch01-08-cover-ears-run.png` });
  await waitCutsceneEnd(page, 1);
  const runTo = zone(lv, 'run_to');
  const pos = await page.evaluate(() => (window as unknown as W).__pilgrim.play!.player.controller.position);
  expect(Math.hypot(pos.x - runTo.x, pos.z - runTo.z)).toBeLessThan(3);

  // 7. Obstinate and Pliable give chase; Obstinate stomps home, Pliable joins.
  await waitTalk(page, 30_000);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/ch01-09-chase.png` });
  await playTalk(page, [1]);
  await waitSim(page, 0.5);
  expect(await flag(page, 'ch01.obstinateLeft')).toBe(true);
  expect(await flag(page, 'ch01.pliableJoins')).toBe(true);
  expect((await probe(page)).companions).toEqual(['pliable']);
  expect(await toasts(page)).toContain('ch01.toast.pliable');
  expect(await page.evaluate(() => (window as unknown as W).__pilgrim.play!.player.mode)).toBe('play');
  await waitSim(page, 2.5);
  const obstinate = await page.evaluate(() => {
    const c = (window as unknown as W).__pilgrim.services.get('chapters') as {
      context: { npc(id: string): { position: Vec3; moving: boolean } | null };
    };
    const o = c.context.npc('obstinate')!;
    return { x: o.position.x, moving: o.moving };
  });
  const oStop = zone(lv, 'obstinate_stop');
  expect(obstinate.moving || obstinate.x < oStop.x - 2).toBe(true); // on his way home (west)

  // 8. The fields: Pliable's bark about the light; the Way to its far end.
  const fields = at(lv.triggers, 'ch01_fields');
  await teleport(page, fields[0], fields[2], Math.PI / 2);
  await waitSim(page, 1.0);
  await expect(page.locator('.dlg-bubble')).toHaveCount(1);
  await page.screenshot({ path: `${SHOTS}/ch01-10-fields.png` });
  const w3 = at(lv.waystones, 'ch01_w3');
  await teleport(page, w3[0] - 6, w3[2] + 4, Math.PI / 2);
  await waitSim(page, 0.6);
  await page.screenshot({ path: `${SHOTS}/ch01-11-far-light.png` });

  // 9. The end: a word with Pliable, then the chapter completes.
  const end = at(lv.triggers, 'ch01_end');
  await teleport(page, end[0], end[2], Math.PI / 2);
  await waitTalk(page);
  await playUntilComplete(page);
  expect(await logged(page, 'chapter:complete')).toEqual([{ chapter: 1 }]);
  // The flow has moved on (the play session is gone); the GameState service carries the flags across.
  expect(
    await page.evaluate(
      () =>
        ((window as unknown as W).__pilgrim.services.get('state') as { flag(k: string): unknown }).flag('ch01.done'),
    ),
  ).toBe(true);

  expect(problems, problems.join('\n')).toEqual([]);
});
