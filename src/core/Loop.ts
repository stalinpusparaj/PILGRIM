/**
 * Fixed 60 Hz simulation with an interpolated render (GDD 2.15 "Engine rules").
 *
 * Each animation frame: accumulate real time, run up to MAX_STEPS_PER_FRAME fixed steps, then call
 * every system's render(alpha) so it can interpolate between the last two simulated states.
 * Rendering can be capped to 30 or 60 fps on any display rate (50 to 500+ Hz). The loop stops
 * scheduling frames while the tab is hidden and pauses the game for that time.
 */
import { events } from './Events';

export const FIXED_DT = 1 / 60;

/** More steps than this in one frame are dropped instead of caught up (no spiral of death). */
const MAX_STEPS_PER_FRAME = 5;
/** Frame gaps longer than this (debugger, long GC, slow device) are clamped, in seconds. */
const MAX_FRAME_DT = 0.25;
/** Frame times this close (s) to 1 or 2 fixed steps snap to them, so vsync jitter does not alternate 0/2 steps. */
const VSYNC_SNAP_DT = 0.002;
/** Callback intervals outside this range (ms) are not display frames (reset, hiccup) and are not sampled. */
const MIN_DISPLAY_MS = 1;
const MAX_DISPLAY_MS = 100;
/** The display interval is the median of this many recent callback intervals (robust to dropped frames). */
const DISPLAY_SAMPLES = 31;
/** A cap within 2% of a whole number of display frames is paced by counting frames (steady cadence). */
const CADENCE_TOLERANCE = 0.02;

export interface System {
  /** Called at a fixed 60 Hz. dt is always FIXED_DT * timeScale. */
  update?(dt: number): void;
  /** Called once per rendered frame after all fixed steps; alpha in [0,1) for interpolation. */
  render?(alpha: number, frameDt: number): void;
  /**
   * Keep receiving update() while the loop is paused (pause menu, title screen). Off by default.
   * Input hooks run every step regardless, so presses made while paused never leak into gameplay.
   */
  updateWhenPaused?: boolean;
}

interface Entry {
  readonly system: System;
  readonly order: number;
  readonly seq: number;
  active: boolean;
}

export class Loop {
  /** Debug time scale, default 1. Scales update dt and elapsed, not the step rate. */
  timeScale = 1;
  /** When true: no update() (except opted-in systems); render() still runs so menus animate. */
  paused = false;
  /** Render rate cap. Simulation always runs at 60 Hz. */
  frameCap: 30 | 60 = 60;
  /** Called before / after every fixed step (Input.beginStep / Input.endStep). */
  onBeforeStep?: () => void;
  onAfterStep?: () => void;

  private entries: Entry[] = [];
  private ordered: Entry[] = [];
  private dirty = false;
  private seq = 0;

  private running = false;
  private hidden = false;
  private pausedByHidden = false;
  private rafId = 0;

  private accumulator = 0;
  private alpha = 0;
  private elapsedSec = 0;
  /** Frame time (rAF timestamp, ms) of the last rendered frame. */
  private lastFrameAt = 0;
  /** Frame time of the last animation-frame callback (rendered or skipped). */
  private lastCallbackAt = 0;
  /** Estimated display refresh interval in ms: median of the recent callback intervals. */
  private displayMs = 1000 / 60;
  private readonly intervals = new Float64Array(DISPLAY_SAMPLES);
  private readonly medianScratch = new Float64Array(DISPLAY_SAMPLES);
  private intervalCount = 0;
  private intervalNext = 0;
  /** Display frames since the last rendered frame (cadence pacing). */
  private framesSinceRender = 0;
  /** Frame-cap grid anchor in ms (grid pacing). */
  private capAnchor = 0;
  private frameStart = 0;
  /** Seconds removed (or added) by vsync snapping, paid back on the next frame. */
  private snapDebt = 0;

  private readonly reported = new WeakSet<System>();

  /** Seconds of unpaused simulated time (sum of update dt). */
  get elapsed(): number {
    return this.elapsedSec;
  }

