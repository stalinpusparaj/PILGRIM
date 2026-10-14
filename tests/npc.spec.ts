import { expect, test, type Page } from '@playwright/test';
import { watchConsole } from './support';
import { openPlay, playerPos, toWayStart, waitSim } from './play-support';
import type { NPC } from '../src/npc/NPC';
import type { Companion } from '../src/npc/Companion';
import type { SpeechBubbles } from '../src/narrative/SpeechBubbles';
import type { PlaySession } from '../src/world/PlaySession';

/**
 * Phase 3 companions (GDD 2.8) in the test world (`?chapter=test`): Pliable (a world NPC) is wrapped in an NPC and
 * a Companion added to the engine loop. While Christian walks, Pliable keeps 2-3.5 m behind-left and never stands
 * in a collider, and hops when he hops; more than 25 m away he catches up with a teleport out of view; low Hope
 * makes him bark (a world-space bubble) and cheer (+10 Hope), at most once per 20 s; dispose removes every
 * listener. Every test runs with a clean console (the bark.generic.* strings live in
 * content/i18n/fragments/npc.*.json until they are merged into en.json / ta.json, so their missing-key warnings
 * are allowed).
 */
test.describe.configure({ mode: 'serial' });

type NpcModule = typeof import('../src/npc/NPC');
type CompanionModule = typeof import('../src/npc/Companion');
type BubblesModule = typeof import('../src/narrative/SpeechBubbles');
type TeleportModule = typeof import('../src/npc/npc-teleport');
type FactoryModule = typeof import('../src/gen/CharacterFactory');

interface NpcTest {
  companion: Companion;
  npc: NPC;
  bubbles: SpeechBubbles;
  ownBubbles: boolean;
  offLoop: () => void;
  offBubbles: () => void;
  baseline: number;
  npcBaseline: number;
  catchUps: Array<{ inView: boolean; inside: boolean; dist: number }>;
  offCatch: () => void;
  npcs: () => number;
  cleanup: () => void;
}

type W = Window & { __npc: NpcTest };

/**
 * Wraps Pliable in a Companion, standing 2.5 m behind-left of Christian at the Way start. When the chapter's own
 * cast already drives the world's Pliable (the ChapterManager runs `?chapter=test`), a fresh Pliable is built
 * instead (two drivers on one Character would fight), and the cast's companions are quietened and sent away so
 * they cannot bark, cheer or crowd the slot.
 */
async function setup(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const w = window as unknown as W;
    const h = window.__pilgrim;
    const play = h.play as PlaySession;
    const engine = h.engine!;
    const load = (p: string): Promise<unknown> => import(/* @vite-ignore */ p);
    const { NPC, NPC_ORDER } = (await load('/src/npc/NPC.ts')) as NpcModule;
    const { Companion } = (await load('/src/npc/Companion.ts')) as CompanionModule;
    const { SpeechBubbles } = (await load('/src/narrative/SpeechBubbles.ts')) as BubblesModule;
    const { inView } = (await load('/src/npc/npc-teleport.ts')) as TeleportModule;
    const { CharacterFactory } = (await load('/src/gen/CharacterFactory.ts')) as FactoryModule;

    const away = play.world.ways.main.sample(0.97);
    for (const c of Companion.all) {
      c.autoBarks = false;
      c.following = false;
      c.npc.teleport(away);
    }
    const existing = h.services.tryGet('bubbles');
    const bubbles = existing ?? new SpeechBubbles(play.view);
    const offBubbles = existing
      ? () => {}
      : engine.loop.add({ render: () => bubbles.update(play.view) }, 999);
    const ownBubbles = !existing;

    const worldPliable = play.world.npcs.get('pliable')!;
    const taken = NPC.all.some((n) => n.character === worldPliable);
    const character = taken ? CharacterFactory.build('pliable') : worldPliable;
    if (taken) {
      play.world.scene.add(character.root);
      play.world.blobs.follow(character);
    }
    const baseline = h.events.count();
    const npcBaseline = NPC.all.length;
    const npc = new NPC({ id: 'npc_test', character, session: play });
    const p = play.player.controller.position;
    const f = play.player.forward;
    npc.teleport(
      p.clone().set(p.x - f.x * 2.2 + f.z * 1.2, p.y, p.z - f.z * 2.2 - f.x * 1.2),
      play.player.facing,
    );
    const companion = new Companion({ npc, session: play, side: 'left' });
    companion.autoBarks = false;
    const offLoop = engine.loop.add(companion, NPC_ORDER);
    const catchUps: NpcTest['catchUps'] = [];
    const offCatch = h.events.on('npc:catchUp', ({ id }) => {
      if (id !== 'npc_test') return;
      const n = npc.position;
      catchUps.push({
        inView: inView(play, n, 1.6),
        inside: play.col.overlaps(n.x, n.y, n.z, 0.25, 1.4),
        dist: Math.hypot(n.x - p.x, n.z - p.z),
      });
    });
    w.__npc = {
      companion,
      npc,
      bubbles,
      ownBubbles,
      offLoop,
      offBubbles,
      baseline,
      npcBaseline,
      catchUps,
      offCatch,
      npcs: () => NPC.all.length,
      cleanup: () => {
        if (!taken) return;
        play.world.blobs.unfollow(character);
        character.root.removeFromParent();
        character.dispose();
      },
    };
  });
}

