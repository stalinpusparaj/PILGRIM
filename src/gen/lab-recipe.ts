/**
 * Character Lab helpers (dev tool, `?lab=1`): recipe editing, the lists the Lab shows and clipboard copy.
 * Pure data helpers; no three.js scene work here.
 */
import type { CharacterRecipe, Expression } from './CharacterFactory';
import { BUILD_LIMITS } from './char-types';

export type { Expression };

/** Every expression the face rig supports (GDD 2.11), in display order. */
export const EXPRESSIONS: readonly Expression[] = [
  'neutral',
  'happy',
  'sad',
  'scared',
  'surprised',
  'angry',
  'sleepy',
  'determined',
];

/** Build multipliers exposed as sliders, over the full range the loader and body builder accept (BUILD_LIMITS). */
export const BUILD_KEYS = ['height', 'girth', 'head', 'legs', 'arms', 'belly'] as const;
export type BuildKey = (typeof BUILD_KEYS)[number];
export const BUILD_RANGE = { min: BUILD_LIMITS.min, max: BUILD_LIMITS.max, step: 0.01 } as const;

/** Burden sack scale range (Character.setBurdenSize: 0 = none, 1 = normal, up to 1.6). */
export const BURDEN_RANGE = { min: 0, max: 1.6, step: 0.05 } as const;

/** The pseudo colour key for the skin tone (lives on `recipe.skin`, not in `recipe.colors`). */
export const SKIN_KEY = 'skin';

export function cloneRecipe(r: CharacterRecipe): CharacterRecipe {
  return structuredClone(r);
}

/** Display label for recipe lists: "Christian (christian_burdened)". */
export function recipeLabel(r: CharacterRecipe): string {
  return r.name ? `${r.name} · ${r.id}` : r.id;
}

/** Colour keys a recipe defines, skin first, then `colors` in declaration order. */
export function colourKeys(r: CharacterRecipe): string[] {
  const keys = [SKIN_KEY];
  for (const [k, v] of Object.entries(r.colors)) if (typeof v === 'string') keys.push(k);
  return keys;
}

export function getColour(r: CharacterRecipe, key: string): string {
  if (key === SKIN_KEY) return r.skin;
  return r.colors[key] ?? '#ffffff';
}

/** Writes a colour back in the recipe's own upper-case hex style. */
export function setColour(r: CharacterRecipe, key: string, hex: string): void {
  const value = hex.toUpperCase();
  if (key === SKIN_KEY) r.skin = value;
  else r.colors[key] = value;
}

/** `<input type=color>` only accepts lower-case #rrggbb; expand #rgb and fall back to white. */
export function toColourInput(hex: string): string {
  const s = hex.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  return '#ffffff';
}

export function getBuild(r: CharacterRecipe, key: BuildKey): number {
  return r.build?.[key] ?? 1;
}

export function setBuild(r: CharacterRecipe, key: BuildKey, value: number): void {
  const v = Math.min(BUILD_RANGE.max, Math.max(BUILD_RANGE.min, value));
  const rounded = Math.round(v * 100) / 100;
  r.build = { ...(r.build ?? {}), [key]: rounded };
}

/** Pretty JSON for "Copy recipe JSON" (ready to paste into content/characters/recipes.json). */
export function recipeJson(r: CharacterRecipe): string {
  return JSON.stringify(r, null, 2);
}

export type CopyResult = 'clipboard' | 'fallback' | 'manual';

/**
 * Copy text: the async Clipboard API first, then a hidden-textarea `execCommand('copy')` fallback (insecure
 * origins, older Safari). 'manual' means both failed and the caller should show the text for Ctrl+C.
 */
export async function copyText(text: string): Promise<CopyResult> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return 'clipboard';
    }
  } catch {
    // Permission denied or not focused: try the fallback below.
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
  document.body.appendChild(area);
  let ok = false;
  try {
    area.select();
    // Deprecated but still the only synchronous fallback where the Clipboard API is unavailable.
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  } finally {
    area.remove();
  }
  return ok ? 'fallback' : 'manual';
}
