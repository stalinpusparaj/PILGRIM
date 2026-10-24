/**
 * Phone music (DECISIONS #391, #392). The live sequencer builds a few oscillators, filters and envelopes per note;
 * on a budget phone the Web Audio thread cannot render that in time and the music stutters (measured on an OPPO
 * A5x: ~18 600 frames of output underrun per 10 s with music alone, none without). Here a song is baked once into
 * seamless loops by the same sequencer, instruments and reverb (music-bake.ts, kept on the device): one STEM per
 * group of tracks that share their `states`. All stems of a song start together as looping AudioBufferSourceNodes
 * and a state change only fades stem gains, exactly like the live sequencer's layer crossfades: instant, smooth,
 * and as cheap as playing sound files. Still our own generated sound (GDD 2.3). A song plays once all its stems
 * are ready (about 15 s the very first time on a budget phone, then under a second from the device store).
 */
import { THERMAL_MODERATE, thermalStatus } from '../core/NativeShell';
import type { MusicPosition } from './Sequencer';
import { bakedLoop, forgetOldStores } from './music-bake';
import { prepareSong } from './seq-song';
import type { MusicState, SongDef, SongId, TrackDef } from './types';

/** What AudioEngine needs from a music player (MusicPlayer and BakedMusic both provide it). */
export interface MusicBackend {
  readonly current: SongId | null;
  readonly state: MusicState;
  readonly position: MusicPosition;
  play(id: SongId, fade?: number, state?: MusicState): void;
  setState(s: MusicState, fade?: number): void;
  stop(fade?: number): void;
  silence(fade?: number): void;
  dispose(): void;
}

/** Songs whose stems are kept in memory (a few MB per stem at 24 kHz). */
const SONGS_KEPT = 2;
/** Background prebake starts this long after the music engine (ms), clear of the first chapter's build. */
const PREBAKE_DELAY_MS = 8000;
/** Rest between background bakes (ms): the phone's CPU cools between songs. */
const PREBAKE_REST_MS = 4000;
const DEFAULT_SONG_FADE = 1.5;
const DEFAULT_STATE_FADE = 2;
/** First fade-in of a song that had to be baked (it arrives mid-scene, so it comes in gently). */
const LATE_FADE = 2.5;

interface StemDef { states: readonly MusicState[] | null; def: SongDef }
interface Stem { states: readonly MusicState[] | null; buf: AudioBuffer }
interface PlayingStem { states: readonly MusicState[] | null; src: AudioBufferSourceNode; gain: GainNode }
interface Playing { id: SongId; stems: PlayingStem[]; bus: GainNode; origin: number; loopSec: number }

/** Tracks grouped by the states they play in; each group becomes one stem that plays in every state. */
export function stemDefs(def: SongDef): StemDef[] {
  const groups = new Map<string, { states: MusicState[] | null; tracks: TrackDef[] }>();
  for (const tr of def.tracks) {
    const states = tr.states && tr.states.length ? [...tr.states].sort() : null;
    const key = states ? states.join(',') : '*';
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { states, tracks: [] }));
    g.tracks.push({ ...tr, states: undefined });
  }
  return [...groups.values()].map((g) => ({ states: g.states, def: { ...def, tracks: g.tracks } }));
}

function audible(states: readonly MusicState[] | null, s: MusicState): boolean {
  return states === null || states.includes(s);
}

export class BakedMusic implements MusicBackend {
  private readonly ready = new Map<SongId, Stem[]>();
  private cur: SongId | null = null;
  private stateValue: MusicState = 'calm';
  private playing: Playing | null = null;
  private gen = 0;
  private disposed = false;
  private prebakeTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly pos: MusicPosition = { bar: 0, beat: 0, loop: 0 };

  constructor(
    private readonly ctx: AudioContext,
    private readonly out: AudioNode,
    private readonly songs: Partial<Record<SongId, SongDef>>,
  ) {
    // Every song, in the background, after the first few seconds: later chapters' music is then ready at once.
    this.prebakeTimer = setTimeout(() => void this.prebakeAll(), PREBAKE_DELAY_MS);
  }

  get current(): SongId | null { return this.cur; }
  get state(): MusicState { return this.stateValue; }
  get position(): MusicPosition {
    const p = this.playing;
    const def = p ? this.songs[p.id] : undefined;
    if (!p || !def || p.loopSec <= 0) { this.pos.bar = this.pos.beat = this.pos.loop = 0; return this.pos; }
    const song = prepareSong(p.id, def);
    const t = Math.max(0, this.ctx.currentTime - p.origin);
    this.pos.loop = Math.floor(t / p.loopSec);
    const beats = (t - this.pos.loop * p.loopSec) / song.spb;
    this.pos.bar = Math.floor(beats / song.barBeats);
    this.pos.beat = beats - this.pos.bar * song.barBeats;
    return this.pos;
  }

