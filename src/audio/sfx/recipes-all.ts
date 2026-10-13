/** The full SFX recipe table: one recipe for every SfxId (the compiler checks nothing is missing). */
import type { SfxId } from '../types';
import { COMBAT_RECIPES } from './recipes-combat';
import { NATURE_RECIPES } from './recipes-nature';
import { PLACE_RECIPES } from './recipes-places';
import { STEP_RECIPES } from './recipes-steps';
import { STORY_RECIPES } from './recipes-story';
import { UI_RECIPES } from './recipes-ui';
import { WORLD_RECIPES } from './recipes-world';
import type { SfxRecipe } from './types';

export const SFX_RECIPES: Record<SfxId, SfxRecipe> = {
  ...UI_RECIPES,
  ...STEP_RECIPES,
  ...STORY_RECIPES,
  ...WORLD_RECIPES,
  ...PLACE_RECIPES,
  ...COMBAT_RECIPES,
  ...NATURE_RECIPES,
};
