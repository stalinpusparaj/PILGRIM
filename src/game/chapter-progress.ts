/**
 * What the story has given Christian by the start of each chapter (GDD 2.7.1, 2.7.4, 2.7.6), so a chapter opened
 * on its own (chapter select from a fresh game, the debug URL, an old save) starts as the story left him:
 *
 *   Chapter VII on (after the Cross, Ch VI): the Burden is gone; the Roll and the Key of Promise are in hand.
 *   Chapter VIII on (after the Palace armoury, Ch VII): Sword, Shield, Helmet, Breastplate, Sturdy shoes, Prayer.
 *
 * Everything is given quietly (no toasts) and only when missing, so a real save's state is left as it is (a Roll
 * lost under the arbour bench stays lost). The Epilogue (14) is Christiana's and is left alone.
 * The ChapterManager calls it before the play session is built, so the session starts in the right outfit.
 */
import type { GameState, GiftId } from '../core/GameState';
import { t } from '../core/I18n';
import { EPILOGUE_CHAPTER } from '../core/Save';
import { PROMISES } from '../ui/satchel-data';
import { BADGES } from './badges';

const AFTER_CROSS = 7;
const AFTER_ARMOURY = 8;
const ARMOURY: readonly GiftId[] = ['sword', 'shield', 'helmet', 'breastplate', 'shoes', 'prayer'];

export function catchUp(state: GameState, chapter: number): void {
  if (chapter < AFTER_CROSS || chapter >= EPILOGUE_CHAPTER) return;
  if (state.burden) state.setBurden(false);
  if (!state.data.hasRoll && state.flag('rollLost') !== true) state.giveRoll();
  if (!state.hasGift('key_promise')) state.giveGift('key_promise', true);
  if (chapter < AFTER_ARMOURY) return;
  for (const id of ARMOURY) if (!state.hasGift(id)) state.giveGift(id, true);
}

/**
 * One line for the next chapter's loading screen about the land just finished (moving on from `state.chapter` to
 * `next`): its Promises found and its badges, and a nudge when something there is still hidden. Null when there is
 * nothing to tell (a first chapter, a replay of an earlier one, a land with neither).
 */
export function recapLine(state: GameState, next: number): string | null {
  const last = state.chapter;
  if (last < 1 || next <= last || last >= EPILOGUE_CHAPTER) return null;
  const parts: string[] = [];
  const promises = PROMISES.filter((p) => p.chapter === last);
  const found = promises.filter((p) => state.data.promises.includes(p.id)).length;
  if (promises.length > 0) parts.push(t('ui.loading.recap.promises', { found, total: promises.length }));
  const badges = BADGES.filter((b) => b.chapter === last);
  const earned = badges.filter((b) => state.data.achievements.includes(b.id)).length;
  if (badges.length > 0) parts.push(t('ui.loading.recap.badges', { n: earned, total: badges.length }));
  if (parts.length === 0) return null;
  const missed = found < promises.length || earned < badges.length;
  return `${t('ui.loading.recap.title')} ${parts.join('  ·  ')}${missed ? `  ${t('ui.loading.recap.missed')}` : ''}`;
}

/**
 * A land's finds for the CHAPTERS screen (e.g. "Promises 1/2 · Badges 0/1") from a save's Promises and badges, or
 * null when the land has neither. Read across every save slot, so a find in any game counts.
 */
export function landProgress(chapter: number, promises: readonly string[], achievements: readonly string[]): string | null {
  const here = PROMISES.filter((p) => p.chapter === chapter);
  const badges = BADGES.filter((b) => b.chapter === chapter);
  const parts: string[] = [];
  if (here.length > 0)
    parts.push(
      t('ui.chapters.promises', { found: here.filter((p) => promises.includes(p.id)).length, total: here.length }),
    );
  if (badges.length > 0)
    parts.push(
      t('ui.chapters.badges', { n: badges.filter((b) => achievements.includes(b.id)).length, total: badges.length }),
    );
  return parts.length > 0 ? parts.join('  ·  ') : null;
}
