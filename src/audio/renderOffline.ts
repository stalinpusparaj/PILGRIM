/**
 * Offline renders, for listening and level checks (dev tool: the music test page's "Download WAV" buttons and
 * browser scripts use it; the game never does). A song (one or more loops, each loop in its own MusicState) or a
 * tour of every SFX is rendered into an OfflineAudioContext through the real mix chain (amb-mixer.ts Mixer:
 * buses, shared reverb, limiter, soft clipper) at the current volume settings, so the file sounds like the game.
 * Also: a 16-bit WAV encoder and peak / RMS statistics.
 */
import { SONGS } from '../../content/music/themes';
import { InstrumentBank } from './Instruments';
import { LOOKAHEAD, MusicPlayer, TICK_MS, type SequencerInstruments } from './Sequencer';
import { Mixer, type MixFlags } from './amb-mixer';
import { prepareSong } from './seq-song';
import { DEFAULT_LEVEL, SFX_RECIPES, variantSeed } from './sfx/index';
import { clearRenderCaches, finishBuffer } from './sfx/buffers';
import { renderRecipe } from './sfx/render';
import type { MusicState, SfxId, SongDef, SongId } from './types';

export const RENDER_RATE = 48000;
const QUANTUM = 128;
const FLAGS: MixFlags = { ducked: false, silenced: false, hidden: false };
/** Ring-out after the last note: pad release plus the shared reverb tail. */
const TAIL = 4;
/**
 * The render pauses every STEP seconds and schedules AHEAD seconds past the pause: the realtime scheduler's tick
 * and look-ahead, so the bank's voice limit (which protects notes scheduled ahead) behaves as in the game.
 */
const STEP = TICK_MS / 1000;
const AHEAD = LOOKAHEAD;
/** MusicPlayer starts a song this long after play(); notes of the loop after the last one start no earlier. */
export const SONG_START = 0.06;
/** A state change starts this long (at most 80 % of a bar) before its loop, so new layers join on its downbeat. */
const STATE_LEAD = 2;

/** Options for renderSong: the game's baked phone music (BakedMusic.ts) renders lighter and dry of volume. */
export interface RenderOptions {
  /** Sample rate of the render (default RENDER_RATE). */
  sampleRate?: number;
  /** Seconds between scheduling pauses (default the realtime tick); look-ahead is this plus LOOKAHEAD. */
  step?: number;
  /** Music at unity gain, ignoring the volume settings (the realtime music bus applies them later). */
  unity?: boolean;
}

/** `loops` loops of the song in `state`. */
export interface SongSegment {
  state: MusicState;
  loops: number;
}

export interface Levels {
  /** Sample peak over both channels, dBFS. */
  peakDb: number;
  /** RMS over both channels, dBFS. */
  rmsDb: number;
}

/**
 * Renders a song: each segment's loops in its state, crossfading into the next segment's state over the last bar
 * before it (tracks that join start on its downbeat), then the natural ring-out. Default: one loop in 'calm'.
 */
export async function renderSong(
  id: SongId,
  segments: readonly SongSegment[] = [{ state: 'calm', loops: 1 }],
  songs: Partial<Record<SongId, SongDef>> = SONGS,
  opts: RenderOptions = {},
): Promise<AudioBuffer> {
  const rate = opts.sampleRate ?? RENDER_RATE;
  const step = opts.step ?? STEP;
  const ahead = opts.step ? opts.step + AHEAD : AHEAD;
  const def = songs[id];
  const first = segments[0];
  if (!def || !first) throw new Error(`renderSong: no song "${id}" or no segments`);
  const song = prepareSong(id, def);
  const loopSec = song.loopBeats * song.spb;
  const lead = Math.min(STATE_LEAD, song.barBeats * song.spb * 0.8);
  const changes: Array<{ at: number; state: MusicState; done: boolean }> = [];
  let loops = 0;
  for (const seg of segments) {
    if (loops > 0) changes.push({ at: SONG_START + loops * loopSec - lead, state: seg.state, done: false });
    loops += Math.max(1, Math.round(seg.loops));
  }
  const musicEnd = loops * loopSec + SONG_START / 2;
  const ctx = new OfflineAudioContext({
    numberOfChannels: 2,
    length: Math.ceil((musicEnd + TAIL) * rate),
    sampleRate: rate,
  });
  const mix = new Mixer(ctx);
  mix.apply(FLAGS, 0);
  if (opts.unity) for (const g of [mix.master, mix.music, mix.musicSend]) g.gain.value = 1;
  const bank = new InstrumentBank(ctx, mix.musicSend);
  if (opts.unity) bank.maxVoices = 24; // a bake is not realtime: the phone's live voice cap does not apply
  // Notes of the loop after the last one are dropped, so the file ends with the song's own ring-out.
  const gate: SequencerInstruments = {
    play: (inst, n, out, wet) => {
      if (n.time < musicEnd) bank.play(inst, n, out, wet);
    },
    playDrum: (kind, time, vel, out, wet) => {
      if (time < musicEnd) bank.playDrum(kind, time, vel, out, wet);
    },
  };
  const player = new MusicPlayer(ctx, gate, mix.music, { [id]: def }, mix.musicSend);
  try {
    player.play(id, 0, first.state);
    player.scheduleUntil(ahead);
    // Pause the render on a grid (plus at every state change) and schedule ahead, like the realtime look-ahead,
    // so the bank's voice limit sees the real clock.
    const frames = new Set<number>();
    const pause = (t: number): void => {
      const frame = Math.floor((t * rate) / QUANTUM) * QUANTUM;
      if (frame <= 0 || frame >= ctx.length || frames.has(frame)) return;
      frames.add(frame);
      const at = frame / rate;
      void ctx.suspend(at).then(() => {
        for (const c of changes) {
          if (c.done || c.at > at + QUANTUM / rate) continue;
          c.done = true;
          player.setState(c.state, lead);
        }
        player.scheduleUntil(Math.min(at + ahead, musicEnd));
        return ctx.resume();
      });
    };
    for (const c of changes) pause(c.at);
    for (let t = step; t < musicEnd; t += step) pause(t);
    return await ctx.startRendering();
  } finally {
    player.dispose();
    bank.dispose();
    mix.dispose();
  }
}

