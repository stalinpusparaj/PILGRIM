/**
 * Voices, moods and text speed for dialogue lines (GDD 2.8 "Babble voices play while text appears at 40
 * characters per second", GDD 2.14 Settings > Text speed).
 *
 * The runner fills `voice`, `mood` and `cps` into every 'dialogue:line'. UIs (DialoguePanel, SpeechBubbles)
 * reveal the text with `revealTimes(text, cps)` (src/audio/babblePlan.ts) and call `speakLine()` here, so the
 * babble blips start exactly when their letters appear.
 */
import { services } from '../core/Services';
import { DEFAULT_CPS } from '../audio/babblePlan';
import type { SpeechHandle } from '../audio/AudioEngine';
import type { Mood, Vec3, VoiceParams } from '../audio/types';
import type { SettingsData } from '../core/Settings';
import { CharacterFactory, type Character, type Expression } from '../gen/CharacterFactory';
import type { DialogueLine } from './DialogueTypes';

/**
 * Settings 'textSpeed' → characters per second. 0 = Instant: the whole line shows at once. The single source for
 * every typewriter (dialogue lines, bubbles, barks, cutscene captions: src/ui/typewriter.ts reads it too).
 */
export const TEXT_SPEED_CPS: Readonly<Record<SettingsData['textSpeed'], number>> = {
  slow: 20,
  normal: DEFAULT_CPS,
  instant: 0,
};

/** Reveal speed for new lines from the player's Text speed setting. */
export function textCps(): number {
  const speed = services.tryGet('settings')?.get('textSpeed') ?? 'normal';
  return TEXT_SPEED_CPS[speed] ?? DEFAULT_CPS;
}

/** A plain mid voice for speakers without a recipe. */
export const DEFAULT_VOICE: Readonly<VoiceParams> = { pitch: 1, speed: 1, wave: 'triangle', vowel: 0.5 };

/** Speaker ids that are not recipe ids. The player's outfits (burdened / free / armour) share one voice family. */
const SPEAKER_RECIPE: Readonly<Record<string, string>> = { christian: 'christian_burdened' };

/** Recipe id for a speaker: the actor's own recipe, else the speaker id itself when it names a recipe. */
export function recipeFor(speaker: string, actor: Character | null): string | null {
  if (actor) return actor.recipe.id;
  const id = SPEAKER_RECIPE[speaker] ?? speaker;
  return CharacterFactory.recipes()[id] ? id : null;
}

/** Babble voice for a speaker: the actor's recipe voice, else the recipe named by the speaker id, else default. */
export function voiceFor(speaker: string, actor: Character | null): VoiceParams {
  const id = recipeFor(speaker, actor);
  const recipe = actor?.recipe ?? (id ? CharacterFactory.recipes()[id] : undefined);
  return recipe ? { ...recipe.voice } : { ...DEFAULT_VOICE };
}

const MOOD_OF_EXPR: Readonly<Partial<Record<Expression, Mood>>> = {
  sad: 'sad',
  scared: 'scared',
  surprised: 'excited',
  angry: 'angry',
  sleepy: 'sleepy',
};

const EXPR_OF_MOOD: Readonly<Partial<Record<Mood, Expression>>> = {
  sad: 'sad',
  excited: 'happy',
  scared: 'scared',
  angry: 'angry',
  sleepy: 'sleepy',
};

/** Babble mood for a line: its own, else from its face, else neutral. */
export function moodFor(mood: Mood | undefined, expr: Expression | undefined): Mood {
  return mood ?? (expr ? MOOD_OF_EXPR[expr] : undefined) ?? 'neutral';
}

/** Face for a line: its own, else from its mood (null = leave the face as it is). */
export function exprFor(expr: Expression | undefined, mood: Mood | undefined): Expression | null {
  return expr ?? (mood ? EXPR_OF_MOOD[mood] : undefined) ?? null;
}

/**
 * Plays the babble for a line through the 'audio' service, in sync with a typewriter that uses
 * `revealTimes(text, line.cps)`. `text` is the translated line (t(line.key)); `at` makes the voice positional
 * (world bubbles). Instant text speed still babbles at the default pace. Returns null without an audio service.
 * Stop the handle when the line is left ('dialogue:lineEnd') or skipped.
 */
export function speakLine(line: DialogueLine, text: string, at?: Vec3): SpeechHandle | null {
  const audio = services.tryGet('audio');
  if (!audio) return null;
  return audio.babble.speak(line.voice, text, {
    mood: line.mood,
    cps: line.cps > 0 ? line.cps : DEFAULT_CPS,
    at,
  });
}
