/**
 * One playing song: one GainNode per track (crossfades between MusicStates) feeding the song's dry GainNode and,
 * through the track's own reverb send, the song's wet GainNode; one Fader drives both song gains (crossfades
 * between songs). The reverb is taken after every fader, so a stop, a song crossfade or a state change fades the
 * reverb with the dry sound. A cursor per track drives the look-ahead scheduler. All timing comes from the
 * AudioContext clock: note time = start + (loop * loopBeats + beat) * secondsPerBeat, so loops wrap exactly
 * and never drift. schedule() allocates nothing (one reused note object is handed to the instruments).
 */
import { Rng, hashString } from '../gen/rng';
import { SEND } from './inst-shared';
import type { DrumKind } from './seq-parse';
import type { PreparedSong, PreparedTrack, SeqNote } from './seq-song';
import type { InstrumentId, MusicState, SongId } from './types';

/** Note handed to the instruments (same shape as Instruments.ts PlayNote). */
export interface NoteEvent {
  midi: number;
  time: number;
  dur: number;
  vel: number;
}

/**
 * What the sequencer needs from InstrumentBank (src/audio/Instruments.ts); the bank satisfies it as is. The
 * sequencer always passes `wet = false`: it takes each track's reverb send itself, after its faders.
 */
export interface SequencerInstruments {
  play(id: InstrumentId, n: NoteEvent, out: AudioNode, wet?: boolean): void;
  playDrum(kind: DrumKind, time: number, vel: number, out: AudioNode, wet?: boolean): void;
}

/** Shortest gain ramp, so no change ever clicks. */
export const MIN_RAMP = 0.012;
/** Notes that should have started more than this long ago are dropped, never played late. */
const LATE = 0.003;
/** A track that comes back mid-note restarts that note at the bar line if at least this many beats remain. */
const MIN_PARTIAL_BEATS = 1;
/** Velocity humanising, +/- half of this (seeded per song). */
const VEL_JITTER = 0.08;
/** Quieter notes are not played at all. */
const MIN_VEL = 0.01;
/** A note that would start below this share of full level while its track or song fades out is not played. */
const FADED = 0.02;
/** Safety cap on notes handled per track per tick. */
const MAX_NOTES_PER_TICK = 512;

/**
 * A gain (one or more AudioParams moving together) that ramps linearly and knows its own value at any time (no
 * AudioParam.value reads, which lag while the context is suspended). Every change starts from the exact current
 * level, so nothing clicks.
 */
export class Fader {
  private from: number;
  private to: number;
  private t0 = 0;
  private t1 = 0;
  readonly params: readonly AudioParam[];

  constructor(params: readonly AudioParam[], initial: number) {
    this.params = params;
    this.from = initial;
    this.to = initial;
    for (const p of params) p.value = initial;
  }

  /** Level at AudioContext time `t`. */
  at(t: number): number {
    if (t >= this.t1) return this.to;
    if (t <= this.t0) return this.from;
    return this.from + ((this.to - this.from) * (t - this.t0)) / (this.t1 - this.t0);
  }

  /** Target level (where the current ramp ends). */
  get target(): number {
    return this.to;
  }

  /** AudioContext time the current ramp ends. */
  get end(): number {
    return this.t1;
  }

  /** Ramps to `target` over `fade` seconds (at least MIN_RAMP) from the level at `now`. */
  set(target: number, now: number, fade: number): void {
    const v = this.at(now);
    const end = now + Math.max(fade, MIN_RAMP);
    for (const p of this.params) {
      p.cancelScheduledValues(now);
      p.setValueAtTime(v, now);
      p.linearRampToValueAtTime(target, end);
    }
    this.from = v;
    this.to = target;
    this.t0 = now;
    this.t1 = end;
  }
}

interface TrackRun {
  readonly t: PreparedTrack;
  readonly gain: GainNode;
  /** The track's reverb send, after its fader (null: no reverb, or none for this instrument). */
  readonly send: GainNode | null;
  readonly fader: Fader;
  /** Scheduling: audible in the current state, or still fading out of it. */
  on: boolean;
  /** Next note index and the loop it belongs to. */
  idx: number;
  loop: number;
  /** A held note restarted at the bar line when the track comes back (null = none). */
  partial: SeqNote | null;
  partialBeat: number;
  partialBeats: number;
}

export class SongRuntime {
  readonly id: SongId;
  readonly song: PreparedSong;
  /** Dry output (into the Music bus). */
  readonly gain: GainNode;
  /** Wet output (into the music reverb send), null when the player has no reverb. */
  private readonly wet: GainNode | null;
  private readonly fader: Fader;
  /** AudioContext time of beat 0 of loop 0. */
  readonly start: number;
  /** AudioContext time after which the runtime is disposed (Infinity while playing). */
  stopAt = Infinity;
  private readonly runs: TrackRun[];
  private readonly bank: SequencerInstruments;
  private readonly rng: Rng;
  private readonly ev: NoteEvent = { midi: 0, time: 0, dur: 0, vel: 0 };
  private disposed = false;

