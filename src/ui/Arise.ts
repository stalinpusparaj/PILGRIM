/**
 * I SHALL ARISE (GDD 2.7.2 "At 0: screen fades, then I SHALL ARISE and you wake at the last waystone with Hope
 * 60"; GDD 2.14 "Big text I SHALL ARISE, small text 'When I fall, I shall arise. - Micah 7:8'. Continues after
 * 3 s").
 *
 * The session listens for `player:arise` (src/player/Hope.ts) and calls:
 *
 *   await runArise({ respawn: () => session.respawnAtWaystone() });
 *
 * Sequence: the screen fades to a soft night (0.9 s) → a warm dawn glow rises and the words appear with a gentle
 * swell → after 3 s it continues by itself (keys and taps do nothing; nothing to skip, nothing to miss) →
 * `respawn()` runs while the screen is still covered, Hope is set to at least HOPE_WAYSTONE_FLOOR (60) → the
 * screen fades back to the world (1 s). Music is ducked meanwhile. Reduce motion (body.reduce-motion or the OS
 * setting) turns the rise and glow motion off; the timings stay so the text is on screen just as long.
 */
import '../audio/events';
import './arise.css';
import { events } from '../core/Events';
import { services } from '../core/Services';
import { t } from '../core/I18n';
import { HOPE_WAYSTONE_FLOOR } from '../core/GameState';
import { h, uiRoot } from './dom';

/** Seconds. `hold` is GDD 2.14's "continues after 3 s", counted from when the words appear. */
export const ARISE_TIMING = { fadeIn: 0.9, textIn: 0.8, hold: 3, fadeOut: 1 } as const;

export interface AriseOptions {
  /** Puts the player back at the last waystone (or the Way's start). Runs while the screen is covered. */
  respawn: () => void;
  /** Where the screen mounts (default: the #ui root). */
  parent?: HTMLElement;
}

interface Run {
  readonly promise: Promise<void>;
  cancel(): void;
}

let current: Run | null = null;

/** True while the I SHALL ARISE screen is up. */
export function isArising(): boolean {
  return current !== null;
}

/** Takes the screen down at once (session teardown). The pending `runArise` promise resolves; respawn is skipped. */
export function cancelArise(): void {
  current?.cancel();
}

/** Shows I SHALL ARISE, respawns, fades back. A second call while one runs returns the same promise. */
export function runArise(opts: AriseOptions): Promise<void> {
  if (current) return current.promise;
  const run = startRun(opts);
  current = run;
  void run.promise.then(() => {
    if (current === run) current = null;
  });
  return run.promise;
}

function startRun(opts: AriseOptions): Run {
  const title = h('h1', { className: 'pg-arise__title' }, t('ui.arise.title'));
  const verse = h('p', { className: 'pg-arise__verse' }, t('ui.arise.verse'));
  const ms = (sec: number): string => `${Math.round(sec * 1000)}ms`;
  const root = h(
    'div',
    {
      className: 'pg-arise',
      role: 'alert',
      style: {
        '--arise-fade-in': ms(ARISE_TIMING.fadeIn),
        '--arise-text-in': ms(ARISE_TIMING.textIn),
        '--arise-fade-out': ms(ARISE_TIMING.fadeOut),
      },
    },
    h('div', { className: 'pg-arise__dawn', 'aria-hidden': 'true' }),
    h('div', { className: 'pg-arise__words' }, title, verse),
  );
  // Taps and clicks stop here (nothing underneath reacts); there is nothing to press on this screen.
  root.addEventListener('pointerdown', swallow);
  root.addEventListener('contextmenu', swallow);

  let finished = false;
  let ducked = false;
  let raf = 0;
  let last = -1;
  let elapsed = 0;
  let stage = 0;
  let resolve: () => void = () => {};
  const promise = new Promise<void>((r) => {
    resolve = r;
  });

  const duck = (on: boolean): void => {
    if (ducked === on) return;
    ducked = on;
    events.emit('audio:duck', { on });
  };
  const finish = (): void => {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(raf);
    root.remove();
    duck(false);
    resolve();
  };

  // The timeline runs on animation frames: a hidden tab holds the screen (the time away does not count), so a
  // child coming back still sees the words before the world returns.
  const T = ARISE_TIMING;
  const stages: ReadonlyArray<readonly [number, () => void]> = [
    [
      0,
      () => {
        root.classList.add('is-dark'); // screen fades
        duck(true);
      },
    ],
    [
      T.fadeIn,
      () => {
        root.classList.add('is-risen'); // sunrise + the words
        events.emit('sfx', { id: 'prayer_swell' });
      },
    ],
    [
      T.fadeIn + T.hold,
      () => {
        try {
          opts.respawn();
        } catch (err) {
          console.error('[arise] respawn failed', err);
        }
        const state = services.tryGet('state');
        if (state && state.hope < HOPE_WAYSTONE_FLOOR) state.setHope(HOPE_WAYSTONE_FLOOR);
        root.classList.add('is-leaving');
        duck(false);
        events.emit('sfx', { id: 'sparkle' });
      },
    ],
    [T.fadeIn + T.hold + T.fadeOut, finish],
  ];
  const tick = (now: number): void => {
    if (finished) return;
    if (last >= 0) elapsed += Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    while (stage < stages.length && elapsed >= stages[stage]![0]) stages[stage++]![1]();
    if (!finished) raf = requestAnimationFrame(tick);
  };

  (opts.parent ?? uiRoot()).appendChild(root);
  // From the next frame, so the opacity transition starts at 0.
  raf = requestAnimationFrame(() => {
    raf = requestAnimationFrame(tick);
  });

  return { promise, cancel: finish };
}

function swallow(e: Event): void {
  e.preventDefault();
  e.stopPropagation();
}
