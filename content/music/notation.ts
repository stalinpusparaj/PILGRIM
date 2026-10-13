/**
 * Tiny helpers for writing song note strings (content/music/*.ts). They only build strings in the TrackDef grammar
 * of src/audio/types.ts: space-separated `PITCH:BEATS[:VEL]` tokens, `.` for a rest, `+` to join chord notes and
 * ` | ` between bars. Everything here runs once at module load, never per frame.
 */

/** Joins bars with ` | ` bar lines (the sequencer ignores them; the dev validator checks every bar's length). */
export function bars(...list: string[]): string {
  return list.join(' | ');
}

/** Repeats a bar (or a `|`-joined phrase) `times` times. */
export function rep(phrase: string, times: number): string {
  return Array.from({ length: times }, () => phrase).join(' | ');
}

/** One note token; the velocity is written only when given. */
export function tok(pitch: string, beats: number, vel?: number): string {
  return vel === undefined ? `${pitch}:${beats}` : `${pitch}:${beats}:${vel}`;
}

/**
 * A broken chord: `pattern` indexes the space-separated pitches of `chord`, every note lasts `step` beats.
 * `accent` (optional) is the velocity of the first note, so the bar's downbeat leans a little.
 */
export function arp(chord: string, pattern: readonly number[], step: number, vel: number, accent?: number): string {
  const notes = chord.split(' ');
  return pattern
    .map((idx, i) => tok(notes[idx % notes.length] ?? '.', step, i === 0 && accent !== undefined ? accent : vel))
    .join(' ');
}

/** The same chord (or note) repeated `count` times, `step` beats each, velocity sliding from `v0` to `v1`. */
export function pulse(chord: string, count: number, step: number, v0: number, v1: number): string {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const v = count > 1 ? v0 + ((v1 - v0) * i) / (count - 1) : v0;
    out.push(tok(chord, step, Math.round(v * 100) / 100));
  }
  return out.join(' ');
}

/** Moves every pitch in a phrase by whole octaves (rests, drum letters, beats and velocities are untouched). */
export function octave(phrase: string, shift: number): string {
  return phrase.replace(/([A-G](?:#|b)?)(\d)/g, (_m, name: string, oct: string) => `${name}${Number(oct) + shift}`);
}

/**
 * Compound time at a fast pulse. The phrase is written counting eighth notes (6 to a 6/8 bar) and comes out in
 * 2/4 with triplet eighths, one beat per dotted quarter: every BEATS value n becomes n/3 (`1` -> `1/3`,
 * `2` -> `2/3`, `3` -> `1`, `6` -> `2`). The sequencer reads `a/b` fractions (seq-parse.ts).
 */
export function triplets(phrase: string): string {
  return phrase
    .split(' ')
    .map((t) => {
      if (t === '|') return t;
      const parts = t.split(':');
      const n = Number(parts[1]);
      parts[1] = n % 3 === 0 ? String(n / 3) : `${n}/3`;
      return parts.join(':');
    })
    .join(' ');
}