  /** `reverb`: the music reverb send (Mixer.musicSend); null plays the song dry. */
  constructor(
    ctx: BaseAudioContext,
    song: PreparedSong,
    out: AudioNode,
    reverb: AudioNode | null,
    bank: SequencerInstruments,
    state: MusicState,
    start: number,
    fadeIn: number,
  ) {
    this.id = song.id;
    this.song = song;
    this.bank = bank;
    this.start = start;
    this.rng = new Rng(hashString(`music:${song.id}`));
    const now = ctx.currentTime;
    this.gain = ctx.createGain();
    this.gain.connect(out);
    const wet = reverb ? ctx.createGain() : null;
    if (wet && reverb) wet.connect(reverb);
    this.wet = wet;
    this.fader = new Fader(wet ? [this.gain.gain, wet.gain] : [this.gain.gain], 0);
    this.fader.set(1, now, fadeIn);
    this.runs = song.tracks.map((t) => {
      const gain = ctx.createGain();
      const on = t.audible[state] && t.base > 0;
      const fader = new Fader([gain.gain], on ? t.base : 0);
      gain.connect(this.gain);
      const amount = trackSend(t);
      let send: GainNode | null = null;
      if (wet && amount > 0) {
        send = ctx.createGain();
        send.gain.value = amount;
        gain.connect(send);
        send.connect(wet);
      }
      return { t, gain, send, fader, on, idx: 0, loop: 0, partial: null, partialBeat: 0, partialBeats: 0 };
    });
  }

  /** Beat position (from beat 0 of loop 0) at AudioContext time `time`; negative before the song starts. */
  beatAt(time: number): number {
    return (time - this.start) / this.song.spb;
  }

  /** Song-level fade (crossfades between songs). */
  fadeTo(target: number, now: number, fade: number): void {
    if (this.disposed) return;
    this.fader.set(target, now, fade);
  }

  /** Fades the song out and marks it for disposal once silent. */
  fadeOut(now: number, fade: number): void {
    this.fadeTo(0, now, fade);
    this.stopAt = now + Math.max(fade, MIN_RAMP) + 0.05;
  }

  /**
   * Crossfades track layers to `state` over `fade` seconds. Tracks that come back re-enter on the next bar line.
   * Leaving tracks keep playing while they fade. One whose layer gets a joining track (the calm tune handing over
   * to the sad tune) fades until half a fade past that bar line, so the layer is never left empty.
   */
  setState(state: MusicState, now: number, fade: number): void {
    if (this.disposed) return;
    const runs = this.runs;
    const joining = new Set<string>();
    for (const r of runs) if (!r.on && r.t.audible[state] && r.t.base > 0) joining.add(r.t.def.layer);
    const entry = this.start + this.nextBar(now) * this.song.spb;
    const handover = Math.max(fade, entry - now + fade / 2);
    for (const r of runs) {
      const target = r.t.audible[state] ? r.t.base : 0;
      if (target !== r.fader.target) {
        r.fader.set(target, now, target === 0 && joining.has(r.t.def.layer) ? handover : fade);
      }
      if (target > 0 && !r.on) {
        this.resume(r, now);
        r.on = true;
      }
    }
  }

  /** Schedules every note of every audible track that starts in [now, horizon). Allocation free. */
  schedule(now: number, horizon: number): void {
    if (this.disposed) return;
    const spb = this.song.spb;
    const loopBeats = this.song.loopBeats;
    const runs = this.runs;
    for (let i = 0; i < runs.length; i++) {
      const r = runs[i]!;
      if (!r.on) continue;
      if (r.fader.target === 0 && now >= r.fader.end) {
        // Faded out of the state: stop scheduling (a later state change brings it back on a bar line).
        r.on = false;
        r.partial = null;
        continue;
      }
      this.flushPartial(r, now, horizon);
      const notes = r.t.notes;
      const count = notes.length;
      if (count === 0) continue;
      for (let guard = 0; guard < MAX_NOTES_PER_TICK; guard++) {
        const n = notes[r.idx]!;
        const t = this.start + (r.loop * loopBeats + n.beat) * spb;
        if (t >= horizon) break;
        if (t < now - LATE) {
          // Late (stalled main thread): drop everything older than now and jump ahead. A held note that still
          // has a beat or more to go restarts on the next beat, so a long pad chord does not go missing.
          const b = (now - this.start) / spb;
          this.rejoin(r, b, Math.ceil(b + LATE / spb));
          this.flushPartial(r, now, horizon);
          continue;
        }
        this.emit(r, n, t, n.beats);
        if (++r.idx >= count) {
          r.idx = 0;
          r.loop++;
        }
      }
    }
  }

