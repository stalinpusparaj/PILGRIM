/**
 * Overlay of the `?dialogue=test` demo: a small Hope lantern readout (flame + bar + value, and a "+5" chip when
 * Hope changes), the current language, "Play sample" and the "English | தமிழ்" toggle. The real HUD lantern
 * comes from the HUD module; this one only proves that dialogue effects reach the GameState.
 *
 * Keyboard: Tab / Enter / Space (real buttons). Touch and mouse: tap. Gamepad: `padStep()` (called by the scene
 * while no conversation runs) moves focus with the d-pad or stick and presses with A.
 */
import { events } from '../core/Events';
import { services } from '../core/Services';
import { i18n, t, type Lang } from '../core/I18n';
import type { Input } from '../core/Input';
import { h, setText, setVisible, uiRoot } from '../ui/dom';
import { acquireDemoStyle, releaseDemoStyle } from './dtest-style';

export interface DemoUiHandlers {
  /** "Play sample" pressed. */
  play(): void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
/** How long the Hope change chip stays up (ms). */
const DELTA_MS = 2600;
/** Stick push that counts as one d-pad step. */
const STICK_STEP = 0.6;
/**
 * After a conversation ends the focus comes back to "Play again"; presses within this time (ms) are the player
 * still tapping Space / A through the last line, not a request to start over.
 */
const REPLAY_GRACE_MS = 1200;
const LANG_ORDER = ['en', 'ta'] as const;

export class DemoUi {
  readonly root: HTMLDivElement;
  private readonly flame: SVGPathElement;
  private readonly fill: HTMLDivElement;
  private readonly meter: HTMLDivElement;
  private readonly hopeLabel: HTMLSpanElement;
  private readonly hopeNum: HTMLSpanElement;
  private readonly labelRow: HTMLDivElement;
  private readonly langLine: HTMLDivElement;
  private readonly playBtn: HTMLButtonElement;
  private readonly status: HTMLDivElement;
  private readonly langGroup: HTMLDivElement;
  private readonly langBtns: Record<'en' | 'ta', HTMLButtonElement>;
  private delta: HTMLSpanElement | null = null;
  private deltaTimer: number | null = null;
  private playing = false;
  private played = false;
  private missing = false;
  private hope = 0;
  private stickLatch = 0;
  private graceUntil = 0;
  private disposed = false;

