/**
 * Morning Manna's three tips for a day (DECISIONS #403): a hint (for the land the player is in on even days, a
 * general one on odd days), a Promise verse (KJV in English, the game's own line elsewhere: GDD 2.16 rule 6) and a
 * "Did you know?" about Bunyan and the story. The same day always shows the same three, under the day's
 * encouragement line for kids (`cheerFor`, DECISIONS #404).
 */
import { dayNumber } from '../core/Daily';
import { PROMISES } from '../ui/satchel-data';

export const PLAY_TIPS = 10;
export const FACTS = 10;
/** Encouragement lines for kids: `cheer.1` .. `cheer.30` (one a day, a month before one repeats). */
export const CHEERS = 30;
/** Chapter hints: `tip.ch<n>.a` / `.b` for chapters 1-13 and the Epilogue (14). */
export const HINT_CHAPTERS = 14;

export type TipKind = 'hint' | 'play' | 'verse' | 'fact';
export interface Tip { kind: TipKind; key: string; ref?: string }

export function tipsFor(day: string, chapter: number): Tip[] {
  const n = dayNumber(day);
  const ch = Math.min(HINT_CHAPTERS, Math.max(1, Math.round(chapter) || 1));
  const first: Tip =
    n % 2 === 0
      ? { kind: 'hint', key: `tip.ch${ch}.${(n >> 1) % 2 === 0 ? 'a' : 'b'}` }
      : { kind: 'play', key: `tip.play.${((n >> 1) % PLAY_TIPS) + 1}` };
  const promise = PROMISES[n % PROMISES.length]!;
  return [
    first,
    { kind: 'verse', key: promise.text, ref: promise.refKey },
    { kind: 'fact', key: `tip.fact.${(n % FACTS) + 1}` },
  ];
}

/** The day's encouragement line (i18n key). */
export function cheerFor(day: string): string {
  return `cheer.${(dayNumber(day) % CHEERS) + 1}`;
}
