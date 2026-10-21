/**
 * Chapters VIII and IX need what the Palace armoury gave in Chapter VII (GDD 2.7.6): the Sword and Shield for
 * Apollyon, Prayer for the smoking pit and the shadows. A chapter opened straight from the debug URL or a save
 * made before the armoury would have neither, and a fresh state is even still burdened. `ensureArmour` puts it
 * right quietly (no toasts): the Burden off, the six armoury gifts, Christian in his armour.
 */
import type { GiftId } from '../core/GameState';
import { ARMOUR_LIGHT_FLAG, RECIPES } from '../player/player-outfit';
import type { ChapterContext } from './types';

const ARMOURY: readonly GiftId[] = ['sword', 'shield', 'helmet', 'breastplate', 'shoes', 'prayer'];

export function ensureArmour(ctx: ChapterContext): void {
  const { state, session } = ctx;
  if (state.burden) state.setBurden(false);
  for (const id of ARMOURY) if (!state.hasGift(id)) state.giveGift(id, true);
  if (state.flag(ARMOUR_LIGHT_FLAG) !== true && session.player.character.recipe.id !== RECIPES.armour)
    session.player.setRecipe(RECIPES.armour);
}
