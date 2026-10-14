/**
 * Hold-to-skip (GDD 2.6 "Skip line / skip scene: Space / hold Space 1 s"): a small ring in the bottom letterbox
 * bar that fills while Space / pad A (the 'skip' action) or the ring itself (touch, mouse) is held, and drains
 * when let go. A label "Hold to skip" with the device's glyph shows for a few seconds at the start and again
 * after any key or tap, so a child who presses something learns what to do; a short tap never skips.
 */
import { events } from '../core/Events';
import { t } from '../core/I18n';
import { services } from '../core/Services';
import { h, listen } from '../ui/dom';

/** GDD 2.6: hold 1 s. */
export const SKIP_HOLD_SECONDS = 1;
/** How long the label stays after the start or the last key / tap. */
const HINT_SECONDS = 3;
/** The ring drains this many times faster than it fills. */
const DRAIN = 3;
const SVG_NS = 'http://www.w3.org/2000/svg';
const R = 24;
const CIRCUMFERENCE = 2 * Math.PI * R;

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string>,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

export class SkipControl {
  readonly root: HTMLDivElement;
  private readonly ring: HTMLButtonElement;
  private readonly fill: SVGCircleElement;
  private readonly text: HTMLSpanElement;
  private readonly glyph: HTMLSpanElement;
  private readonly offs: Array<() => void> = [];
  private progress = 0;
  private shownProgress = -1;
  private hint = 0;
  private active = false;
  private pointerId: number | null = null;
  /** A screen reader's activation (a click with no pointer behind it) cannot hold: it skips at once. */
  private requested = false;

  constructor(host: HTMLElement) {
    const svg = svgEl('svg', { viewBox: '0 0 56 56', 'aria-hidden': 'true', focusable: 'false' });
    svg.append(
      svgEl('circle', { class: 'pg-cs-skip__track', cx: '28', cy: '28', r: String(R) }),
      (this.fill = svgEl('circle', {
        class: 'pg-cs-skip__fill',
        cx: '28',
        cy: '28',
        r: String(R),
        'stroke-dasharray': CIRCUMFERENCE.toFixed(2),
        'stroke-dashoffset': CIRCUMFERENCE.toFixed(2),
      })),
      // Two forward triangles: "skip ahead".
      svgEl('path', { class: 'pg-cs-skip__icon', d: 'M18 19.5v17l11-8.5zM29 19.5v17l11-8.5z' }),
    );
    this.ring = h('button', { className: 'pg-cs-skip__ring', type: 'button', tabIndex: -1 });
    this.ring.appendChild(svg);
    this.glyph = h('span', { className: 'pg-cs-skip__glyph', 'aria-hidden': 'true' });
    this.text = h('span', {});
    this.root = h(
      'div',
      { className: 'pg-cs-skip', hidden: true },
      h('span', { className: 'pg-cs-skip__label', 'aria-hidden': 'true' }, this.glyph, this.text),
      this.ring,
    );
    host.appendChild(this.root);

    this.offs.push(
      listen(this.ring, 'pointerdown', this.onDown),
      listen(this.ring, 'pointerup', this.onUp),
      listen(this.ring, 'pointercancel', this.onUp),
      listen(this.ring, 'lostpointercapture', this.onUp),
      listen(this.ring, 'contextmenu', (e) => e.preventDefault()),
      listen(this.ring, 'click', (e) => {
        if (e.detail === 0 && this.active) this.requested = true;
      }),
      listen(window, 'keydown', this.onAnyInput, { capture: true, passive: true }),
      listen(window, 'pointerdown', this.onAnyInput, { capture: true, passive: true }),
      events.on('lang:changed', () => this.refreshText()),
      events.on('input:device', () => this.refreshText()),
    );
    this.refreshText();
  }

  /** Shows the ring for a new cutscene (empty, label visible). */
  start(): void {
    this.active = true;
    this.progress = 0;
    this.hint = HINT_SECONDS;
    this.pointerId = null;
    this.requested = false;
    this.refreshText();
    this.root.hidden = false;
    this.paint();
  }

  stop(): void {
    this.active = false;
    this.releasePointer();
    this.root.hidden = true;
    this.root.classList.remove('is-held', 'is-hint');
  }

  /** Fixed step. `keyHeld` = the 'skip' action is held. True once, when a full hold completes. */
  update(dt: number, keyHeld: boolean): boolean {
    if (!this.active) return false;
    if (this.requested) {
      this.requested = false;
      return true;
    }
    const held = keyHeld || this.pointerId !== null;
    if (held) {
      this.progress += dt / SKIP_HOLD_SECONDS;
      this.hint = HINT_SECONDS;
    } else {
      this.progress = Math.max(0, this.progress - (dt * DRAIN) / SKIP_HOLD_SECONDS);
      this.hint = Math.max(0, this.hint - dt);
    }
    this.root.classList.toggle('is-held', held);
    this.root.classList.toggle('is-hint', this.hint > 0);
    if (this.progress >= 1) {
      this.progress = 1;
      this.paint();
      return true;
    }
    this.paint();
    return false;
  }

  dispose(): void {
    for (const off of this.offs.splice(0)) off();
    this.root.remove();
  }

  private paint(): void {
    if (Math.abs(this.progress - this.shownProgress) < 0.002) return;
    this.shownProgress = this.progress;
    this.fill.setAttribute('stroke-dashoffset', ((1 - this.progress) * CIRCUMFERENCE).toFixed(2));
  }

  private refreshText(): void {
    this.text.textContent = t('ui.cutscene.holdToSkip');
    this.ring.setAttribute('aria-label', t('ui.cutscene.skip'));
    const input = services.tryGet('input');
    // Touch players hold the ring itself; keyboard and pad players see their key (built from our constants).
    this.glyph.innerHTML = input && input.device !== 'touch' ? input.glyph('skip') : '';
  }

  private releasePointer(): void {
    if (this.pointerId !== null && this.ring.hasPointerCapture(this.pointerId)) {
      this.ring.releasePointerCapture(this.pointerId);
    }
    this.pointerId = null;
  }

  private readonly onDown = (e: PointerEvent): void => {
    if (!this.active || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    this.pointerId = e.pointerId;
    this.ring.setPointerCapture(e.pointerId);
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (e.pointerId === this.pointerId) this.pointerId = null;
  };

  private readonly onAnyInput = (): void => {
    if (this.active) this.hint = HINT_SECONDS;
  };
}
