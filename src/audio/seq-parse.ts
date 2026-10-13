/**
 * Note-string parser for the music sequencer (GDD 2.13, TrackDef.notes in src/audio/types.ts).
 *
 * Grammar (whitespace separated tokens):
 *   PITCH:BEATS[:VEL]   PITCH = scientific pitch (C4, F#3, Bb5), `.` for a rest, or a drum letter
 *                       K (kick) S (snare) H (hat) O (open hat) T (tom) R (rim).
 *                       BEATS = decimal (0.5, 1.5) or fraction (1/3); omitted = 1 beat.
 *                       VEL = 0..1, default 0.8.
 *   A+B+C:BEATS         chord (pitches) or drum hits together (K+H:0.5).
 *   |                   bar line: ignored for timing, checked by validateSong (may also touch tokens: `C4:4|D4:4`).
 *
 * Parsing never throws. Every problem is reported: a bad pitch becomes a rest of its length, a token whose BEATS
 * cannot be read is skipped, an out-of-range VEL is clamped.
 * Runs once per song (pre-parse), never in the scheduler tick.
 */
import type { InstrumentId } from './types';

export type DrumKind = 'K' | 'S' | 'H' | 'O' | 'T' | 'R';

export interface ParsedNote {
  /** Start, in beats from the start of the loop. One beat = one meter-denominator note. */
  beat: number;
  /** Length in beats. */
  beats: number;
  /** MIDI notes. Empty = rest, unless `drum` is set. */
  midis: number[];
  /** Drum hits for a drum token: one or more letters of K S H O T R ('K', or 'KH' for `K+H`). */
  drum?: string;
  /** Velocity 0..1 (0 for rests). */
  vel: number;
}

/** Detailed parse result used by validateSong and the player. Problems carry no song/track prefix. */
export interface TrackParse {
  notes: ParsedNote[];
  problems: string[];
  /** Total length of all tokens, in beats. */
  totalBeats: number;
  /** Beat lengths of the segments between `|` bar lines (empty segments dropped). Empty when no `|` is used. */
  segments: number[];
  /** True when any pitched note was found. */
  hasPitched: boolean;
  /** True when any drum hit was found. */
  hasDrums: boolean;
}

export const DEFAULT_VEL = 0.8;
/** Tolerance for beat sums (fractions such as 0.333 written as decimals). */
export const BEAT_EPS = 0.01;

