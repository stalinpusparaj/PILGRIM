/**
 * Ambience (GDD 2.13 "Ambience per zone, positional where useful"): one procedural bed per zone that crossfades
 * when the zone changes, plus positional emitters (town bells, bog frogs, candle crackle, river...).
 *
 * - Beds are recipes (src/audio/amb-beds.ts): looping seeded noise / texture layers with slow LFOs and randomly
 *   timed one-shots. Noise loops are shared (Synth.noiseBuffer cache), textures are rendered once and cached.
 * - One light timer (~10 Hz) schedules events a little ahead on the AudioContext clock and stops when nothing
 *   plays. A suspended context (hidden tab) freezes the clock, so nothing piles up.
 * - Emitters run only while the listener is within reach (see listenerAt), at most MAX_ACTIVE at once.
 * - Everything is seeded (src/gen/rng.ts): the same seed and calls give the same sounds.
 */
import { Rng, hashString } from '../gen/rng';
import { noiseBuffer, type NoiseColor } from './Synth';
import { Bed } from './amb-bed';
import { BEDS, isAmbienceId } from './amb-beds';
import { EMITTER_HYSTERESIS, Emitter } from './amb-emitter';
import { renderTexture } from './amb-textures';
import type { AmbHost, TextureId } from './amb-types';
import type { AmbienceId, Vec3 } from './types';

export interface AmbienceOptions {
  /** Reverb send for far events (the engine's shared convolver). Default none. */
  reverb?: AudioNode | null;
  /** Seed for every bed, event and texture. */
  seed?: number;
  /** Use HRTF panning for emitters (desktop). Default false ('equalpower', cheap on phones). */
  hrtf?: boolean;
}

const TICK_MS = 100;
const IDLE_TICK_MS = 250;
/** Events are scheduled this far ahead of ctx.currentTime. */
const HORIZON = 0.3;
const DEFAULT_FADE = 2.5;
const MAX_FADE = 30;
const NOISE_SECONDS = 4;
/** Most emitters sounding at once (the first in reach win; levels place emitters sparsely). */
const MAX_ACTIVE = 8;

const noop = (): void => undefined;

export class Ambience implements AmbHost {
  readonly ctx: AudioContext;
  readonly space: AudioNode | null;
  readonly stereo: boolean;
  private readonly bus: GainNode;
  private readonly root: Rng;
  private readonly hrtf: boolean;
  private readonly textures = new Map<TextureId, Promise<AudioBuffer>>();
  private cur: Bed | null = null;
  private curId: AmbienceId | null = null;
  private readonly fading = new Set<Bed>();
  private readonly emitters = new Set<Emitter>();
  private readonly retired = new Set<Emitter>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private serial = 0;
  private lx = 0;
  private ly = 0;
  private lz = 0;
  private hasListener = false;
  private disposed = false;

  constructor(ctx: AudioContext, out: AudioNode, opts: AmbienceOptions = {}) {
    this.ctx = ctx;
    this.space = opts.reverb ?? null;
    this.stereo = typeof ctx.createStereoPanner === 'function';
    this.hrtf = opts.hrtf ?? false;
    this.root = new Rng(opts.seed ?? hashString('pilgrim:ambience'));
    this.bus = ctx.createGain();
    this.bus.connect(out);
  }

  /** The zone bed playing (or fading in), null for none. */
  get current(): AmbienceId | null {
    return this.curId;
  }

  /** Emitters added and not removed. */
  get emitterCount(): number {
    return this.emitters.size;
  }

  /** One-shots sounding right now, in every bed and emitter (diagnostics, leak tests). */
  get liveShots(): number {
    let n = this.cur?.liveShots ?? 0;
    for (const b of this.fading) n += b.liveShots;
    for (const e of this.emitters) n += e.liveShots;
    for (const e of this.retired) n += e.liveShots;
    return n;
  }

  /** Crossfades to the bed of `id` (null = fade to silence) over `fade` seconds (default 2.5). */
  set(id: AmbienceId | null, fade = DEFAULT_FADE): void {
    if (this.disposed || id === this.curId) return;
    if (id !== null && !isAmbienceId(id)) {
      if (import.meta.env.DEV) console.warn(`[ambience] unknown ambience "${String(id)}"`);
      return;
    }
    const f = cleanFade(fade);
    const t = this.ctx.currentTime;
    if (this.cur) {
      this.cur.fadeOut(t, f);
      this.fading.add(this.cur);
    }
    this.cur = null;
    this.curId = id;
    if (id !== null) {
      const bed = new Bed(this, BEDS[id], this.root.fork(`${id}#${++this.serial}`), this.bus, false);
      bed.start(t + 0.02, f);
      this.cur = bed;
    }
    this.wake();
  }

