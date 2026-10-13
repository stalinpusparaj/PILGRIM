/**
 * One ambience one-shot (a bell, a croak, a chirp): the few nodes an event function builds, routed through an
 * optional distance low-pass, stereo panner and reverb send, started together and disconnected as soon as they
 * end. Events are seconds apart, so the nodes are created per event (never per frame).
 */
import type { Rng } from '../gen/rng';
import type { NoiseColor } from './Synth';
import type { AmbHost } from './amb-types';

export interface ShotRoute {
  /** Input level. */
  level: number;
  /** Stereo position, or null for none (positional emitters pan with their PannerNode). */
  pan: number | null;
  /** Distance low-pass in Hz, 0 = none. */
  far: number;
  /** Reverb send level, 0 = none. */
  send: number;
}

export class Shot {
  /** Event functions connect their output here. */
  readonly input: GainNode;
  /** Stereo pan of the shot (for sweeps), or null when not panned. */
  readonly pan: AudioParam | null = null;
  private readonly nodes: AudioNode[] = [];
  private readonly sources: AudioScheduledSourceNode[] = [];
  private readonly offsets: number[] = [];
  private freed = false;

  /** `owner` holds the shot while it sounds (its bed frees what is left on dispose). */
  constructor(
    private readonly host: AmbHost,
    dest: AudioNode,
    route: ShotRoute,
    private readonly owner: Set<Shot>,
  ) {
    const ctx = host.ctx;
    this.input = this.gain(route.level);
    let head: AudioNode = this.input;
    if (route.far > 0) head = head.connect(this.filter('lowpass', route.far, 0.6));
    if (route.pan !== null && host.stereo) {
      const p = this.track(ctx.createStereoPanner());
      p.pan.value = route.pan;
      this.pan = p.pan;
      head = head.connect(p);
    }
    head.connect(dest);
    if (route.send > 0 && host.space) head.connect(this.gain(route.send)).connect(host.space);
    owner.add(this);
  }

  get ctx(): AudioContext {
    return this.host.ctx;
  }

  osc(type: OscillatorType, hz: number): OscillatorNode {
    const o = this.track(this.host.ctx.createOscillator());
    o.type = type;
    o.frequency.value = hz;
    this.sources.push(o);
    this.offsets.push(0);
    return o;
  }

  /** Looping seeded noise, started at a random point of the loop. */
  noise(color: NoiseColor, r: Rng): AudioBufferSourceNode {
    const s = this.track(this.host.ctx.createBufferSource());
    const buf = this.host.noise(color);
    s.buffer = buf;
    s.loop = true;
    this.sources.push(s);
    this.offsets.push(r.range(0, buf.duration * 0.9));
    return s;
  }

  gain(v: number): GainNode {
    const g = this.track(this.host.ctx.createGain());
    g.gain.value = v;
    return g;
  }

  filter(type: BiquadFilterType, hz: number, q: number): BiquadFilterNode {
    const f = this.track(this.host.ctx.createBiquadFilter());
    f.type = type;
    f.frequency.value = hz;
    f.Q.value = q;
    return f;
  }

  /** Starts every source at `t`, stops them at `end` and frees every node when they have ended. */
  play(t: number, end: number): void {
    const first = this.sources[0];
    if (!first) {
      this.free();
      return;
    }
    const stop = Math.max(end, t + 0.05);
    for (let i = 0; i < this.sources.length; i++) {
      const s = this.sources[i]!;
      if (s instanceof AudioBufferSourceNode) s.start(t, this.offsets[i] ?? 0);
      else s.start(t);
      s.stop(stop);
    }
    first.onended = () => this.free();
  }

  /** Stops and disconnects everything now (also used on dispose). Safe to call twice. */
  free(): void {
    if (this.freed) return;
    this.freed = true;
    for (const s of this.sources) {
      s.onended = null;
      try {
        s.stop();
      } catch {
        // never started or already stopped
      }
    }
    for (const n of this.nodes) n.disconnect();
    this.nodes.length = 0;
    this.sources.length = 0;
    this.owner.delete(this);
  }

  private track<T extends AudioNode>(n: T): T {
    this.nodes.push(n);
    return n;
  }
}

/** Rises to `peak` in about `atk` seconds from wherever the param is, then decays with time constant `tc`. */
export function strike(p: AudioParam, t: number, peak: number, atk: number, tc: number): void {
  p.setTargetAtTime(peak, t, atk / 3);
  p.setTargetAtTime(0, t + atk, tc);
}

/** Rises to `peak` (time constant `atk`), holds, then fades from `off` with time constant `rel`. */
export function hold(p: AudioParam, t: number, peak: number, atk: number, off: number, rel: number): void {
  p.setTargetAtTime(peak, t, atk);
  p.setTargetAtTime(0, off, rel);
}
