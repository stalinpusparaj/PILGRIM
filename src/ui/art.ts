/**
 * Shipped art (public/art/): the generated promo and UI images the owner chose to put in the game
 * (DECISIONS, Phase 4: the GDD 2.3 asset rule is waived for that one folder). Everything is referenced by
 * URL from here so a missing or renamed file is a one-line fix, and `art.css` paints them.
 */
import './art.css';

export const ART = {
  /** Title screen backdrop (16:9) and its portrait companion (9:16). */
  title: '/art/title.jpg',
  titlePortrait: '/art/title-portrait.jpg',
  /** Hero key art behind menus (pause, chapters, credits, demo end). */
  keyArt: '/art/key-art.jpg',
  /** App icon (512 px PNG): favicon, title emblem, loading emblem. */
  icon: '/art/icon.png',
} as const;

/** Chapter card art (16:9) for the chapters that have one, else null. */
export function chapterArt(chapter: number | string): string | null {
  const n = typeof chapter === 'string' ? Number(chapter) : chapter;
  return Number.isInteger(n) && n >= 1 && n <= 4 ? `/art/ch${n}.jpg` : null;
}

/** CSS `url(...)` for a style property (`--art`), or '' to clear it. */
export function cssUrl(url: string | null): string {
  return url ? `url(${url})` : '';
}
