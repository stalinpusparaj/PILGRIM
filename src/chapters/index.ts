/**
 * Chapter script registry (ARCHITECTURE "Chapters"): one lazy chunk per script. Keys: 'test', '1'..'13',
 * 'epilogue'. Only 'test' exists so far; Phase 4 adds '1'..'4'. A chapter without a script is played with the
 * test script on the test level (ChapterManager fallback, DECISIONS).
 */
import type { ChapterScript } from './types';

export type ChapterModule = { default: ChapterScript };

export const CHAPTERS: Readonly<Record<string, () => Promise<ChapterModule>>> = {
  test: () => import('./test'),
  '1': () => import('./ch01'),
  '4': () => import('./ch04'),
  '2': () => import('./ch02'),
  '3': () => import('./ch03'),
};

/** The flow's chapter number as a registry key: 14 → 'epilogue', else the number as text. */
export function chapterKey(chapter: number): string {
  return chapter >= 14 ? 'epilogue' : String(chapter);
}

/** Key of the chapter after `chapter` (13 → 'epilogue'), or null after the Epilogue. */
export function nextChapterKey(chapter: number): string | null {
  return chapter >= 14 ? null : chapterKey(chapter + 1);
}

export function hasChapter(key: string): boolean {
  return Object.hasOwn(CHAPTERS, key);
}
