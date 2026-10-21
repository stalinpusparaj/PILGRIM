import { expect, test, type Page } from '@playwright/test';
import { frames, gpuMemory, waitForMode, watchConsole } from './support';
import { waitSim } from './play-support';

/**
 * Combat (GDD 2.6, 2.7.6, 2.7.7, 2.9): the Apollyon fight won with real shield blocks, perfect blocks and sword
 * hits (an in-page bot reads the fight's probe every fixed step, like a player watching the tells); 0 hearts =
 * I SHALL ARISE and the same phase again; SWORD / SHIELD touch buttons only in combat zones; the Prayer gift's ring,
 * Hope and 15 s rest; the Ch IX shadows drain Hope, flee from prayer and scatter from the sword; the smoking pit.
 * Screenshots: test-results/combat/.
 */

const SHOTS = 'test-results/combat';

interface V {
  x: number;
  y: number;
  z: number;
  toArray(): number[];
}
interface Probe {
  phase: string;
  sub: string;
  hits: number;
  bounced: number;
  darts: number;
  dartDist: number;
}
interface Fight {
  pos: V;
  probe(): Probe;
  skipTo(p: string): void;
  o: { hearts: { value: number; damage(n: number): number } };
}
interface CombatSvc {
  active: boolean;
  shieldUp: boolean;
  swing(): boolean;
  holdShield(on: boolean | null): void;
}
interface Win {
  __log: Array<{ name: string; payload: unknown }>;
  __bot: { log: string[]; perfect: number };
  __pilgrim: {
    events: { on(name: string, fn: (p: unknown) => void): () => void; count(): number };
    services: { tryGet(key: string): unknown; get(key: string): unknown; has(key: string): boolean };
    engine: { loop: { add(s: { update(dt: number): void }, order: number): () => void } };
    play: {
      teleport(x: number, z: number, facing?: number): void;
      player: { controller: { position: V }; mode: string };
      state: { hope: number; setHope(n: number): void; flag(k: string): unknown };
      world: { level: { triggers: Array<{ id: string; at: number[] }> }; npcs: Map<string, { root: { visible: boolean } }> };
    } | null;
  };
}

async function open(page: Page, chapter: string): Promise<void> {
  await page.goto(`/?chapter=${chapter}&skipIntro=1`);
  await waitForMode(page);
  await page.waitForFunction(() => (window as unknown as Win).__pilgrim.play != null, null, { timeout: 30_000 });
  await page.evaluate(() => {
    const win = window as unknown as Win;
    win.__log = [];
    for (const name of ['combat:block', 'prayer:burst', 'apollyon:phase', 'shadow:flee', 'shadow:scatter', 'player:arise'])
      win.__pilgrim.events.on(name, (payload) => win.__log.push({ name, payload }));
  });
  await page.addStyleTag({ content: '.pg-click-to-play { display: none !important; }' });
  await frames(page, 20);
}

async function count(page: Page, name: string): Promise<number> {
  return page.evaluate((n) => (window as unknown as Win).__log.filter((e) => e.name === n).length, name);
}

/** Answers (first choice) and skips every conversation until none runs for a moment. */
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

async function teleportTo(page: Page, trigger: string, dx = 0): Promise<void> {
  await page.evaluate(
    ({ id, dx }) => {
      const play = (window as unknown as Win).__pilgrim.play!;
      const t = play.world.level.triggers.find((x) => x.id === id)!;
      play.teleport(t.at[0]! + dx, t.at[2]!, Math.PI / 2);
    },
    { id: trigger, dx },
  );
}

/** Walks into the arena, answers Apollyon's claim, waits until the fight runs. */
async function startFight(page: Page): Promise<void> {
  await teleportTo(page, 'apollyon_approach', -4);
  await waitSim(page, 0.5);
  await expect
    .poll(
      async () => {
        await settle(page);
        return page.evaluate(() => (window as unknown as Win).__pilgrim.services.has('apollyon'));
      },
      { timeout: 30_000 },
    )
    .toBe(true);
}

