/**
 * InstrumentBank (GDD 2.13): the in-house synth instruments used by the music sequencer (and anything else
 * that wants a pitched note): soft pluck, warm pad, bell, flute-like lead, bass, marimba, soft drums, choir
 * "aah", music box and strings. Built from oscillators, noise buffers, envelopes and filters only.
 *
 * - Every instrument is velocity-sensitive and level-matched: at vel 0.8 a single note of any of them has
 *   about the same perceived loudness (calibrated with K-weighted momentary loudness, see LEVEL).
 * - Each has its own reverb-send amount into the `reverbSend` node given to the constructor (inst-shared SEND),
 *   taken before the caller's `out`. A caller that fades `out` (the sequencer) passes `wet = false` and takes the
 *   send itself after its faders, so a fade also fades the reverb.
 * - Voice-limited: at most `maxVoices` (24) notes at once; when full, the quietest sounding voice (oldest on a
 *   tie) is faded out in ~50 ms (no click) and replaced. At most ~6 nodes per voice; every node is disconnected when its
 *   voice ends.
 * - Deterministic: detune "humanising" and noise start points come from a seeded Rng, so the same calls give
 *   the same audio (works in an OfflineAudioContext too).
 */
import { Rng, hashString } from '../gen/rng';
import type { InstrumentId } from './types';
import { midiToHz } from './Synth';
import { Kit, velCurve, type BuilderTable, type NoteSpec } from './inst-kit';
import { SharedRig } from './inst-shared';
import { Voice, VoicePool } from './inst-voice';
import { bass, choir, flute, pad, pluck, strings } from './inst-tonal';
import { bell, marimba, musicbox } from './inst-mallet';
import { DRUM_LEVEL, buildDrum, isDrumKind, midiToDrum, type DrumKind } from './inst-drums';

export type { DrumKind } from './inst-drums';
export { SEND } from './inst-shared';

export interface PlayNote {
  midi: number;
  /** Context time (s) the note starts; times in the past play now. */
  time: number;
  /** Gate length in seconds (struck instruments ring on a little past it). */
  dur: number;
  /** Velocity 0..1 (louder and brighter when higher). */
  vel: number;
}

/**
 * Peak gain per instrument at vel 0.8. Calibrated in Chrome so one note of each, across its usual range, reaches
 * the same K-weighted momentary loudness: -24 LUFS +-1 dB per note, dry (drums: kick -24, snare -25, tom -26,
 * rim -29, hats -30/-31). Single notes peak at 0.1-0.25, leaving headroom for full arrangements.
 */
export const LEVEL: Readonly<Record<Exclude<InstrumentId, 'drums'>, number>> = {
  pluck: 0.073,
  pad: 0.104,
  bell: 0.075,
  flute: 0.071,
  bass: 0.098,
  marimba: 0.132,
  choir: 0.151,
  musicbox: 0.065,
  strings: 0.073,
};

const BUILDERS: BuilderTable = { pluck, pad, bell, flute, bass, marimba, choir, musicbox, strings };

const MAX_VOICES = 24;
/** Fade time constant for a stolen voice (s); it is fully stopped ~70 ms later. */
const STEAL_TC = 0.012;

export class InstrumentBank {
  /** Simultaneous note limit (oldest/quietest voices are stolen beyond it). Lower it on weak devices. */
  maxVoices = MAX_VOICES;
  private readonly rig: SharedRig;
  private readonly kit: Kit;
  private readonly pool = new VoicePool();
  /** Voices that may still sound, in start order (pruned lazily by end time). */
  private readonly active: Voice[] = [];
  /** Every voice whose nodes still exist, keyed by the source whose `ended` event releases it. */
  private readonly live = new Map<EventTarget, Voice>();
  private readonly note: NoteSpec = { hz: 440, midi: 69, t: 0, dur: 0.25, vel: 0.8, amp: 0 };
  private disposed = false;

  constructor(
    private readonly ctx: BaseAudioContext,
    reverbSend: AudioNode,
  ) {
    this.rig = new SharedRig(ctx, reverbSend);
    this.kit = new Kit(ctx, new Rng(hashString('instrument-bank')), this.rig);
  }