  /** A positional emitter of kind `id` at world position `at`. Returns a function that fades it out and removes it. */
  addEmitter(id: AmbienceId, at: Vec3): () => void {
    if (this.disposed || !isAmbienceId(id)) return noop;
    const e = new Emitter(
      this,
      id,
      BEDS[id],
      at[0],
      at[1],
      at[2],
      this.root.fork(`emit:${id}:${++this.serial}`),
      this.bus,
      this.hrtf,
    );
    this.emitters.add(e);
    this.wake();
    return () => {
      if (!this.emitters.delete(e)) return;
      if (this.disposed) return;
      e.deactivate(this.ctx.currentTime);
      this.retired.add(e);
      this.wake();
    };
  }

  /** Listener world position (the engine forwards it from setListener; no allocation). Emitters start/stop by it. */
  listenerAt(x: number, y: number, z: number): void {
    this.lx = x;
    this.ly = y;
    this.lz = z;
    this.hasListener = true;
  }

  // AmbHost -------------------------------------------------------------------------------------------------

  noise(color: NoiseColor): AudioBuffer {
    return noiseBuffer(this.ctx, NOISE_SECONDS, color);
  }

  texture(id: TextureId): Promise<AudioBuffer> {
    let p = this.textures.get(id);
    if (!p) {
      p = renderTexture(this.ctx, id, this.root.fork(`tex:${id}`)).catch((err: unknown) => {
        console.warn(`[ambience] texture "${id}" failed to render`, err);
        return this.ctx.createBuffer(1, 128, this.ctx.sampleRate);
      });
      this.textures.set(id, p);
    }
    return p;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.cur?.dispose();
    this.cur = null;
    this.curId = null;
    for (const b of this.fading) b.dispose();
    this.fading.clear();
    for (const e of this.emitters) e.dispose();
    this.emitters.clear();
    for (const e of this.retired) e.dispose();
    this.retired.clear();
    this.textures.clear();
    this.bus.disconnect();
  }

  // scheduling ----------------------------------------------------------------------------------------------

  private wake(): void {
    if (this.timer !== null || this.disposed) return;
    this.timer = setTimeout(this.tick, 0);
  }

  private readonly tick = (): void => {
    this.timer = null;
    if (this.disposed) return;
    const running = this.ctx.state === 'running';
    if (running) {
      try {
        this.step(this.ctx.currentTime);
      } catch (err) {
        console.error('[ambience] tick failed', err);
      }
    }
    if (this.cur || this.fading.size > 0 || this.emitters.size > 0 || this.retired.size > 0) {
      this.timer = setTimeout(this.tick, running ? TICK_MS : IDLE_TICK_MS);
    }
  };

  private step(now: number): void {
    const until = now + HORIZON;
    this.cur?.tick(now, until);
    for (const b of this.fading) {
      if (now < b.deadAt) continue;
      b.dispose();
      this.fading.delete(b);
    }
    this.updateEmitters(now);
    for (const e of this.emitters) e.tick(now, until);
    for (const e of this.retired) {
      e.tick(now, until);
      if (e.busy) continue;
      e.dispose();
      this.retired.delete(e);
    }
  }

  /** Starts emitters the listener walked into reach of and stops those it left (with hysteresis). */
  private updateEmitters(now: number): void {
    let active = 0;
    for (const e of this.emitters) if (e.active) active++;
    for (const e of this.emitters) {
      if (!this.hasListener) {
        if (!e.active && active < MAX_ACTIVE) {
          e.activate(now);
          active++;
        }
        continue;
      }
      const d2 = e.dist2(this.lx, this.ly, this.lz);
      const reach = e.reach;
      if (e.active) {
        const off = reach * EMITTER_HYSTERESIS;
        if (d2 > off * off) {
          e.deactivate(now);
          active--;
        }
      } else if (d2 < reach * reach && active < MAX_ACTIVE) {
        e.activate(now);
        active++;
      }
    }
  }
}

function cleanFade(fade: number): number {
  if (!Number.isFinite(fade)) return DEFAULT_FADE;
  return Math.min(MAX_FADE, Math.max(0.05, fade));
}
