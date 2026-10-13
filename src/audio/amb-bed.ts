/**
 * A running ambience bed (or the positional version of one inside an emitter): its looping layers, slow LFOs
 * and event generators. Layers are built once and loop until the bed is disposed; events are scheduled by
 * Ambience's timer a little ahead on the AudioContext clock (tick). Fades are linear and tracked here, so a
 * fade can start from the exact current level (AudioParam.value lags while the context is suspended).
 */
import type { Rng } from '../gen/rng';
import { Shot } from './amb-shot';
import type { AmbHost, BedDef, EventDef, FilterDef, LayerDef } from './amb-types';

interface Gen {
  readonly def: EventDef;
  readonly rng: Rng;
  /** Stereo spot of a 'fixed' generator. */
  readonly pan: number;
  next: number;
}

/** Texture layers fade in when their loop is ready (it may render after the bed started). */
const LATE_FADE = 0.6;
/** An event more than this late (stalled timers) is skipped instead of played in a burst. */
const STALE = 0.25;

let failedOnce = false;

export class Bed {
  /** Bed output (its fader). */
  readonly out: GainNode;
  /** Context time after which a faded-out bed is silent and can be disposed. */
  deadAt = Infinity;
  private readonly host: AmbHost;
  private readonly rng: Rng;
  private readonly spot: boolean;
  private readonly level: number;
  private readonly nodes: AudioNode[] = [];
  private readonly sources: AudioScheduledSourceNode[] = [];
  private readonly offsets: number[] = [];
  private readonly gens: Gen[] = [];
  private readonly shots = new Set<Shot>();
  private alive = true;
  private started = false;
  private quiet = false;
  private from = 0;
  private to = 0;
  private t0 = 0;
  private t1 = 0;

  /** `spot` = positional emitter version: only `spot` items (if any are marked), no stereo, no reverb/far. */
  constructor(host: AmbHost, def: BedDef, rng: Rng, dest: AudioNode, spot: boolean) {
    this.host = host;
    this.rng = rng;
    this.spot = spot;
    this.level = spot ? def.spotGain : def.gain;
    this.out = this.node(host.ctx.createGain());
    this.out.gain.value = 0;
    this.out.connect(dest);
    const all = !spot || !(def.layers.some((l) => l.spot) || def.events.some((e) => e.spot));
    for (const l of def.layers) if (all || l.spot) this.layer(l);
    for (let i = 0; i < def.events.length; i++) {
      const e = def.events[i]!;
      if (!all && !e.spot) continue;
      const spread = e.spread ?? 0.7;
      this.gens.push({ def: e, rng: rng.fork(i + 1), pan: rng.range(-spread, spread), next: Infinity });
    }
  }

  /** Starts the loops at ctx time `t` and fades the bed in over `fade` seconds. */
  start(t: number, fade: number): void {
    if (!this.alive || this.started) return;
    this.started = true;
    for (let i = 0; i < this.sources.length; i++) {
      const s = this.sources[i]!;
      if (s instanceof AudioBufferSourceNode) s.start(t, this.offsets[i] ?? 0);
      else s.start(t);
    }
    for (const g of this.gens) g.next = t + g.rng.range(0.1, 0.6) * g.def.every[1];
    this.ramp(t, this.level, fade);
  }

  /** Fades out over `fade` seconds and stops making events; dispose() once `deadAt` has passed. */
  fadeOut(t: number, fade: number): void {
    if (!this.alive) return;
    this.quiet = true;
    this.ramp(t, 0, fade);
    this.deadAt = this.t1 + 0.1;
  }

  /** Schedules the events due before `until`. */
  tick(now: number, until: number): void {
    if (!this.alive || this.quiet || !this.started) return;
    for (const g of this.gens) {
      if (g.next < now - STALE) g.next = now + g.rng.range(0.05, 0.5) * g.def.every[0];
      while (g.next < until) {
        this.fire(g, Math.max(g.next, now));
        g.next += g.rng.range(g.def.every[0], g.def.every[1]);
      }
    }
  }

  /** One-shots still sounding. */
  get liveShots(): number {
    return this.shots.size;
  }

