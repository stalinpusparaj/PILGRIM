/**
 * Recipe loading: validates and normalises `content/characters/recipes.json` (or any recipe object) at runtime so
 * missing or bad optional fields fall back to sensible defaults instead of crashing a build.
 * Accepted file shapes: `{ id: recipe }`, `[recipe]`, or either nested one level (e.g. `{ recipes: [...] }`).
 */
import {
  BEARDS,
  BODY_TYPES,
  BUILD_LIMITS,
  FACE_LIMITS,
  REST_POSES,
  BOTTOMS,
  EXPRESSIONS,
  HAIRS,
  HATS,
  PROP_BONES,
  PROP_TYPES,
  TOPS,
  VOICE_WAVES,
  type CharacterRecipe,
} from './char-types';
import { SKIN_TONES } from './palette';

type Dict = Record<string, unknown>;

const isDict = (v: unknown): v is Dict => typeof v === 'object' && v !== null && !Array.isArray(v);

function hex(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s;
  if (/^#[0-9a-fA-F]{3}$/.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  return null;
}

function num(v: unknown, min: number, max: number): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : undefined;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[]): T | undefined {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
}

const DEFAULT_VOICE: CharacterRecipe['voice'] = { pitch: 1, speed: 1, wave: 'triangle', vowel: 0.5 };
/** The animation library's style ranges (src/gen/anim/types.ts DEFAULT_STYLE docs; the clips clamp to the same). */
const STYLE_RANGE = { bounce: [0, 2], stiffness: [0, 1], swagger: [0, 1], lean: [-0.6, 0.6] } as const;

/** Generic villager used when a recipe id is unknown. */
export const FALLBACK_RECIPE: CharacterRecipe = {
  id: 'fallback',
  name: 'Villager',
  body: 'adult',
  skin: SKIN_TONES[1],
  colors: { top: '#8A6A4A', bottom: '#5B4636', feet: '#4A3A2E', hair: '#4A3426' },
  parts: { top: 'tunic', bottom: 'trousers', hair: 'short', beard: 'none', hat: 'none', extras: [] },
  expression: 'neutral',
  voice: { ...DEFAULT_VOICE },
};

function looksLikeRecipe(v: unknown): v is Dict {
  return isDict(v) && ('body' in v || 'skin' in v || 'colors' in v || 'parts' in v);
}

/** Returns a complete, valid recipe (never throws). Idempotent: normalising a normalised recipe changes nothing. */
export function normaliseRecipe(raw: unknown, fallbackId = 'recipe'): CharacterRecipe {
  const r: Dict = isDict(raw) ? raw : {};
  const id = typeof r.id === 'string' && r.id.length > 0 ? r.id : fallbackId;
  const body = oneOf(r.body, BODY_TYPES) ?? 'adult';
  const colorsIn: Dict = isDict(r.colors) ? r.colors : {};
  const colors: CharacterRecipe['colors'] = {
    top: hex(colorsIn.top) ?? '#8A6A4A',
    bottom: hex(colorsIn.bottom) ?? '#5B4636',
  };
  for (const [k, v] of Object.entries(colorsIn)) {
    const h = hex(v);
    if (h && k !== 'top' && k !== 'bottom') colors[k] = h;
  }
  const partsIn: Dict = isDict(r.parts) ? r.parts : {};
  const extras = Array.isArray(partsIn.extras)
    ? partsIn.extras.filter((e): e is string => typeof e === 'string')
    : [];
  const parts: CharacterRecipe['parts'] = { extras };
  const top = oneOf(partsIn.top, TOPS);
  const bottom = oneOf(partsIn.bottom, BOTTOMS);
  const hair = oneOf(partsIn.hair, HAIRS);
  const beard = oneOf(partsIn.beard, BEARDS);
  const hat = oneOf(partsIn.hat, HATS);
  if (top) parts.top = top;
  if (bottom) parts.bottom = bottom;
  parts.hair = hair ?? 'short';
  parts.beard = beard ?? 'none';
  parts.hat = hat ?? 'none';

  const props: NonNullable<CharacterRecipe['props']> = [];
  if (Array.isArray(r.props)) {
    for (const p of r.props) {
      if (!isDict(p)) continue;
      const type = oneOf(p.type, PROP_TYPES);
      if (type) props.push({ type, bone: oneOf(p.bone, PROP_BONES) ?? 'propR' });
    }
  }
  const buildIn: Dict = isDict(r.build) ? r.build : {};
  const build: NonNullable<CharacterRecipe['build']> = {};
  for (const k of ['height', 'girth', 'head', 'legs', 'arms', 'belly'] as const) {
    const v = num(buildIn[k], BUILD_LIMITS.min, BUILD_LIMITS.max);
    if (v !== undefined) build[k] = v;
  }
  const voiceIn: Dict = isDict(r.voice) ? r.voice : {};
  const styleIn: Dict = isDict(r.style) ? r.style : {};
  const style: NonNullable<CharacterRecipe['style']> = {};
  for (const k of ['bounce', 'stiffness', 'swagger', 'lean'] as const) {
    const v = num(styleIn[k], STYLE_RANGE[k][0], STYLE_RANGE[k][1]);
    if (v !== undefined) style[k] = v;
  }
  const out: CharacterRecipe = {
    id,
    body,
    skin: hex(r.skin) ?? SKIN_TONES[1],
    colors,
    parts,
    build,
    props,
    burden: r.burden === true,
    glow: r.glow === true,
    expression: oneOf(r.expression, EXPRESSIONS) ?? 'neutral',
    voice: {
      pitch: num(voiceIn.pitch, 0.2, 4) ?? DEFAULT_VOICE.pitch,
      speed: num(voiceIn.speed, 0.2, 4) ?? DEFAULT_VOICE.speed,
      wave: oneOf(voiceIn.wave, VOICE_WAVES) ?? DEFAULT_VOICE.wave,
      vowel: num(voiceIn.vowel, 0, 1) ?? DEFAULT_VOICE.vowel,
    },
    style,
  };
  if (typeof r.name === 'string') out.name = r.name;
  const faceIn: Dict = isDict(r.face) ? r.face : {};
  const brows = num(faceIn.brows, FACE_LIMITS.brows[0], FACE_LIMITS.brows[1]);
  if (brows !== undefined) out.face = { brows };
  const pose = oneOf(r.pose, REST_POSES);
  if (pose) out.pose = pose;
  const scale = num(r.scale, 0.3, 5);
  if (scale !== undefined) out.scale = scale;
  return out;
}

/** Collects every recipe-like object in the file (keyed by id; ids come from the `id` field or the key). */
export function collectRecipes(json: unknown): Record<string, CharacterRecipe> {
  const out: Record<string, CharacterRecipe> = {};
  const visit = (v: unknown, key: string, depth: number): void => {
    if (looksLikeRecipe(v)) {
      const rec = normaliseRecipe(v, key);
      if (out[rec.id]) console.warn(`[CharacterFactory] duplicate recipe id "${rec.id}"`);
      out[rec.id] = rec;
      return;
    }
    if (depth > 1) return;
    if (Array.isArray(v)) v.forEach((item, i) => visit(item, `${key}_${i + 1}`, depth + 1));
    else if (isDict(v)) for (const [k, item] of Object.entries(v)) visit(item, k, depth + 1);
  };
  visit(json, 'recipe', 0);
  return out;
}
