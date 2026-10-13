/**
 * Song checks for the music sequencer (GDD 2.13). validateSong returns readable problems (empty = fine); the
 * player logs them once per song in dev builds but still plays the song.
 */
import { BEAT_EPS, fmt, parseTrackDetailed } from './seq-parse';
import type { InstrumentId, MusicState, SongDef } from './types';

export const MUSIC_STATES: readonly MusicState[] = ['calm', 'tension', 'sad', 'boss', 'joy'];
const INSTRUMENTS: readonly InstrumentId[] = [
  'pluck', 'pad', 'bell', 'flute', 'bass', 'marimba', 'drums', 'choir', 'musicbox', 'strings',
];
const LAYERS: readonly string[] = ['bed', 'melody', 'counter', 'bass', 'perc', 'sparkle'];
const DENOMINATORS: readonly number[] = [1, 2, 4, 8, 16];

function isInt(n: number): boolean {
  return Number.isFinite(n) && Math.floor(n) === n;
}

/** Song-level checks (tempo, meter, loop, tracks). */
function checkSongShape(s: SongDef, out: string[]): void {
  const p = `${s.id}:`;
  if (!s.title || s.title.trim() === '') out.push(`${p} title is empty`);
  if (!Number.isFinite(s.bpm) || s.bpm < 30 || s.bpm > 260) out.push(`${p} bpm ${s.bpm} should be 30..260`);
  const [num, den] = s.meter;
  if (!isInt(num) || num < 1 || num > 16) out.push(`${p} meter top ${num} should be a whole number 1..16`);
  if (!DENOMINATORS.includes(den)) out.push(`${p} meter bottom ${den} should be 1, 2, 4, 8 or 16`);
  if (!isInt(s.loopBars) || s.loopBars < 1) out.push(`${p} loopBars ${s.loopBars} should be a whole number >= 1`);
  if (s.tracks.length === 0) out.push(`${p} has no tracks`);
}

/** Returns readable problems with a song: bar sums != meter, loop length mismatch, bad tokens, bad fields. */
export function validateSong(s: SongDef): string[] {
  const out: string[] = [];
  checkSongShape(s, out);
  const barBeats = s.meter[0] > 0 ? s.meter[0] : 4;
  const loopBeats = barBeats * s.loopBars;
  const meterText = `${s.meter[0]}/${s.meter[1]}`;
  const names = new Set<string>();

  for (const t of s.tracks) {
    const p = `${s.id}/${t.name || '(unnamed)'}:`;
    if (!t.name) out.push(`${s.id}: a track has no name`);
    else if (names.has(t.name)) out.push(`${p} track name is used twice`);
    names.add(t.name);
    if (!INSTRUMENTS.includes(t.instrument)) out.push(`${p} unknown instrument "${t.instrument}"`);
    if (!LAYERS.includes(t.layer)) out.push(`${p} unknown layer "${t.layer}"`);
    if (t.gain !== undefined && (!Number.isFinite(t.gain) || t.gain < 0 || t.gain > 1)) {
      out.push(`${p} gain ${t.gain} should be 0..1`);
    }
    if (t.states) {
      if (t.states.length === 0) out.push(`${p} states is empty, so the track never plays (leave it out for all states)`);
      for (const st of t.states) {
        if (!MUSIC_STATES.includes(st)) out.push(`${p} unknown state "${st}"`);
      }
    }

    const parsed = parseTrackDetailed(t.notes, s.meter, t.instrument);
    for (const pr of parsed.problems) out.push(`${p} ${pr}`);
    if (parsed.notes.length === 0) {
      out.push(`${p} has no notes`);
      continue;
    }
    if (!parsed.hasPitched && !parsed.hasDrums) out.push(`${p} has only rests`);

    // Bar lines: every segment between `|` must hold whole bars (one bar = meter top beats).
    let beatAt = 0;
    for (const seg of parsed.segments) {
      const bar = Math.floor(beatAt / barBeats + 1e-6) + 1;
      const bars = seg / barBeats;
      const whole = Math.round(bars);
      if (whole < 1 || Math.abs(seg - whole * barBeats) > BEAT_EPS) {
        out.push(
          whole <= 1
            ? `${p} bar ${bar} has ${fmt(seg)} beats, expected ${barBeats} (${meterText})`
            : `${p} bars from ${bar} hold ${fmt(seg)} beats, not a whole number of ${barBeats}-beat bars`,
        );
      }
      beatAt += seg;
    }

    // Loop length: the track must fill exactly loopBars bars.
    if (Math.abs(parsed.totalBeats - loopBeats) > BEAT_EPS) {
      const diff = parsed.totalBeats - loopBeats;
      out.push(
        `${p} notes add up to ${fmt(parsed.totalBeats)} beats (${fmt(parsed.totalBeats / barBeats)} bars), ` +
          `${fmt(Math.abs(diff))} ${diff > 0 ? 'more' : 'fewer'} than the loop of ${s.loopBars} bars ` +
          `(${fmt(loopBeats)} beats of ${meterText})`,
      );
    }
  }
  return out;
}