/** Where each effect starts in a tour, seconds. */
export interface SfxMark {
  id: SfxId;
  at: number;
}

/**
 * Renders every SFX (variant 0, at its recipe level, the designed pitch) one after another with `gap` seconds of
 * silence between them, through the effects bus.
 */
export async function renderSfxTour(
  ids: readonly SfxId[] = Object.keys(SFX_RECIPES) as SfxId[],
  gap = 0.4,
): Promise<{ buffer: AudioBuffer; marks: SfxMark[] }> {
  const clips: Array<{ id: SfxId; buf: AudioBuffer }> = [];
  try {
    for (const id of ids) {
      const raw = await renderRecipe(SFX_RECIPES[id], variantSeed(id, 0));
      const buf = finishBuffer(raw, (length, sampleRate) => new AudioBuffer({ length, sampleRate }));
      if (buf) clips.push({ id, buf });
    }
  } finally {
    clearRenderCaches();
  }
  let t = gap;
  const marks: SfxMark[] = [];
  for (const c of clips) {
    marks.push({ id: c.id, at: t });
    t += c.buf.duration + gap;
  }
  const ctx = new OfflineAudioContext({
    numberOfChannels: 2,
    length: Math.ceil((t + 1) * RENDER_RATE),
    sampleRate: RENDER_RATE,
  });
  const mix = new Mixer(ctx);
  mix.apply(FLAGS, 0);
  clips.forEach((c, i) => {
    const src = new AudioBufferSourceNode(ctx, { buffer: c.buf });
    const g = new GainNode(ctx, { gain: Math.min(1, SFX_RECIPES[c.id].level ?? DEFAULT_LEVEL) });
    src.connect(g).connect(mix.effects);
    src.start(marks[i]?.at ?? 0);
  });
  try {
    return { buffer: await ctx.startRendering(), marks };
  } finally {
    mix.dispose();
  }
}

/** Peak and RMS of `buf` between `from` and `to` seconds (default: all of it). */
export function levels(buf: AudioBuffer, from = 0, to = buf.duration): Levels {
  const a = Math.max(0, Math.floor(from * buf.sampleRate));
  const b = Math.min(buf.length, Math.ceil(to * buf.sampleRate));
  let peak = 0;
  let sum = 0;
  let n = 0;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = a; i < b; i++) {
      const v = d[i] ?? 0;
      const abs = v < 0 ? -v : v;
      if (abs > peak) peak = abs;
      sum += v * v;
      n++;
    }
  }
  const db = (x: number): number => (x > 0 ? 20 * Math.log10(x) : -Infinity);
  return { peakDb: db(peak), rmsDb: db(Math.sqrt(sum / Math.max(1, n))) };
}

/** 16-bit PCM WAV (interleaved) of an AudioBuffer. */
export function encodeWav(buf: AudioBuffer): ArrayBuffer {
  const channels = buf.numberOfChannels;
  const frames = buf.length;
  const bytes = frames * channels * 2;
  const out = new ArrayBuffer(44 + bytes);
  const v = new DataView(out);
  const text = (at: number, s: string): void => {
    for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i));
  };
  text(0, 'RIFF');
  v.setUint32(4, 36 + bytes, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, channels, true);
  v.setUint32(24, buf.sampleRate, true);
  v.setUint32(28, buf.sampleRate * channels * 2, true);
  v.setUint16(32, channels * 2, true);
  v.setUint16(34, 16, true);
  text(36, 'data');
  v.setUint32(40, bytes, true);
  const data: Float32Array[] = [];
  for (let ch = 0; ch < channels; ch++) data.push(buf.getChannelData(ch));
  let at = 44;
  for (let i = 0; i < frames; i++) {
    for (let ch = 0; ch < channels; ch++) {
      const s = Math.max(-1, Math.min(1, data[ch]?.[i] ?? 0));
      v.setInt16(at, Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), true);
      at += 2;
    }
  }
  return out;
}

/** Saves `buf` as a WAV file through the browser's download (music test page). */
export function downloadWav(buf: AudioBuffer, name: string): void {
  const url = URL.createObjectURL(new Blob([encodeWav(buf)], { type: 'audio/wav' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
