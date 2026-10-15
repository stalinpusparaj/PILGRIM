/**
 * Opening (GDD 2.14 "Opening"): narration text over black, fading in line by line ("As I walked through the
 * wilderness of this world, I lay down to sleep... and as I slept, I dreamed a dream."), then "Click to play"
 * (desktop) / "Tap to play" (mobile).
 *
 * The first chapter loads behind it (GameFlow passes `ready`): the prompt appears once the narration has played
 * and the chapter is ready, so the player never waits twice. Activating the prompt is the user gesture that
 * starts gameplay (pointer lock on desktop).
 *
 * Controls (GDD 2.6 "Skip line / skip scene: Space / hold Space 1 s"): a short press of Space, Enter, E, a tap or
 * pad A shows every line at once (or plays, once the prompt is up); holding any of them for 1 s skips the whole
 * opening. A ring in the corner fills while held. Escape, pad B or pad Menu go back to the title (START pressed
 * by mistake), as they back out of every other menu screen.
 */
import { events } from '../core/Events';
import { t } from '../core/I18n';
import { services } from '../core/Services';
import { h } from './dom';
import { Texts, afterPaint, uid } from './menu-screen';
import './opening.css';

export type OpeningPhase = 'narration' | 'waiting' | 'prompt' | 'done';

export interface OpeningOptions {
  /** Settles when the first chapter is ready to play; the prompt waits for it (default: ready at once). */
  ready?: Promise<unknown>;
  /** The player chose to play (or skipped once the chapter was ready). Called once. */
  onDone(): void;
  /** Escape / pad B / pad Menu: back to the title. Called once; without it those keys do nothing. */
  onBack?(): void;
}

/** First line after this pause; then each line stays alone for its reading time. */
const FIRST_LINE_S = 1.0;
const MIN_LINE_S = 2.8;
const CHARS_PER_S = 15;
/** Extra pause after the last line's reading time, before the prompt. */
const AFTER_LAST_S = 0.4;
/** GDD 2.6: hold 1 s to skip a scene. */
const HOLD_S = 1;
const ACTIVATE_KEYS = new Set(['Space', 'Enter', 'NumpadEnter', 'KeyE']);
/** Standard-mapping pad buttons: A plays / skips; B and Menu go back. */
const PAD_A = 0;
const PAD_BACK = [1, 9] as const;
const RING_R = 20;
const RING_LEN = 2 * Math.PI * RING_R;

