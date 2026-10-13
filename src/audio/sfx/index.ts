/**
 * SfxBank (GDD 2.13): renders every SFX recipe once on load (OfflineAudioContext, time-sliced) and plays the
 * buffers through a small pool of voices with per-play pitch/volume variation, optional 3D position and a
 * polyphony cap per id. Per-play randomness comes from one seeded Rng stream, so a session replays identically.
 *
 * The `pitch` play option is a playback-rate multiplier (1 = as designed); recipes with a `steps` scale snap it to
 * that scale (pitch.ts). Use stepPitch('joy_note', n) for the n-th rising joy chime.
 */
import { Rng, hashString } from '../../gen/rng';
import { nextFrame } from '../../gen/yielder';
import type { SfxId, Vec3 } from '../types';
import { clearRenderCaches, finishBuffer, warmNoise } from './buffers';
import { pitchToSemitones } from './pitch';
import { DEFAULT_RATE, recipeProblems, renderRecipe } from './render';
import { SFX_RECIPES } from './recipes-all';
import type { NoiseColor, SfxPlayOptions, SfxRecipe } from './types';

export type { SfxPlayOptions, SfxRecipe } from './types';
export { SFX_RECIPES } from './recipes-all';
export { pitchToSemitones, stepPitch } from './pitch';

/** Playback level of a recipe without its own `level`. */
export const DEFAULT_LEVEL = 0.6;
const DEFAULT_POLY = 3;
/** Sounding voices across all ids; the oldest is stolen past this. */
const MAX_ACTIVE = 24;
/** Voice objects kept (sounding + fading out after a steal). */
const MAX_POOL = 36;
const STEAL_FADE = 0.03;
/** The same id is not restarted within this many seconds (duplicate events in one frame stack to +6 dB). */
const RETRIGGER = 0.025;
/** Positional sounds farther than this from the listener are not played at all. */
const MAX_DISTANCE = 60;
/** Main-thread budget per slice while rendering on load (ms); one build step (at most ~3.5 ms) may follow it. */
const SLICE_MS = 4;
const NOISE_COLORS: readonly NoiseColor[] = ['white', 'pink', 'brown'];
const RENDER_CONCURRENCY = 3;
/** Rendered first: the sounds most likely to be needed during the first seconds. */
const EARLY_PREFIXES = ['ui_', 'step_', 'jump', 'land'];

interface Voice {
  readonly gain: GainNode;
  panner: PannerNode | null;
  src: AudioBufferSourceNode | null;
  id: SfxId | null;
  startedAt: number;
  endsAt: number;
  releasing: boolean;
  readonly onEnded: () => void;
}

export interface SfxBankOptions {
  /** Seed of the per-play variation stream (default: fixed). */
  seed?: number;
  /** Recipe table override (tests). */
  recipes?: Record<SfxId, SfxRecipe>;
}

/**
 * Time-slicer shared by the render workers: one pending yield at a time, and the budget is re-checked after every
 * resume (workers resumed by the same frame would otherwise each get a fresh budget, back to back).
 */
class Slicer {
  private start = performance.now();
  private pending: Promise<void> | null = null;

  constructor(private readonly budgetMs: number) {}

  async tick(): Promise<void> {
    while (performance.now() - this.start >= this.budgetMs) {
      this.pending ??= nextFrame().then(() => {
        this.pending = null;
        this.start = performance.now();
      });
      await this.pending;
    }
  }
}

/** Stable render seed of one recipe variant (independent of the bank seed: an id always sounds the same). */
export function variantSeed(id: SfxId, variant: number): number {
  return (hashString(id) ^ Math.imul(variant + 1, 0x9e3779b1)) >>> 0;
}

export class SfxBank {
  /** Resolves when every recipe is rendered (or failed). Never rejects. */
  readonly ready: Promise<void>;
  private readonly recipes: Record<SfxId, SfxRecipe>;
  private readonly slots = new Map<SfxId, Array<AudioBuffer | null>>();
  private readonly lastVariant = new Map<SfxId, number>();
  private readonly voices: Voice[] = [];
  private readonly rng: Rng;
  private rendered = 0;
  private jobs = 0;
  private disposed = false;

  constructor(
    private readonly ctx: AudioContext,
    private readonly out: GainNode,
    opts: SfxBankOptions = {},
  ) {
    this.recipes = opts.recipes ?? SFX_RECIPES;
    this.rng = new Rng(opts.seed ?? hashString('pilgrim-sfx-play'));
    this.ready = this.load().catch((e: unknown) => {
      console.warn('[sfx] loading failed', e);
    });
  }

