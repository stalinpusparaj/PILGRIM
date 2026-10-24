import { expect, test, type Page } from '@playwright/test';
import { waitForMode, watchConsole } from './support';
import {
  SHOT_DIR_PLAY,
  SPEED,
  bubbleText,
  cameraForward,
  crossWatchResult,
  faceWaystone,
  keys,
  logged,
  measureSpeed,
  openPlay,
  peakRise,
  playerPos,
  toWayStart,
  waitSim,
  watchCross,
  type PlayWindow,
} from './play-support';

/**
 * Phase 2 controls in the test world (`?chapter=test`, a PlaySession on content/levels/test.json): keyboard,
 * touch and gamepad can each move, jump and use a waystone, and the interaction bubble shows the button of the
 * device in use; Normal pace: burdened walking is ~2.4 m/s with a ~3.36 m/s fast walk, and after the debug Cross drop the free walk is
 * ~3.4 m/s, the run ~6 m/s and the first three jumps are joy jumps; a hop in the Cross's slow-down never leaves him
 * kneeling in the air, and its camera swings round him gently with someone always in view. A keyboard player's Tab
 * never takes focus off "Click to play". Every test runs with a clean console. Saves Phase 2 report screenshots to
 * test-results/phase2/.
 */
test.describe.configure({ mode: 'serial' });

interface MockPad {
  id: string;
  index: number;
  connected: boolean;
  mapping: string;
  timestamp: number;
  axes: number[];
  buttons: Array<{ pressed: boolean; touched: boolean; value: number }>;
}
type PadWindow = PlayWindow & { __pad: MockPad };

/** The glyph the bubble shows: a keycap's text, or 'icon' for a picture (touch button, pad badge). */
async function bubbleGlyph(page: Page): Promise<{ device: string; key: string | null; icon: boolean }> {
  return page.evaluate(() => {
    const b = document.querySelector<HTMLElement>('.hud-bubble')!;
    const kbd = b.querySelector('.hud-bubble__glyph kbd');
    return {
      device: b.dataset.device ?? '',
      key: kbd ? (kbd.textContent ?? '') : null,
      icon: b.querySelector('.hud-bubble__glyph svg') !== null,
    };
  });
}

test('keyboard: W walks away from the camera, Space hops, E at a waystone saves and toasts', async ({
  page,
}) => {
  const problems = watchConsole(page);
  await openPlay(page);
  await toWayStart(page);
  const fwd = await cameraForward(page);
  const a = await playerPos(page);
  await page.keyboard.down('KeyW');
  await waitSim(page, 1.5);
  await page.screenshot({ path: `${SHOT_DIR_PLAY}/burdened-walk.png` });
  await page.keyboard.up('KeyW');
  const b = await playerPos(page);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const moved = Math.hypot(dx, dz);
  expect(moved).toBeGreaterThan(1.5);
  expect((dx * fwd.x + dz * fwd.z) / moved).toBeGreaterThan(0.8);

  await waitSim(page, 0.5);
  await page.keyboard.down('Space');
  const rise = await peakRise(page, 0.8);
  await page.keyboard.up('Space');
  expect(rise).toBeGreaterThan(0.15); // burdened hop: 0.3 m

  await faceWaystone(page, 'test_w1');
  const read = await page.evaluate(() =>
    (window as unknown as PlayWindow).__pilgrim.services.get('i18n').t('ui.verb.read'),
  );
  await expect.poll(() => bubbleText(page)).toContain(read);
  expect(await bubbleGlyph(page)).toEqual({ device: 'kbm', key: 'E', icon: false });
  await page.screenshot({ path: `${SHOT_DIR_PLAY}/interaction-bubble-keyboard.png` });
  await page.keyboard.press('KeyE');
  await expect.poll(() => logged(page, 'save:written'), { timeout: 5000 }).toContainEqual({ slot: 'auto' });
  // The waystone's toast is requested and the HUD shows its text.
  const toasts = (await logged(page, 'hud:toast')) as Array<{ key: string }>;
  expect(toasts.map((x) => x.key)).toContain('ui.toast.rollUpdated');
  const text = await page.evaluate(
    (key) => (window as unknown as PlayWindow).__pilgrim.services.get('i18n').t(key),
    'ui.toast.rollUpdated',
  );
  await expect(page.locator('#ui')).toContainText(text, { timeout: 8000 }); // toasts queue one at a time
  expect(await page.evaluate(() => (window as unknown as PlayWindow).__pilgrim.play!.state.waystone)).toBe(
    'test_w1',
  );
  expect(problems, problems.join('\n')).toEqual([]);
});

