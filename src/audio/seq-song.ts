/**
 * Song preparation for the music sequencer: parses every track once into play-ready note lists (rests dropped,
 * drum letters split into kinds) and works out which tracks sound in each MusicState. Nothing here runs in the
 * scheduler tick.
 */
import { parseTrackDetailed, type DrumKind } from './seq-parse';
import { MUSIC_STATES, validateSong } from './seq-validate';
import type { MusicState, SongDef, SongId, TrackDef } from './types';

/** Play-ready note (rests removed). Exactly one of `midis` (non-empty) / `kinds` is used. */
export interface SeqNote {
  beat: number;
  beats: number;
  midis: number[];
  /** Drum hits, or null for a pitched note. */
  kinds: DrumKind[] | null;
  vel: number;
}

export interface PreparedTrack {
  readonly def: TrackDef;
  /** Sorted by beat; only notes that start inside the loop. */
  readonly notes: SeqNote[];
  /** Track gain when audible (TrackDef.gain, default 0.7). */
  readonly base: number;
  /** Audible per state, after the empty-state fallback (see prepareSong). */
  readonly audible: Readonly<Record<MusicState, boolean>>;
}

export interface PreparedSong {
  readonly id: SongId;
  readonly def: SongDef;
  readonly tracks: PreparedTrack[];
  /** Beats per bar (meter top). */
  readonly barBeats: number;
  /** Beats per loop (barBeats * loopBars). */
  readonly loopBeats: number;
  /** Seconds per beat (60 / bpm, beat = meter-bottom note). */
  readonly spb: number;
  readonly problems: readonly string[];
  /** Set once the problems were logged. */
  warned: boolean;
}

export const DEFAULT_TRACK_GAIN = 0.7;

function hearsIn(def: TrackDef, s: MusicState): boolean {
  return def.states === undefined || def.states.includes(s);
}

/**
 * Parses and checks one song. Bad values fall back to safe ones (the song still plays). A state in which no
 * track would sound plays the 'calm' arrangement instead (or every track when calm is empty too), so changing
 * the state never leaves a song silent by accident.
 */
export function prepareSong(key: SongId, def: SongDef): PreparedSong {
  const problems = validateSong(def);
  if (def.id !== key) problems.unshift(`${key}: SongDef.id is "${def.id}" but it is stored under "${key}"`);

  const bpm = Number.isFinite(def.bpm) && def.bpm > 0 ? Math.min(260, Math.max(30, def.bpm)) : 100;
  const barBeats = Number.isFinite(def.meter[0]) && def.meter[0] >= 1 ? Math.round(def.meter[0]) : 4;
  const loopBars = Number.isFinite(def.loopBars) && def.loopBars >= 1 ? Math.round(def.loopBars) : 1;
  const loopBeats = barBeats * loopBars;

  const effective: Record<MusicState, MusicState | null> = { calm: null, tension: null, sad: null, boss: null, joy: null };
  const anyIn = (s: MusicState): boolean => def.tracks.some((t) => hearsIn(t, s));
  for (const s of MUSIC_STATES) effective[s] = anyIn(s) ? s : anyIn('calm') ? 'calm' : null;

  const tracks: PreparedTrack[] = def.tracks.map((t) => {
    const parsed = parseTrackDetailed(t.notes, def.meter, t.instrument);
    const notes: SeqNote[] = [];
    for (const n of parsed.notes) {
      if (n.beat >= loopBeats - 1e-9) break;
      if (n.drum) {
        notes.push({ beat: n.beat, beats: n.beats, midis: [], kinds: [...n.drum] as DrumKind[], vel: n.vel });
      } else if (n.midis.length > 0) {
        notes.push({ beat: n.beat, beats: n.beats, midis: n.midis.slice(), kinds: null, vel: n.vel });
      }
    }
    const audible = { calm: false, tension: false, sad: false, boss: false, joy: false };
    for (const s of MUSIC_STATES) {
      const e = effective[s];
      audible[s] = e === null ? true : hearsIn(t, e);
    }
    const g = t.gain ?? DEFAULT_TRACK_GAIN;
    return { def: t, notes, base: Number.isFinite(g) ? Math.min(1, Math.max(0, g)) : DEFAULT_TRACK_GAIN, audible };
  });

  return { id: key, def, tracks, barBeats, loopBeats, spb: 60 / bpm, problems, warned: false };
}
