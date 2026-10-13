/**
 * Babble voice presets (GDD 2.11 design sheet, "Babble voice" column) for the music test page and demos.
 * The game itself reads each character's `voice` from content/characters/recipes.json; these presets are the
 * reference values to copy from.
 *
 * pitch: x ~220 Hz (0.5 giant .. 2 child). speed: syllable rate (more letters per blip when slow).
 * wave: sine = pure / bell-like, triangle = soft and warm, sawtooth = rich (low or nasal voices stay audible
 * on phone speakers), square = buzzy (grumpy, growls). vowel: formant colour, 0 dark "oo" .. 1 bright "ee".
 */
import type { VoiceParams } from './types';

export const VOICE_PRESETS: Record<string, VoiceParams> = {
  /** Mid, warm. */
  christian: { pitch: 1, speed: 1, wave: 'triangle', vowel: 0.5 },
  /** Soft mid. */
  christiana: { pitch: 1.3, speed: 0.95, wave: 'triangle', vowel: 0.62 },
  /** The four sons: high, quick. */
  son: { pitch: 1.85, speed: 1.35, wave: 'triangle', vowel: 0.72 },
  /** Low, slow. */
  evangelist: { pitch: 0.7, speed: 0.72, wave: 'sawtooth', vowel: 0.28 },
  /** Low, grumpy. */
  obstinate: { pitch: 0.66, speed: 0.95, wave: 'square', vowel: 0.12 },
  /** High, fast. */
  pliable: { pitch: 1.45, speed: 1.45, wave: 'triangle', vowel: 0.85 },
  /** Low, kind. */
  help: { pitch: 0.76, speed: 0.88, wave: 'sawtooth', vowel: 0.42 },
  /** Nasal, posh: bright and buzzy, a little slow and grand. */
  wiseman: { pitch: 1.12, speed: 0.92, wave: 'sawtooth', vowel: 0.95 },
  /** Mid, quick. */
  goodwill: { pitch: 1.05, speed: 1.3, wave: 'triangle', vowel: 0.55 },
  /** Gentle. */
  interpreter: { pitch: 0.92, speed: 0.82, wave: 'triangle', vowel: 0.4 },
  /** Shining Ones: bell-like (sine voices ring). */
  shining: { pitch: 1.95, speed: 0.85, wave: 'sine', vowel: 0.95 },
  /** Giant Despair: very low, slow. */
  giant: { pitch: 0.5, speed: 0.6, wave: 'sawtooth', vowel: 0.15 },
  /** Apollyon: deep growl (pitch below 0.42 adds a growl rumble). */
  apollyon_growl: { pitch: 0.32, speed: 0.8, wave: 'square', vowel: 0.08 },
};
