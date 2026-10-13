/**
 * In-house step sequencer (GDD 2.13): plays SongDefs (content/music/themes.ts) through the synth instruments.
 *
 * - Look-ahead scheduler: a setTimeout tick every ~25 ms schedules, on the AudioContext clock, every note that
 *   starts within the next ~120 ms. Loops wrap exactly (times come from beat positions, never accumulated).
 * - Each track has its own GainNode -> song GainNode -> `out`, and its own reverb send taken after both gains ->
 *   song wet GainNode -> `reverb`, so every fade (stop, song crossfade, state change) fades the reverb too.
 * - setState() crossfades track layers by TrackDef.states: a leaving track keeps playing while it fades, a
 *   joining one enters on the next bar line, and a layer handing over (calm tune -> sad tune) overlaps until then.
 *   A track that has faded out is not scheduled at all.
 * - play() of another song crossfades songs over `fade` seconds; the old song keeps playing until its gain
 *   reaches 0, then stops scheduling and is disconnected. play() of the current song only changes the state.
 * - A suspended context (hidden tab) freezes currentTime, so nothing piles up; anything that should have started
 *   before "now" (stalled timers) is dropped, never played late. Only a held pitched note with a beat or more
 *   left restarts, on the next beat, so a stall cannot leave a long pad chord missing.
 * - Songs are parsed once in the constructor; the tick allocates nothing beyond the instruments' own nodes.
 * - validateSong() problems are logged once per song in dev builds (console.warn); the song still plays.
 */
import { prepareSong, type PreparedSong } from './seq-song';
import { SongRuntime, type SequencerInstruments } from './seq-runtime';
import type { MusicState, SongDef, SongId } from './types';

export { parseTrack, pitchToMidi, type ParsedNote, type DrumKind } from './seq-parse';
export { validateSong } from './seq-validate';
export type { SequencerInstruments, NoteEvent } from './seq-runtime';

/** Scheduler tick while the context runs (ms). */
export const TICK_MS = 25;
/** Notes starting within this many seconds of ctx.currentTime are scheduled each tick. */
export const LOOKAHEAD = 0.12;
/** Tick while the context is suspended or interrupted (ms): only waits for it to run again. */
const IDLE_TICK_MS = 250;
/** A new song starts this long after play() so its first notes are scheduled in time. */
const START_DELAY = 0.06;
/** Default fades (seconds). */
const DEFAULT_SONG_FADE = 1.5;
const DEFAULT_STATE_FADE = 2;
const DEFAULT_STOP_FADE = 1;
const DEFAULT_SILENCE_FADE = 0.4;
const MAX_FADE = 30;

function cleanFade(fade: number | undefined, fallback: number): number {
  if (fade === undefined || !Number.isFinite(fade)) return fallback;
  return Math.min(MAX_FADE, Math.max(0, fade));
}

/** Live playback position of the current song (one object, updated on every read). */
export interface MusicPosition {
  /** Bar inside the loop, 0-based. */
  bar: number;
  /** Beat inside the bar, 0-based and fractional (0 .. meter top). */
  beat: number;
  /** Completed loops since the song started. */
  loop: number;
}

export class MusicPlayer {
  private readonly ctx: BaseAudioContext;
  private readonly bank: SequencerInstruments;
  private readonly out: AudioNode;
  private readonly reverb: AudioNode | null;
  private readonly songs = new Map<SongId, PreparedSong>();
  /** The current song plus any songs still fading out. */
  private readonly runs: SongRuntime[] = [];
  private cur: SongRuntime | null = null;
  private stateValue: MusicState = 'calm';
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly pos: MusicPosition = { bar: 0, beat: 0, loop: 0 };
  private readonly tickFn = (): void => this.tick();
  /** Suspended -> running (unlock, tab shown): schedule at once instead of waiting for the idle tick. */
  private readonly onStateChange = (): void => {
    if (this.runs.length > 0) this.kick();
  };
  private tickFailed = false;
  private disposed = false;

  /**
   * @param ctx    the shared AudioContext (any BaseAudioContext works).
   * @param bank   the InstrumentBank (anything with its play/playDrum).
   * @param out    the Music bus (GainNode); every song connects here.
   * @param songs  all song data; parsed and checked once here.
   * @param reverb the music reverb send (Mixer.musicSend); each track's send connects here. Omit for a dry mix.
   */
  constructor(
    ctx: BaseAudioContext,
    bank: SequencerInstruments,
    out: AudioNode,
    songs: Partial<Record<SongId, SongDef>>,
    reverb: AudioNode | null = null,
  ) {
    this.ctx = ctx;
    this.bank = bank;
    this.out = out;
    this.reverb = reverb;
    for (const key of Object.keys(songs) as SongId[]) {
      const def = songs[key];
      if (def) this.songs.set(key, prepareSong(key, def));
    }
    ctx.addEventListener('statechange', this.onStateChange);
  }

  /** The song playing (or fading in), null when stopped. */
  get current(): SongId | null {
    return this.cur ? this.cur.id : null;
  }

  get state(): MusicState {
    return this.stateValue;
  }

  /** Position of the current song at ctx.currentTime. The same object is reused (read it, don't keep it). */
  get position(): MusicPosition {
    const p = this.pos;
    const r = this.cur;
    if (!r) {
      p.bar = 0;
      p.beat = 0;
      p.loop = 0;
      return p;
    }
    const { loopBeats, barBeats } = r.song;
    const b = Math.max(0, r.beatAt(this.ctx.currentTime));
    p.loop = Math.floor(b / loopBeats);
    const inLoop = b - p.loop * loopBeats;
    p.bar = Math.min(Math.floor(inLoop / barBeats), loopBeats / barBeats - 1);
    p.beat = inLoop - p.bar * barBeats;
    return p;
  }