  constructor(
    private readonly handlers: DemoUiHandlers,
    parent: HTMLElement = uiRoot(),
  ) {
    acquireDemoStyle();
    this.flame = svgEl('path', {
      d: 'M17 17 C 21 22, 23 26, 21 30 C 20 33, 14 33, 13 30 C 11 26, 14 22, 17 17 Z',
      class: 'dtest-flame',
      style: 'fill: var(--accent-light); stroke: var(--accent-deep); stroke-width: 1.2',
    });
    this.fill = h('div', { className: 'dtest-meter-fill' });
    this.meter = h(
      'div',
      { className: 'dtest-meter', role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': 100 },
      this.fill,
    );
    this.hopeLabel = h('span');
    this.hopeNum = h('span', { className: 'dtest-hope-num' });
    this.labelRow = h(
      'div',
      { className: 'dtest-hope-label', 'aria-live': 'polite' },
      this.hopeLabel,
      this.hopeNum,
    );
    this.langLine = h('div', { className: 'dtest-lang-line' });
    const readout = h(
      'div',
      { className: 'panel dtest-readout ui-passive' },
      h(
        'div',
        { className: 'dtest-hope' },
        lanternSvg(this.flame),
        h('div', { className: 'dtest-hope-col' }, this.labelRow, this.meter),
      ),
      this.langLine,
    );

    this.playBtn = h('button', {
      type: 'button',
      className: 'btn dtest-play',
      onClick: () => this.pressPlay(),
    });
    this.status = h('div', { className: 'dtest-status ui-passive', role: 'status' });
    this.langBtns = {
      en: this.langButton('en'),
      ta: this.langButton('ta'),
    };
    this.langGroup = h(
      'div',
      { className: 'dtest-langs', role: 'group' },
      this.langBtns.en,
      h('span', { className: 'sep', 'aria-hidden': 'true' }, '|'),
      this.langBtns.ta,
    );
    const actions = h('div', { className: 'dtest-actions' }, this.playBtn, this.status, this.langGroup);
    this.root = h('div', { className: 'dtest-root' }, h('div', { className: 'dtest-bar' }, readout, actions));
    parent.append(this.root);
    this.refresh();
  }

  /** Re-reads every text (call on `lang:changed`). */
  refresh(): void {
    if (this.disposed) return;
    setText(this.hopeLabel, t('ui.hud.hope'));
    this.meter.setAttribute('aria-label', t('ui.hud.hope'));
    const lang = i18n.lang;
    setText(this.langLine, `${t('ui.title.lang.label')}: ${t(`ui.title.lang.${lang}`)}`);
    this.langGroup.setAttribute('aria-label', t('ui.title.lang.label'));
    for (const l of LANG_ORDER) {
      setText(this.langBtns[l], t(`ui.title.lang.${l}`));
      this.langBtns[l].setAttribute('aria-pressed', String(l === lang));
      this.langBtns[l].lang = l;
    }
    setText(this.playBtn, t(this.played ? 'ui.dialogueTest.again' : 'ui.dialogueTest.play'));
    setText(this.status, t(this.missing ? 'ui.dialogueTest.missing' : 'ui.dialogueTest.playing'));
    this.layout();
  }

  /** Shows Hope (0-100); a non-zero `delta` pops a "+5" / "-5" chip by the bar. */
  setHope(value: number, delta = 0): void {
    if (this.disposed) return;
    this.hope = value;
    const f = Math.min(1, Math.max(0, value / 100));
    this.fill.style.transform = `scaleX(${f.toFixed(3)})`;
    this.flame.style.transform = `scale(${(0.35 + 0.65 * f).toFixed(3)})`;
    this.meter.setAttribute('aria-valuenow', String(Math.round(value)));
    setText(this.hopeNum, String(Math.round(value)));
    if (delta !== 0) this.showDelta(delta);
  }

  get hopeShown(): number {
    return this.hope;
  }

  /** While a conversation runs the play button gives way to a "Talking..." status. */
  setPlaying(on: boolean): void {
    if (this.disposed) return;
    if (!on && this.playing) {
      this.played = true;
      this.graceUntil = performance.now() + REPLAY_GRACE_MS;
    }
    this.playing = on;
    this.refresh();
  }

  /** content/dialogue/test.json (or its graph) is not there: the button is replaced by a message. */
  setMissing(): void {
    this.missing = true;
    this.refresh();
  }

  /** Puts the focus on "Play sample" for keyboard and gamepad users (a touch player gets no focus ring). */
  focusPlay(): void {
    if (this.disposed || this.playBtn.hidden) return;
    const device = services.tryGet('input')?.device;
    if (device === 'pad') this.focusEl(this.playBtn);
    else if (device !== 'touch') this.playBtn.focus({ preventScroll: true });
  }

  /** Gamepad focus navigation; call from a fixed step while no conversation owns the pad. */
  padStep(input: Input): void {
    if (this.disposed || input.device !== 'pad') return;
    let dir = 0;
    if (input.pressed('moveLeft') || input.pressed('moveForward')) dir = -1;
    if (input.pressed('moveRight') || input.pressed('moveBack')) dir = 1;
    const x = input.move.x;
    const stick = x > STICK_STEP ? 1 : x < -STICK_STEP ? -1 : 0;
    if (stick !== 0 && stick !== this.stickLatch) dir = stick;
    this.stickLatch = stick;
    const items = this.focusables();
    if (items.length === 0) return;
    const at = items.findIndex((b) => b === document.activeElement);
    if (dir !== 0) {
      const next = at < 0 ? 0 : (at + dir + items.length) % items.length;
      this.focusEl(items[next]!);
      events.emit('sfx', { id: 'ui_click', volume: 0.5 });
    } else if (input.pressed('jump')) {
      if (at < 0) this.focusEl(items[0]!);
      else items[at]!.click();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.deltaTimer !== null) window.clearTimeout(this.deltaTimer);
    this.deltaTimer = null;
    this.root.remove();
    releaseDemoStyle();
  }

  // ---------------------------------------------------------------------------------------------- private

  private layout(): void {
    setVisible(this.playBtn, !this.playing && !this.missing);
    setVisible(this.status, this.playing || this.missing);
    // On a phone the "Talking..." pill gives way (the dialogue panel says it already), keeping the panel clear.
    this.status.classList.toggle('is-playing', this.playing && !this.missing);
  }

  private pressPlay(): void {
    if (this.playing || this.missing || performance.now() < this.graceUntil) return;
    events.emit('sfx', { id: 'ui_click' });
    this.handlers.play();
  }

  private langButton(lang: Lang): HTMLButtonElement {
    return h('button', {
      type: 'button',
      className: 'btn btn-secondary',
      onClick: () => {
        if (i18n.lang === lang) return;
        events.emit('sfx', { id: 'ui_click' });
        i18n.setLang(lang); // persists through Settings and emits lang:changed (the scene calls refresh())
      },
    });
  }

  private focusables(): HTMLButtonElement[] {
    const list = [this.playBtn, this.langBtns.en, this.langBtns.ta];
    return list.filter((b) => !b.hidden && !b.disabled);
  }

  /** Focus that shows its ring even when it did not come from a key (gamepad). */
  private focusEl(el: HTMLButtonElement): void {
    for (const b of this.root.querySelectorAll('.dtest-padfocus')) b.classList.remove('dtest-padfocus');
    el.focus({ preventScroll: true });
    el.classList.add('dtest-padfocus');
    el.addEventListener('blur', () => el.classList.remove('dtest-padfocus'), { once: true });
  }

  private showDelta(delta: number): void {
    this.delta?.remove();
    if (this.deltaTimer !== null) window.clearTimeout(this.deltaTimer);
    const up = delta > 0;
    const chip = h(
      'span',
      { className: `dtest-delta${up ? '' : ' down'}` },
      `${up ? '▲ +' : '▼ '}${Math.round(delta)}`,
    );
    this.labelRow.append(chip);
    this.delta = chip;
    this.deltaTimer = window.setTimeout(() => {
      chip.remove();
      if (this.delta === chip) this.delta = null;
      this.deltaTimer = null;
    }, DELTA_MS);
  }
}

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string>,
  ...children: SVGElement[]
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...children);
  return el;
}

/** A little lantern (our own shapes): handle, cap, glass, the flame passed in, base. */
function lanternSvg(flame: SVGPathElement): SVGSVGElement {
  const ink = 'fill: var(--ink); opacity: 0.85';
  return svgEl(
    'svg',
    { class: 'dtest-lantern', viewBox: '0 0 34 44', 'aria-hidden': 'true', focusable: 'false' },
    svgEl('path', {
      d: 'M11 8 C 11 2, 23 2, 23 8',
      style: 'fill: none; stroke: var(--ink); stroke-width: 2.4; stroke-linecap: round; opacity: 0.85',
    }),
    svgEl('rect', { x: '8', y: '7', width: '18', height: '5', rx: '2', style: ink }),
    svgEl('rect', {
      x: '8.5',
      y: '12',
      width: '17',
      height: '24',
      rx: '4',
      style: 'fill: rgba(255, 232, 163, 0.45); stroke: var(--ink); stroke-width: 2; opacity: 0.95',
    }),
    flame,
    svgEl('rect', { x: '6', y: '36', width: '22', height: '5', rx: '2', style: ink }),
  );
}
