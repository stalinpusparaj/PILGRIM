import { expect, test } from '@playwright/test';
import { frames, watchConsole } from './support';
import { openPlay, waitSim, type PlayWindow } from './play-support';

/**
 * Phase 2 controller and camera regressions in the test world (`?chapter=test`): with the real CollisionWorld and
 * KinematicController, free jumps in place and drops from many heights land on a walkable box top (never shoved off
 * its side); walking up a 0.22 m step, the follow camera rises with Christian without dipping first. Runs with a
 * clean console.
 */

test('jumps and drops land on walkable tops, and the camera rides a step up without dipping', async ({
  page,
}) => {
  const problems = watchConsole(page);
  await openPlay(page);
  // The real CollisionWorld and controller class, with a 4 x 4 m box 1 m tall in the open beside the Way's start.
  const land = await page.evaluate(() => {
    type Vec = { x: number; y: number; z: number; clone(): Vec; set(x: number, y: number, z: number): Vec };
    type Ctrl = {
      position: Vec;
      teleport(p: Vec): void;
      step(dt: number, wish: { x: number; z: number }, jump: boolean, p: object): { landed: boolean };
    };
    const play = (window as unknown as PlayWindow).__pilgrim.play! as unknown as {
      spawn(): { x: number; z: number; facing: number };
      col: {
        groundAt(x: number, z: number): number;
        addCollider(c: object, o: object): number;
        removeCollider(h: number): void;
      };
      player: { controller: Ctrl & { constructor: new (col: unknown, r: number, h: number) => Ctrl } };
    };
    const s = play.spawn();
    const x = s.x + Math.cos(s.facing) * 8;
    const z = s.z - Math.sin(s.facing) * 8;
    const top = play.col.groundAt(x, z) + 1;
    const box = play.col.addCollider(
      { kind: 'box', center: [x, top - 0.5, z], half: [2, 0.5, 2], rotY: 0 },
      { walkable: true },
    );
    const Ctor = play.player.controller.constructor;
    const c = new Ctor(play.col, 0.35, 1.5);
    const free = {
      walkSpeed: 3.4,
      runSpeed: 6,
      jumpHeight: 1.1,
      gravity: 24,
      accel: 30,
      airControl: 0.5,
      slopeLimit: 40,
      stepUp: 0.3,
    };
    const v = (): Vec => c.position.clone();
    const fall = (): void => {
      for (let i = 0; i < 400; i++) if (c.step(1 / 60, { x: 0, z: 0 }, false, free).landed) return;
    };
    let jumpsOnTop = 0;
    for (let j = 0; j < 5; j++) {
      c.teleport(v().set(x + 0.5, top, z));
      c.step(1 / 60, { x: 0, z: 0 }, true, free);
      fall();
      if (Math.abs(c.position.y - top) < 1e-3) jumpsOnTop++;
    }
    let dropsOnTop = 0;
    for (let i = 0; i < 40; i++) {
      c.teleport(v().set(x - 0.6 + i * 0.03, top + 0.6 + i * 0.1, z + 0.4));
      fall();
      if (Math.abs(c.position.y - top) < 1e-3) dropsOnTop++;
    }
    play.col.removeCollider(box);
    return { jumpsOnTop, dropsOnTop };
  });
  expect(land).toEqual({ jumpsOnTop: 5, dropsOnTop: 40 });

  // Free, walking up onto a 0.22 m step on the Way: the camera never drops below where it was.
  await page.evaluate(() => {
    const play = (window as unknown as PlayWindow).__pilgrim
      .play! as unknown as PlayWindow['__pilgrim']['play'] & {
      setBurden(on: boolean): void;
      col: { groundAt(x: number, z: number): number; addCollider(c: object, o: object): number };
    };
    play.setBurden(false);
    const s = play.spawn();
    play.teleport(s.x, s.z, s.facing);
    const x = s.x + Math.sin(s.facing) * 4;
    const z = s.z + Math.cos(s.facing) * 4;
    const g = play.col.groundAt(x, z);
    play.col.addCollider(
      { kind: 'box', center: [x, g + 0.11, z], half: [1.5, 0.11, 0.6], rotY: s.facing },
      { walkable: true },
    );
  });
  await waitSim(page, 0.4);
  const camY = (): Promise<{ cam: number; feet: number }> =>
    page.evaluate(() => {
      const play = (window as unknown as PlayWindow).__pilgrim.play!;
      return { cam: play.view.matrixWorld.elements[13]!, feet: play.player.controller.position.y };
    });
  await page.keyboard.down('KeyW');
  let before: { cam: number; feet: number } = await camY();
  let worst = 0;
  for (let i = 0; i < 90; i++) {
    const now = await camY();
    if (now.feet - before.feet > 0.15) {
      // Stepped up: watch the camera for a few frames.
      for (let k = 0; k < 8; k++) {
        worst = Math.max(worst, before.cam - (await camY()).cam);
        await frames(page, 1);
      }
      break;
    }
    before = now;
    await frames(page, 1);
  }
  await page.keyboard.up('KeyW');
  console.log(`step up: camera dipped ${worst.toFixed(3)} m`);
  expect(worst).toBeLessThan(0.02);
  expect(problems, problems.join('\n')).toEqual([]);
});
