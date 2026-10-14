/**
 * The DOM of the conversation panel (src/ui/DialoguePanel.ts): a full-screen layer that catches taps and clicks,
 * the bottom panel (portrait, name tag, typed text, next indicator, up to 3 choice buttons), the hold-to-skip
 * ring button and the small hint shown while a line plays in a world-space bubble instead.
 * Plain DOM, no game logic: the panel calls the setters and gets the player's pointer input through `ViewHandlers`.
 */
import { h } from './dom';
import { t } from '../core/I18n';
import type { PortraitColors } from './Portraits';

export interface ViewHandlers {
  /** A tap or click on the layer or the panel (not on a choice or the skip button). */
  advance(): void;
  /** A choice button was clicked or tapped (its position in the shown list). */
  pick(slot: number): void;
  /** Enter on the panel: confirm the focused choice, or advance. */
  enter(): void;
  /** Tab / Shift+Tab while choices are up: move the highlight by +-1 (focus never leaves the conversation). */
  move(delta: number): void;
  /** The skip button is pressed (true) or let go (false). */
  skipHold(down: boolean): void;
  /** The skip button was activated without a hold (a screen reader's click, Enter on it): skip at once. */
  skipNow(): void;
  /** True when `code` (Enter after a remap) is bound to an Input action the panel reads: Input handles it then. */
  inputOwns(code: string): boolean;
}

export type ViewMode = 'line' | 'bubble' | 'choices';

const SVG_NS = 'http://www.w3.org/2000/svg';
const RING_R = 22;
const RING_LEN = 2 * Math.PI * RING_R;
/** Our own chevron (next) and double chevron (skip) icons, drawn on the 48 grid like src/ui/Svg.ts. */
const NEXT_ICON =
  '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" ' +
  'stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M14 18l10 10 10-10"/></svg>';
const SKIP_ICON_PATH = 'M17 17l8 7-8 7M26 17l8 7-8 7';

export class DialogueView {
  readonly root: HTMLDivElement;
  readonly panel: HTMLDivElement;
  private readonly face: HTMLDivElement;
  private readonly name: HTMLDivElement;
  readonly text: HTMLDivElement;
  private readonly live: HTMLDivElement;
  private readonly kicker: HTMLParagraphElement;
  private readonly choiceBox: HTMLDivElement;
  private readonly next: HTMLDivElement;
  private readonly nextGlyph: HTMLSpanElement;
  private readonly hint: HTMLDivElement;
  private readonly hintGlyph: HTMLSpanElement;
  private readonly hintLabel: HTMLSpanElement;
  private readonly skip: HTMLButtonElement;
  private readonly ring: SVGCircleElement;
  private buttons: HTMLButtonElement[] = [];
  private focused = -1;
  private ringShown = -1;