const LETTER_PC: Readonly<Record<string, number>> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const DRUMS = 'KSHORT';
const PITCH_RE = /^([A-Ga-g])(#{1,2}|b{1,2})?(-?\d)$/;

/** Scientific pitch to MIDI (C4 = 60, A4 = 69). NaN when the text is not a pitch. */
export function pitchToMidi(p: string): number {
  const m = PITCH_RE.exec(p);
  if (!m) return NaN;
  const letter = m[1]!.toLowerCase();
  const acc = m[2] ?? '';
  const shift = acc.length === 0 ? 0 : acc[0] === '#' ? acc.length : -acc.length;
  const octave = Number(m[3]);
  return (octave + 1) * 12 + (LETTER_PC[letter] ?? 0) + shift;
}

/** Readable number: at most 3 decimals, no trailing zeros. */
export function fmt(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

/** Parses BEATS: `2`, `0.5`, `1/3`. NaN when invalid. */
function parseBeats(s: string): number {
  const slash = s.indexOf('/');
  if (slash >= 0) {
    const a = Number(s.slice(0, slash));
    const b = Number(s.slice(slash + 1));
    if (s.slice(0, slash) === '' || s.slice(slash + 1) === '' || !(b > 0)) return NaN;
    return a / b;
  }
  if (s.trim() === '') return NaN;
  return Number(s);
}

function isDrumLetter(s: string): boolean {
  return s.length === 1 && DRUMS.includes(s.toUpperCase());
}

/** Splits a note string into tokens, keeping `|` as its own token even when written without spaces. */
export function tokenize(notes: string): string[] {
  return notes.replace(/\|/g, ' | ').split(/\s+/).filter((t) => t.length > 0);
}

/**
 * Parses a note string with full diagnostics. `meter` is used to name bars in problem messages; `instrument`
 * flags drum hits on melodic instruments and pitches on the drum kit (both still parse and play).
 */
export function parseTrackDetailed(notes: string, meter: [number, number], instrument: InstrumentId): TrackParse {
  const barBeats = meter[0] > 0 ? meter[0] : 4;
  const out: TrackParse = { notes: [], problems: [], totalBeats: 0, segments: [], hasPitched: false, hasDrums: false };
  const tokens = tokenize(notes);
  let pos = 0;
  let segStart = 0;
  let usedBars = false;
  const barName = (beat: number): string => `bar ${Math.floor(beat / barBeats + 1e-6) + 1}`;

  for (const tok of tokens) {
    if (tok === '|') {
      usedBars = true;
      if (pos - segStart > BEAT_EPS) out.segments.push(pos - segStart);
      segStart = pos;
      continue;
    }
    const parts = tok.split(':');
    const where = `${barName(pos)}, "${tok}"`;
    if (parts.length > 3 || parts[0] === '') {
      out.problems.push(`${where}: not PITCH:BEATS[:VEL]`);
      continue;
    }
    // BEATS
    let beats = 1;
    if (parts.length >= 2) {
      beats = parseBeats(parts[1]!);
      if (!Number.isFinite(beats) || beats <= 0) {
        out.problems.push(`${where}: BEATS must be a number above 0`);
        continue;
      }
    }
    // VEL
    let vel = DEFAULT_VEL;
    if (parts.length === 3) {
      vel = Number(parts[2]);
      if (parts[2] === '' || !Number.isFinite(vel)) {
        out.problems.push(`${where}: VEL must be a number 0..1`);
        vel = DEFAULT_VEL;
      } else if (vel < 0 || vel > 1) {
        out.problems.push(`${where}: VEL ${fmt(vel)} is outside 0..1`);
        vel = Math.min(1, Math.max(0, vel));
      }
    }
    // PITCH / chord / rest / drums
    const head = parts[0]!;
    const note: ParsedNote = { beat: pos, beats, midis: [], vel };
    if (head === '.') {
      note.vel = 0;
    } else {
      const members = head.split('+');
      let drum = '';
      let bad = false;
      for (const m of members) {
        if (isDrumLetter(m)) {
          drum += m.toUpperCase();
        } else {
          const midi = pitchToMidi(m);
          if (Number.isNaN(midi)) {
            out.problems.push(`${where}: "${m}" is not a pitch (C4, F#3, Bb5), a rest (.) or a drum (K S H O T R)`);
            bad = true;
          } else if (midi < 21 || midi > 108) {
            out.problems.push(`${where}: ${m} (MIDI ${midi}) is outside the playable range A0..C8`);
            bad = true;
          } else {
            note.midis.push(midi);
          }
        }
      }
      if (drum && note.midis.length > 0) {
        out.problems.push(`${where}: a chord cannot mix drums and pitches`);
        bad = true;
      }
      if (bad) {
        note.midis = [];
        note.vel = 0;
      } else if (drum) {
        note.drum = drum;
        out.hasDrums = true;
        if (instrument !== 'drums') out.problems.push(`${where}: drum hit on instrument "${instrument}"`);
      } else if (note.midis.length > 0) {
        out.hasPitched = true;
        if (instrument === 'drums') out.problems.push(`${where}: pitched note on the drum kit`);
      }
    }
    out.notes.push(note);
    pos += beats;
  }
  if (usedBars && pos - segStart > BEAT_EPS) out.segments.push(pos - segStart);
  out.totalBeats = pos;
  return out;
}

/** Pinned API: parses a note string into notes (rests included, `midis` empty). Never throws. */
export function parseTrack(notes: string, meter: [number, number], instrument: InstrumentId): ParsedNote[] {
  return parseTrackDetailed(notes, meter, instrument).notes;
}