async function probe(page: Page): Promise<Probe> {
  return page.evaluate(() => ((window as unknown as Win).__pilgrim.services.get('apollyon') as Fight).probe());
}

test('Chapter VIII: Apollyon is beaten with shield blocks, perfect blocks and sword hits', async ({ page }) => {
  test.setTimeout(240_000);
  const problems = watchConsole(page);
  await open(page, '8');
  await startFight(page);
  await expect(page.locator('.hud-hearts')).toBeVisible();

  // The bot: shield up through each paw telegraph, sword into the open belly; raise the shield just before each
  // dart (a perfect block), walk up and strike when he is knocked down.
  await page.evaluate(() => {
    const win = window as unknown as Win;
    const s = win.__pilgrim.services;
    const fight = s.get('apollyon') as Fight;
    const combat = s.get('combat') as CombatSvc;
    const play = win.__pilgrim.play!;
    win.__bot = { log: [], perfect: 0 };
    win.__pilgrim.events.on('combat:block', (p) => {
      if ((p as { perfect: boolean }).perfect) win.__bot.perfect++;
    });
    let last = '';
    win.__pilgrim.engine.loop.add(
      {
        update() {
          if (!s.has('apollyon')) return;
          const p = fight.probe();
          const pp = play.player.controller.position;
          const d = Math.hypot(fight.pos.x - pp.x, fight.pos.z - pp.z);
          if (p.phase === 'paws') {
            combat.holdShield(p.sub === 'telegraph');
            if (p.sub === 'open') combat.swing();
          } else if (p.phase === 'darts') {
            combat.holdShield(p.dartDist < 2.0 && p.dartDist > 0.6);
            if (p.sub === 'down') {
              if (d > 2.6) {
                pp.x += ((fight.pos.x - pp.x) / d) * 0.08;
                pp.z += ((fight.pos.z - pp.z) / d) * 0.08;
              } else combat.swing();
            }
          } else combat.holdShield(null);
          const key = `${p.phase}:${p.sub}:${p.hits}:${p.bounced}`;
          if (key !== last) win.__bot.log.push((last = key));
        },
      },
      126,
    );
  });

  await expect.poll(async () => (await probe(page)).phase, { timeout: 60_000 }).toBe('darts');
  expect(await count(page, 'combat:block')).toBeGreaterThanOrEqual(3);
  await page.screenshot({ path: `${SHOTS}/apollyon-darts.png` });
  await expect.poll(async () => (await probe(page)).phase, { timeout: 90_000 }).toBe('fall');
  expect(await page.evaluate(() => (window as unknown as Win).__bot.perfect)).toBeGreaterThanOrEqual(3);

  // Phase 3: thrown down, the sword lands 4 m off; reach for it.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const i = (window as unknown as Win).__pilgrim.services.get('interactables') as {
          get(id: string): unknown;
        };
        return i.get('reach_sword') != null;
      }),
      { timeout: 20_000 },
    )
    .toBe(true);
  await page.screenshot({ path: `${SHOTS}/apollyon-reach-sword.png` });
  await page.evaluate(() => {
    const i = (window as unknown as Win).__pilgrim.services.get('interactables') as {
      get(id: string): { onUse(): void };
    };
    i.get('reach_sword').onUse();
  });
  await expect
    .poll(
      async () => {
        await settle(page);
        return page.evaluate(() => (window as unknown as Win).__pilgrim.play!.state.flag('ch08.fightDone'));
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  expect(
    await page.evaluate(() => (window as unknown as Win).__pilgrim.play!.world.npcs.get('apollyon')!.root.visible),
  ).toBe(false);
  await expect(page.locator('.hud-hearts')).toBeHidden({ timeout: 15_000 });
  expect(problems, problems.join('\n')).toEqual([]);
});

