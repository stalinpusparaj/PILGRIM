import { expect, test } from '@playwright/test';
import { frames, gpuMemory, waitForMode, watchConsole } from './support';
import {
  SHOT_DIR_PLAY,
  bubbleText,
  facePoint,
  faceWaystone,
  logged,
  openPlay,
  peakRise,
  toWayStart,
  waitSim,
  type PlayWindow,
} from './play-support';

/**
 * Phase 2 world systems in the test world (`?chapter=test`): Promises are picked up by walking through them; the
 * pit bonks the player back onto the Way (Hope -5, toast); the low wall shows Climb, Space climbs it and its
 * Promise is taken; the Slough slows and sinks Christian and standing still raises the stepping stones, which
 * hold him up; low Hope greys the world and Hope 0 shows I SHALL ARISE and wakes the player at the last waystone
 * with Hope 60, and a bonk that empties Hope keeps him locked under the screen; restarting the session three times
 * (once mid-Cross) leaves GPU memory and the event bus where they were and the old Cross silent. Every test runs
 * with a clean console. Saves Phase 2 report screenshots to test-results/phase2/.
 */
test.describe.configure({ mode: 'serial' });

test('walking through a Promise picks it up', async ({ page }) => {
  const problems = watchConsole(page);
  await openPlay(page);
  await page.evaluate(() => {
    const play = (window as unknown as PlayWindow).__pilgrim.play!;
    const p = play.world.level.promises.find((e) => e.id === 'test_p1')!;
    const [x, , z] = p.at;
    // 3 m before it along the Way, facing it.
    const c = play.world.ways.main.closest(x, z);
    const s = play.spawn();
    play.teleport(c.point.x - Math.sin(s.facing) * 3, c.point.z - Math.cos(s.facing) * 3, s.facing);
  });
  await waitSim(page, 0.3);
  await page.keyboard.down('KeyW');
  await expect
    .poll(() => logged(page, 'promise:collected'), { timeout: 10_000 })
    .toContainEqual(expect.objectContaining({ id: 'test_p1' }));
  await page.keyboard.up('KeyW');
  expect(
    await page.evaluate(() => (window as unknown as PlayWindow).__pilgrim.play!.state.hasPromise('test_p1')),
  ).toBe(true);
  expect(problems, problems.join('\n')).toEqual([]);
});

test('walking into the pit bonks the player back onto the Way with Hope -5 and a toast', async ({ page }) => {
  const problems = watchConsole(page);
  await openPlay(page);
  // 3 m east of the pit, facing west into it.
  await page.evaluate(() => {
    const play = (window as unknown as PlayWindow).__pilgrim.play!;
    const pit = play.world.level.landmarks.find((l) => l.type === 'pit')!;
    play.teleport(pit.at![0] + 3, pit.at![2], -Math.PI / 2);
  });
  await waitSim(page, 0.4);
  await page.keyboard.down('KeyW');
  await expect.poll(() => logged(page, 'player:bonk'), { timeout: 8000 }).toEqual([{ reason: 'pit' }]);
  await page.keyboard.up('KeyW');
  await waitSim(page, 0.45); // popped back, sitting dazed with the stars out
  await page.screenshot({ path: `${SHOT_DIR_PLAY}/bonk-stars.png` });
  await waitSim(page, 1.1);
  const after = await page.evaluate(() => {
    const play = (window as unknown as PlayWindow).__pilgrim.play!;
    const p = play.player.controller.position;
    const way = play.world.ways.main;
    return { hope: play.state.hope, mode: play.player.mode, off: way.closest(p.x, p.z).dist - way.halfWidth };
  });
  expect(after.hope).toBe(95);
  expect(after.mode).toBe('play');
  expect(after.off).toBeLessThan(0.3); // back on the Way, not at a waystone
  expect(await logged(page, 'hud:toast')).toContainEqual({ key: 'ui.toast.bonk' });
  expect(problems, problems.join('\n')).toEqual([]);
});

test('the low wall shows Climb, Space climbs it and the Promise on top is taken', async ({ page }) => {
  const problems = watchConsole(page);
  await openPlay(page);
  const wall = await page.evaluate(
    () =>
      (window as unknown as PlayWindow).__pilgrim.play!.world.level.landmarks.find(
        (l) => l.id === 'test_ledge',
      )!.at!,
  );
  // 2.4 m in front of the wall, on the Way side, facing it.
  await facePoint(page, wall[0], wall[2], 2.4);
  await page.keyboard.down('KeyW');
  const climb = await page.evaluate(() =>
    (window as unknown as PlayWindow).__pilgrim.services.get('i18n').t('ui.verb.climb'),
  );
  await expect.poll(() => bubbleText(page), { timeout: 5000 }).toContain(climb);
  // Climbing is the jump button's job: the bubble shows the Space keycap.
  await expect(page.locator('.hud-bubble kbd')).toHaveText('Space');
  await page.keyboard.press('Space');
  const rise = await peakRise(page, 2.5);
  await page.keyboard.up('KeyW');
  expect(rise).toBeGreaterThan(0.7); // the wall is about 1 m high
  await expect
    .poll(() => logged(page, 'promise:collected'), { timeout: 5000 })
    .toContainEqual(expect.objectContaining({ id: 'test_p2' }));
  expect(problems, problems.join('\n')).toEqual([]);
});

