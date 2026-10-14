import type { Page } from '@playwright/test';

/**
 * Shared helpers for the Phase 3 story / UI specs (story.spec.ts, story-shots.spec.ts): loose typings of what the
 * page exposes, the GameFlow probe, a fake standard gamepad, and drivers for the `?dialogue=test` conversation.
 */

export const SHOT_DIR = 'test-results/phase3a';
export const SETTINGS_KEY = 'pilgrim.settings.v1';

export interface FlowProbe {
  state: string;
  screen: string;
  chapter: number | null;
  loopPaused: boolean;
  titleReady: boolean;
  continueAvailable: boolean;
  focused: string | null;
  menuDepth: number;
}

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** What story tests read from `window.__pilgrim` and the services (all loosely typed). */
export interface StoryWindow {
  __pilgrim: {
    ready?: boolean;
    modeReady?: boolean;
    engine: { camera: { position: Vec3 } };
    events: { on(name: string, fn: (payload: unknown) => void): () => void };
    services: { get(key: string): unknown; tryGet(key: string): unknown };
  };
  __pad?: { set(button: number, down: boolean): void };
  __spy?: DialogueSpy;
}

/** Recorded by installDialogueSpy(): every line (with the camera position at that moment) and babble call. */
export interface DialogueSpy {
  lines: Array<{ node: string; key: string; bubble: boolean; cps: number; cam: [number, number, number] }>;
  babble: string[];
  hope: number[];
  chose: number[];
}

export interface RunnerHandle {
  active: boolean;
  phase: string;
  line: { node: string; key: string; bubble: boolean } | null;
}

export async function flowProbe(page: Page): Promise<FlowProbe> {
  return page.evaluate(() => {
    const flow = (window as unknown as StoryWindow).__pilgrim.services.get('flow') as { probe(): FlowProbe };
    return flow.probe();
  });
}

/** Polls the flow probe until `test` passes (or throws after `timeout` ms with the last probe). */
export async function waitForFlow(
  page: Page,
  test: (p: FlowProbe) => boolean,
  timeout = 30_000,
): Promise<FlowProbe> {
  const end = Date.now() + timeout;
  let last: FlowProbe | null = null;
  while (Date.now() < end) {
    last = await page
      .evaluate(() => {
        const svc = (window as unknown as StoryWindow).__pilgrim?.services;
        const flow = svc?.tryGet('flow') as { probe(): FlowProbe } | undefined;
        return flow ? flow.probe() : null;
      })
      .catch(() => null);
    if (last && test(last)) return last;
    await page.waitForTimeout(100);
  }
  throw new Error(`flow did not reach the expected state; last probe: ${JSON.stringify(last)}`);
}

/** A standard-mapping gamepad the page sees through navigator.getGamepads(); drive it with padTap(). */
export async function installFakePad(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const buttons = Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }));
    const pad = {
      id: 'Fake pad (STANDARD GAMEPAD)',
      index: 0,
      connected: true,
      mapping: 'standard',
      buttons,
      axes: [0, 0, 0, 0],
      timestamp: 1,
      vibrationActuator: null,
    };
    (window as unknown as StoryWindow).__pad = {
      set(button: number, down: boolean): void {
        const b = buttons[button];
        if (!b) return;
        b.pressed = down;
        b.touched = down;
        b.value = down ? 1 : 0;
        pad.timestamp = performance.now();
      },
    };
    Object.defineProperty(Navigator.prototype, 'getGamepads', {
      configurable: true,
      value: () => [pad, null, null, null],
    });
  });
}

/** Standard-mapping buttons. */
export const PAD = { A: 0, B: 1, RB: 5, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 } as const;

/** Presses and lets go of a fake-pad button (held long enough for menus polling once per frame). */
export async function padTap(page: Page, button: number, holdMs = 120): Promise<void> {
  await page.evaluate((b) => (window as unknown as StoryWindow).__pad?.set(b, true), button);
  await page.waitForTimeout(holdMs);
  await page.evaluate((b) => (window as unknown as StoryWindow).__pad?.set(b, false), button);
  await page.waitForTimeout(180);
}

/** The id (data-focus-id / data-key) or tag of the focused element. */
export async function focusedId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return el?.dataset['focusId'] ?? el?.dataset['key'] ?? el?.tagName ?? '';
  });
}

// ----------------------------------------------------------------------------------------- dialogue demo

/** Records 'dialogue:line' (with the camera position), babble.speak calls, Hope changes and choices. */
export async function installDialogueSpy(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as StoryWindow;
    const p = w.__pilgrim;
    const spy: DialogueSpy = { lines: [], babble: [], hope: [], chose: [] };
    w.__spy = spy;
    p.events.on('dialogue:line', (raw) => {
      const l = raw as { node: string; key: string; bubble: boolean; cps: number };
      const c = p.engine.camera.position;
      spy.lines.push({ node: l.node, key: l.key, bubble: l.bubble, cps: l.cps, cam: [c.x, c.y, c.z] });
    });
    p.events.on('hope:changed', (raw) => spy.hope.push((raw as { delta: number }).delta));
    p.events.on('dialogue:chose', (raw) => spy.chose.push((raw as { index: number }).index));
    const audio = p.services.get('audio') as {
      babble: { speak(voice: unknown, text: string, opts?: unknown): unknown };
    };
    const speak = audio.babble.speak;
    audio.babble.speak = (voice, text, opts) => {
      spy.babble.push(text);
      return speak(voice, text, opts);
    };
  });
}

export async function readSpy(page: Page): Promise<DialogueSpy> {
  return page.evaluate(() => (window as unknown as StoryWindow).__spy as DialogueSpy);
}

export async function runnerState(page: Page): Promise<RunnerHandle> {
  return page.evaluate(() => {
    const r = (window as unknown as StoryWindow).__pilgrim.services.get('dialogue') as RunnerHandle;
    return { active: r.active, phase: r.phase, line: r.line ? { ...r.line } : null };
  });
}

export async function hope(page: Page): Promise<number> {
  return page.evaluate(
    () => ((window as unknown as StoryWindow).__pilgrim.services.get('state') as { hope: number }).hope,
  );
}

/** Presses Space (reveal, then next) until `done` holds for the runner, e.g. choices are up or it ended. */
export async function spaceUntil(
  page: Page,
  done: (r: RunnerHandle) => boolean,
  timeout = 30_000,
): Promise<RunnerHandle> {
  const end = Date.now() + timeout;
  for (;;) {
    const r = await runnerState(page);
    if (done(r)) return r;
    if (Date.now() > end) throw new Error(`dialogue stuck: ${JSON.stringify(r)}`);
    if (r.phase === 'typing' || r.phase === 'shown') await page.keyboard.press('Space');
    await page.waitForTimeout(220);
  }
}

/** Starts the `?dialogue=test` sample with the demo's Play button and waits for its first line. */
export async function playSample(page: Page): Promise<void> {
  await page.locator('.dtest-play').click();
  await page.waitForFunction(() => {
    const r = (window as unknown as StoryWindow).__pilgrim.services.tryGet('dialogue') as
      RunnerHandle | undefined;
    return r?.active === true && r.line !== null;
  });
}