test('0 hearts: I SHALL ARISE and the same phase starts again with full hearts', async ({ page }) => {
  test.setTimeout(120_000);
  const problems = watchConsole(page);
  await open(page, '8');
  await startFight(page);
  await page.evaluate(() => ((window as unknown as Win).__pilgrim.services.get('apollyon') as Fight).skipTo('darts'));
  await expect.poll(async () => (await probe(page)).sub, { timeout: 10_000 }).not.toBe('takeoff');
  await page.evaluate(() =>
    ((window as unknown as Win).__pilgrim.services.get('apollyon') as Fight).o.hearts.damage(5),
  );
  await expect(page.locator('.pg-arise')).toBeVisible({ timeout: 5000 });
  await page.screenshot({ path: `${SHOTS}/arise.png` });
  await expect.poll(async () => (await probe(page)).sub, { timeout: 20_000 }).toBe('takeoff');
  const after = await page.evaluate(() => {
    const f = (window as unknown as Win).__pilgrim.services.get('apollyon') as Fight;
    return { phase: f.probe().phase, hits: f.probe().hits, hearts: f.o.hearts.value };
  });
  expect(after).toEqual({ phase: 'darts', hits: 0, hearts: 5 });
  expect(problems, problems.join('\n')).toEqual([]);
});

