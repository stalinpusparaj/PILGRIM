/**
 * The conversation UI (GDD 2.8 "a bottom panel with portrait icon for conversations with choices (max 3)"):
 * listens to the DialogueRunner's events (protocol in src/narrative/DialogueTypes.ts) and calls it back.
 *
 * - 'dialogue:line' with `bubble: false` shows the bottom panel: a generated portrait (src/ui/Portraits.ts), the
 *   speaker's name (`name.<recipeId>`), the line typed at `line.cps` with its babble (typewriter + speakLine) and a
 *   'next' indicator once it is shown. `bubble: true` lines go to the 'bubbles' service over the speaker's head
 *   (when the speaker's Character is known, else the panel shows them); the panel box steps aside but the input
 *   and the hint stay.
 * - When a line is fully shown the panel calls runner.lineDone(); 'dialogue:choices' shows 1-3 big buttons.
 * - Input (dialogue-input.ts): Space / E / A or a tap finish the typing, a second press moves on
 *   (runner.skipLine()); holding Space / A, or the skip button, for 1 s calls runner.skipScene(); choices by
 *   1 / 2 / 3, click, tap, or arrows / d-pad / stick + Enter / E / Space / A.
 * - While a conversation runs, gameplay input is off (Input.setGameplayActive(false): free mouse for the choices,
 *   touch controls hidden, `setTouchButtons([])`) and switched back on at the end when a play session runs
 *   (option `restoreGameplay` overrides) and no cutscene is still playing (story-input.ts), like cutscenes.
 * - Keyboard focus stays in the layer: Tab / Shift+Tab move the choice highlight, which also follows DOM focus.
 * - Screen readers hear each line once with its speaker's name (bubble lines too: the bubble stays silent).
 * - Follows 'lang:changed' (text, name, choices re-rendered) and the input device (glyphs, number badges).
 *
 *   const panel = new DialoguePanel(runner, { actor: (s) => world.npcs.get(s) ?? null });
 *   ...
 *   panel.dispose();
 */
import { events } from '../core/Events';
import { services } from '../core/Services';
import { t } from '../core/I18n';
import type { TouchButton } from '../core/Input';
import type { Character } from '../gen/CharacterFactory';
import type { DialogueRunner } from '../narrative/Dialogue';
import type { DialogueChoiceView, DialogueChoicesEvent, DialogueLine } from '../narrative/DialogueTypes';
import { PLAYER_SPEAKER } from '../narrative/dialogue-rules';
import { speakLine } from '../narrative/dialogue-voice';
import { cutsceneHoldsInput } from '../narrative/story-input';
import type { BubbleHandle } from '../narrative/SpeechBubbles';
import '../audio/events';
import { uiRoot } from './dom';
import { DialogueView } from './dialogue-view';
import { DialogueInput } from './dialogue-input';
import { speakerName } from './dialogue-strings';
import { portraitColors, portraitUrl } from './Portraits';
import { typewrite, type TypewriterController } from './typewriter';
import './dialogue.css';

export interface DialoguePanelOptions {
  parent?: HTMLElement;
  /** The Character for a speaker id, for bubble lines. Default: the runner's own host lookup (runner.actor). */
  actor?: (speaker: string) => Character | null;
  /**
   * Switch gameplay input back on when a conversation ends. Default: when a play session is running (the
   * 'player' service is registered); title screens, demos and other menu-like scenes stay as they are.
   */
  restoreGameplay?: boolean;
  /** Touch buttons to show again after a conversation (Input has no getter; default jump + use). */
  touchButtonsAfter?: TouchButton[];
}

/** Loop order of the panel's input system: before gameplay systems read the same presses. */
const INPUT_ORDER = -50;
const DEFAULT_TOUCH: TouchButton[] = ['jump', 'use'];

interface Current {
  line: DialogueLine;
  tw: TypewriterController | null;
  bubble: BubbleHandle | null;
  shown: boolean;
  choices: DialogueChoiceView[];
}

export class DialoguePanel {
  private readonly view: DialogueView;
  private readonly input: DialogueInput;
  private readonly offs: Array<() => void> = [];
  private removeSystem: (() => void) | null = null;
  private current: Current | null = null;
  private open = false;
  private returnFocus: HTMLElement | null = null;
  private disposed = false;

