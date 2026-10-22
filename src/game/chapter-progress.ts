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
import { EPILOGUE_CHAPTER } from '../core/Save';

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