  constructor(private readonly on: ViewHandlers) {
    this.face = h('div', { className: 'dlg-face', 'aria-hidden': 'true' });
    this.name = h('div', { className: 'dlg-name' });
    this.text = h('div', { className: 'dlg-text', 'aria-hidden': 'true' });
    this.live = h('div', { className: 'sr-only', 'aria-live': 'polite' });
    this.nextGlyph = h('span', { className: 'dlg-glyph' });
    this.next = h('div', { className: 'dlg-next', hidden: true, 'aria-hidden': 'true' }, this.nextGlyph);
    this.next.insertAdjacentHTML('beforeend', NEXT_ICON);
    this.kicker = h('p', { className: 'dlg-kicker', hidden: true });
    this.choiceBox = h('div', { className: 'dlg-choices', role: 'group' });
    this.panel = h(
      'div',
      { className: 'dlg-panel' },
      this.face,
      h('div', { className: 'dlg-body' }, this.name, this.text),
      this.kicker,
      this.choiceBox,
      this.next,
    );
    this.hintGlyph = h('span', { className: 'dlg-glyph' });
    this.hintLabel = h('span', { className: 'dlg-hint__label' });
    this.hint = h('div', { className: 'dlg-hint', 'aria-hidden': 'true' }, this.hintGlyph, this.hintLabel);
    this.hint.insertAdjacentHTML('beforeend', NEXT_ICON);

    const { button, ring } = skipButton();
    this.skip = button;
    this.ring = ring;
    this.root = h(
      'div',
      // Not a modal dialog: lines are announced from the live region, the buttons carry their own labels.
      { className: 'dlg-layer', tabIndex: -1, hidden: true },
      this.panel,
      this.hint,
      this.skip,
      this.live,
    );
    this.relabel();

    this.root.addEventListener('click', () => this.on.advance());
    this.root.addEventListener('keydown', this.onKeyDown);
    // DOM focus moved to a choice some other way (a screen reader, a click): the highlight Enter confirms follows.
    this.choiceBox.addEventListener('focusin', (e) => {
      const slot = this.buttons.indexOf(e.target as HTMLButtonElement);
      if (slot >= 0 && slot !== this.focused) this.focusChoice(slot, false);
    });
    this.skip.addEventListener('click', (e) => {
      e.stopPropagation();
      if (e.detail === 0) this.on.skipNow(); // no pointer behind it: an activation that cannot hold
    });
    this.skip.addEventListener('pointerdown', this.onSkipDown);
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      this.skip.addEventListener(type, this.onSkipUp);
    }
  }

  /** Labels that come from the string tables (also on 'lang:changed'). */
  relabel(): void {
    const hold = t('ui.dialogue.holdSkip');
    this.skip.setAttribute('aria-label', hold);
    this.skip.title = hold;
    this.choiceBox.setAttribute('aria-label', t('ui.dialogue.choose'));
    this.kicker.textContent = t('ui.dialogue.choose');
    this.hintLabel.textContent = t('ui.dialogue.next');
  }

  setOpen(open: boolean): void {
    if (open) {
      this.root.hidden = false;
      void this.root.offsetWidth; // commit the closed state so the fade/slide in runs
      this.root.classList.add('is-open');
    } else {
      this.root.classList.remove('is-open');
      this.root.hidden = true;
      this.clearChoices();
    }
  }

  setMode(mode: ViewMode, choicesOnly = false): void {
    this.root.classList.toggle('is-bubble-line', mode === 'bubble');
    this.panel.classList.toggle('is-choices-only', choicesOnly);
    this.kicker.hidden = !choicesOnly;
  }

  /** Device class on the layer: number badges for keyboard players; touch keeps the pause corner clear. */
  setDevice(device: string): void {
    this.root.classList.toggle('is-kbm', device === 'kbm');
    this.root.classList.toggle('is-touch', device === 'touch');
  }

  setSpeaker(name: string, portrait: string | null, colors: PortraitColors, isPlayer: boolean): void {
    this.panel.classList.toggle('is-player', isPlayer);
    this.name.textContent = name;
    this.name.hidden = name === '';
    this.face.classList.toggle('has-image', portrait !== null);
    this.face.style.backgroundImage = portrait ? `url("${portrait}")` : '';
    this.face.style.backgroundColor = portrait ? '' : colors.outer;
    this.face.style.border = portrait ? '' : `3px solid ${colors.rim}`;
    this.face.textContent = portrait ? '' : (Array.from(name)[0] ?? '');
  }

  /** The whole line for screen readers (the typing text itself is hidden from them). */
  announce(text: string): void {
    this.live.textContent = text;
  }

  setNext(visible: boolean, glyph: string): void {
    this.next.hidden = !visible;
    this.hint.classList.toggle('is-ready', visible);
    if (this.nextGlyph.innerHTML !== glyph) {
      this.nextGlyph.innerHTML = glyph; // Input.glyph(): markup from our own constants
      this.hintGlyph.innerHTML = glyph;
    }
  }

  setChoices(labels: readonly string[]): void {
    this.clearChoices();
    this.buttons = labels.map((label, slot) => {
      const b = h(
        'button',
        { className: 'btn dlg-choice', type: 'button' },
        h('span', { className: 'dlg-choice__num', 'aria-hidden': 'true' }, String(slot + 1)),
        h('span', { className: 'dlg-choice__label' }, label),
      );
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.on.pick(slot);
      });
      return b;
    });
    this.choiceBox.replaceChildren(...this.buttons);
    this.panel.classList.toggle('has-choices', this.buttons.length > 0);
    this.reveal(this.choiceBox, this.text); // the question stays in view above its answers
  }

  relabelChoices(labels: readonly string[]): void {
    this.buttons.forEach((b, i) => {
      const label = b.querySelector('.dlg-choice__label');
      if (label && labels[i] !== undefined) label.textContent = labels[i];
    });
  }

  clearChoices(): void {
    this.buttons = [];
    this.focused = -1;
    this.choiceBox.replaceChildren();
    this.panel.classList.remove('has-choices');
  }

  get choiceCount(): number {
    return this.buttons.length;
  }

  get focusedChoice(): number {
    return this.focused;
  }

  /** Moves the highlight (and DOM focus, for screen readers) to a choice; -1 clears it. */
  focusChoice(slot: number, domFocus: boolean): void {
    this.focused = slot >= 0 && slot < this.buttons.length ? slot : -1;
    this.buttons.forEach((b, i) => b.classList.toggle('is-focused', i === this.focused));
    const b = this.buttons[this.focused];
    if (!b) return;
    if (domFocus) b.focus({ preventScroll: true });
    this.reveal(b);
  }

  /**
   * Scrolls the panel (only it: never the page) so `el` is in view, when long text made the panel scroll, but
   * never past the top of `keep` when it is shown (choices appearing must not push their question out of view;
   * a focused choice is then revealed on its own).
   */
  private reveal(el: HTMLElement, keep: HTMLElement | null = null): void {
    const p = this.panel;
    if (p.scrollHeight <= p.clientHeight) return;
    const margin = 10;
    const top = el.offsetTop - margin;
    const bottom = el.offsetTop + el.offsetHeight + margin;
    let want = p.scrollTop;
    if (bottom > p.scrollTop + p.clientHeight) want = Math.min(top, bottom - p.clientHeight);
    else if (top < p.scrollTop) want = top;
    if (keep?.offsetParent) want = Math.min(want, keep.offsetTop - margin);
    p.scrollTop = Math.max(0, want);
  }

  /** Hold-to-skip progress 0..1; `enabled` false hides the button (choices are up). */
  setSkip(progress: number, enabled: boolean, holding: boolean): void {
    this.skip.setAttribute('aria-disabled', enabled ? 'false' : 'true');
    this.skip.classList.toggle('is-holding', holding);
    const p = Math.round(Math.max(0, Math.min(1, progress)) * 100);
    if (p === this.ringShown) return;
    this.ringShown = p;
    this.ring.style.strokeDashoffset = String(RING_LEN * (1 - p / 100));
  }

  dispose(): void {
    this.root.removeEventListener('keydown', this.onKeyDown);
    this.root.remove();
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Tab') {
      // Focus stays in the conversation (never on a page button behind it): Tab walks the choices with the
      // highlight, or between the layer and the skip button while a line plays.
      e.preventDefault();
      if (this.buttons.length) this.on.move(e.shiftKey ? -1 : 1);
      else if (e.target === this.skip) this.root.focus({ preventScroll: true });
      else if (this.skip.getAttribute('aria-disabled') !== 'true') this.skip.focus({ preventScroll: true });
      return;
    }
    if (e.code !== 'Enter' && e.code !== 'NumpadEnter' && e.code !== 'Space') return;
    // Space and Enter must not click a focused button natively: Input's 'skip' and our Enter handle them, so a
    // choice is never picked twice (and a quick tap never also skips the next line). An Enter remapped to Skip
    // or Use is Input's alone, else one press would reveal a line and leave it.
    e.preventDefault();
    if (e.code === 'Space' || e.repeat || this.on.inputOwns(e.code)) return;
    if (e.target === this.skip) this.on.skipNow();
    else this.on.enter();
  };

  private readonly onSkipDown = (e: PointerEvent): void => {
    e.stopPropagation();
    if (e.button !== 0) return;
    try {
      this.skip.setPointerCapture(e.pointerId);
    } catch {
      // capture is best effort (the pointer may already be gone)
    }
    this.on.skipHold(true);
  };

  private readonly onSkipUp = (): void => this.on.skipHold(false);
}

