/**
 * Speaker names for the dialogue panel and bubbles: `speakerName(recipeId)` tries `name.<recipeId>`, then the id
 * without its outfit suffix (`christian_burdened` → `name.christian`), and returns '' when no name is known (the
 * name tag hides). Names live in content/i18n/en.json / ta.json like every other string.
 */
import { i18n, t } from '../core/I18n';

/** Display name for a recipe id (or speaker id), '' when the game has no name for it. */
export function speakerName(id: string): string {
  if (!id) return '';
  const direct = `name.${id}`;
  if (i18n.has(direct)) return t(direct);
  const base = id.replace(/_.*$/, '');
  const short = `name.${base}`;
  return base !== id && i18n.has(short) ? t(short) : '';
}