  dispose(): void {
    if (!this.alive) return;
    this.alive = false;
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        // never started
      }
    }
    for (const s of this.shots) s.free();
    for (const n of this.nodes) n.disconnect();
    this.nodes.length = 0;
    this.sources.length = 0;
    this.gens.length = 0;
  }

  private fire(g: Gen, t: number): void {
    const d = g.def;
    const r = g.rng;
    let pan: number | null = null;
    if (!this.spot && d.pan === 'fixed') pan = clampPan(g.pan + r.range(-0.08, 0.08));
    else if (!this.spot && d.pan === 'random') pan = r.range(-1, 1) * (d.spread ?? 0.7);
    const route = {
      level: d.gain * r.range(0.7, 1),
      pan,
      far: this.spot ? 0 : (d.far ?? 0),
      send: this.spot ? 0 : (d.send ?? 0),
    };
    const shot = new Shot(this.host, this.out, route, this.shots);
    try {
      shot.play(t, d.fn(shot, t, r));
    } catch (err) {
      shot.free();
      if (!failedOnce) console.error('[ambience] event failed', err);
      failedOnce = true;
    }
  }

  private layer(l: LayerDef): void {
    const ctx = this.host.ctx;
    const g = this.node(ctx.createGain());
    g.gain.value = l.gain;
    if (!this.spot && l.pan !== undefined && this.host.stereo) {
      const p = this.node(ctx.createStereoPanner());
      p.pan.value = l.pan;
      g.connect(p).connect(this.out);
    } else {
      g.connect(this.out);
    }
    let entry: AudioNode = g;
    let first: BiquadFilterNode | null = null;
    const filters = l.filters ?? [];
    for (let i = filters.length - 1; i >= 0; i--) {
      first = this.filter(filters[i]!);
      first.connect(entry);
      entry = first;
    }
    for (const s of l.swell ?? []) this.lfo(s.rate, s.depth * l.gain, g.gain);
    if (l.wander && first) this.lfo(l.wander.rate, l.wander.depth, first.frequency);
    switch (l.kind) {
      case 'noise': {
        const src = this.node(ctx.createBufferSource());
        src.buffer = this.host.noise(l.color);
        src.loop = true;
        src.playbackRate.value = l.rate ?? 1;
        src.connect(entry);
        this.source(src, this.rng.range(0, src.buffer.duration * 0.9));
        break;
      }
      case 'tone': {
        const o = this.node(ctx.createOscillator());
        o.type = l.wave;
        o.frequency.value = l.freq;
        o.detune.value = l.detune ?? 0;
        o.connect(entry);
        this.source(o, 0);
        break;
      }
      case 'texture': {
        const at = this.rng.next();
        const rate = l.rate ?? 1;
        const target = entry;
        this.host.texture(l.tex).then(
          (buf) => this.late(buf, at, rate, target),
          () => undefined,
        );
        break;
      }
    }
  }

  /** Starts a texture loop that finished rendering after the bed was built. */
  private late(buf: AudioBuffer, at: number, rate: number, entry: AudioNode): void {
    if (!this.alive) return;
    const ctx = this.host.ctx;
    const t = ctx.currentTime + 0.03;
    const src = this.node(ctx.createBufferSource());
    src.buffer = buf;
    src.loop = true;
    src.playbackRate.value = rate;
    const gate = this.node(ctx.createGain());
    gate.gain.setValueAtTime(0, t);
    gate.gain.linearRampToValueAtTime(1, t + LATE_FADE);
    src.connect(gate).connect(entry);
    this.sources.push(src);
    this.offsets.push(0);
    src.start(t, at * buf.duration * 0.95);
  }

  private lfo(rate: number, depth: number, param: AudioParam): void {
    const ctx = this.host.ctx;
    const o = this.node(ctx.createOscillator());
    o.frequency.value = rate * this.rng.range(0.85, 1.15);
    const d = this.node(ctx.createGain());
    d.gain.value = depth;
    o.connect(d).connect(param);
    this.source(o, 0);
  }

  private filter(f: FilterDef): BiquadFilterNode {
    const n = this.node(this.host.ctx.createBiquadFilter());
    n.type = f.type;
    n.frequency.value = f.freq;
    n.Q.value = f.q ?? 0.7;
    return n;
  }

  private source(s: AudioScheduledSourceNode, offset: number): void {
    this.sources.push(s);
    this.offsets.push(offset);
  }

  private node<T extends AudioNode>(n: T): T {
    this.nodes.push(n);
    return n;
  }

  /** Linear fade from the exact current level to `target`. */
  private ramp(t: number, target: number, fade: number): void {
    const from = this.valueAt(t);
    const end = t + Math.max(0.02, fade);
    const p = this.out.gain;
    p.cancelScheduledValues(t);
    p.setValueAtTime(from, t);
    p.linearRampToValueAtTime(target, end);
    this.from = from;
    this.to = target;
    this.t0 = t;
    this.t1 = end;
  }

  private valueAt(t: number): number {
    if (t >= this.t1) return this.to;
    if (t <= this.t0) return this.from;
    return this.from + ((this.to - this.from) * (t - this.t0)) / (this.t1 - this.t0);
  }
}

function clampPan(p: number): number {
  return p < -1 ? -1 : p > 1 ? 1 : p;
}
