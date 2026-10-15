import type { Page } from '@playwright/test';
import { frames, waitForMode, type PilgrimHandle } from './support';

/**
 * Shared helpers for the Phase 2 play specs (play.spec.ts, play-world.spec.ts): the loose typings of the play
 * session that `window.__pilgrim.play` exposes (src/world/PlaySession.ts), an event log, waits on the
 * simulated clock (the fixed-step loop, so timing does not depend on how fast the headless GPU draws), and moving
 * the player around the test level (content/levels/test.json). Report screenshots go to test-results/phase2/.
 */

/** Where the Phase 2 report screenshots go (Playwright clears test-results/ at the start of each run). */
export const SHOT_DIR_PLAY = 'test-results/phase2';

/** GDD 2.7.1 speeds (m/s) and how close the measured ones must be. */
export const SPEED = { burdened: 2.4, burdenedRun: 3.36, walk: 2.72, run: 4.8, tolerance: 0.3 };

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export interface PlayHandle {
  readonly player: {
    readonly controller: { readonly position: V3; readonly velocity: V3; readonly grounded: boolean };
    readonly mode: string;
    readonly speedScale: number;
    readonly character: { readonly burdenSize: number };
  };
  readonly state: {
    readonly hope: number;
    readonly burden: boolean;
    readonly waystone: string;
    setHope(v: number): void;
    hasPromise(id: string): boolean;
  };
  readonly slough: { readonly depth: number; readonly sinking: boolean; readonly onStone: boolean };
  readonly world: {
    readonly level: {
      readonly waystones: Array<{ id: string; at: [number, number, number] }>;
      readonly promises: Array<{ id: string; at: [number, number, number] }>;
      readonly landmarks: Array<{ id: string; type: string; at?: [number, number, number] }>;
      readonly water: Array<{ kind: string; x: number; z: number; r?: number }>;
    };
    readonly ways: {
      readonly main: {
        readonly halfWidth: number;
        readonly length: number;
        closest(x: number, z: number): { t: number; dist: number; point: V3 };
        sample(t: number): V3;
        tangent(t: number): V3;
      };
    };
  };
  readonly view: { readonly matrixWorld: { readonly elements: ArrayLike<number> } };
  teleport(x: number, z: number, facing?: number): void;
  crossDrop(): Promise<void>;
  goToCross(): boolean;
  spawn(): { x: number; z: number; facing: number };
}

interface Bus {
  on(name: string, fn: (payload?: unknown) => void): () => void;
  count(): number;
}

export type PlayWindow = Window & {
  __pilgrim: PilgrimHandle & {
    play: PlayHandle | null;
    events: Bus;
    services: { get(key: 'i18n'): { t(key: string): string } };
    engine: { loop: { elapsed: number } } | null;
  };
  __log: Array<{ name: string; payload: unknown }>;
};

/** Events the specs look at, recorded into `window.__log`. */
const LOGGED = [
  'save:written',
  'hud:toast',
  'promise:collected',
  'player:arise',
  'player:bonk',
  'sfx',
  'burden:dropped',
  'slough:steps',
];

/** Opens the test world and records the events the tests look at into `window.__log`. */
export async function openPlay(page: Page): Promise<void> {
  await page.goto('/?chapter=test');
  await waitForMode(page);
  await page.waitForFunction(() => (window as unknown as PlayWindow).__pilgrim.play != null);
  await page.evaluate((names) => {
    const w = window as unknown as PlayWindow;
    w.__log = [];
    for (const name of names) w.__pilgrim.events.on(name, (payload) => w.__log.push({ name, payload }));
  }, LOGGED);
  // Screenshots show the game, not the "Click to play" overlay (headless Chrome has no pointer lock).
  await page.addStyleTag({ content: '.pg-click-to-play { display: none !important; }' });
  await frames(page, 20);
}

export async function logged(page: Page, name: string): Promise<unknown[]> {
  return page.evaluate(
    (n) => (window as unknown as PlayWindow).__log.filter((e) => e.name === n).map((e) => e.payload),
    name,
  );
}

/** Simulated seconds (the fixed-step loop clock). */
export async function simTime(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as PlayWindow).__pilgrim.engine?.loop.elapsed ?? 0);
}