  /**
   * Plays one note of `id` into `out`. 'drums' maps General-MIDI note numbers to the kit (36 kick, 38 snare...).
   * `wet` (default true) also feeds the instrument's reverb send; false = dry only (the caller sends `out` itself).
   */
  play(id: InstrumentId, n: PlayNote, out: AudioNode, wet = true): void {
    if (id === 'drums') {
      this.playDrum(midiToDrum(n.midi), n.time, n.vel, out, wet);
      return;
    }
    if (this.disposed || !Number.isFinite(n.midi) || !(n.vel > 0)) return;
    const midi = Math.min(120, Math.max(12, n.midi));
    const spec = this.note;
    spec.midi = midi;
    spec.hz = midiToHz(midi);
    spec.t = this.startTime(n.time);
    spec.dur = Number.isFinite(n.dur) && n.dur > 0 ? n.dur : 0.25;
    spec.vel = Math.min(1, n.vel);
    spec.amp = LEVEL[id] * velCurve(n.vel);
    const v = this.begin(id, spec.t);
    try {
      const final = BUILDERS[id](this.kit, v, spec);
      if (id === 'choir') final.connect(this.rig.formantInput(out, v.end, wet));
      else {
        final.connect(out);
        if (wet) final.connect(this.rig.send(id));
      }
      this.commit(v, final);
    } catch (err) {
      this.abort(v, err);
    }
  }

  /** Plays one drum hit (K kick, S snare, H hat, O open hat, T tom, R rim) into `out`; `wet` as in play(). */
  playDrum(kind: DrumKind, time: number, vel: number, out: AudioNode, wet = true): void {
    if (this.disposed || !isDrumKind(kind) || !(vel > 0)) return;
    const t = this.startTime(time);
    const v = this.begin('drums', t);
    try {
      const final = buildDrum(this.kit, v, kind, t, DRUM_LEVEL[kind] * velCurve(vel), Math.min(1, vel));
      final.connect(out);
      if (wet) final.connect(this.rig.send('drums'));
      this.commit(v, final);
    } catch (err) {
      this.abort(v, err);
    }
  }

  /** Number of notes currently sounding or scheduled (for the debug panel and tests). */
  get voiceCount(): number {
    this.prune(this.ctx.currentTime);
    return this.active.length;
  }

  /** Stops every voice at once and disconnects every node the bank made. The bank is unusable afterwards. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const now = this.ctx.currentTime;
    for (const v of this.live.values()) {
      v.stopAt(now);
      v.disconnectAll();
    }
    this.live.clear();
    this.active.length = 0;
    this.rig.dispose();
  }

  private startTime(time: number): number {
    const now = this.ctx.currentTime;
    return Number.isFinite(time) && time > now ? time : now;
  }

  /** Takes a voice record, making room first if the bank is full. */
  private begin(id: InstrumentId, t: number): Voice {
    const now = this.ctx.currentTime;
    this.prune(now);
    while (this.active.length >= Math.max(1, this.maxVoices)) this.steal(now);
    this.rig.sweep(now);
    const v = this.pool.take();
    v.inst = id;
    v.start = t;
    return v;
  }

  private commit(v: Voice, final: GainNode): void {
    v.final = final;
    if (v.nodes.indexOf(final) < 0) v.nodes.push(final);
    const first = v.sources[0];
    if (!first) {
      this.release(v);
      return;
    }
    for (let i = 0; i < v.sources.length; i++) v.sources[i]?.stop(v.end);
    first.onended = this.onEnded;
    this.live.set(first, v);
    this.active.push(v);
  }

  private abort(v: Voice, err: unknown): void {
    v.stopAt(this.ctx.currentTime);
    v.disconnectAll();
    this.pool.give(v);
    if (import.meta.env.DEV) console.warn('[instruments] note failed', err);
  }

  private readonly onEnded = (e: Event): void => {
    const target = e.target;
    const v = target ? this.live.get(target) : undefined;
    if (!v || !target) return;
    this.live.delete(target);
    this.release(v);
  };

  private release(v: Voice): void {
    v.disconnectAll();
    const i = this.active.indexOf(v);
    if (i >= 0) this.active.splice(i, 1);
    this.pool.give(v);
  }

  private prune(now: number): void {
    const a = this.active;
    let w = 0;
    for (let r = 0; r < a.length; r++) {
      const v = a[r];
      if (v && v.end > now) a[w++] = v;
    }
    a.length = w;
  }

  /** Fades out the quietest sounding voice (relative to its peak; oldest wins a near tie). */
  private steal(now: number): void {
    const a = this.active;
    let best = -1;
    let bestScore = Infinity;
    for (let i = 0; i < a.length; i++) {
      const v = a[i];
      if (!v || v.start > now + 0.005) continue; // scheduled ahead: keep it
      const score = v.peak > 0 ? v.levelAt(now) / v.peak : 0;
      if (score < bestScore - 0.02) {
        best = i;
        bestScore = score;
      }
    }
    if (best < 0) best = 0;
    const v = a[best];
    a.splice(best, 1);
    if (!v) return;
    if (v.start > now) {
      v.stopAt(v.start); // never heard
      return;
    }
    const g = v.final?.gain;
    if (g) {
      const level = v.levelAt(now);
      g.cancelScheduledValues(now);
      g.setValueAtTime(level, now);
      g.setTargetAtTime(0, now, STEAL_TC);
    }
    v.stopAt(now + STEAL_TC * 6);
  }
}
