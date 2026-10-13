/**
 * Nodes the InstrumentBank shares between voices, created lazily and torn down in dispose():
 * - one reverb-send gain per instrument (its send amount), feeding the bank's reverbSend;
 * - three vibrato LFOs (flute, strings, choir) that voices connect into their oscillators' `detune` (cents,
 *   so one LFO serves every pitch);
 * - a looping, band-passed breath noise for the flute;
 * - the choir's "aah" formant filter bank, one per destination node and send choice (formants are fixed in Hz, so
 *   every choir voice heading to the same `out` shares it), swept away once unused;
 * - the custom waveforms (PeriodicWave) for flute, bass and pluck.
 */
import type { InstrumentId } from './types';
import { harmonicWave, noiseBuffer } from './Synth';

/** Reverb send per instrument (0..1, post-envelope). */
export const SEND: Readonly<Record<InstrumentId, number>> = {
  pluck: 0.28,
  pad: 0.4,
  bell: 0.42,
  flute: 0.3,
  bass: 0.04,
  marimba: 0.22,
  drums: 0.12,
  choir: 0.5,
  musicbox: 0.38,
  strings: 0.36,
};

export type LfoKind = 'flute' | 'strings' | 'choir';
const LFO_HZ: Readonly<Record<LfoKind, number>> = { flute: 5.1, strings: 5.6, choir: 4.7 };
/** Fixed vibrato depth in cents for the shared-depth LFOs (the flute uses a per-voice depth instead). */
const LFO_CENTS: Readonly<Record<LfoKind, number>> = { flute: 1, strings: 9, choir: 7 };

/** Open "aah" (Hz, Q, gain). Wide bands keep it soft and even across the range. */
const FORMANTS: ReadonlyArray<readonly [number, number, number]> = [
  [800, 2.2, 1.0],
  [1200, 3, 0.55],
  [2650, 4, 0.2],
];
const FORMANT_BODY_HZ = 600;
const FORMANT_BODY_GAIN = 0.4;

interface FormantChain {
  input: GainNode;
  nodes: AudioNode[];
  lastUse: number;
}

export interface Waves {
  flute: PeriodicWave;
  bass: PeriodicWave;
  pluck: PeriodicWave;
}

