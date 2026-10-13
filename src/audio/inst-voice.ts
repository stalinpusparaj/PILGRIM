/**
 * One playing note of the InstrumentBank: every node it created (so all of them can be disconnected when it
 * ends), the connections it made into shared modulators' params, and the shape of its final envelope (so a
 * stolen voice fades from exactly where it is). Voice records are pooled; the Web Audio nodes are not (they
 * are one-shot by design).
 */
import type { InstrumentId } from './types';
import { adsrValueAt } from './Synth';

export class Voice {
  inst: InstrumentId = 'pluck';
  /** Context time the note starts and the time every source stops. */
  start = 0;
  end = 0;
  /** Final gain stage: the only node connected to the caller's `out` (and to the reverb send). */
  final: GainNode | null = null;
  readonly nodes: AudioNode[] = [];
  readonly sources: AudioScheduledSourceNode[] = [];
  /**
   * Connections from shared nodes (LFOs, breath noise) into this voice: linkFrom[i] -> linkTo[i] (a param) or
   * linkToNode[i] (a node). Disconnecting the voice's own nodes would not remove these.
   */
  readonly linkFrom: AudioNode[] = [];
  readonly linkTo: (AudioParam | null)[] = [];
  readonly linkToNode: (AudioNode | null)[] = [];
  // Envelope of `final.gain` as scheduled by adsr() (peak 0 = no envelope recorded).
  private et = 0;
  private ep = 0;
  private ea = 0;
  private ed = 0;
  private es = 0;
  private er = 0;
  private edur = 0;

  setShape(t: number, peak: number, a: number, d: number, s: number, r: number, dur: number): void {
    this.et = t;
    this.ep = peak;
    this.ea = a;
    this.ed = d;
    this.es = s;
    this.er = r;
    this.edur = dur;
  }

  get peak(): number {
    return this.ep;
  }

  /** Value of the final envelope at `time`. */
  levelAt(time: number): number {
    if (this.ep <= 0) return 0;
    return adsrValueAt(this.et, this.ep, this.ea, this.ed, this.es, this.er, this.edur, time);
  }

  reset(): void {
    this.final = null;
    this.nodes.length = 0;
    this.sources.length = 0;
    this.linkFrom.length = 0;
    this.linkTo.length = 0;
    this.linkToNode.length = 0;
    this.ep = 0;
    this.start = 0;
    this.end = 0;
  }

  /** Disconnects everything this voice created or connected. Safe to call more than once. */
  disconnectAll(): void {
    for (let i = 0; i < this.sources.length; i++) {
      const s = this.sources[i];
      if (s) s.onended = null;
    }
    for (let i = 0; i < this.linkFrom.length; i++) {
      const from = this.linkFrom[i];
      const to = this.linkTo[i];
      const toNode = this.linkToNode[i];
      try {
        if (from && to) from.disconnect(to);
        else if (from && toNode) from.disconnect(toNode);
      } catch {
        // already disconnected
      }
    }
    for (let i = 0; i < this.nodes.length; i++) {
      try {
        this.nodes[i]?.disconnect();
      } catch {
        // already disconnected
      }
    }
  }

  /** Re-schedules every source to stop at `when` (used by voice stealing). */
  stopAt(when: number): void {
    this.end = when;
    for (let i = 0; i < this.sources.length; i++) {
      try {
        this.sources[i]?.stop(when);
      } catch {
        // some older engines refuse a second stop(); the original stop time then stands
      }
    }
  }
}

export class VoicePool {
  private free: Voice[] = [];

  take(): Voice {
    return this.free.pop() ?? new Voice();
  }

  give(v: Voice): void {
    v.reset();
    if (this.free.length < 64) this.free.push(v);
  }
}
