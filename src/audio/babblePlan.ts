/**
 * Babble planning (GDD 2.13 "Babble voices"): turns a line of text into syllable blips. Pure and deterministic
 * (seeded from the text), so the same line always sounds the same; src/audio/Babble.ts plays the plan.
 *
 * - One blip per 2-3 letters of each word (a one-letter word gets one blip). Slow voices and sad/sleepy moods
 *   lean to 3 letters per blip and longer, lower, falling blips; fast voices and excited lines lean to 2 and
 *   shorter ones. Spaces and punctuation make no sound.
 * - Timing follows the text reveal: a blip starts when its first letter appears. `revealTimes()` is the reveal
 *   clock (cps characters per second plus a short breath after . ! ? and a tiny one after , ; :). A dialogue
 *   typewriter that uses it stays exactly in sync; one revealing at a flat cps drifts by at most one breath
 *   (~0.15 s at 40 cps) per sentence.
 * - Speech-like melody: a smoothed random contour, gentle fall across each sentence, questions rise at the end,
 *   exclamations start high. The vowel colour alternates between 3 shades around the voice's own vowel.
 */
import { hashString, Rng } from '../gen/rng';
import type { Mood, VoiceParams } from './types';

/** Blip pitch for VoiceParams.pitch = 1, in Hz. */
export const BABBLE_BASE_HZ = 220;
/** Default text reveal speed, characters per second (GDD 2.8). */
export const DEFAULT_CPS = 40;

/** Extra reveal time after a sentence end (. ! ? …), in character slots: 150 ms at 40 cps. */
const SENTENCE_BREATH = 6;
/** Extra reveal time after , ; : and dashes, in character slots. */
const COMMA_BREATH = 2;
/** Letters per blip for an average voice in a neutral mood (GDD: one blip per 2-3 letters). */
const LETTERS_PER_BLIP = 2.5;
/** GDD 2.13 bounds: every blip covers 2 or 3 letters (only a one-letter word is shorter). */
const MIN_LETTERS = 2;
const MAX_LETTERS = 3;

export interface MoodShape {
  /** Pitch shift in semitones. */
  semis: number;
  /** Letters-per-blip multiplier: > 1 means fewer, slower syllables. */
  letters: number;
  /** Blip length multiplier. */
  dur: number;
  /** Level multiplier (kept close to 1: never loud). */
  gain: number;
  /** Vowel brightness shift (-1..1). */
  vowel: number;
  /** Pitch glide across each blip, semitones (negative falls). */
  glide: number;
  /** Brightness multiplier for the voice's tone filter. */
  bright: number;
  /** Tremolo depth 0..1 (scared) and rate in Hz. */
  tremolo: number;
  tremoloHz: number;
}

export const MOOD_SHAPES: Readonly<Record<Mood, MoodShape>> = {
  neutral: { semis: 0, letters: 1, dur: 1, gain: 1, vowel: 0, glide: -0.4, bright: 1, tremolo: 0, tremoloHz: 0 },
  sad: { semis: -3, letters: 1.3, dur: 1.3, gain: 0.85, vowel: -0.15, glide: -1.3, bright: 0.8, tremolo: 0, tremoloHz: 0 },
  excited: { semis: 3, letters: 0.82, dur: 0.82, gain: 1.05, vowel: 0.1, glide: 0.9, bright: 1.15, tremolo: 0, tremoloHz: 0 },
  scared: { semis: 1.5, letters: 0.92, dur: 0.9, gain: 0.9, vowel: 0.05, glide: 0.3, bright: 1, tremolo: 0.45, tremoloHz: 9 },
  angry: { semis: -0.5, letters: 1, dur: 0.85, gain: 1.3, vowel: 0.18, glide: -0.8, bright: 1.45, tremolo: 0, tremoloHz: 0 },
  sleepy: { semis: -2, letters: 1.45, dur: 1.5, gain: 0.8, vowel: -0.2, glide: -1.6, bright: 0.75, tremolo: 0, tremoloHz: 0 },
};

/** A planned line: parallel arrays, one entry per blip (`count` entries are valid). */
export interface BabblePlan {
  readonly count: number;
  /** Blip start, seconds from the start of the line. */
  readonly time: Float32Array;
  /** Blip length, seconds. */
  readonly dur: Float32Array;
  /** Blip start pitch, Hz. */
  readonly hz: Float32Array;
  /** Pitch at the end of the blip, as a ratio of `hz`. */
  readonly glide: Float32Array;
  /** Vowel colour 0..1. */
  readonly vowel: Float32Array;
  /** Relative level 0..1 (stressed syllables are louder). */
  readonly gain: Float32Array;
  /** When the line is done: the later of the last blip's end and the end of the text reveal, seconds. */
  readonly end: number;
}