function skipButton(): { button: HTMLButtonElement; ring: SVGCircleElement } {
  const button = h('button', { className: 'dlg-skip', type: 'button' });
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 48 48');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const circle = (cls: string): SVGCircleElement => {
    const c = document.createElementNS(SVG_NS, 'circle');
    c.setAttribute('class', cls);
    c.setAttribute('cx', '24');
    c.setAttribute('cy', '24');
    c.setAttribute('r', String(RING_R));
    c.setAttribute('fill', 'none');
    c.setAttribute('stroke-width', '4');
    return c;
  };
  const track = circle('dlg-ring-track');
  const ring = circle('dlg-ring');
  ring.setAttribute('stroke-linecap', 'round');
  ring.setAttribute('transform', 'rotate(-90 24 24)');
  ring.style.strokeDasharray = String(RING_LEN);
  ring.style.strokeDashoffset = String(RING_LEN);
  const arrows = document.createElementNS(SVG_NS, 'path');
  arrows.setAttribute('d', SKIP_ICON_PATH);
  arrows.setAttribute('fill', 'none');
  arrows.setAttribute('stroke', 'currentColor');
  arrows.setAttribute('stroke-width', '4');
  arrows.setAttribute('stroke-linecap', 'round');
  arrows.setAttribute('stroke-linejoin', 'round');
  svg.append(track, ring, arrows);
  button.appendChild(svg);
  return { button, ring };
}
