/**
 * Dialogue typewriter (GDD 2.8: "Babble voices play while text appears at 40 characters per second"; GDD 2.14
 * Settings > Text speed: Slow / Normal / Instant).
 *
 * - Speeds: TEXT_SPEED_CPS (src/narrative/dialogue-voice.ts: slow 20 cps, normal 40 cps, instant = the whole
 *   line at once). The speed is read from Settings when the line starts unless the caller passes one.
 * - The reveal follows `revealTimes()` from src/audio/babblePlan.ts (the same clock the babble voice plans its
 *   blips on, including the short breath after . ! ? and ,), so every blip starts when its first letter shows.
 * - Text is revealed by grapheme cluster (Intl.Segmenter, with a combining-mark fallback), so a Tamil vowel sign
 *   or pulli never shows apart from its consonant. A cluster appears at the reveal time of its first code unit.
 * - The unrevealed rest of the line is already in the DOM with `visibility: hidden`, so the box has its final
 *   size from the first frame: no reflow, no words jumping to the next line while they type.
 * - The babble starts with the reveal (services 'audio', when registered). Instant speed plays a short burst of
 *   the first word or two instead of the whole line (DECISIONS: the speaker keeps a voice, the line does not
 *   babble on after it is fully shown). Skipping or cancelling stops the voice.
 * - Driven by requestAnimationFrame with frame deltas clamped to 0.1 s, so a hidden tab (no frames, audio
 *   suspended) does not jump the text ahead of the voice when it comes back.
 *
 *   const tw = typewrite(textEl, t(key), { voice: recipe.voice, mood: 'excited' });
 *   button.onclick = () => (tw.finished ? next() : tw.skip());
 *   await tw.done;
 */
import { services } from '../core/Services';
import { revealTimes, DEFAULT_CPS } from '../audio/babblePlan';
import type { Mood, Vec3, VoiceParams } from '../audio/types';
import type {} from '../audio/AudioEngine'; // 'audio' service typing
import { TEXT_SPEED_CPS } from '../narrative/dialogue-voice';

export type TextSpeed = 'slow' | 'normal' | 'instant';

/** Characters per second for each Settings text speed (instant has no rate). */
export const TEXT_CPS: Readonly<Record<Exclude<TextSpeed, 'instant'>, number>> = {
  slow: TEXT_SPEED_CPS.slow,
  normal: TEXT_SPEED_CPS.normal,
};
/** Letters of babble played for an instant line (the first word or two). */
const INSTANT_BURST_LETTERS = 10;
/** Longest frame step the reveal clock accepts (hidden tabs, long stalls). */
const MAX_FRAME_DT = 0.1;

export interface TypewriterOptions {
  /** Babble voice of the speaker (recipe.voice). No voice: the line is silent. */
  voice?: VoiceParams | null;
  mood?: Mood;
  /** World position for a positional voice (world-space bubbles). */
  at?: Vec3;
  /** Overrides the Settings text speed. */
  speed?: TextSpeed;
  /** Overrides `speed` with an exact rate in characters per second; 0 = instant (DialogueLine.cps). */
  cps?: number;
  /**
   * Plays the voice for `text` at `cps` instead of the built-in babble (e.g. the runner's speakLine()). Return
   * null for silence. `text` is the line, or the short burst at instant speed.
   */
  speak?: (text: string, cps: number, at?: Vec3) => { stop(): void; done?: Promise<void> } | null;
  /** Language for grapheme segmentation (default: the document language). */
  lang?: string;
  /** Called whenever more text shows: code units shown, total code units. */
  onProgress?: (shown: number, total: number) => void;
}

export interface TypewriterController {
  /** Shows the whole line now and stops the voice. */
  skip(): void;
  /** Stops without touching the text any more (the element is being removed). Resolves `done`. */
  cancel(): void;
  /** Resolves when the whole line is shown (naturally, skipped or cancelled). Never rejects. */
  readonly done: Promise<void>;
  readonly voiceDone: Promise<void>;
  /** True once the whole line is shown. */
  readonly finished: boolean;
  /** Seconds the full reveal takes at this speed (0 for instant). */
  readonly duration: number;
}

/** The player's text speed (Settings > Text speed), 'normal' without a settings service. */
export function currentTextSpeed(): TextSpeed {
  return services.tryGet('settings')?.get('textSpeed') ?? 'normal';
}

/** Characters per second for a speed, or null for instant. */
export function cpsFor(speed: TextSpeed): number | null {
  return speed === 'instant' ? null : TEXT_CPS[speed];
}

// ------------------------------------------------------------------------------------------ graphemes

type Segmenter = { segment(text: string): Iterable<{ index: number }> };
type SegmenterCtor = new (lang: string | undefined, opts: { granularity: 'grapheme' }) => Segmenter;

const segmenters = new Map<string, Segmenter | null>();
/** A base character with its combining marks (and joiners), for engines without Intl.Segmenter. */
const CLUSTER_FALLBACK = /\P{M}[\p{M}‌‍]*|[\p{M}‌‍]+/gu;