  /** 0..1 share of recipe variants rendered so far (loading bar). */
  get progress(): number {
    return this.jobs === 0 ? (this.disposed ? 0 : 1) : this.rendered / this.jobs;
  }

  /** True once at least one variant of `id` is rendered. */
  has(id: SfxId): boolean {
    const s = this.slots.get(id);
    return s !== undefined && s.some((b) => b !== null);
  }

  /** The rendered buffer of one variant (tests and the music test page). */
  buffer(id: SfxId, variant = 0): AudioBuffer | null {
    return this.slots.get(id)?.[variant] ?? null;
  }

  play(id: SfxId, opts?: SfxPlayOptions): void {
    if (this.disposed || this.ctx.state !== 'running') return; // never queue a burst for the unlock moment
    const recipe = this.recipes[id];
    const buf = this.pickVariant(id);
    if (!recipe || !buf) return;
    const at = opts?.at;
    if (at && this.tooFar(at)) return;
    const now = this.ctx.currentTime;
    this.reap(now);
    const v = this.freeVoice();
    if (!v || !this.makeRoom(id, recipe.poly ?? DEFAULT_POLY, now)) return;

    let semis = pitchToSemitones(recipe, opts?.pitch);
    const vp = recipe.vary?.pitch ?? 0;
    if (vp > 0) semis += this.rng.range(-vp, vp);
    const rate = Math.min(4, Math.max(0.25, Math.pow(2, semis / 12)));
    const reqVol = opts?.volume;
    let vol =
      (recipe.level ?? DEFAULT_LEVEL) * (reqVol !== undefined && Number.isFinite(reqVol) ? reqVol : 1);
    const vv = recipe.vary?.volume ?? 0;
    if (vv > 0) vol *= 1 - this.rng.range(0, vv); // variation only ever makes it quieter
    vol = Math.min(1, Math.max(0, vol));

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    src.onended = v.onEnded;
    const g = v.gain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(vol, now);
    if (at) src.connect(this.placePanner(v, at));
    else src.connect(v.gain);
    src.start(now);
    v.src = src;
    v.id = id;
    v.startedAt = now;
    v.endsAt = now + buf.duration / rate;
    v.releasing = false;
  }