interface FollowSample {
  dist: number;
  along: number;
  side: number;
  inside: boolean;
}

/** Samples Pliable's place relative to Christian's heading every rendered frame for `seconds` of game time. */
async function sampleFollow(page: Page, seconds: number): Promise<FollowSample[]> {
  return page.evaluate(
    (secs) =>
      new Promise<FollowSample[]>((done) => {
        const h = window.__pilgrim;
        const play = h.play as PlaySession;
        const npc = (window as unknown as W).__npc.npc;
        const loop = h.engine!.loop;
        const until = loop.elapsed + secs;
        const out: FollowSample[] = [];
        const tick = (): void => {
          const p = play.player.controller.position;
          const v = play.player.controller.velocity;
          const vh = Math.hypot(v.x, v.z);
          const n = npc.position;
          if (vh > 0.5) {
            const hx = v.x / vh;
            const hz = v.z / vh;
            const rx = n.x - p.x;
            const rz = n.z - p.z;
            out.push({
              dist: Math.hypot(rx, rz),
              along: rx * hx + rz * hz,
              side: rx * hz - rz * hx, // + = left of a body facing (hx, hz)
              inside: play.col.overlaps(n.x, n.y, n.z, 0.25, 1.4),
            });
          }
          if (loop.elapsed >= until) done(out);
          else requestAnimationFrame(tick);
        };
        tick();
      }),
    seconds,
  );
}

function allowed(problems: string[]): string[] {
  return problems.filter((p) => !p.includes('[i18n] missing key "bark.generic.'));
}