// ------------------------------------------------------------------------------------------ text helpers

const LETTER = /[\p{L}\p{N}\p{M}]/u;
const SENTENCE_END = /[.!?…]/;
const COMMA = /[,;:–—]/;
/** Joins letters inside one word ("don't", "Hate-good") without starting a new word. */
const JOINER = /['’-]/;

function isLetter(text: string, i: number): boolean {
  return i >= 0 && i < text.length && LETTER.test(text[i]);
}

/** Punctuation that is the last of its run (so "?!" and "..." breathe once). */
function breathAfter(text: string, i: number): number {
  const ch = text[i];
  const next = i + 1 < text.length ? text[i + 1] : '';
  if (SENTENCE_END.test(ch)) return SENTENCE_END.test(next) ? 0 : SENTENCE_BREATH;
  if (COMMA.test(ch)) return COMMA_BREATH;
  return 0;
}

/**
 * Reveal clock for a line: `times[i]` is when character i appears, `end` when the whole line is shown (the
 * breath after the final punctuation is not counted). Pure; the dialogue typewriter can use it to stay in sync.
 */
export function revealTimes(text: string, cps = DEFAULT_CPS): { times: Float32Array; end: number } {
  const slot = 1 / Math.max(1, cps);
  const times = new Float32Array(text.length);
  let t = 0;
  for (let i = 0; i < text.length; i++) {
    times[i] = t;
    t += slot;
    if (i < text.length - 1) t += breathAfter(text, i) * slot;
  }
  return { times, end: t };
}

/** Per character: the sentence it belongs to, and each sentence's closing mark ('.', '?', '!' or ''). */
function sentences(text: string): { of: Uint16Array; mark: string[] } {
  const of = new Uint16Array(text.length);
  const mark: string[] = [''];
  let s = 0;
  for (let i = 0; i < text.length; i++) {
    of[i] = s;
    const ch = text[i];
    if (SENTENCE_END.test(ch) && !SENTENCE_END.test(text[i + 1] ?? '')) {
      // A run like "?!" counts as a question when it contains '?'.
      let j = i;
      let m = '.';
      while (j >= 0 && SENTENCE_END.test(text[j])) {
        if (text[j] === '?') m = '?';
        else if (text[j] === '!' && m !== '?') m = '!';
        j--;
      }
      mark[s] = m;
      s = Math.min(s + 1, 65535);
      mark[s] = '';
    }
  }
  return { of, mark };
}

// --------------------------------------------------------------------------------------------- formants

// Vowel axis 0..1 through oo, oh, ah, eh, ee (adult formants, Hz).
const F1_TABLE = [320, 480, 720, 540, 300];
const F2_TABLE = [800, 1000, 1240, 1800, 2300];

function lerpTable(table: readonly number[], v: number): number {
  const x = Math.min(1, Math.max(0, v)) * (table.length - 1);
  const i = Math.min(table.length - 2, Math.floor(x));
  const f = x - i;
  return table[i] * (1 - f) + table[i + 1] * f;
}

/** Formant scale for small and big bodies (children have higher formants, giants lower). */
function formantScale(pitch: number): number {
  return Math.pow(Math.min(2.2, Math.max(0.3, pitch)), 0.2);
}

/** First formant (Hz) for a vowel colour and voice pitch. */
export function formant1(vowel: number, pitch: number): number {
  return lerpTable(F1_TABLE, vowel) * formantScale(pitch);
}

/** Second formant (Hz) for a vowel colour and voice pitch. */
export function formant2(vowel: number, pitch: number): number {
  return lerpTable(F2_TABLE, vowel) * formantScale(pitch);
}

/** Cut-off of the voice's tone (low-pass) filter: brighter vowels and angry lines are brighter. */
export function toneCutoff(vowel: number, bright: number): number {
  return Math.min(5200, Math.max(900, (1300 + 2100 * Math.min(1, Math.max(0, vowel))) * bright));
}

// ------------------------------------------------------------------------------------------------ plan

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Safe copy of VoiceParams: NaN or out-of-range values from data files cannot break the synth. */
export function sanitizeVoice(v: VoiceParams): VoiceParams {
  const num = (x: number, lo: number, hi: number, d: number) => (Number.isFinite(x) ? clamp(x, lo, hi) : d);
  const wave = v.wave === 'sine' || v.wave === 'square' || v.wave === 'sawtooth' ? v.wave : 'triangle';
  return { pitch: num(v.pitch, 0.2, 3, 1), speed: num(v.speed, 0.3, 3, 1), wave, vowel: num(v.vowel, 0, 1, 0.5) };
}

/** Plans the blips for one line. `voice` should already be sanitised. */
export function planBabble(voice: VoiceParams, text: string, mood: Mood = 'neutral', cps = DEFAULT_CPS): BabblePlan {
  const shape = MOOD_SHAPES[mood] ?? MOOD_SHAPES.neutral;
  const { times, end: revealEnd } = revealTimes(text, cps);
  const slot = 1 / Math.max(1, cps);
  const rng = new Rng(hashString(text));
  const { of: sentenceOf, mark } = sentences(text);

  let letters = 0;
  for (let i = 0; i < text.length; i++) if (isLetter(text, i)) letters++;
  const time = new Float32Array(letters);
  const dur = new Float32Array(letters);
  const hz = new Float32Array(letters);
  const glide = new Float32Array(letters);
  const vowel = new Float32Array(letters);
  const gain = new Float32Array(letters);
  const sent = new Uint16Array(letters);
  const wordStart = new Uint8Array(letters);

  // 1. Syllables: chunks of 2-3 letters inside each word (GDD 2.13). Speed and mood only move the average inside
  // that range; beyond it, slowness shows in longer blips (shape.dur, quick), lower pitch and the falling glide.
  const target = clamp((LETTERS_PER_BLIP * shape.letters) / voice.speed, MIN_LETTERS, MAX_LETTERS);
  const quick = clamp(1 / Math.sqrt(voice.speed), 0.75, 1.3);
  const lo = Math.floor(target);
  const frac = target - lo;
  const wordLetters: number[] = [];
  let count = 0;
  let i = 0;
  while (i < text.length) {
    if (!isLetter(text, i)) {
      i++;
      continue;
    }
    wordLetters.length = 0;
    while (i < text.length && (isLetter(text, i) || (JOINER.test(text[i]) && isLetter(text, i + 1)))) {
      if (isLetter(text, i)) wordLetters.push(i);
      i++;
    }
    const k = wordLetters.length;
    let at = 0;
    while (at < k) {
      let size = Math.max(1, rng.next() < frac ? lo + 1 : lo);
      const left = k - at;
      // No lone trailing letter: 2+1 becomes 3, 3+1 becomes 2+2 (never more than MAX_LETTERS).
      if (left - size === 1) size = size < MAX_LETTERS ? size + 1 : size - 1;
      if (size > left) size = left;
      const first = wordLetters[at];
      const last = wordLetters[at + size - 1];
      time[count] = times[first];
      dur[count] = clamp((times[last] - times[first] + slot) * 0.9 * shape.dur * quick, 0.04, 0.2);
      sent[count] = sentenceOf[first];
      wordStart[count] = at === 0 ? 1 : 0;
      count++;
      at += size;
    }
  }

  // 2. Melody, stress and vowel colour per syllable.
  const shades = [voice.vowel, voice.vowel + 0.22, voice.vowel - 0.2];
  let prevShade = -1;
  let contour = 0;
  let s0 = 0;
  while (s0 < count) {
    let s1 = s0;
    while (s1 < count && sent[s1] === sent[s0]) s1++;
    const n = s1 - s0;
    const m = mark[sent[s0]] ?? '';
    for (let j = 0; j < n; j++) {
      const idx = s0 + j;
      const pos = n > 1 ? j / (n - 1) : 0.5;
      contour = 0.55 * contour + 0.45 * rng.range(-1.6, 1.6);
      let semis = shape.semis + contour + 0.9 - 1.8 * pos; // gentle fall across the sentence
      let bend = shape.glide;
      if (wordStart[idx]) semis += 0.6;
      if (m === '!') semis += j === 0 ? 2.2 : 0.7;
      if (m === '?' && j === n - 1) {
        semis += 3;
        bend = Math.abs(bend) + 2;
      } else if (m === '?' && j === n - 2) semis += 1.4;
      else if (m === '.' && j === n - 1) bend -= 1.2;
      hz[idx] = clamp(BABBLE_BASE_HZ * voice.pitch * Math.pow(2, semis / 12), 40, 1400);
      glide[idx] = Math.pow(2, bend / 12);
      gain[idx] = wordStart[idx] ? 1 : 0.8 + 0.12 * rng.next();
      let shade = rng.int(0, 2);
      if (shade === prevShade) shade = (shade + 1 + rng.int(0, 1)) % 3;
      prevShade = shade;
      vowel[idx] = clamp(shades[shade] + shape.vowel, 0, 1);
    }
    s0 = s1;
  }

  const lastEnd = count > 0 ? time[count - 1] + dur[count - 1] : 0;
  return { count, time, dur, hz, glide, vowel, gain, end: Math.max(lastEnd, revealEnd) };
}
