/**
 * Phone music (DECISIONS #391). The live sequencer builds a few oscillators, filters and envelopes per note; on a
 * budget phone the Web Audio thread cannot render that in time and the music stutters (measured on an OPPO A5x:
 * ~18 600 frames of output underrun per 10 s with music alone, none without). Here each (song, state) is baked
 * once into a seamless loop by the same sequencer, instruments and reverb (music-bake.ts, stored on the device)
 * and played as one looping AudioBufferSourceNode: as cheap as a sound file, and still made by our own code.
 * Until a tune's loop exists the live sequencer plays it, then hands over at the same point in the tune.
 */
import type { MusicPosition } from './Sequencer';
import { bakedLoop } from './music-bake';
import { prepareSong } from './seq-song';
import type { MusicState, SongDef, SongId } from './types';

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

/** Baked loops kept in memory (~2-4 MB each at 24 kHz). */
const CACHE_MAX = 4;
const DEFAULT_SONG_FADE = 1.5;
const DEFAULT_STATE_FADE = 2;
/** Live-to-baked handover crossfade, seconds. */
const HANDOVER = 1.2;

interface Voice { src: AudioBufferSourceNode; gain: GainNode }

export class BakedMusic implements MusicBackend {
  private readonly cache = new Map<string, AudioBuffer>();
  private cur: SongId | null = null;
  private stateValue: MusicState = 'calm';
  private voice: Voice | null = null;
  /** Context time the playing loop's sample 0 lines up with (for same-position crossfades). */
  private origin = 0;
  private loopSec = 0;
  private gen = 0;
  private disposed = false;
  private readonly pos: MusicPosition = { bar: 0, beat: 0, loop: 0 };

  /**
   * `live` plays a tune the first time, while its loop is being baked (a light voice cap keeps it bearable);
   * from then on the baked loop takes over at the same point in the tune.
   */
  constructor(
    private readonly ctx: AudioContext,
    private readonly out: AudioNode,
    private readonly songs: Partial<Record<SongId, SongDef>>,
    private readonly live: MusicBackend | null = null,
  ) {}

  get current(): SongId | null { return this.cur; }
  get state(): MusicState { return this.stateValue; }
  get position(): MusicPosition {
    if (!this.voice && this.live?.current) return this.live.position;
    const def = this.cur ? this.songs[this.cur] : undefined;
    if (!def || !this.voice || this.loopSec <= 0) { this.pos.bar = this.pos.beat = this.pos.loop = 0; return this.pos; }
    const song = prepareSong(this.cur!, def);
    const t = Math.max(0, this.ctx.currentTime - this.origin);
    this.pos.loop = Math.floor(t / this.loopSec);
    const beats = (t - this.pos.loop * this.loopSec) / song.spb;
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
    const from = this.cur;
    this.cur = id;
    this.stateValue = state ?? 'calm';
    this.swap(fade ?? (from ? DEFAULT_SONG_FADE : 0), false);
  }

  setState(s: MusicState, fade?: number): void {
    if (this.disposed || s === this.stateValue) return;
    this.stateValue = s;
    if (this.cur) this.swap(fade ?? DEFAULT_STATE_FADE, true);
  }

  stop(fade?: number): void {
    this.gen++;
    this.cur = null;
    this.fadeOut(fade ?? 1);
    this.live?.stop(fade ?? 1);
  }

  silence(fade?: number): void {
    this.gen++;
    this.cur = null;
    this.fadeOut(fade ?? 0.4);
    this.live?.silence(fade);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.gen++;
    this.fadeOut(0);
    this.live?.dispose();
    this.cache.clear();
  }

  /** Plays the current song in the current state: its baked loop when ready, else live while it bakes. */
  private swap(fade: number, samePosition: boolean): void {
    const id = this.cur;
    const def = id ? this.songs[id] : undefined;
    if (!id || !def) return;
    const gen = ++this.gen;
    const state = this.stateValue;
    const key = `${id}:${state}`;
    const ready = this.cache.get(key);
    if (ready) {
      this.live?.stop(fade);
      this.start(ready, fade, samePosition, null);
      return;
    }
    // Not baked yet: the live sequencer plays (from where the loop was), and hands over once the bake is in.
    const wasBaked = this.voice !== null;
    this.fadeOut(fade);
    if (this.live) {
      if (wasBaked || this.live.current !== id) this.live.play(id, fade, state);
      else this.live.setState(state, fade);
    }
    void bakedLoop(id, state, def, () => gen === this.gen && !this.disposed).then((buf) => {
      if (!buf || this.disposed) return;
      this.cache.set(key, buf);
      while (this.cache.size > CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
      if (gen !== this.gen) return;
      const at = this.live?.current === id ? this.liveSeconds(id) : null;
      this.live?.stop(HANDOVER);
      this.start(buf, HANDOVER, false, at);
    });
  }

  /** Where the live sequencer is in the loop, seconds. */
  private liveSeconds(id: SongId): number | null {
    const def = this.songs[id];
    if (!def || !this.live) return null;
    const song = prepareSong(id, def);
    const p = this.live.position;
    return (p.bar * song.barBeats + p.beat) * song.spb;
  }

  /** Starts a baked loop, crossfading from whatever baked loop plays (same position, or `at` seconds in). */
  private start(buf: AudioBuffer, fade: number, samePosition: boolean, at: number | null): void {
    const now = this.ctx.currentTime;
    const loop = buf.duration;
    let offset = 0;
    if (at !== null) offset = ((at % loop) + loop) % loop;
    else if (samePosition && this.voice && Math.abs(loop - this.loopSec) < 0.01) {
      offset = (((now - this.origin) % loop) + loop) % loop;
    }
    this.fadeOut(fade);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + Math.max(0.02, fade));
    src.connect(gain).connect(this.out);
    src.start(now, offset);
    this.voice = { src, gain };
    this.origin = now - offset;
    this.loopSec = loop;
  }

  private fadeOut(fade: number): void {
    const v = this.voice;
    if (!v) return;
    this.voice = null;
    const now = this.ctx.currentTime;
    const f = Math.max(0.02, fade);
    v.gain.gain.cancelScheduledValues(now);
    v.gain.gain.setValueAtTime(v.gain.gain.value, now);
    v.gain.gain.linearRampToValueAtTime(0, now + f);
    v.src.stop(now + f + 0.05);
    v.src.onended = () => { v.src.disconnect(); v.gain.disconnect(); };
  }
}
