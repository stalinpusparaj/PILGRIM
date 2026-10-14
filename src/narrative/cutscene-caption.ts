/**
 * Fallback captions for cutscene lines when no speech-bubble service is running: the line appears in the bottom
 * letterbox bar with a typewriter on the babble reveal clock (`revealTimes`, src/audio/babblePlan.ts), so the
 * blips and the letters stay in sync; the speaker's mouth flaps while it types; music ducks (GDD 2.13). The
 * box keeps its final size from the first letter (unrevealed text is laid out but invisible), so nothing jumps.
 * The reveal speed is the player's Text speed from the one table every typewriter uses (`textCps()`,
 * TEXT_SPEED_CPS in dialogue-voice.ts); Instant shows the line at once with a short babble burst, like the panel.
 * Subtitles are always on (GDD 2.15 Accessibility): screen readers get the whole line at once.
 */
import '../audio/events';
import { events } from '../core/Events';
import { t } from '../core/I18n';
import { services } from '../core/Services';
import type { Character } from '../gen/CharacterFactory';
import { DEFAULT_CPS, revealTimes } from '../audio/babblePlan';
import type { Mood } from '../audio/types';
import { h } from '../ui/dom';
import { babbleBurst } from '../ui/typewriter';
import type { SayHandle } from './cutscene-types';
import { textCps } from './dialogue-voice';

/** The music duck's owner name ('audio:duck' `by`): a pause or a conversation closing never un-ducks a caption. */
const DUCK_OWNER = 'caption';
/** After the last letter: at least this long, plus a little per word, before the line fades. */
const HOLD_MIN = 1.6;
const HOLD_PER_WORD = 0.3;
/** Combining marks (Tamil vowel signs, the pulli) are revealed with their letter, never on their own. */
const MARK = /\p{M}/u;

interface Line {
  speaker: Character | null;
  text: string;
  times: Float32Array;
  revealEnd: number;
  holdEnd: number;
  elapsed: number;
  shown: number;
  babble: { stop(): void } | null;
}

export class Captions {
  readonly root: HTMLDivElement;
  private readonly box: HTMLParagraphElement;
  private readonly seen: HTMLSpanElement;
  private readonly unseen: HTMLSpanElement;
  private readonly sr: HTMLSpanElement;
  private line: Line | null = null;
  private ducked = false;
  private serial = 0;

  constructor(host: HTMLElement) {
    this.seen = h('span', { 'aria-hidden': 'true' });
    this.unseen = h('span', { 'aria-hidden': 'true', style: { visibility: 'hidden' } });
    this.box = h('p', { className: 'pg-cs-caption__text' }, this.seen, this.unseen);
    this.sr = h('span', { className: 'pg-cs-sr', role: 'status', 'aria-live': 'polite' });
    this.root = h('div', { className: 'pg-cs-caption' }, this.box, this.sr);
    host.appendChild(this.root);
  }

  /** Shows a line (replacing the one on screen). `close()` on the handle removes it if it is still this line. */
  say(
    speaker: Character | null,
    key: string,
    opts: { mood?: Mood; params?: Record<string, string | number> },
  ): SayHandle {
    this.stopLine();
    const text = t(key, opts.params);
    const cps = textCps(); // 0 = Instant
    const reveal = cps > 0 ? revealTimes(text, cps) : { times: new Float32Array(text.length), end: 0 };
    const words = text.split(/\s+/).filter(Boolean).length;
    const line: Line = {
      speaker,
      text,
      times: reveal.times,
      revealEnd: reveal.end,
      holdEnd: reveal.end + Math.max(HOLD_MIN, words * HOLD_PER_WORD),
      elapsed: 0,
      shown: -1,
      babble: null,
    };
    this.line = line;
    const serial = ++this.serial;
    if (speaker) {
      speaker.setTalking(true);
      const audio = services.tryGet('audio');
      if (audio) {
        const p = speaker.root.position;
        line.babble = audio.babble.speak(speaker.recipe.voice, cps > 0 ? text : babbleBurst(text), {
          mood: opts.mood ?? 'neutral',
          cps: cps > 0 ? cps : DEFAULT_CPS,
          at: [p.x, p.y + speaker.height * 0.9, p.z],
        });
      }
    }
    if (!this.ducked) {
      this.ducked = true;
      events.emit('audio:duck', { on: true, by: DUCK_OWNER });
    }
    this.sr.textContent = text;
    this.paint(line);
    this.root.classList.add('is-on');
    return { close: () => serial === this.serial && this.clear() };
  }

  /** Fixed step: advance the typewriter; fade the line when its hold is over. */
  update(dt: number): void {
    const line = this.line;
    if (!line) return;
    line.elapsed += dt;
    this.paint(line);
    if (line.elapsed >= line.revealEnd) line.speaker?.setTalking(false);
    if (line.elapsed >= line.holdEnd) this.clear();
  }

  /** Removes the line on screen (if any), stops its babble and un-ducks the music. */
  clear(): void {
    this.stopLine();
    this.root.classList.remove('is-on');
    this.sr.textContent = '';
    if (this.ducked) {
      this.ducked = false;
      events.emit('audio:duck', { on: false, by: DUCK_OWNER });
    }
  }

  dispose(): void {
    this.clear();
    this.root.remove();
  }

  private stopLine(): void {
    const line = this.line;
    if (!line) return;
    this.line = null;
    line.babble?.stop();
    line.speaker?.setTalking(false);
  }

  private paint(line: Line): void {
    let n = 0;
    const times = line.times;
    while (n < times.length && times[n]! <= line.elapsed) n++;
    while (n > 0 && n < line.text.length && MARK.test(line.text[n]!)) n++;
    if (n === line.shown) return;
    line.shown = n;
    this.seen.textContent = line.text.slice(0, n);
    this.unseen.textContent = line.text.slice(n);
  }
}