export class SharedRig {
  readonly waves: Waves;
  private sends = new Map<InstrumentId, GainNode>();
  private lfos = new Map<LfoKind, { osc: OscillatorNode; depth: GainNode }>();
  private breathSrc: AudioBufferSourceNode | null = null;
  private breathNodes: AudioNode[] = [];
  private breathOut: AudioNode | null = null;
  /** Formant chains by destination: [0] dry only, [1] also feeding the choir reverb send. */
  private readonly formants = [
    new Map<AudioNode, FormantChain>(),
    new Map<AudioNode, FormantChain>(),
  ] as const;
  private nextSweep = 0;

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly reverbSend: AudioNode,
  ) {
    this.waves = {
      // Mostly fundamental with a soft, hollow upper body.
      flute: harmonicWave(ctx, [1, 0.2, 0.085, 0.045, 0.02, 0.01]),
      // Round, lightly saturated bass: strong 2nd-4th harmonics (what a little drive adds) so it is still heard
      // on phone and laptop speakers that cannot play the fundamental, then a steep roll-off (never buzzy).
      bass: harmonicWave(ctx, [1, 0.5, 0.32, 0.2, 0.12, 0.07, 0.04, 0.025]),
      // Saw-like but with a steeper roll-off (1/n^1.35): bright pluck without buzz.
      pluck: harmonicWave(ctx, Array.from({ length: 24 }, (_, i) => 1 / Math.pow(i + 1, 1.35))),
    };
  }

  /** The reverb-send gain for an instrument (connect a voice's final node to it). */
  send(id: InstrumentId): GainNode {
    let g = this.sends.get(id);
    if (!g) {
      g = new GainNode(this.ctx, { gain: SEND[id] });
      g.connect(this.reverbSend);
      this.sends.set(id, g);
    }
    return g;
  }

  /** Raw LFO output (-1..1). Scale it with your own gain before connecting it to a param. */
  lfoRaw(kind: LfoKind): AudioNode {
    return this.lfo(kind).osc;
  }

  /** LFO already scaled to this kind's vibrato depth in cents: connect it straight into `detune`. */
  lfoCents(kind: LfoKind): AudioNode {
    return this.lfo(kind).depth;
  }

  private lfo(kind: LfoKind): { osc: OscillatorNode; depth: GainNode } {
    let l = this.lfos.get(kind);
    if (!l) {
      const osc = new OscillatorNode(this.ctx, { type: 'sine', frequency: LFO_HZ[kind] });
      const depth = new GainNode(this.ctx, { gain: LFO_CENTS[kind] });
      osc.connect(depth);
      osc.start(this.ctx.currentTime);
      l = { osc, depth };
      this.lfos.set(kind, l);
    }
    return l;
  }

  /** Looping breath noise (band-passed around 2.4 kHz), shared by every flute voice. */
  breath(): AudioNode {
    if (this.breathOut) return this.breathOut;
    const src = new AudioBufferSourceNode(this.ctx, { buffer: noiseBuffer(this.ctx, 2, 'white'), loop: true });
    const hp = new BiquadFilterNode(this.ctx, { type: 'highpass', frequency: 900, Q: 0.6 });
    const lp = new BiquadFilterNode(this.ctx, { type: 'lowpass', frequency: 5200, Q: 0.6 });
    src.connect(hp);
    hp.connect(lp);
    src.start(this.ctx.currentTime);
    this.breathSrc = src;
    this.breathNodes = [src, hp, lp];
    this.breathOut = lp;
    return lp;
  }

  /**
   * Input of the "aah" formant bank that feeds `out` (and, when `wet`, the choir reverb send). Voices connect their
   * final node here instead of to `out`. `until` = when the caller's voice ends (keeps the chain alive until then).
   */
  formantInput(out: AudioNode, until: number, wet: boolean): AudioNode {
    const chains = this.formants[wet ? 1 : 0];
    let chain = chains.get(out);
    if (!chain) {
      const ctx = this.ctx;
      const input = new GainNode(ctx, { gain: 1 });
      const sum = new GainNode(ctx, { gain: 1 });
      const nodes: AudioNode[] = [input, sum];
      for (const [hz, q, g] of FORMANTS) {
        const bp = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: hz, Q: q });
        const w = new GainNode(ctx, { gain: g });
        input.connect(bp);
        bp.connect(w);
        w.connect(sum);
        nodes.push(bp, w);
      }
      const body = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: FORMANT_BODY_HZ, Q: 0.5 });
      const bodyGain = new GainNode(ctx, { gain: FORMANT_BODY_GAIN });
      input.connect(body);
      body.connect(bodyGain);
      bodyGain.connect(sum);
      nodes.push(body, bodyGain);
      sum.connect(out);
      if (wet) sum.connect(this.send('choir'));
      chain = { input, nodes, lastUse: until };
      chains.set(out, chain);
    }
    chain.lastUse = Math.max(chain.lastUse, until);
    return chain.input;
  }

  /** Drops formant chains nobody has used for a while (cheap; runs at most once a second). */
  sweep(now: number): void {
    if (now < this.nextSweep) return;
    this.nextSweep = now + 1;
    for (const chains of this.formants) {
      for (const [out, chain] of chains) {
        if (chain.lastUse < now - 1.5) {
          disconnectAll(chain.nodes);
          chains.delete(out);
        }
      }
    }
  }

  dispose(): void {
    for (const l of this.lfos.values()) {
      stopQuietly(l.osc);
      disconnectAll([l.osc, l.depth]);
    }
    this.lfos.clear();
    if (this.breathSrc) stopQuietly(this.breathSrc);
    disconnectAll(this.breathNodes);
    this.breathSrc = null;
    this.breathOut = null;
    this.breathNodes = [];
    for (const chains of this.formants) {
      for (const chain of chains.values()) disconnectAll(chain.nodes);
      chains.clear();
    }
    disconnectAll([...this.sends.values()]);
    this.sends.clear();
  }
}

function stopQuietly(s: AudioScheduledSourceNode): void {
  try {
    s.stop();
  } catch {
    // never started or already stopped
  }
}

function disconnectAll(nodes: readonly AudioNode[]): void {
  for (const n of nodes) {
    try {
      n.disconnect();
    } catch {
      // already disconnected
    }
  }
}