  /** Fades out everything that is sounding. */
  stopAll(fade = 0.08): void {
    const now = this.ctx.currentTime;
    for (const v of this.voices) if (v.src && !v.releasing) this.steal(v, now, fade);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const v of this.voices) {
      const s = v.src;
      if (s) {
        s.onended = null;
        try {
          s.stop();
        } catch {
          /* already stopped */
        }
        s.disconnect();
      }
      v.src = null;
      v.gain.disconnect();
      v.panner?.disconnect();
    }
    this.voices.length = 0;
    this.slots.clear();
  }

  // ---- loading -------------------------------------------------------------------------------------------------

  private async load(): Promise<void> {
    if (typeof OfflineAudioContext === 'undefined') {
      console.warn('[sfx] OfflineAudioContext unavailable: effects stay silent');
      return;
    }
    const ids = (Object.keys(this.recipes) as SfxId[]).sort((a, b) => early(b) - early(a));
    const queue: Array<{ id: SfxId; variant: number }> = [];
    for (const id of ids) {
      const r = this.recipes[id];
      if (import.meta.env.DEV) for (const p of recipeProblems(id, r)) console.warn(`[sfx] ${p}`);
      const n = Math.max(1, Math.floor(r.variants ?? 1));
      this.slots.set(id, new Array<AudioBuffer | null>(n).fill(null));
      for (let v = 0; v < n; v++) queue.push({ id, variant: v });
    }
    this.jobs = queue.length;
    await nextFrame(); // start apart from the task that constructed the bank
    const y = new Slicer(SLICE_MS);
    try {
      // Generate the shared noise loops first, in slices, so no single render has to pay for them.
      for (const rate of new Set(ids.map((id) => this.recipes[id].rate ?? DEFAULT_RATE))) {
        for (const color of NOISE_COLORS) {
          await warmNoise(rate, color, () => y.tick());
          if (this.disposed) return;
        }
      }
      await this.renderQueue(queue, y);
    } finally {
      clearRenderCaches();
    }
  }

  private async renderQueue(queue: ReadonlyArray<{ id: SfxId; variant: number }>, y: Slicer): Promise<void> {
    const make = (length: number, rate: number): AudioBuffer => this.ctx.createBuffer(1, length, rate);
    const tick = (): Promise<void> => y.tick();
    let next = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        const job = queue[next++];
        if (!job || this.disposed) return;
        await y.tick();
        if (this.disposed) return;
        try {
          const raw = await renderRecipe(this.recipes[job.id], variantSeed(job.id, job.variant), tick);
          if (this.disposed) return;
          await y.tick();
          if (this.disposed) return;
          const slot = this.slots.get(job.id);
          const buf = finishBuffer(raw, make);
          if (slot) slot[job.variant] = buf;
          if (!buf) console.warn(`[sfx] ${job.id} rendered silent`);
        } catch (e) {
          console.warn(`[sfx] could not render ${job.id}`, e);
        }
        this.rendered++;
      }
    };
    const workers: Promise<void>[] = [];
    for (let i = 0; i < RENDER_CONCURRENCY; i++) workers.push(worker());
    await Promise.all(workers);
  }

  // ---- voices --------------------------------------------------------------------------------------------------

  private pickVariant(id: SfxId): AudioBuffer | null {
    const slots = this.slots.get(id);
    if (!slots) return null;
    const n = slots.length;
    if (n === 1) return slots[0] ?? null;
    const last = this.lastVariant.get(id) ?? -1;
    let i: number;
    if (last < 0) i = this.rng.int(0, n - 1);
    else {
      i = this.rng.int(0, n - 2); // any variant but the last one played
      if (i >= last) i++;
    }
    for (let k = 0; k < n; k++) {
      const j = (i + k) % n;
      const b = slots[j];
      if (b) {
        this.lastVariant.set(id, j);
        return b;
      }
    }
    return null;
  }

  private tooFar(at: Vec3): boolean {
    const l = this.ctx.listener;
    if (!l.positionX) return false; // older engines: the listener position cannot be read back
    const dx = at[0] - l.positionX.value;
    const dy = at[1] - l.positionY.value;
    const dz = at[2] - l.positionZ.value;
    return dx * dx + dy * dy + dz * dz > MAX_DISTANCE * MAX_DISTANCE;
  }

  private placePanner(v: Voice, at: Vec3): PannerNode {
    let p = v.panner;
    if (!p) {
      p = this.ctx.createPanner();
      p.panningModel = 'equalpower';
      p.distanceModel = 'inverse';
      p.refDistance = 3;
      p.rolloffFactor = 0.7;
      p.maxDistance = MAX_DISTANCE;
      p.connect(v.gain);
      v.panner = p;
    }
    if (p.positionX) {
      p.positionX.value = at[0];
      p.positionY.value = at[1];
      p.positionZ.value = at[2];
    } else {
      p.setPosition(at[0], at[1], at[2]);
    }
    return p;
  }

  private createVoice(): Voice {
    const gain = this.ctx.createGain();
    gain.connect(this.out);
    const v: Voice = {
      gain,
      panner: null,
      src: null,
      id: null,
      startedAt: 0,
      endsAt: 0,
      releasing: false,
      onEnded: () => this.finish(v),
    };
    return v;
  }

  private finish(v: Voice): void {
    const s = v.src;
    if (s) {
      s.onended = null;
      s.disconnect();
    }
    v.src = null;
    v.id = null;
    v.releasing = false;
  }

  /** Frees voices whose `ended` event never arrived (a context that was suspended or closed meanwhile). */
  private reap(now: number): void {
    for (const v of this.voices) if (v.src && now > v.endsAt + 1) this.finish(v);
  }

  private steal(v: Voice, now: number, fade = STEAL_FADE): void {
    const s = v.src;
    if (!s) return;
    v.releasing = true;
    const g = v.gain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + fade);
    try {
      s.stop(now + fade + 0.005);
    } catch {
      this.finish(v);
    }
  }

  /** Applies the per-id and global caps by stealing the oldest voice; false = drop (same id just started). */
  private makeRoom(id: SfxId, poly: number, now: number): boolean {
    let same = 0;
    let total = 0;
    let oldestSame: Voice | null = null;
    let oldest: Voice | null = null;
    for (const v of this.voices) {
      if (!v.src || v.releasing) continue;
      total++;
      if (!oldest || v.startedAt < oldest.startedAt) oldest = v;
      if (v.id === id) {
        if (now - v.startedAt < RETRIGGER) return false; // a duplicate in the same moment would only be louder
        same++;
        if (!oldestSame || v.startedAt < oldestSame.startedAt) oldestSame = v;
      }
    }
    if (same >= poly && oldestSame) this.steal(oldestSame, now);
    else if (total >= MAX_ACTIVE && oldest) this.steal(oldest, now);
    return true;
  }

  private freeVoice(): Voice | null {
    for (const v of this.voices) if (!v.src) return v;
    if (this.voices.length >= MAX_POOL) return null;
    const v = this.createVoice();
    this.voices.push(v);
    return v;
  }
}

function early(id: string): number {
  for (const p of EARLY_PREFIXES) if (id.startsWith(p)) return 1;
  return 0;
}