test('touch: the joystick moves the player, JUMP jumps and tapping the bubble reads a waystone', async ({ page }) => {
  const problems = watchConsole(page);
  await openPlay(page);
  await toWayStart(page);
  // A touch anywhere makes touch the input device: the joystick and round buttons appear.
  await page.evaluate(() => {
    const opts = {
      pointerId: 7,
      pointerType: 'touch',
      clientX: 640,
      clientY: 360,
      bubbles: true,
      isPrimary: true,
    };
    document.body.dispatchEvent(new PointerEvent('pointerdown', opts));
    document.body.dispatchEvent(new PointerEvent('pointerup', opts));
  });
  await expect(page.locator('.pg-touch-btn[data-id="jump"]')).toBeVisible();
  // No bottom USE button on touch: the hand bubble over the object is tapped instead.
  await expect(page.locator('.pg-touch-btn[data-id="use"]')).toBeHidden();

  const a = await playerPos(page);
  await page.evaluate(() => {
    const zone = document.querySelector('.pg-touch-zone')!;
    const at = (type: string, y: number): boolean =>
      zone.dispatchEvent(
        new PointerEvent(type, {
          pointerId: 11,
          pointerType: 'touch',
          clientX: 220,
          clientY: y,
          bubbles: true,
        }),
      );
    at('pointerdown', 520);
    at('pointermove', 440); // push the stick forward
  });
  await waitSim(page, 1.5);
  await page.screenshot({ path: `${SHOT_DIR_PLAY}/touch-controls.png` });
  await page.evaluate(() => {
    document
      .querySelector('.pg-touch-zone')!
      .dispatchEvent(new PointerEvent('pointerup', { pointerId: 11, pointerType: 'touch', bubbles: true }));
  });
  const b = await playerPos(page);
  expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeGreaterThan(1.2);

  const tap = (id: string, ms: number): Promise<void> =>
    page.evaluate(
      async ({ id, ms }) => {
        const btn = document.querySelector(`.pg-touch-btn[data-id="${id}"]`)!;
        const o = { pointerId: 12, pointerType: 'touch', bubbles: true, cancelable: true };
        btn.dispatchEvent(new PointerEvent('pointerdown', o));
        await new Promise((r) => setTimeout(r, ms));
        btn.dispatchEvent(new PointerEvent('pointerup', o));
      },
      { id, ms },
    );
  await waitSim(page, 0.5);
  const press = tap('jump', 150);
  const rise = await peakRise(page, 0.8);
  await press;
  expect(rise).toBeGreaterThan(0.15);

  // The bubble shows the USE button's picture, not a key; USE reads the stone.
  await faceWaystone(page, 'test_w1');
  await expect.poll(() => bubbleText(page)).not.toBeNull();
  expect(await bubbleGlyph(page)).toEqual({ device: 'touch', key: null, icon: true });
  await page.screenshot({ path: `${SHOT_DIR_PLAY}/interaction-bubble-touch.png` });
  await page.evaluate(() => {
    const r = document.querySelector('.hud-bubble.is-on')!.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const zone = [...document.querySelectorAll('.pg-touch-zone')].find((z) => {
      const zr = z.getBoundingClientRect();
      return x >= zr.left && x <= zr.right;
    })!;
    const o = { pointerId: 13, pointerType: 'touch', clientX: x, clientY: r.top + r.height / 2, bubbles: true, cancelable: true };
    zone.dispatchEvent(new PointerEvent('pointerdown', o));
    zone.dispatchEvent(new PointerEvent('pointerup', o));
  });
  await expect.poll(() => logged(page, 'save:written'), { timeout: 5000 }).toContainEqual({ slot: 'auto' });
  expect(problems, problems.join('\n')).toEqual([]);
});