  constructor(
    private readonly runnerRef: DialogueRunner | null = null,
    private readonly opts: DialoguePanelOptions = {},
  ) {
    this.view = new DialogueView({
      advance: () => this.advance(),
      pick: (slot) => {
        if (!this.input.choicesArming) this.pick(slot);
      },
      enter: () => (this.current?.choices.length ? this.confirm() : this.advance()),
      move: (d) => this.moveFocus(d),
      skipHold: (down) => (this.input.pointerHold = down),
      skipNow: () => {
        if (this.inputMode() === 'lines') this.runner()?.skipScene();
      },
      inputOwns: (code) => {
        const input = services.tryGet('input');
        return (
          !!input && (input.getBindings('skip').includes(code) || input.getBindings('use').includes(code))
        );
      },
    });
    (opts.parent ?? uiRoot()).appendChild(this.view.root);
    this.input = new DialogueInput({
      mode: () => this.inputMode(),
      advance: () => this.advance(),
      pick: (slot) => this.pick(slot),
      confirm: () => this.confirm(),
      move: (d) => this.moveFocus(d),
      hold: (p, holding) => this.view.setSkip(p, this.inputMode() === 'lines', holding),
      skipScene: () => this.runner()?.skipScene(),
    });
    this.offs.push(
      events.on('dialogue:start', () => this.onStart()),
      events.on('dialogue:line', (line) => this.onLine(line)),
      events.on('dialogue:reveal', () => this.onReveal()),
      events.on('dialogue:choices', (e) => this.onChoices(e)),
      events.on('dialogue:lineEnd', () => this.onLineEnd()),
      events.on('dialogue:end', () => this.onEnd()),
      events.on('lang:changed', () => this.relabel()),
      events.on('input:device', ({ device }) => this.onDevice(device)),
    );
    // A panel created mid-conversation picks up what is on screen.
    const r = this.runner();
    if (r?.active) {
      this.onStart();
      if (r.line) this.onLine(r.line);
      if (r.phase === 'choosing') this.showChoices(r.choices);
    }
  }

  /** True while a conversation is on screen. */
  get visible(): boolean {
    return this.open;
  }

  dispose(): void {
    if (this.disposed) return;
    if (this.open) this.close();
    this.disposed = true;
    for (const off of this.offs.splice(0)) off();
    this.view.dispose();
  }

  // ------------------------------------------------------------------------------------------- events

  private runner(): DialogueRunner | null {
    return this.runnerRef ?? services.tryGet('dialogue') ?? null;
  }

  private onStart(): void {
    if (this.open || this.disposed) return;
    this.open = true;
    const input = services.tryGet('input');
    input?.setTouchButtons([]);
    input?.setGameplayActive(false);
    const active = document.activeElement;
    this.returnFocus = active instanceof HTMLElement && active !== document.body ? active : null;
    this.onDevice(input?.device ?? 'kbm');
    this.view.setMode('line');
    this.view.setOpen(true);
    this.keepFocus();
    const loop = services.tryGet('engine')?.loop;
    this.removeSystem = loop ? loop.add(this.input, INPUT_ORDER) : null;
  }

  private onLine(line: DialogueLine): void {
    if (!this.open) this.onStart();
    this.endLine();
    const cur: Current = { line, tw: null, bubble: null, shown: false, choices: [] };
    this.current = cur;
    const text = t(line.key);
    const name = speakerName(line.recipe ?? line.speaker);
    this.view.announce(name ? `${name}: ${text}` : text);
    this.view.setNext(false, this.glyph());
    this.view.clearChoices();
    this.keepFocus();
    const onShown = (): void => {
      if (this.current === cur) this.markShown(cur);
    };

    const actor = line.bubble ? this.actorFor(line.speaker) : null;
    const bubbles = services.tryGet('bubbles');
    if (actor && bubbles) {
      this.view.setMode('bubble');
      cur.bubble = bubbles.speak(actor, line.key, {
        mood: line.mood,
        durationSec: Infinity,
        cps: line.cps,
        voice: line.voice,
        speak: (spoken, _cps, at) => speakLine(line, spoken, at),
        talk: false, // the runner flaps the speaker's mouth until lineDone()
        announce: false, // the panel's live region already says it, with the speaker's name
        onRevealed: onShown,
      });
      return;
    }
    this.view.setMode('line');
    const recipe = line.recipe ?? line.speaker;
    this.view.setSpeaker(
      name,
      portraitUrl(recipe, line.expr ?? undefined),
      portraitColors(recipe),
      line.speaker === PLAYER_SPEAKER,
    );
    cur.tw = typewrite(this.view.text, text, {
      cps: line.cps,
      mood: line.mood,
      speak: (spoken) => speakLine(line, spoken),
    });
    void cur.tw.done.then(onShown);
  }

  private onReveal(): void {
    const cur = this.current;
    if (!cur) return;
    cur.tw?.skip();
    cur.bubble?.skip();
  }

  private onChoices(e: DialogueChoicesEvent): void {
    if (!this.open) return;
    this.showChoices(e.choices);
  }

  private showChoices(choices: DialogueChoiceView[]): void {
    const cur = this.current;
    if (!cur) return;
    cur.choices = choices;
    const bubbleLine = cur.bubble !== null;
    this.view.setNext(false, '');
    this.view.setMode('choices', bubbleLine);
    this.view.setChoices(choices.map((c) => t(c.key)));
    const device = services.tryGet('input')?.device ?? 'kbm';
    this.view.focusChoice(device === 'touch' ? -1 : 0, device !== 'touch');
  }

  private onLineEnd(): void {
    this.endLine();
    this.view.setNext(false, '');
    this.view.clearChoices();
  }

  private onEnd(): void {
    if (this.open) this.close();
  }