export async function waitSim(page: Page, seconds: number): Promise<void> {
  const until = (await simTime(page)) + seconds;
  await page.waitForFunction(
    (t) => ((window as unknown as PlayWindow).__pilgrim.engine?.loop.elapsed ?? 0) >= t,
    until,
    { timeout: seconds * 1000 * 4 + 5000 },
  );
}

export async function playerPos(page: Page): Promise<V3 & { grounded: boolean; t: number }> {
  return page.evaluate(() => {
    const w = window as unknown as PlayWindow;
    const c = w.__pilgrim.play!.player.controller;
    return {
      x: c.position.x,
      y: c.position.y,
      z: c.position.z,
      grounded: c.grounded,
      t: w.__pilgrim.engine!.loop.elapsed,
    };
  });
}

/** The camera's horizontal forward (unit). */
export async function cameraForward(page: Page): Promise<{ x: number; z: number }> {
  return page.evaluate(() => {
    // A camera looks down its -Z axis: forward is minus the third column of its world matrix.
    const e = (window as unknown as PlayWindow).__pilgrim.play!.view.matrixWorld.elements;
    const x = -e[8]!;
    const z = -e[10]!;
    const len = Math.hypot(x, z) || 1;
    return { x: x / len, z: z / len };
  });
}

/** Back to the Way start (where the Way runs straight for 35 m), facing along it, camera snapped behind. */
export async function toWayStart(page: Page): Promise<void> {
  await page.evaluate(() => {
    const play = (window as unknown as PlayWindow).__pilgrim.play!;
    const s = play.spawn();
    play.teleport(s.x, s.z, s.facing);
  });
  await waitSim(page, 0.3);
}

/** Horizontal speed (m/s) while `hold` is in force: 1 s to settle, then measured over 1.2 s of simulated time. */
export async function measureSpeed(
  page: Page,
  hold: () => Promise<void>,
  release: () => Promise<void>,
): Promise<number> {
  await hold();
  await waitSim(page, 1.0);
  const a = await playerPos(page);
  await waitSim(page, 1.2);
  const b = await playerPos(page);
  await release();
  return Math.hypot(b.x - a.x, b.z - a.z) / (b.t - a.t);
}

/** Highest point above the start height while waiting `seconds` of simulated time. */
export async function peakRise(page: Page, seconds: number): Promise<number> {
  const start = (await playerPos(page)).y;
  return page.evaluate(
    ({ seconds, start }) =>
      new Promise<number>((done) => {
        const w = window as unknown as PlayWindow;
        const loop = w.__pilgrim.engine!.loop;
        const until = loop.elapsed + seconds;
        let peak = 0;
        const tick = (): void => {
          const p = w.__pilgrim.play!.player.controller.position;
          peak = Math.max(peak, p.y - start);
          if (loop.elapsed >= until) done(peak);
          else requestAnimationFrame(tick);
        };
        tick();
      }),
    { seconds, start },
  );
}

/** Stands the player `dist` m in front of a level point (on the Way side), facing it. */
export async function facePoint(page: Page, x: number, z: number, dist: number): Promise<void> {
  await page.evaluate(
    ({ x, z, dist }) => {
      const play = (window as unknown as PlayWindow).__pilgrim.play!;
      const c = play.world.ways.main.closest(x, z).point;
      const dx = x - c.x;
      const dz = z - c.z;
      const len = Math.hypot(dx, dz) || 1;
      play.teleport(x - (dx / len) * dist, z - (dz / len) * dist, Math.atan2(dx, dz));
    },
    { x, z, dist },
  );
  await waitSim(page, 0.4);
}

/** Stands the player 1.6 m in front of a waystone, facing it. */
export async function faceWaystone(page: Page, id: string): Promise<void> {
  const at = await page.evaluate(
    (wid) =>
      (window as unknown as PlayWindow).__pilgrim.play!.world.level.waystones.find((w) => w.id === wid)!.at,
    id,
  );
  await facePoint(page, at[0], at[2], 1.6);
}

/** Holds keyboard keys (in order) and releases them (in reverse). */
export function keys(page: Page, list: string[]): { down(): Promise<void>; up(): Promise<void> } {
  return {
    down: async () => {
      for (const k of list) await page.keyboard.down(k);
    },
    up: async () => {
      for (const k of [...list].reverse()) await page.keyboard.up(k);
    },
  };
}