  play(id: SongId, fade?: number, state?: MusicState): void {
    if (this.disposed || !this.songs[id]) return;
    if (this.cur === id) {
      if (state !== undefined && state !== this.stateValue) this.setState(state, fade);
      return;
    }
    const hadSong = this.cur !== null;
    this.cur = id;
    this.stateValue = state ?? 'calm';
    const gen = ++this.gen;
    const f = fade ?? (hadSong ? DEFAULT_SONG_FADE : 0);
    this.release(f);
    const stems = this.ready.get(id);
    if (stems) {
      this.start(id, stems, f);
      return;
    }
    void this.bake(id, () => gen === this.gen && !this.disposed).then((baked) => {
      if (baked && gen === this.gen && !this.disposed) this.start(id, baked, Math.max(f, LATE_FADE));
    });
  }

  setState(s: MusicState, fade?: number): void {
    if (this.disposed || s === this.stateValue) return;
    this.stateValue = s;
    const p = this.playing;
    if (!p) return;
    const now = this.ctx.currentTime;
    const f = Math.max(0.05, fade ?? DEFAULT_STATE_FADE);
    for (const st of p.stems) ramp(st.gain.gain, audible(st.states, s) ? 1 : 0, now, f);
  }

  stop(fade?: number): void {
    this.gen++;
    this.cur = null;
    this.release(fade ?? 1);
  }

  silence(fade?: number): void {
    this.stop(fade ?? 0.4);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.prebakeTimer !== null) clearTimeout(this.prebakeTimer);
    this.gen++;
    this.release(0);
    this.ready.clear();
  }

  /**
   * Bakes every song's stems in the background, one at a time with a rest between them, and not at all while the
   * phone reports heat (DECISIONS #394). Stems already on the device cost only a lookup.
   */
  private async prebakeAll(): Promise<void> {
    this.prebakeTimer = null;
    void forgetOldStores();
    for (const [id, def] of Object.entries(this.songs) as Array<[SongId, SongDef | undefined]>) {
      if (!def) continue;
      for (const s of stemDefs(def)) {
        while (!this.disposed && (thermalStatus() >= THERMAL_MODERATE || document.hidden)) await sleep(PREBAKE_REST_MS * 4);
        if (this.disposed) return;
        const t0 = performance.now();
        await bakedLoop(id, s.def, { urgent: false, wanted: () => !this.disposed });
        if (performance.now() - t0 > 500) await sleep(PREBAKE_REST_MS); // it was rendered, not read back
      }
    }
  }

  /** Every stem of a song, from the device store or baked now (one after another). Null if any fails. */
  private async bake(id: SongId, wanted: () => boolean): Promise<Stem[] | null> {
    const def = this.songs[id];
    if (!def) return null;
    const stems: Stem[] = [];
    for (const s of stemDefs(def)) {
      const buf = await bakedLoop(id, s.def, { urgent: true, wanted });
      if (!buf) return null;
      stems.push({ states: s.states, buf });
    }
    this.ready.delete(id);
    this.ready.set(id, stems);
    while (this.ready.size > SONGS_KEPT) {
      const oldest = this.ready.keys().next().value!;
      if (oldest === this.cur) break;
      this.ready.delete(oldest);
    }
    return stems;
  }

  private start(id: SongId, stems: readonly Stem[], fade: number): void {
    const now = this.ctx.currentTime;
    const at = now + 0.05;
    const bus = this.ctx.createGain();
    bus.gain.setValueAtTime(0, now);
    bus.gain.linearRampToValueAtTime(1, at + Math.max(0.02, fade));
    bus.connect(this.out);
    const playing: PlayingStem[] = stems.map((s) => {
      const src = this.ctx.createBufferSource();
      src.buffer = s.buf;
      src.loop = true;
      const gain = this.ctx.createGain();
      gain.gain.value = audible(s.states, this.stateValue) ? 1 : 0;
      src.connect(gain).connect(bus);
      src.start(at);
      return { states: s.states, src, gain };
    });
    this.playing = { id, stems: playing, bus, origin: at, loopSec: stems[0]?.buf.duration ?? 0 };
  }

  private release(fade: number): void {
    const p = this.playing;
    if (!p) return;
    this.playing = null;
    const now = this.ctx.currentTime;
    const f = Math.max(0.02, fade);
    ramp(p.bus.gain, 0, now, f);
    for (const s of p.stems) s.src.stop(now + f + 0.05);
    const first = p.stems[0];
    const cleanup = (): void => {
      for (const s of p.stems) { s.src.disconnect(); s.gain.disconnect(); }
      p.bus.disconnect();
    };
    if (first) first.src.onended = cleanup;
    else cleanup();
  }
}

function ramp(param: AudioParam, to: number, now: number, fade: number): void {
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.linearRampToValueAtTime(to, now + fade);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