test.describe('touch', () => {
  test.use({ viewport: { width: 915, height: 412 }, hasTouch: true, isMobile: true });

  test('SWORD and SHIELD buttons show only in the combat zone', async ({ page }) => {
    const problems = watchConsole(page);
    await open(page, '8');
    await page.evaluate(() => {
      const o = { pointerId: 7, pointerType: 'touch', clientX: 400, clientY: 200, bubbles: true, isPrimary: true };
      document.body.dispatchEvent(new PointerEvent('pointerdown', o));
      document.body.dispatchEvent(new PointerEvent('pointerup', o));
    });
    const sword = page.locator('.pg-touch-btn[data-id="sword"]');
    const shield = page.locator('.pg-touch-btn[data-id="shield"]');
    await expect(page.locator('.pg-touch-btn[data-id="pray"]')).toBeVisible();
    await expect(sword).toBeHidden();
    await expect(shield).toBeHidden();
    await page.evaluate(() => (window as unknown as Win).__pilgrim.play!.teleport(30, 0, Math.PI / 2)); // the arena, past the trigger
    await expect(sword).toBeVisible();
    await expect(shield).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/touch-combat-buttons.png` });
    await page.evaluate(() => (window as unknown as Win).__pilgrim.play!.teleport(-40, -1, Math.PI / 2));
    await expect(sword).toBeHidden();
    expect(problems, problems.join('\n')).toEqual([]);
  });
});

test('Prayer and the shadows of Chapter IX', async ({ page }) => {
  test.setTimeout(120_000);
  const problems = watchConsole(page);
  await open(page, '9');
  const hope = (): Promise<number> => page.evaluate(() => (window as unknown as Win).__pilgrim.play!.state.hope);

  // Prayer: +20 Hope, a burst, then 15 s of rest.
  await teleportTo(page, 'valley_enter');
  await settle(page);
  await page.evaluate(() => (window as unknown as Win).__pilgrim.play!.state.setHope(40));
  const before = await hope();
  await page.keyboard.press('KeyQ');
  await expect.poll(() => count(page, 'prayer:burst')).toBe(1);
  expect(await hope()).toBeGreaterThanOrEqual(before + 19);
  await page.screenshot({ path: `${SHOTS}/prayer-ring.png` });
  await waitSim(page, 1);
  await page.keyboard.press('KeyQ');
  await waitSim(page, 0.5);
  expect(await count(page, 'prayer:burst')).toBe(1);

  // A shadow close by drains Hope and nudges; prayer makes it flee; the sword scatters one.
  await teleportTo(page, 'whisper_zone_1');
  await settle(page);
  const sh = (fn: string, arg?: number): Promise<unknown> =>
    page.evaluate(
      ({ fn, arg }) => {
        const p = (window as unknown as Win).__pilgrim.services.get('shadows') as Record<string, (a?: number) => unknown>;
        return p[fn]!(arg);
      },
      { fn, arg },
    );
  await page.evaluate(() => (window as unknown as Win).__pilgrim.play!.state.setHope(80));
  await sh('summon', 0);
  await waitSim(page, 2);
  const states = (await sh('probe')) as Array<{ state: string; dist: number }>;
  expect(states[0]!.state).toBe('chase');
  expect(await hope()).toBeLessThan(80);
  await page.screenshot({ path: `${SHOTS}/shadow-close.png` });
  await page.evaluate(() => {
    const p = (window as unknown as Win).__pilgrim.services.get('prayer') as { resetCooldown(): void; pray(): boolean };
    p.resetCooldown();
    p.pray();
  });
  await expect.poll(() => count(page, 'shadow:flee')).toBeGreaterThanOrEqual(1);
  expect(((await sh('probe')) as Array<{ state: string }>)[0]!.state).toBe('flee');

  await sh('summon', 1);
  await waitSim(page, 0.6);
  await page.evaluate(() => {
    const c = (window as unknown as Win).__pilgrim.services.get('combat') as CombatSvc & { holdShield(o: boolean): void };
    c.holdShield(true); // turn to face it
  });
  await waitSim(page, 0.4);
  await page.evaluate(() => {
    const c = (window as unknown as Win).__pilgrim.services.get('combat') as CombatSvc;
    c.holdShield(null);
  });
  await waitSim(page, 0.1);
  await page.evaluate(() => ((window as unknown as Win).__pilgrim.services.get('combat') as CombatSvc).swing());
  await expect.poll(() => count(page, 'shadow:scatter')).toBe(1);
  expect(((await sh('probe')) as Array<{ state: string }>)[1]!.state).toBe('scatter');
  await waitSim(page, 3.5);
  expect(((await sh('probe')) as Array<{ state: string }>)[1]!.state).not.toBe('scatter');

  // The smoking pit parts for a prayer near it.
  await teleportTo(page, 'ember_pit_near');
  await settle(page);
  await page.evaluate(() =>
    ((window as unknown as Win).__pilgrim.services.get('prayer') as { resetCooldown(): void }).resetCooldown(),
  );
  await page.keyboard.press('KeyQ');
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Win).__pilgrim.play!.state.flag('ch09.pitDone')))
    .toBe(true);
  expect(problems, problems.join('\n')).toEqual([]);
});

test('restarting Chapters VIII and IX mid-fight keeps GPU memory and listeners flat', async ({ page }) => {
  test.setTimeout(180_000);
  const problems = watchConsole(page);
  const listeners = (): Promise<number> => page.evaluate(() => (window as unknown as Win).__pilgrim.events.count());
  const restart = async (): Promise<void> => {
    await page.evaluate(() =>
      ((window as unknown as Win).__pilgrim.services.get('chapters') as { restart(): Promise<void> }).restart(),
    );
    await waitForMode(page);
    await page.waitForFunction(() => (window as unknown as Win).__pilgrim.play != null);
    await frames(page, 30);
  };
  for (const chapter of ['8', '9']) {
    await open(page, chapter);
    await restart();
    const baseline = { ...(await gpuMemory(page)), events: await listeners() };
    for (let i = 0; i < 3; i++) {
      if (chapter === '8') {
        await startFight(page);
        await page.evaluate(() =>
          ((window as unknown as Win).__pilgrim.services.get('apollyon') as Fight).skipTo('darts'),
        );
        await waitSim(page, 4);
      } else {
        await teleportTo(page, 'whisper_zone_1');
        await settle(page);
        await page.keyboard.press('KeyQ');
        await waitSim(page, 1);
      }
      await restart();
    }
    const last = { ...(await gpuMemory(page)), events: await listeners() };
    expect(last.geometries, `chapter ${chapter} geometries`).toBeLessThanOrEqual(baseline.geometries);
    expect(last.textures, `chapter ${chapter} textures`).toBeLessThanOrEqual(baseline.textures);
    expect(last.events, `chapter ${chapter} listeners`).toBe(baseline.events);
  }
  expect(problems, problems.join('\n')).toEqual([]);
});