  /** validateSong() problems of a song (empty = none or unknown song). For the music test page. */
  problems(id: SongId): readonly string[] {
    return this.songs.get(id)?.problems ?? [];
  }

  /** Song data as prepared by the player (bpm-derived timing etc.), or null. For the music test page. */
  info(id: SongId): { bpm: number; barBeats: number; loopBars: number; seconds: number } | null {
    const s = this.songs.get(id);
    if (!s) return null;
    return { bpm: 60 / s.spb, barBeats: s.barBeats, loopBars: s.loopBeats / s.barBeats, seconds: s.loopBeats * s.spb };
  }

  /**
   * Plays a song. Another song playing crossfades out over `fade` seconds (default 1.5; from silence the
   * default is an immediate start). `state` defaults to 'calm' for a new song. Playing the current song again
   * only applies `state` (if given), crossfading over `fade` (default 2).
   */
  play(id: SongId, fade?: number, state?: MusicState): void {
    if (this.disposed) return;
    const song = this.songs.get(id);
    if (!song) {
      if (import.meta.env.DEV) console.warn(`[music] unknown song "${id}"`);
      return;
    }
    if (this.cur && this.cur.id === id) {
      if (state !== undefined && state !== this.stateValue) this.setState(state, fade);
      return;
    }
    this.warnProblems(song);
    const now = this.ctx.currentTime;
    const prev = this.cur;
    const f = cleanFade(fade, prev ? DEFAULT_SONG_FADE : 0);
    this.stateValue = state ?? 'calm';

    // A song still fading out comes back in place (it is still in time) instead of restarting.
    let run: SongRuntime | null = null;
    for (const r of this.runs) if (r.id === id && r !== prev) run = r;
    if (run) {
      run.stopAt = Infinity;
      run.fadeTo(1, now, f);
      run.setState(this.stateValue, now, f);
    } else {
      const start = now + START_DELAY;
      run = new SongRuntime(this.ctx, song, this.out, this.reverb, this.bank, this.stateValue, start, f);
      this.runs.push(run);
    }
    if (prev) prev.fadeOut(now, f);
    this.cur = run;
    this.kick();
  }

  /** Crossfades the current song's track layers to `s` over `fade` seconds (default 2). */
  setState(s: MusicState, fade?: number): void {
    if (this.disposed) return;
    this.stateValue = s;
    if (this.cur) this.cur.setState(s, this.ctx.currentTime, cleanFade(fade, DEFAULT_STATE_FADE));
  }

  /** Fades the current song out over `fade` seconds (default 1) and stops it. */
  stop(fade?: number): void {
    if (this.disposed || !this.cur) return;
    this.cur.fadeOut(this.ctx.currentTime, cleanFade(fade, DEFAULT_STOP_FADE));
    this.cur = null;
  }

  /** Fades every song (also those already fading out) to 0 over `fade` seconds (default 0.4) and stops. */
  silence(fade?: number): void {
    if (this.disposed) return;
    const now = this.ctx.currentTime;
    const f = cleanFade(fade, DEFAULT_SILENCE_FADE);
    for (const r of this.runs) if (r.stopAt > now + f) r.fadeOut(now, f);
    this.cur = null;
  }

  /**
   * Schedules every note up to AudioContext time `until` at once, without waiting for the timer. For an
   * OfflineAudioContext (render a song to measure it): `play(id); scheduleUntil(seconds); startRendering()`.
   */
  scheduleUntil(until: number): void {
    if (this.disposed) return;
    const now = this.ctx.currentTime;
    for (let h = now + 1; ; h += 1) {
      const horizon = Math.min(h, until);
      for (const r of this.runs) r.schedule(now, horizon);
      if (horizon >= until) break;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.ctx.removeEventListener('statechange', this.onStateChange);
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    for (const r of this.runs) r.dispose();
    this.runs.length = 0;
    this.cur = null;
  }

  /** Runs a tick now (so a new song's first notes are scheduled at once) and keeps the timer going. */
  private kick(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.tick();
  }

  /**
   * Scheduler tick. While the context is suspended its clock is frozen, so the window [now, now + LOOKAHEAD)
   * stays the same and nothing new is scheduled (no pile-up); notes queued before the context first runs play
   * as soon as it does.
   */
  private tick(): void {
    this.timer = null;
    if (this.disposed) return;
    const ctx = this.ctx;
    if (ctx.state === 'closed') return;
    const runs = this.runs;
    const now = ctx.currentTime;
    try {
      let w = 0;
      for (let i = 0; i < runs.length; i++) {
        const r = runs[i]!;
        if (r.stopAt <= now) r.dispose();
        else runs[w++] = r;
      }
      runs.length = w;
      const horizon = now + LOOKAHEAD;
      for (let i = 0; i < runs.length; i++) runs[i]!.schedule(now, horizon);
    } catch (err) {
      if (!this.tickFailed) console.error('[music] scheduler tick failed', err);
      this.tickFailed = true;
    }
    if (runs.length === 0) return;
    this.timer = setTimeout(this.tickFn, ctx.state === 'running' ? TICK_MS : IDLE_TICK_MS);
  }

  private warnProblems(song: PreparedSong): void {
    if (song.warned) return;
    song.warned = true;
    if (!import.meta.env.DEV || song.problems.length === 0) return;
    console.warn(`[music] "${song.id}" has ${song.problems.length} problem(s); it still plays:\n  ${song.problems.join('\n  ')}`);
  }
}
