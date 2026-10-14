/**
 * Shared types and small DOM helpers for the MY SATCHEL tab pages (satchel-roll/promises/friends/map/carried).
 * Pages are plain functions: they read the live GameState through a SatchelView and return a DOM subtree; the
 * SatchelUI owns the panel, re-renders a page when the state changes and keeps focus by `data-key`.
 */
import type { GameState } from '../core/GameState';
import { i18n, t } from '../core/I18n';
import type { LevelData } from '../world/LevelTypes';
import { h, type Child } from './dom';

export type SatchelTab = 'roll' | 'promises' | 'friends' | 'map' | 'carried';
export const SATCHEL_TABS: readonly SatchelTab[] = ['roll', 'promises', 'friends', 'map', 'carried'];

export function isSatchelTab(v: unknown): v is SatchelTab {
  return typeof v === 'string' && (SATCHEL_TABS as readonly string[]).includes(v);
}

/** Where the player stands, in world metres; `heading` is the facing direction on the ground (x, z). */
export interface SatchelPlayer {
  x: number;
  z: number;
  heading?: { x: number; z: number } | null;
}

/** What the MAP tab draws: the current level (GDD 2.15 level file) and the player marker. */
export interface SatchelMapContext {
  level: LevelData | null;
  player?: SatchelPlayer | null;
}

/** Everything a page needs. Callbacks run the page's actions through the SatchelUI. */
export interface SatchelView {
  readonly state: GameState;
  readonly map: SatchelMapContext | null;
  /** True when a carried item can be used right now (the chapter decides, e.g. the Key at a locked door). */
  canUse(itemId: string): boolean;
  /** "Read" on a Promise card: returns the Hope gained (0 when already read this chapter). */
  readPromise(id: string): number;
  /** "Use" on a carried item. */
  useItem(itemId: string): void;
  /** Portrait data URL for a recipe (null when none can be made). */
  portrait(recipe: string, expr: string): Promise<string | null>;
  /** False once the page has been replaced or the Satchel closed (late async results are dropped). */
  readonly alive: () => boolean;
  /** setTimeout owned by the Satchel: cleared when it closes. */
  later(fn: () => void, ms: number): void;
}

export interface PageResult {
  el: HTMLElement;
}

/** i18n key part for a chapter number: 1..13, 14 = epilogue. */
export function chapterKey(chapter: number): string {
  return chapter >= 14 ? 'epilogue' : String(chapter);
}

/** "CHAPTER III" (or the chapter number in the current language); '' for an unknown chapter. */
export function chapterNumber(chapter: number): string {
  const key = `ui.chapter.${chapterKey(chapter)}.number`;
  return i18n.has(key) ? t(key) : '';
}

export function chapterTitle(chapter: number): string {
  const key = `ui.chapter.${chapterKey(chapter)}.title`;
  return i18n.has(key) ? t(key) : '';
}

/** A soft "nothing here yet" line, focusable so keyboard and pad users land somewhere on an empty page. */
export function emptyNote(text: string, key: string): HTMLElement {
  return h('p', { className: 'pg-satchel__empty', tabIndex: 0, dataset: { key } }, text);
}

/** A small decorative inline-SVG holder (our own markup only). */
export function svgSpan(className: string, markup: string): HTMLSpanElement {
  const el = h('span', { className, 'aria-hidden': 'true' });
  el.innerHTML = markup;
  return el;
}

/** Section heading inside a page. */
export function sectionTitle(text: string, ...extra: Child[]): HTMLHeadingElement {
  return h('h3', { className: 'pg-satchel__section' }, text, ...extra);
}

/** True when the game or the OS asks for less motion. */
export function reducedMotion(): boolean {
  if (document.body.classList.contains('reduce-motion')) return true;
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** First grapheme of a (translated) name, for the portrait fallback badge (Tamil letters are clusters). */
export function initialOf(name: string): string {
  const text = name.replace(/^(Mr\.|Lord|The|திரு\.)\s+/u, '').trim();
  if (!text) return '?';
  const Segmenter = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (typeof Segmenter === 'function') {
    const first = new Segmenter(undefined, { granularity: 'grapheme' })
      .segment(text)
      [Symbol.iterator]()
      .next();
    if (!first.done) return first.value.segment.toUpperCase();
  }
  return Array.from(text)[0]!.toUpperCase();
}
