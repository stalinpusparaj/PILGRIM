/**
 * Node factory handed to the instrument builders (inst-tonal, inst-mallet, inst-drums). Every node it makes
 * is registered on the voice, so the bank can stop and disconnect the whole voice in one place.
 */
import type { Rng } from '../gen/rng';
import type { InstrumentId } from './types';
import type { SharedRig } from './inst-shared';
import type { Voice } from './inst-voice';
import { adsr, noiseBuffer, type NoiseColor } from './Synth';

/** One note for a builder: frequency, start, gate length, velocity (0..1) and the level-matched peak gain. */
export interface NoteSpec {
  hz: number;
  midi: number;
  t: number;
  dur: number;
  vel: number;
  amp: number;
}

/** Builds the nodes for one note and returns the voice's final gain (envelope recorded via kit.env). */
export type VoiceBuilder = (k: Kit, v: Voice, n: NoteSpec) => GainNode;

export class Kit {
  readonly nyquist: number;

  constructor(
    readonly ctx: BaseAudioContext,
    readonly rng: Rng,
    readonly rig: SharedRig,
  ) {
    this.nyquist = ctx.sampleRate / 2;
  }

  osc(v: Voice, type: Exclude<OscillatorType, 'custom'>, hz: number, t: number, detune = 0): OscillatorNode {
    return this.startOsc(v, new OscillatorNode(this.ctx, { type, frequency: hz, detune }), t);
  }

  /** Oscillator with one of the rig's custom waveforms (inst-shared Waves). */
  wave(v: Voice, periodicWave: PeriodicWave, hz: number, t: number, detune = 0): OscillatorNode {
    return this.startOsc(v, new OscillatorNode(this.ctx, { type: 'custom', periodicWave, frequency: hz, detune }), t);
  }

  private startOsc(v: Voice, o: OscillatorNode, t: number): OscillatorNode {
    o.start(t);
    v.nodes.push(o);
    v.sources.push(o);
    return o;
  }

  /** Looping seeded noise, started at a random (seeded) point so repeated hits are not identical. */
  noise(v: Voice, color: NoiseColor, t: number): AudioBufferSourceNode {
    const buffer = noiseBuffer(this.ctx, 2, color);
    const s = new AudioBufferSourceNode(this.ctx, { buffer, loop: true });
    s.start(t, this.rng.range(0, buffer.duration * 0.9));
    v.nodes.push(s);
    v.sources.push(s);
    return s;
  }

  gain(v: Voice, value: number): GainNode {
    const g = new GainNode(this.ctx, { gain: value });
    v.nodes.push(g);
    return g;
  }

  filter(v: Voice, type: BiquadFilterType, hz: number, q: number): BiquadFilterNode {
    const f = new BiquadFilterNode(this.ctx, { type, frequency: Math.min(hz, this.nyquist * 0.95), Q: q });
    v.nodes.push(f);
    return f;
  }

  /** Two-input merger: input 0 = left, input 1 = right (cheap stereo width for ensembles). */
  merger(v: Voice): ChannelMergerNode {
    const m = new ChannelMergerNode(this.ctx, { numberOfInputs: 2 });
    v.nodes.push(m);
    return m;
  }

  /** Connects a shared node into one of this voice's params; undone when the voice ends. */
  linkParam(v: Voice, from: AudioNode, to: AudioParam): void {
    from.connect(to);
    v.linkFrom.push(from);
    v.linkTo.push(to);
    v.linkToNode.push(null);
  }

  /** Connects a shared node into one of this voice's nodes; undone when the voice ends. */
  linkNode(v: Voice, from: AudioNode, to: AudioNode): void {
    from.connect(to);
    v.linkFrom.push(from);
    v.linkTo.push(null);
    v.linkToNode.push(to);
  }

  /**
   * Schedules the voice's final envelope (see Synth.adsr), records it for voice stealing and sets `v.end`.
   * Returns the end time.
   */
  env(v: Voice, g: GainNode, t: number, peak: number, a: number, d: number, s: number, r: number, dur: number): number {
    const end = adsr(g.gain, t, peak, a, d, s, r, dur);
    v.setShape(t, peak, a, d, s, r, dur);
    v.end = end;
    return end;
  }

  /** Fast percussive decay on an inner gain: `level` at t, falling with time constant `tc`. */
  hit(g: GainNode, t: number, level: number, tc: number): void {
    g.gain.setValueAtTime(level, t);
    g.gain.setTargetAtTime(0, t + 0.001, tc);
  }

  /** A deterministic "human" detune in cents, +-spread. */
  wobble(spread: number): number {
    return this.rng.range(-spread, spread);
  }
}

/** Velocity curve: 1 at vel 0.8 (the level-matching point), ~+3 dB at 1, -9 dB at 0.4, -18 dB at 0.2. */
export function velCurve(vel: number): number {
  const v = vel < 0 ? 0 : vel > 1.2 ? 1.2 : vel;
  return Math.pow(v / 0.8, 1.5);
}

export type BuilderTable = Readonly<Record<Exclude<InstrumentId, 'drums'>, VoiceBuilder>>;