  // ------------------------------------------------------------------------------------------- actions

  private inputMode(): 'lines' | 'choices' | null {
    const cur = this.current;
    if (!this.open || !cur) return null;
    return cur.choices.length > 0 ? 'choices' : 'lines';
  }

  /** Space / E / A / tap on a line: finish the typing, or move on. */
  private advance(): void {
    const cur = this.current;
    if (!cur || cur.choices.length > 0) return;
    this.runner()?.skipLine();
  }

  private pick(slot: number): void {
    const cur = this.current;
    const choice = cur?.choices[slot];
    if (!cur || !choice) return;
    cur.choices = []; // never twice
    this.view.focusChoice(-1, false);
    events.emit('sfx', { id: 'ui_choice' });
    this.runner()?.choose(choice.index);
  }

  private confirm(): void {
    const cur = this.current;
    if (!cur || cur.choices.length === 0) return;
    const slot = this.view.focusedChoice;
    if (slot < 0) {
      this.view.focusChoice(0, true); // first press only shows where the highlight is
      return;
    }
    this.pick(slot);
  }

  private moveFocus(delta: number): void {
    const n = this.view.choiceCount;
    if (n === 0) return;
    const from = this.view.focusedChoice;
    const next = from < 0 ? (delta > 0 ? 0 : n - 1) : (from + delta + n) % n;
    this.view.focusChoice(next, true);
    events.emit('sfx', { id: 'ui_click' });
  }

  // ------------------------------------------------------------------------------------------- helpers

  /** Stops the current line's typing and bubble (the runner moved on). */
  private endLine(): void {
    const cur = this.current;
    if (!cur) return;
    this.current = null;
    cur.tw?.cancel();
    cur.bubble?.dismiss();
  }

  private close(): void {
    this.endLine();
    this.open = false;
    this.removeSystem?.();
    this.removeSystem = null;
    this.input.pointerHold = false;
    this.view.setSkip(0, false, false);
    this.view.setOpen(false);
    const input = services.tryGet('input');
    input?.setTouchButtons(this.opts.touchButtonsAfter ?? DEFAULT_TOUCH);
    // A cutscene still playing keeps the input (it gives it back when it ends).
    if ((this.opts.restoreGameplay ?? inPlaySession()) && !cutsceneHoldsInput())
      input?.setGameplayActive(true);
    const back = this.returnFocus;
    this.returnFocus = null;
    if (back?.isConnected) back.focus({ preventScroll: true });
    else if (this.view.root.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
  }

  private actorFor(speaker: string): Character | null {
    if (this.opts.actor) return this.opts.actor(speaker);
    return this.runner()?.actor(speaker) ?? null; // the runner's host lookup
  }

  /** Keyboard and pad players keep the focus inside the layer (Enter works; a stray page button never gets Space). */
  private keepFocus(): void {
    if (services.tryGet('input')?.device === 'touch') return;
    if (!this.view.root.contains(document.activeElement)) this.view.root.focus({ preventScroll: true });
  }

  private glyph(): string {
    const input = services.tryGet('input');
    if (!input || input.device === 'touch') return '';
    return input.glyph('skip');
  }

  private onDevice(device: string): void {
    this.view.setDevice(device);
    const cur = this.current;
    if (cur?.shown && !cur.line.hasChoices) this.view.setNext(true, this.glyph());
  }

  /** New language: the line, the name and the choices show in it at once (no second voice). */
  private relabel(): void {
    this.view.relabel();
    const cur = this.current;
    if (!cur) return;
    const text = t(cur.line.key);
    const name = speakerName(cur.line.recipe ?? cur.line.speaker);
    this.view.announce(name ? `${name}: ${text}` : text);
    if (cur.tw) {
      cur.tw.cancel();
      cur.tw = typewrite(this.view.text, text, { cps: 0 });
      if (!cur.shown) {
        void cur.tw.done.then(() => {
          if (this.current === cur) this.markShown(cur);
        });
      }
      const recipe = cur.line.recipe ?? cur.line.speaker;
      const portrait = portraitUrl(recipe, cur.line.expr ?? undefined);
      this.view.setSpeaker(name, portrait, portraitColors(recipe), cur.line.speaker === PLAYER_SPEAKER);
    }
    if (cur.choices.length) this.view.relabelChoices(cur.choices.map((c) => t(c.key)));
    this.view.setNext(cur.shown && !cur.line.hasChoices, this.glyph());
  }

  /** The whole line is shown: the next indicator appears and the runner hears it (choices follow at once). */
  private markShown(cur: Current): void {
    if (cur.shown) return;
    cur.shown = true;
    if (!cur.line.hasChoices) this.view.setNext(true, this.glyph());
    this.runner()?.lineDone(); // emits 'dialogue:choices' synchronously when the line has some
  }
}

/** A gameplay session is running (Phase 2's Player registers the 'player' service; not typed in this module). */
function inPlaySession(): boolean {
  return (services as unknown as { has(key: string): boolean }).has('player');
}