test('gamepad: left stick moves, A jumps, X uses a waystone', async ({ page }) => {
  const problems = watchConsole(page);
  await page.addInitScript(() => {
    const w = window as unknown as PadWindow;
    w.__pad = {
      id: 'Mock pad (STANDARD GAMEPAD)',
      index: 0,
      connected: true,
      mapping: 'standard',
      timestamp: 1,
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    };
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => [w.__pad, null, null, null],
    });
  });
  const pad = async (axes: number[] | null, button?: [number, boolean]): Promise<void> => {
    await page.evaluate(
      ({ axes, button }) => {
        const p = (window as unknown as PadWindow).__pad;
        if (axes) p.axes = axes;
        if (button)
          p.buttons[button[0]] = { pressed: button[1], touched: button[1], value: button[1] ? 1 : 0 };
        p.timestamp++;
      },
      { axes, button },
    );
  };
  await openPlay(page);
  await toWayStart(page);
  const a = await playerPos(page);
  await pad([0, -1, 0, 0]);
  await waitSim(page, 1.5);
  await pad([0, 0, 0, 0]);
  const b = await playerPos(page);
  expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeGreaterThan(1.5);

  await waitSim(page, 0.5);
  await pad(null, [0, true]);
  const rise = await peakRise(page, 0.8);
  await pad(null, [0, false]);
  expect(rise).toBeGreaterThan(0.15);

  await faceWaystone(page, 'test_w1');
  await expect.poll(() => bubbleText(page)).not.toBeNull();
  expect(await bubbleGlyph(page)).toEqual({ device: 'pad', key: null, icon: true });
  await page.screenshot({ path: `${SHOT_DIR_PLAY}/interaction-bubble-pad.png` });
  await pad(null, [2, true]);
  await waitSim(page, 0.2);
  await pad(null, [2, false]);
  await expect.poll(() => logged(page, 'save:written'), { timeout: 5000 }).toContainEqual({ slot: 'auto' });
  expect(problems, problems.join('\n')).toEqual([]);
});