function segmenterFor(lang: string | undefined): Segmenter | null {
  const key = lang ?? '';
  if (segmenters.has(key)) return segmenters.get(key) ?? null;
  const Ctor = (Intl as unknown as { Segmenter?: SegmenterCtor }).Segmenter;
  let seg: Segmenter | null = null;
  if (typeof Ctor === 'function') {
    try {
      seg = new Ctor(lang || undefined, { granularity: 'grapheme' });
    } catch {
      seg = null;
    }
  }
  segmenters.set(key, seg);
  return seg;
}

/**
 * Code-unit offsets where each grapheme cluster starts, plus `text.length` at the end. A Tamil syllable such as
 * "கா" or "க்" is one cluster, so it is never split by the reveal.
 */
export function graphemeStarts(text: string, lang?: string): Uint32Array {
  const starts: number[] = [];
  const seg = segmenterFor(lang);
  if (seg) {
    for (const s of seg.segment(text)) starts.push(s.index);
  } else {
    CLUSTER_FALLBACK.lastIndex = 0;
    for (let m = CLUSTER_FALLBACK.exec(text); m; m = CLUSTER_FALLBACK.exec(text)) starts.push(m.index);
  }
  starts.push(text.length);
  return Uint32Array.from(starts);
}

/** The first word or two of a line, up to `letters` letters (instant speed's babble burst). */
export function babbleBurst(text: string, letters = INSTANT_BURST_LETTERS): string {
  const words = text.trim().split(/\s+/);
  let out = '';
  let count = 0;
  for (const w of words) {
    if (out && count >= letters / 2) break;
    out = out ? `${out} ${w}` : w;
    count += w.replace(/[^\p{L}\p{N}\p{M}]/gu, '').length;
    if (count >= letters) break;
  }
  return out;
}

// ------------------------------------------------------------------------------------------ typewriter

function startVoice(
  text: string,
  cps: number,
  opts: TypewriterOptions,
): { stop(): void; done?: Promise<void> } | null {
  if (!text) return null;
  if (opts.speak) return opts.speak(text, cps, opts.at);
  const voice = opts.voice ?? null;
  if (!voice) return null;
  return services.tryGet('audio')?.babble.speak(voice, text, { mood: opts.mood, cps, at: opts.at }) ?? null;
}

/**
 * Types `text` into `el` (its children are replaced by a shown span and a hidden rest span). Returns the
 * controller; the caller owns `el`.
 */
export function typewrite(el: HTMLElement, text: string, opts: TypewriterOptions = {}): TypewriterController {
  const cps =
    opts.cps !== undefined && Number.isFinite(opts.cps)
      ? opts.cps > 0
        ? opts.cps
        : null
      : cpsFor(opts.speed ?? currentTextSpeed());
  const shown = document.createElement('span');
  shown.className = 'tw-shown';
  const rest = document.createElement('span');
  rest.className = 'tw-rest';
  rest.style.visibility = 'hidden';
  rest.setAttribute('aria-hidden', 'true');
  el.replaceChildren(shown, rest);

  const lang = opts.lang ?? (document.documentElement.lang || undefined);
  const starts = graphemeStarts(text, lang);
  const clusters = starts.length - 1;
  const clock = cps === null ? null : revealTimes(text, cps);

  let resolveDone: () => void = () => undefined;
  const done = new Promise<void>((resolve) => (resolveDone = resolve));
  let finished = false;
  let stopped = false;
  let raf = 0;
  let lastFrame = 0;
  let elapsed = 0;
  let cluster = 0; // clusters shown
  let shownUnits = -1;

  const handle = startVoice(
    cps === null && services.tryGet('settings')?.get('voiceMode') === 'classic' ? babbleBurst(text) : text,
    cps ?? DEFAULT_CPS,
    opts,
  );

  const render = (units: number): void => {
    if (units === shownUnits) return;
    shownUnits = units;
    shown.textContent = text.slice(0, units);
    rest.textContent = text.slice(units);
    opts.onProgress?.(units, text.length);
  };

  const finish = (): void => {
    if (finished) return;
    finished = true;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    resolveDone();
  };

  const frame = (now: number): void => {
    raf = 0;
    if (stopped || finished || !clock) return;
    const dt = lastFrame ? Math.min(MAX_FRAME_DT, Math.max(0, (now - lastFrame) / 1000)) : 0;
    lastFrame = now;
    elapsed += dt;
    while (cluster < clusters && clock.times[starts[cluster]] <= elapsed) cluster++;
    render(starts[cluster]);
    if (cluster >= clusters && elapsed >= clock.end) {
      finish();
      return;
    }
    raf = requestAnimationFrame(frame);
  };

  if (!clock || clusters === 0) {
    render(text.length);
    finish();
  } else {
    cluster = 1; // the first cluster shows at once (time 0)
    render(starts[1]);
    raf = requestAnimationFrame(frame);
  }

  return {
    skip(): void {
      if (stopped) return;
      handle?.stop();
      render(text.length);
      finish();
    },
    cancel(): void {
      if (stopped) return;
      stopped = true;
      handle?.stop();
      finish();
    },
    done,
    voiceDone: handle?.done ?? Promise.resolve(),
    get finished(): boolean {
      return finished;
    },
    duration: clock ? clock.end : 0,
  };
}