test('companion follows behind-left, hops, catches up out of view, cheers on low Hope, disposes clean', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const problems = watchConsole(page);
  await openPlay(page);
  await toWayStart(page);
  await setup(page);
  await waitSim(page, 0.5);

  // Walking along the Way: 2-3.5 m behind-left, never inside a collider.
  await page.keyboard.down('KeyW');
  await waitSim(page, 1.5);
  const walk = await sampleFollow(page, 3);
  expect(walk.length).toBeGreaterThan(20);
  for (const s of walk) {
    expect(s.dist).toBeGreaterThanOrEqual(2);
    expect(s.dist).toBeLessThanOrEqual(3.5);
    expect(s.along).toBeLessThan(0);
    expect(s.side).toBeGreaterThan(0);
    expect(s.inside).toBe(false);
  }

  // Christian hops: Pliable hops too.
  const peak = page.evaluate(
    () =>
      new Promise<number>((done) => {
        const h = window.__pilgrim;
        const play = h.play as PlaySession;
        const npc = (window as unknown as W).__npc.npc;
        const loop = h.engine!.loop;
        const until = loop.elapsed + 2;
        let best = 0;
        const tick = (): void => {
          const n = npc.position;
          best = Math.max(best, n.y - play.col.groundAt(n.x, n.z, n.y + 0.3));
          if (loop.elapsed >= until) done(best);
          else requestAnimationFrame(tick);
        };
        tick();
      }),
  );
  await page.keyboard.down('Space');
  await waitSim(page, 0.2);
  await page.keyboard.up('Space');
  expect(await peak).toBeGreaterThan(0.12);
  await page.keyboard.up('KeyW');
  await page.screenshot({ path: 'test-results/phase3/companion-follow.png' });

  // 40 m ahead along the Way: a catch-up teleport, out of view, on free ground, behind him.
  await page.evaluate(() => {
    const play = window.__pilgrim.play as PlaySession;
    const way = play.world.ways.main;
    const p = play.player.controller.position;
    const t = way.closest(p.x, p.z).t + 40 / way.length;
    const at = way.sample(t);
    const tan = way.tangent(t);
    play.teleport(at.x, at.z, Math.atan2(tan.x, tan.z));
  });
  await waitSim(page, 1.5);
  const catchUps = await page.evaluate(() => (window as unknown as W).__npc.catchUps);
  expect(catchUps.length).toBeGreaterThanOrEqual(1);
  expect(catchUps[0]!.inView).toBe(false);
  expect(catchUps[0]!.inside).toBe(false);
  expect(catchUps[0]!.dist).toBeLessThan(25);
  // He walks up into his place again.
  await waitSim(page, 4);
  const near = await page.evaluate(() => {
    const play = window.__pilgrim.play as PlaySession;
    const n = (window as unknown as W).__npc.npc.position;
    const p = play.player.controller.position;
    return Math.hypot(n.x - p.x, n.z - p.z);
  });
  expect(near).toBeLessThan(4.5);

  // Low Hope: a bark bubble over Pliable and +10 Hope; not again within 20 s.
  await page.evaluate(() => {
    (window as unknown as W).__npc.companion.autoBarks = true;
    (window.__pilgrim.play as PlaySession).state.setHope(20);
  });
  await waitSim(page, 0.6);
  const bark = await page.evaluate(() => {
    const play = window.__pilgrim.play as PlaySession;
    const t = (window as unknown as W).__npc;
    return {
      key: t.companion.lastBark,
      hope: play.state.hope,
      bubbles: t.bubbles.count,
      text: document.querySelector('.dlg-bubbles')?.textContent ?? '',
    };
  });
  expect(bark.key ?? '').toMatch(/^bark\.generic\.lowHope\./);
  expect(bark.hope).toBeGreaterThanOrEqual(29.5);
  expect(bark.bubbles).toBeGreaterThanOrEqual(1);
  expect(bark.text.length).toBeGreaterThan(0);
  await page.screenshot({ path: 'test-results/phase3/companion-bark.png' });
  await page.evaluate(() => (window.__pilgrim.play as PlaySession).state.setHope(20));
  await waitSim(page, 2);
  const again = await page.evaluate(() => (window.__pilgrim.play as PlaySession).state.hope);
  expect(again).toBeLessThan(21);
  await playerPos(page);

  // Dispose: every listener and loop system goes; the World keeps its character.
  const after = await page.evaluate(() => {
    const t = (window as unknown as W).__npc;
    const h = window.__pilgrim;
    t.offCatch();
    t.offLoop();
    t.companion.dispose();
    const count = h.events.count();
    const still = (h.play as PlaySession).world.npcs.has('pliable');
    const npcs = t.npcs();
    t.cleanup();
    if (t.ownBubbles) {
      t.offBubbles();
      t.bubbles.dispose();
    }
    return { count, baseline: t.baseline, npcs, npcBaseline: t.npcBaseline, still };
  });
  expect(after.count).toBe(after.baseline);
  expect(after.npcs).toBe(after.npcBaseline);
  expect(after.still).toBe(true);
  await waitSim(page, 0.3);
  expect(allowed(problems)).toEqual([]);
});