test('Normal pace: burdened walk ~1.6 m/s with no running; after the debug Cross drop free walk ~2.72, run ~4.8 and three joy jumps', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const problems = watchConsole(page);
  await openPlay(page);
  await toWayStart(page);
  const w = keys(page, ['KeyW']);
  const burdened = await measureSpeed(page, w.down, w.up);
  // Burdened: holding run changes nothing (GDD 2.7.1).
  await toWayStart(page);
  const sw = keys(page, ['ShiftLeft', 'KeyW']);
  const burdenedRun = await measureSpeed(page, sw.down, sw.up);
  console.log(`burdened walk ${burdened.toFixed(2)} m/s, with run held ${burdenedRun.toFixed(2)} m/s`);
  expect(Math.abs(burdened - SPEED.burdened)).toBeLessThan(SPEED.tolerance);
  expect(Math.abs(burdenedRun - SPEED.burdenedRun)).toBeLessThan(SPEED.tolerance);

  // The whole GDD 2.7.1 sequence at the level's cross, with a few report frames along the way.
  await page.evaluate(() => (window as unknown as PlayWindow).__pilgrim.play!.goToCross());
  await waitSim(page, 0.5);
  await watchCross(page);
  const crossing = page.evaluate(() => (window as unknown as PlayWindow).__pilgrim.play!.crossDrop());
  // A child tapping Space while input slows: no hop, and certainly no kneeling in mid-air.
  await waitSim(page, 0.85);
  await page.keyboard.press('Space');
  for (const [at, name] of [
    [2.55, 'ropes'],
    [2.6, 'sack-rolling'],
    [2.0, 'tomb'],
    [2.6, 'stretch'],
  ] as const) {
    await waitSim(page, at);
    await page.screenshot({ path: `${SHOT_DIR_PLAY}/cross-drop-${name}.png` });
  }
  await crossing;
  const cam = await crossWatchResult(page);
  console.log(
    `Cross: feet above ground ${cam.rootUp.toFixed(3)} m, camera ≥ ${cam.nearest.toFixed(2)} m from him, ` +
      `≤ ${cam.speed.toFixed(1)} m/s, ${cam.empty.toFixed(2)} s with nobody in view`,
  );
  expect(cam.rootUp).toBeLessThan(0.03);
  expect(cam.nearest).toBeGreaterThan(2.5); // GDD 2.5: gentle eased moves, never through him
  expect(cam.speed).toBeLessThan(8);
  expect(cam.empty).toBeLessThan(0.15);
  const after = await page.evaluate(() => {
    const play = (window as unknown as PlayWindow).__pilgrim.play!;
    return { burden: play.state.burden, size: play.player.character.burdenSize, mode: play.player.mode };
  });
  expect(after.burden).toBe(false);
  expect(after.size).toBe(0);
  expect(after.mode).toBe('play');
  expect((await logged(page, 'burden:dropped')).length).toBe(1);
  // GDD 2.7.1: three plucked ropes, two bounces, the thoom.
  const ids = ((await logged(page, 'sfx')) as Array<{ id: string }>).map((s) => s.id);
  expect(ids.filter((id) => id === 'rope_snap').length).toBe(3);
  expect(ids.filter((id) => id === 'sack_roll').length).toBe(2);
  expect(ids.filter((id) => id === 'tomb_thoom').length).toBe(1);

  await toWayStart(page);
  const walk = await measureSpeed(page, w.down, w.up);
  await toWayStart(page);
  await sw.down();
  await waitSim(page, 1.2);
  await page.screenshot({ path: `${SHOT_DIR_PLAY}/free-run.png` });
  await sw.up();
  await toWayStart(page);
  const run = await measureSpeed(page, sw.down, sw.up);
  console.log(`free walk ${walk.toFixed(2)} m/s, run ${run.toFixed(2)} m/s`);
  expect(Math.abs(walk - SPEED.walk)).toBeLessThan(SPEED.tolerance);
  expect(Math.abs(run - SPEED.run)).toBeLessThan(SPEED.tolerance * 1.5);

  // Joy jumps: the first three jumps after the Cross ring rising notes; the fourth is a plain jump.
  await toWayStart(page);
  const notes = async (): Promise<number> =>
    ((await logged(page, 'sfx')) as Array<{ id: string }>).filter((s) => s.id === 'joy_note').length;
  const before = await notes();
  for (let i = 0; i < 4; i++) {
    await page.keyboard.down('Space');
    const rise = await peakRise(page, 0.3);
    if (i === 0) await page.screenshot({ path: `${SHOT_DIR_PLAY}/joy-jump.png` });
    await page.keyboard.up('Space');
    await page.waitForFunction(
      () => (window as unknown as PlayWindow).__pilgrim.play!.player.controller.grounded,
    );
    await waitSim(page, 0.6);
    expect(rise).toBeGreaterThan(0.3); // free jump: 1.1 m
  }
  expect((await notes()) - before).toBe(3);
  expect(problems, problems.join('\n')).toEqual([]);
});

test('keyboard only: losing the pointer lock pauses; Tab stays in the menu and Enter goes back to play', async ({ page }) => {
  const problems = watchConsole(page);
  await page.goto('/?chapter=test');
  await waitForMode(page);
  // Headless Chrome grants the pointer lock at once; letting it go is what Esc or alt-tab do. Under the game flow
  // that opens the pause menu, and KEEP GOING (Enter) takes the lock back, so no mouse is ever needed.
  await page.evaluate(() => document.exitPointerLock());
  const resume = page.locator('[data-key="ui.pause.resume"]');
  await expect(resume).toBeVisible();
  await resume.focus();
  await page.keyboard.press('Tab'); // the Satchel key (GDD 2.6): focus must stay inside the menu
  expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
  await resume.focus();
  await page.keyboard.press('Enter');
  await expect(resume).toBeHidden();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __pilgrim: { services: { get(k: 'input'): { pointerLocked: boolean } } } })
            .__pilgrim.services.get('input').pointerLocked,
      ),
    )
    .toBe(true);
  expect(problems, problems.join('\n')).toEqual([]);
});