  /** Disconnects every node. Notes already handed to the instruments end on their own. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const p of this.fader.params) p.cancelScheduledValues(0);
    this.gain.disconnect();
    this.wet?.disconnect();
    for (const r of this.runs) {
      r.gain.disconnect();
      r.send?.disconnect();
    }
  }

  /** The next bar line at or after `now` (plus the scheduler's margin), as an absolute beat. */
  private nextBar(now: number): number {
    const { spb, barBeats } = this.song;
    const b = Math.max(0, (now + 0.03 - this.start) / spb);
    return Math.ceil(b / barBeats - 1e-9) * barBeats;
  }

  /** Puts the cursor on the first note at or after absolute beat `b`. */
  private seek(r: TrackRun, b: number): void {
    const loopBeats = this.song.loopBeats;
    const pos = b > 0 ? b : 0;
    let loop = Math.floor(pos / loopBeats);
    const inLoop = pos - loop * loopBeats;
    const notes = r.t.notes;
    let idx = 0;
    while (idx < notes.length && notes[idx]!.beat < inLoop - 1e-9) idx++;
    if (idx >= notes.length) {
      idx = 0;
      loop++;
    }
    r.idx = idx;
    r.loop = loop;
  }

  /** A track that was silent comes back: continue from the next bar line, picking up a note held across it. */
  private resume(r: TrackRun, now: number): void {
    const bar = this.nextBar(now);
    this.rejoin(r, bar, bar);
  }

  /**
   * Puts the cursor on the first note at or after absolute beat `from`; if the note before it is a pitched note
   * still sounding at absolute beat `at` (>= from's note start) with at least MIN_PARTIAL_BEATS left, it is
   * queued to restart at `at` for the rest of its length.
   */
  private rejoin(r: TrackRun, from: number, at: number): void {
    this.seek(r, from);
    r.partial = null;
    const notes = r.t.notes;
    if (notes.length === 0 || (r.idx === 0 && r.loop === 0)) return;
    const prevIdx = r.idx > 0 ? r.idx - 1 : notes.length - 1;
    const prevLoop = r.idx > 0 ? r.loop : r.loop - 1;
    const prev = notes[prevIdx]!;
    if (prev.kinds !== null) return;
    const end = prevLoop * this.song.loopBeats + prev.beat + prev.beats;
    if (end - at >= MIN_PARTIAL_BEATS) {
      r.partial = prev;
      r.partialBeat = at;
      r.partialBeats = end - at;
    }
  }

  /** Emits a queued held-note restart once it falls inside the window (dropped if it is already late). */
  private flushPartial(r: TrackRun, now: number, horizon: number): void {
    const partial = r.partial;
    if (partial === null) return;
    const t = this.start + r.partialBeat * this.song.spb;
    if (t >= horizon) return;
    if (t >= now - LATE) this.emit(r, partial, t, r.partialBeats);
    r.partial = null;
  }

  private emit(r: TrackRun, n: SeqNote, time: number, beats: number): void {
    let vel = n.vel * (1 + (this.rng.next() - 0.5) * VEL_JITTER);
    vel = vel > 1 ? 1 : vel;
    if (vel < MIN_VEL) return;
    // The faders shape the notes (dry and reverb); a note that would start almost silent only takes a voice.
    if (fadedOut(this.fader, time, 1) || fadedOut(r.fader, time, r.t.base)) return;
    const kinds = n.kinds;
    if (kinds !== null) {
      for (let k = 0; k < kinds.length; k++) this.bank.playDrum(kinds[k]!, time, vel, r.gain, false);
      return;
    }
    const ev = this.ev;
    const instrument = r.t.def.instrument;
    ev.time = time;
    ev.dur = beats * this.song.spb;
    ev.vel = vel;
    for (let k = 0; k < n.midis.length; k++) {
      ev.midi = n.midis[k]!;
      this.bank.play(instrument, ev, r.gain, false);
    }
  }
}

/** True when `f` is fading out and is below FADED of `full` at time `t` (it only gets quieter from there). */
function fadedOut(f: Fader, t: number, full: number): boolean {
  return f.target === 0 && f.at(t) < FADED * full;
}

/**
 * A track's reverb send amount, taken after its fader: the instrument's SEND divided by the track's full gain, so
 * at full level the wet signal is exactly the instrument's own send (the tuned balance) and every fade scales it.
 */
function trackSend(t: PreparedTrack): number {
  const amount = SEND[t.def.instrument] ?? 0;
  return t.base > 0 ? amount / t.base : 0;
}