/** Text of the interaction bubble while it is on screen, else null. */
export async function bubbleText(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const b = document.querySelector('.hud-bubble');
    return b && b.classList.contains('is-on') ? (b.textContent ?? '') : null;
  });
}

/** What `watchCross` measured over a Cross sequence. */
export interface CrossWatch {
  /** Highest the drawn feet got above the ground while the scene owned Christian, before the joy leap (m). */
  rootUp: number;
  /** Closest the camera came to his chest (m). */
  nearest: number;
  /** Fastest the camera moved (m/s of camera time, so a slow frame cannot fake a whip). */
  speed: number;
  /** Seconds with neither Christian, the sack nor the tomb's mouth in view. */
  empty: number;
}

/**
 * Logs every rendered frame of a Cross sequence (camera, Christian, the sack, the tomb's mouth) until
 * `crossWatchResult` reads it. Call right before `crossDrop()`.
 */
export async function watchCross(page: Page): Promise<void> {
  await page.evaluate(() => {
    type V = {
      x: number;
      y: number;
      z: number;
      copy(v: V): V;
      project(c: unknown): V;
      distanceTo(v: V): number;
    };
    const w = window as unknown as PlayWindow & { __crossWatch: CrossWatch; __crossOff: () => void };
    const P = w.__pilgrim as unknown as {
      engine: { loop: { add(s: unknown, order: number): () => void; timeScale: number } };
      play: PlayHandle & {
        view: { position: V; updateMatrixWorld(): void };
        world: PlayHandle['world'] & {
          terrain: { heightAt(x: number, z: number): number };
          scene: { getObjectByName(n: string): { visible: boolean; getWorldPosition(v: V): V } | undefined };
        };
        player: PlayHandle['player'] & { character: { root: { position: V } } };
        col: { groundAt(x: number, z: number, fromY?: number): number };
      };
    };
    const play = P.play;
    const cam = play.view;
    const Vec = cam.position.constructor as new (x?: number, y?: number, z?: number) => V;
    const tomb = play.world.level.landmarks.find((l) => l.type === 'tomb') as { at: number[]; rotY?: number };
    const rot = tomb.rotY ?? 0;
    const mx = tomb.at[0]! + Math.sin(rot) * 0.62;
    const mz = tomb.at[2]! + Math.cos(rot) * 0.62;
    const mouth = new Vec(mx, play.world.terrain.heightAt(mx, mz) + 0.4, mz);
    const tmp = new Vec();
    const seen = (p: V): boolean => {
      tmp.copy(p).project(cam);
      return tmp.z > -1 && tmp.z < 1 && Math.abs(tmp.x) <= 0.95 && Math.abs(tmp.y) <= 0.95;
    };
    const last = new Vec(NaN, NaN, NaN);
    const res: CrossWatch = { rootUp: 0, nearest: Infinity, speed: 0, empty: 0 };
    w.__crossWatch = res;
    w.__crossOff = P.engine.loop.add(
      {
        render: (_a: number, frameDt: number) => {
          cam.updateMatrixWorld();
          const dt = frameDt * P.engine.loop.timeScale;
          const feet = play.player.character.root.position;
          const chest = new Vec(feet.x, feet.y + 0.9, feet.z);
          if (dt > 1e-4 && Number.isFinite(last.x))
            res.speed = Math.max(res.speed, cam.position.distanceTo(last) / dt);
          last.copy(cam.position);
          res.nearest = Math.min(res.nearest, cam.position.distanceTo(chest));
          if (play.player.mode === 'cutscene' && play.state.burden)
            // the kneel (the joy leap is a real leap)
            res.rootUp = Math.max(res.rootUp, feet.y - play.col.groundAt(feet.x, feet.z, feet.y + 0.5));
          const sack = play.world.scene.getObjectByName('cross:sack');
          const sackSeen = sack !== undefined && sack.visible && seen(sack.getWorldPosition(new Vec()));
          const him = seen(chest) || seen(new Vec(feet.x, feet.y + 1.4, feet.z));
          if (!him && !sackSeen && !seen(mouth)) res.empty += dt;
        },
      },
      999,
    );
  });
}

/** Stops the `watchCross` log and returns what it measured. */
export async function crossWatchResult(page: Page): Promise<CrossWatch> {
  return page.evaluate(() => {
    const w = window as unknown as { __crossWatch: CrossWatch; __crossOff: () => void };
    w.__crossOff();
    return w.__crossWatch;
  });
}
