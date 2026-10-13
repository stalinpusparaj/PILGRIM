/**
 * The `pitch` play option: a playback-rate multiplier (1 = as designed, 2 = an octave up, 0.5 = an octave down;
 * clamped to 0.25..4), like VoiceParams.pitch. Recipes with a `steps` scale (joy_note, rope_snap) snap it to the
 * nearest note of that scale in any octave, so musical effects always stay in tune whatever the caller passes.
 */
import type { SfxId } from '../types';
import { SFX_RECIPES } from './recipes-all';
import type { SfxRecipe } from './types';

const MIN_RATE = 0.25;
const MAX_RATE = 4;

/** Semitones to play a recipe at for a `pitch` multiplier (0 for a missing or invalid value). */
export function pitchToSemitones(recipe: SfxRecipe, pitch: number | undefined): number {
  if (pitch === undefined || !Number.isFinite(pitch) || pitch <= 0) return 0;
  const semis = 12 * Math.log2(Math.min(MAX_RATE, Math.max(MIN_RATE, pitch)));
  const steps = recipe.steps;
  if (!steps || steps.length === 0) return semis;
  const oct = Math.floor(semis / 12);
  let best = 0;
  let bestDist = Infinity;
  for (let o = oct - 1; o <= oct + 1; o++) {
    for (const s of steps) {
      const v = s + 12 * o;
      const dist = Math.abs(v - semis);
      if (dist < bestDist - 1e-9) {
        bestDist = dist;
        best = v;
      }
    }
  }
  return best;
}

/**
 * The `pitch` multiplier for the n-th note of a recipe's scale, continuing by octaves (semitones when the recipe
 * has no scale). joy_note: stepPitch('joy_note', 0), (…, 1), (…, 2) = the rising chimes of the three joy jumps;
 * rope_snap: 0, 1, 2 = the three ropes.
 */
export function stepPitch(id: SfxId, n: number, recipes: Record<SfxId, SfxRecipe> = SFX_RECIPES): number {
  const steps = recipes[id].steps;
  const i = Number.isFinite(n) ? Math.round(n) : 0;
  if (!steps || steps.length === 0) return Math.pow(2, i / 12);
  const len = steps.length;
  const o = Math.floor(i / len);
  return Math.pow(2, ((steps[i - o * len] ?? 0) + 12 * o) / 12);
}