/** Splits the narration after each "..." so it fades in a phrase at a time (works for English and Tamil). */
export function splitNarration(text: string): string[] {
  return text
    .split(/(?<=\.\.\.|…)\s+/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export class Opening {
  readonly root: HTMLDivElement;
  private readonly texts: Texts;
  private readonly narration: HTMLDivElement;
  private readonly prompt: HTMLButtonElement;
  private readonly promptLabel: HTMLSpanElement;
  private readonly waiting: HTMLDivElement;
  private readonly centre: HTMLDivElement;
  private readonly hold: HTMLDivElement;
  private readonly ringArc: SVGCircleElement;
  private readonly offs: Array<() => void> = [];
  private lines: HTMLParagraphElement[] = [];
  private schedule: number[] = [];
  private shownLines = 0;
  private voicePending = false;
  private narrationVoice: { stop(): void; done: Promise<void> } | null = null;
  private narrationEnd = 0;
  private time = 0;
  private lastFrame = 0;
  private raf = 0;
  private isReady = false;
  private state: OpeningPhase = 'narration';
  private pressAt: number | null = null;
  private padDown = false;
  private padBackDown = false;
  private disposed = false;

  constructor(
    parent: HTMLElement,
    private readonly opts: OpeningOptions,
  ) {
    this.texts = new Texts(() => this.onLang());
    const labelId = uid('pg-opening');
    this.narration = h('div', { className: 'pg-opening__text', id: labelId, 'aria-live': 'polite' });
    this.promptLabel = h('span');
    this.prompt = h(
      'button',
      { type: 'button', className: 'pg-opening__prompt', hidden: true, onClick: () => this.finish() },
      h('span', { className: 'pg-opening__play', 'aria-hidden': 'true' }),
      this.promptLabel,
    );
    this.waiting = h(
      'div',
      { className: 'pg-opening__waiting', hidden: true, 'aria-hidden': 'true' },
      h('span'),
      h('span'),
      h('span'),
    );
    this.ringArc = svgEl('circle', { cx: 24, cy: 24, r: RING_R, class: 'pg-opening__ringarc' });
    const ring = svgEl('svg', { viewBox: '0 0 48 48', width: 48, height: 48, 'aria-hidden': 'true' });
    ring.append(svgEl('circle', { cx: 24, cy: 24, r: RING_R, class: 'pg-opening__ringbg' }), this.ringArc);
    this.ringArc.style.strokeDasharray = `${RING_LEN}`;
    this.ringArc.style.strokeDashoffset = `${RING_LEN}`;
    this.hold = h(
      'div',
      { className: 'pg-opening__hold' },
      ring,
      this.texts.text(h('span', { className: 'pg-opening__holdtext' }), 'ui.opening.holdSkip'),
    );
    this.centre = h('div', { className: 'pg-opening__centre' }, this.narration, this.waiting, this.prompt);
    this.root = h(
      'div',
      { className: 'pg-screen pg-opening', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': labelId },
      this.centre,
      this.hold,
    );
    this.buildLines();
    this.refreshPrompt();
    parent.appendChild(this.root);

    this.listen(window, 'keydown', (e) => this.onKeyDown(e as KeyboardEvent));
    this.listen(window, 'keyup', (e) => this.onKeyUp(e as KeyboardEvent));
    this.listen(this.root, 'pointerdown', (e) => this.onPointerDown(e as PointerEvent));
    this.listen(window, 'pointerup', () => this.release());
    this.listen(window, 'pointercancel', () => this.cancelHold());
    this.listen(window, 'blur', () => this.cancelHold());
    this.offs.push(events.on('input:device', () => this.refreshPrompt()));

    const ready = opts.ready ?? Promise.resolve();
    ready.then(
      () => this.onReady(),
      () => this.onReady(), // GameFlow reports a failed load itself; never leave the player on black
    );
    events.emit('music:stop', { fade: 2.5 });
    events.emit('ambience:set', { id: 'night', fade: 2.5 });
    this.offs.push(afterPaint(() => this.root.classList.add('is-shown')));
    // A pad A still held from the title's START must be let go before it counts here.
    this.padDown = latestPad()?.buttons[PAD_A]?.pressed ?? false;
    this.padBackDown = padBackHeld(latestPad());
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  get phase(): OpeningPhase {
    return this.state;
  }

  /** Skip the narration (as a 1 s hold does): play at once when the chapter is ready, else when it is. */
  skip(): void {
    this.revealAll();
    if (this.isReady) this.finish();
    else this.setPhase('waiting');
  }

  dispose(): void {
    this.narrationVoice?.stop();
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    for (const off of this.offs.splice(0)) off();
    this.texts.dispose();
    this.root.remove();
  }

  // ------------------------------------------------------------------------------------------- timeline

  private buildLines(): void {
    this.narration.replaceChildren();
    const parts = splitNarration(t('ui.opening.narration'));
    this.lines = parts.map((text) => h('p', { className: 'pg-opening__line' }, text));
    this.narration.append(...this.lines);
    this.schedule = [];
    let at = FIRST_LINE_S;
    for (const text of parts) {
      this.schedule.push(at);
      at += Math.max(MIN_LINE_S, text.length / CHARS_PER_S);
    }
    this.narrationEnd = at + AFTER_LAST_S;
    for (let i = 0; i < this.shownLines && i < this.lines.length; i++) this.lines[i]!.classList.add('is-in');
  }

  private readonly tick = (now: number): void => {
    this.raf = requestAnimationFrame(this.tick);
    const dt = Math.min(0.25, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.time += dt;
    this.pollPad();
    while (this.shownLines < this.lines.length && this.time >= this.schedule[this.shownLines]!) {
      if (this.voicePending) break;
      this.lines[this.shownLines]!.classList.add('is-in');
      this.reveal(this.lines[this.shownLines]!);
      this.narrationVoice?.stop();
      this.narrationVoice =
        services
          .tryGet('audio')
          ?.spoken.speak(
            this.lines[this.shownLines]!.textContent ?? '',
            { pitch: 1, speed: 1, wave: 'triangle', vowel: 0.5 },
            1,
          ) ?? null;
      const narration = this.narrationVoice;
      if (narration) {
        this.voicePending = true;
        void narration.done.then(() => {
          if (this.narrationVoice === narration) this.voicePending = false;
        });
      }
      this.shownLines++;
    }
    if (
      this.state === 'narration' &&
      this.time >= this.narrationEnd &&
      this.shownLines === this.lines.length &&
      !this.voicePending
    )
      this.setPhase(this.isReady ? 'prompt' : 'waiting');
    this.drawHold(now);
  };

  private revealAll(): void {
    for (const line of this.lines) line.classList.add('is-in', 'is-instant');
    this.narrationVoice?.stop();
    this.voicePending = false;
    this.shownLines = this.lines.length;
    this.time = Math.max(this.time, this.narrationEnd);
  }

  private onReady(): void {
    if (this.disposed) return;
    this.isReady = true;
    if (this.state === 'waiting') this.setPhase('prompt');
  }

  private setPhase(phase: OpeningPhase): void {
    if (this.state === phase || this.state === 'done') return;
    this.state = phase;
    this.root.dataset.phase = phase;
    this.waiting.hidden = phase !== 'waiting';
    this.prompt.hidden = phase !== 'prompt';
    this.hold.hidden = phase === 'prompt';
    if (phase === 'prompt') {
      this.cancelHold();
      const touch = services.tryGet('input')?.device === 'touch';
      this.prompt.focus({ preventScroll: true, focusVisible: !touch } as FocusOptions);
      events.emit('sfx', { id: 'ui_open' });
    }
    if (phase !== 'narration') this.reveal(phase === 'prompt' ? this.prompt : this.waiting);
  }

  /** Large text can make the centre column scroll: keep the newest line or the prompt in view (never the page). */
  private reveal(el: HTMLElement): void {
    const box = this.centre.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (r.bottom > box.bottom) this.centre.scrollTop += r.bottom - box.bottom + 12;
  }

  /** Back to the title (Escape, pad B, pad Menu). */
  private back(): void {
    if (this.state === 'done' || this.disposed || !this.opts.onBack) return;
    this.state = 'done';
    this.root.dataset.phase = 'done';
    events.emit('sfx', { id: 'ui_close' });
    this.opts.onBack();
  }

  private finish(): void {
    if (this.state === 'done' || this.disposed) return;
    if (!this.isReady) {
      this.skip();
      return;
    }
    this.state = 'done';
    this.root.dataset.phase = 'done';
    events.emit('sfx', { id: 'ui_choice' });
    this.opts.onDone();
  }

  // -------------------------------------------------------------------------------------------- input

  private onKeyDown(e: KeyboardEvent): void {
    if (e.code === 'Escape') {
      if (!e.repeat) this.back();
      return;
    }
    if (!ACTIVATE_KEYS.has(e.code)) return;
    e.preventDefault(); // one path for every device: no native button click on top of this
    if (e.repeat) return;
    this.press();
  }

  private onKeyUp(e: KeyboardEvent): void {
    if (!ACTIVATE_KEYS.has(e.code)) return;
    e.preventDefault();
    this.release();
  }

  private onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    this.press();
  }

  private pollPad(): void {
    const pad = latestPad();
    const back = padBackHeld(pad);
    if (back && !this.padBackDown) this.back();
    this.padBackDown = back;
    const down = pad?.buttons[PAD_A]?.pressed ?? false;
    if (down && !this.padDown) this.press();
    else if (!down && this.padDown) this.release();
    this.padDown = down;
  }

  private press(): void {
    if (this.state === 'done' || this.pressAt !== null) return;
    this.pressAt = performance.now();
  }

  /** A press shorter than the hold: show the whole text, or play when the prompt is up. */
  private release(): void {
    if (this.pressAt === null) return;
    const held = (performance.now() - this.pressAt) / 1000;
    this.pressAt = null;
    if (held >= HOLD_S || this.state === 'done') return;
    if (this.state === 'prompt') this.finish();
    else if (this.state === 'narration') this.revealAll();
  }

  private cancelHold(): void {
    this.pressAt = null;
  }

  private drawHold(now: number): void {
    const held = this.pressAt === null ? 0 : (now - this.pressAt) / 1000;
    const k = Math.min(1, held / HOLD_S);
    this.ringArc.style.strokeDashoffset = `${RING_LEN * (1 - k)}`;
    this.hold.classList.toggle('is-holding', k > 0);
    if (k >= 1 && this.state !== 'prompt' && this.state !== 'done') {
      this.pressAt = null;
      this.skip();
    }
  }

  // ------------------------------------------------------------------------------------------- helpers

  private refreshPrompt(): void {
    const touch = (services.tryGet('input')?.device ?? 'kbm') === 'touch';
    this.texts.unbind(this.promptLabel);
    this.texts.text(this.promptLabel, touch ? 'ui.opening.tap' : 'ui.opening.click');
  }

  private onLang(): void {
    this.buildLines();
    if (this.state !== 'narration') this.revealAll();
  }

  private listen(target: EventTarget, type: string, fn: (e: Event) => void): void {
    target.addEventListener(type, fn);
    this.offs.push(() => target.removeEventListener(type, fn));
  }
}

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

function padBackHeld(pad: Gamepad | null): boolean {
  return PAD_BACK.some((b) => pad?.buttons[b]?.pressed === true);
}

function latestPad(): Gamepad | null {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return null;
  try {
    let best: Gamepad | null = null;
    for (const p of navigator.getGamepads())
      if (p && p.connected && (!best || p.timestamp > best.timestamp)) best = p;
    return best;
  } catch {
    return null;
  }
}