test('the Slough slows and sinks Christian; standing still raises stepping stones that hold him up', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const problems = watchConsole(page);
  await openPlay(page);
  // Onto the Way 10 m before the middle of the mud, walking on along it.
  await page.evaluate(() => {
    const play = (window as unknown as PlayWindow).__pilgrim.play!;
    const way = play.world.ways.main;
    const mud = play.world.level.water.find((w) => w.kind === 'mud')!;
    const t = way.closest(mud.x, mud.z).t - 10 / way.length;
    const p = way.sample(t);
    const d = way.tangent(t);
    play.teleport(p.x, p.z, Math.atan2(d.x, d.z));
  });
  await waitSim(page, 0.4);
  const slough = (): Promise<{ depth: number; sinking: boolean; onStone: boolean; scale: number }> =>
    page.evaluate(() => {
      const play = (window as unknown as PlayWindow).__pilgrim.play!;
      const s = play.slough;
      return { depth: s.depth, sinking: s.sinking, onStone: s.onStone, scale: play.player.speedScale };
    });
  await page.keyboard.down('KeyW');
  await waitSim(page, 2.5);
  await page.keyboard.up('KeyW');
  const sunk = await slough();
  expect(sunk.sinking).toBe(true);
  expect(sunk.depth).toBeGreaterThan(0.1);
  expect(sunk.scale).toBeLessThan(0.7); // 65% speed in the mud
  // GDD 2.7.5: standing still for 2 s reveals the steps.
  await expect.poll(() => logged(page, 'slough:steps'), { timeout: 8000 }).toHaveLength(1);
  await waitSim(page, 1.6);
  await page.screenshot({ path: `${SHOT_DIR_PLAY}/slough-steps.png` });
  // The stones rise under and around him: on one he stops sinking and climbs back out of the mud.
  await expect.poll(async () => (await slough()).onStone, { timeout: 5000 }).toBe(true);
  await waitSim(page, 1.0);
  const up = await slough();
  expect(up.sinking).toBe(false);
  expect(up.depth).toBeLessThan(sunk.depth);
  // The mud's edge is no invisible wall: walking in from the east side reaches the mud, with no Climb prompt.
  await page.evaluate(() => {
    const play = (window as unknown as PlayWindow).__pilgrim.play!;
    const mud = play.world.level.water.find((w) => w.kind === 'mud')!;
    const a = Math.PI / 6;
    const x = mud.x + Math.cos(a) * (mud.r! + 2);
    const z = mud.z + Math.sin(a) * (mud.r! + 2);
    play.teleport(x, z, Math.atan2(mud.x - x, mud.z - z));
  });
  await waitSim(page, 0.3);
  await page.keyboard.down('KeyW');
  await waitSim(page, 4.5); // half speed in the slough zone
  const rim = await page.evaluate(() => {
    const play = (window as unknown as PlayWindow).__pilgrim.play!;
    const mud = play.world.level.water.find((w) => w.kind === 'mud')!;
    const p = play.player.controller.position;
    return { inside: mud.r! - Math.hypot(p.x - mud.x, p.z - mud.z), sinking: play.slough.sinking };
  });
  expect(await bubbleText(page)).toBeNull();
  await page.keyboard.up('KeyW');
  expect(rim.inside).toBeGreaterThan(0.8);
  expect(rim.sinking).toBe(true);
  expect(problems, problems.join('\n')).toEqual([]);
});

test('a bonk that empties Hope keeps the player locked under I SHALL ARISE', async ({ page }) => {
  const problems = watchConsole(page);
  await openPlay(page);
  await page.evaluate(() => {
    const play = (window as unknown as PlayWindow).__pilgrim.play!;
    const pit = play.world.level.landmarks.find((l) => l.type === 'pit')!;
    play.teleport(pit.at![0] + 3, pit.at![2], -Math.PI / 2);
    play.state.setHope(4); // the bonk's -5 takes it to 0
  });
  await waitSim(page, 0.3);
  await page.keyboard.down('KeyW'); // held the whole time, as a child would
  await expect(page.locator('.pg-arise')).toBeVisible({ timeout: 8000 });
  const modes: string[] = [];
  for (let i = 0; i < 10; i++) {
    await waitSim(page, 0.3);
    modes.push(await page.evaluate(() => (window as unknown as PlayWindow).__pilgrim.play!.player.mode));
  }
  await page.keyboard.up('KeyW');
  expect(
    modes.every((m) => m === 'locked'),
    modes.join(' '),
  ).toBe(true);
  await expect(page.locator('.pg-arise')).toHaveCount(0, { timeout: 15_000 });
  expect(await page.evaluate(() => (window as unknown as PlayWindow).__pilgrim.play!.player.mode)).toBe(
    'play',
  );
  expect(await logged(page, 'player:bonk')).toHaveLength(1);
  expect(problems, problems.join('\n')).toEqual([]);
});