  /** performance.now() at the start of the current/last rendered frame (for CPU frame-time stats). */
  get frameStartMs(): number {
    return this.frameStart;
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Adds a system. Lower order runs first; equal orders keep insertion order. Returns a remove function. */
  add(system: System, order = 0): () => void {
    const entry: Entry = { system, order, seq: this.seq++, active: true };
    this.entries.push(entry);
    this.dirty = true;
    return () => {
      if (!entry.active) return;
      entry.active = false;
      this.entries = this.entries.filter((e) => e !== entry);
      this.dirty = true;
    };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    document.addEventListener('visibilitychange', this.onVisibility);
    this.resetClock();
    if (document.hidden) this.suspend();
    else this.schedule();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.cancel();
    // Hand the pause flag back so a later start() is not stuck paused.
    if (this.pausedByHidden) this.paused = false;
    this.pausedByHidden = false;
    this.hidden = false;
  }

  private schedule(): void {
    if (this.rafId === 0) this.rafId = requestAnimationFrame(this.tick);
  }

  private cancel(): void {
    if (this.rafId !== 0) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  /** Forget elapsed real time: next frame starts from now with an empty accumulator. */
  private resetClock(): void {
    const now = performance.now();
    this.accumulator = 0;
    this.snapDebt = 0;
    this.lastFrameAt = now;
    this.lastCallbackAt = now;
    this.capAnchor = now;
    this.framesSinceRender = 0;
  }

  private readonly onVisibility = (): void => {
    if (!this.running) return;
    if (document.hidden) this.suspend();
    else this.wake();
  };

  private suspend(): void {
    if (this.hidden) return;
    this.hidden = true;
    this.cancel();
    if (!this.paused) {
      this.paused = true;
      this.pausedByHidden = true;
    }
    events.emit('game:pause', { reason: 'hidden' });
  }

  private wake(): void {
    if (!this.hidden) return;
    this.hidden = false;
    this.resetClock(); // no catch-up burst for the time spent hidden
    if (this.pausedByHidden) {
      this.pausedByHidden = false;
      this.paused = false;
      events.emit('game:resume');
    }
    this.schedule();
  }

  private readonly tick = (time: number): void => {
    this.rafId = 0;
    if (!this.running || this.hidden) return;
    this.schedule();

    // The rAF timestamp is the display frame's time; performance.now() here would add callback jitter.
    const now = Number.isFinite(time) ? time : performance.now();
    if (!this.shouldRender(now, this.trackDisplay(now))) return;

    this.frameStart = performance.now();
    const frameDt = this.frameDelta(now);
    this.lastFrameAt = now;

    const list = this.sorted();
    this.simulate(list, frameDt);

    const alpha = this.alpha;
    for (const entry of list) {
      if (!entry.active || !entry.system.render) continue;
      try {
        entry.system.render(alpha, frameDt);
      } catch (err) {
        this.report(entry.system, err);
      }
    }
  };

  private simulate(list: readonly Entry[], frameDt: number): void {
    this.accumulator += frameDt;
    const scale = Number.isFinite(this.timeScale) && this.timeScale > 0 ? this.timeScale : 0;
    const dt = FIXED_DT * scale;
    let steps = 0;

    while (this.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      this.accumulator -= FIXED_DT;
      steps++;
      const paused = this.paused;
      this.onBeforeStep?.();
      for (const entry of list) {
        const system = entry.system;
        if (!entry.active || !system.update || (paused && system.updateWhenPaused !== true)) continue;
        try {
          system.update(dt);
        } catch (err) {
          this.report(system, err);
        }
      }
      if (!paused) this.elapsedSec += dt;
      this.onAfterStep?.();
    }

    // Drop whatever backlog is left; keep only the fractional part for interpolation.
    if (this.accumulator >= FIXED_DT) this.accumulator %= FIXED_DT;
    // While paused, freeze alpha so interpolated objects do not shimmer between two states.
    if (!this.paused) this.alpha = Math.min(this.accumulator / FIXED_DT, 0.999999);
  }

  /**
   * Real seconds since the last rendered frame, clamped and vsync-snapped. The snapping error is carried
   * into the next frame, so simulated time never drifts from real time on any display rate.
   */
  private frameDelta(now: number): number {
    const raw = Math.min(Math.max((now - this.lastFrameAt) / 1000, 0), MAX_FRAME_DT);
    const dt = raw + this.snapDebt;
    let out = dt;
    if (Math.abs(dt - FIXED_DT) < VSYNC_SNAP_DT) out = FIXED_DT;
    else if (Math.abs(dt - 2 * FIXED_DT) < VSYNC_SNAP_DT) out = 2 * FIXED_DT;
    out = Math.max(out, 0);
    this.snapDebt = dt - out;
    return out;
  }

  /** Samples the display interval; returns how many display frames this callback stands for (>= 1). */
  private trackDisplay(now: number): number {
    const delta = now - this.lastCallbackAt;
    this.lastCallbackAt = now;
    if (delta >= MIN_DISPLAY_MS && delta <= MAX_DISPLAY_MS) {
      this.intervals[this.intervalNext] = delta;
      this.intervalNext = (this.intervalNext + 1) % DISPLAY_SAMPLES;
      if (this.intervalCount < DISPLAY_SAMPLES) this.intervalCount++;
      this.displayMs = this.medianInterval();
    }
    return Math.max(1, Math.round(delta / this.displayMs));
  }

  /** Median of the sampled intervals, without allocating (typed-array sort of a reused buffer). */
  private medianInterval(): number {
    const n = this.intervalCount;
    const buf = this.medianScratch;
    for (let i = 0; i < DISPLAY_SAMPLES; i++) buf[i] = i < n ? this.intervals[i] : Infinity;
    buf.sort();
    return buf[(n - 1) >> 1];
  }

  /**
   * Frame cap. When the cap is a whole number of display frames (60 on 59.94/60/120/240/360 Hz, 30 on
   * 60/90/120 Hz), every n-th display frame renders: counting frames, not milliseconds, gives a steady
   * cadence on displays a hair off their nominal rate and ignores callback jitter. Otherwise (60 on 144 Hz,
   * 30 on 75 Hz) render times sit on a fixed grid of 1000/cap ms, so the average rate is the cap exactly.
   * Displays at or below the cap render every frame.
   */
  private shouldRender(now: number, frames: number): boolean {
    const interval = 1000 / this.frameCap;
    const ratio = interval / this.displayMs; // display frames per capped frame
    const n = Math.max(1, Math.round(ratio));
    this.framesSinceRender += frames;
    if (ratio <= 1 + CADENCE_TOLERANCE || Math.abs(ratio / n - 1) <= CADENCE_TOLERANCE) {
      if (this.framesSinceRender < n) return false;
      this.capAnchor = now;
    } else {
      const since = now - this.capAnchor;
      if (since < interval - this.displayMs * 0.5) return false;
      this.capAnchor = since > interval * 2 ? now : this.capAnchor + interval;
    }
    this.framesSinceRender = 0;
    return true;
  }

  private sorted(): readonly Entry[] {
    if (this.dirty) {
      this.ordered = [...this.entries].sort((a, b) => a.order - b.order || a.seq - b.seq);
      this.dirty = false;
    }
    return this.ordered;
  }

  /** A throwing system must not stop the game: log its first error and keep running. */
  private report(system: System, err: unknown): void {
    if (this.reported.has(system)) return;
    this.reported.add(system);
    console.error('[loop] a system threw; further errors from it are suppressed', err);
  }
}