test('low Hope greys the world; Hope 0 shows I SHALL ARISE and wakes the player at the waystone with Hope 60', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const problems = watchConsole(page);
  await openPlay(page);
  await faceWaystone(page, 'test_w1');
  await page.keyboard.press('KeyE');
  await expect.poll(() => logged(page, 'save:written'), { timeout: 5000 }).toContainEqual({ slot: 'auto' });
  // Walk away, then lose Hope: below 30 the world loses its colour.
  await toWayStart(page);
  await page.keyboard.down('KeyW');
  await waitSim(page, 1.5);
  await page.keyboard.up('KeyW');
  await page.evaluate(() => (window as unknown as PlayWindow).__pilgrim.play!.state.setHope(10));
  await waitSim(page, 2.5);
  await page.screenshot({ path: `${SHOT_DIR_PLAY}/hud-lantern-low-hope.png` });
  await page.evaluate(() => (window as unknown as PlayWindow).__pilgrim.play!.state.setHope(0));
  await expect(page.locator('.pg-arise')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.pg-arise')).toContainText('I SHALL ARISE');
  await page.waitForTimeout(2200);
  await page.screenshot({ path: `${SHOT_DIR_PLAY}/arise-screen.png` });
  await expect(page.locator('.pg-arise')).toHaveCount(0, { timeout: 15_000 });
  const after = await page.evaluate(() => {
    const play = (window as unknown as PlayWindow).__pilgrim.play!;
    const ws = play.world.level.waystones.find((w) => w.id === 'test_w1')!;
    const p = play.player.controller.position;
    return {
      hope: play.state.hope,
      mode: play.player.mode,
      dist: Math.hypot(p.x - ws.at[0], p.z - ws.at[2]),
    };
  });
  expect(after.hope).toBe(60);
  expect(after.mode).toBe('play');
  expect(after.dist).toBeLessThan(6);
  expect((await logged(page, 'player:arise')).length).toBe(1);
  expect(problems, problems.join('\n')).toEqual([]);
});

test('restarting the play session 3 times does not grow GPU memory or the event bus', async ({ page }) => {
  test.setTimeout(120_000);
  const problems = watchConsole(page);
  await openPlay(page);
  await frames(page, 30);
  const listeners = (): Promise<number> =>
    page.evaluate(() => (window as unknown as PlayWindow).__pilgrim.events.count());
  const baseline = await gpuMemory(page);
  const baseEvents = await listeners();
  let late: string[] = [];
  for (let i = 0; i < 3; i++) {
    if (i === 1) {
      // Mid-Cross: the session owns the run, so nothing of it (joy theme, burden:dropped) outlives the session.
      late = await page.evaluate(async () => {
        const P = (window as unknown as PlayWindow).__pilgrim;
        const play = P.play!;
        play.goToCross();
        void play.crossDrop();
        const t0 = P.engine!.loop.elapsed;
        await new Promise<void>((done) => {
          const tick = (): void =>
            P.engine!.loop.elapsed - t0 >= 4 ? done() : void requestAnimationFrame(tick);
          tick();
        });
        const seen: string[] = [];
        let stopped = false;
        const offs = [
          P.events.on('music:stop', () => (stopped = true)),
          P.events.on('music:play', (p) => {
            if (stopped && (p as { state?: string }).state === 'joy') seen.push('music:play joy');
          }),
          P.events.on('burden:dropped', () => seen.push('burden:dropped')),
        ];
        await P.restartMode();
        await new Promise((done) => setTimeout(done, 500));
        for (const off of offs) off();
        return seen;
      });
    } else {
      await page.evaluate(() => (window as unknown as PlayWindow).__pilgrim.restartMode());
    }
    await waitForMode(page);
    await frames(page, 30);
  }
  expect(late).toEqual([]);
  const last = await gpuMemory(page);
  const events = await listeners();
  console.log(
    `GPU ${baseline.geometries}g/${baseline.textures}t → ${last.geometries}g/${last.textures}t, ` +
      `listeners ${baseEvents} → ${events}`,
  );
  expect(last.geometries).toBeLessThanOrEqual(baseline.geometries);
  expect(last.textures).toBeLessThanOrEqual(baseline.textures);
  expect(events).toBe(baseEvents);
  expect(await page.locator('#ui .pg-arise').count()).toBe(0);
  expect(problems, problems.join('\n')).toEqual([]);
});
