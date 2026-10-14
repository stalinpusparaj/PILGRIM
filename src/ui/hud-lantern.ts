/**
 * The Hope lantern (GDD 2.7.2, 2.14 HUD bottom-left) and the hearts row under it (GDD 2.7.7, Chapter VIII).
 *
 * No numbers: Hope 0..100 only sets two CSS variables, --flame (flame size) and --glow (glass and halo), and
 * CSS eases between them; the flame flickers with a CSS animation. A rise gives a gentle pulse, a fall a little
 * shiver. Slow zone drains change Hope a hair every step, so rises and falls are accumulated with a decay and a
 * cooldown: a drip of drain never makes the lantern shiver nonstop, a bonk or a waystone always shows.
 */
import { t } from '../core/I18n';
import { h, setVisible } from './dom';
import { heartSvg, lanternSvg } from './hud-icons';

/** Below this, Hope reads as low (GDD 2.7.2): a smaller, redder, more nervous flame. */
const LOW_HOPE = 30;
/** Flame scale and glow at Hope 0 (they grow linearly to 1 at Hope 100). */
const FLAME_MIN = 0.26;
const GLOW_MIN = 0.1;
/** Rewrite the CSS variables only when Hope moved this much; the CSS transition hides the steps. */
const WRITE_STEP = 0.4;
/** Accumulated rise / fall (Hope points) that triggers a pulse / shiver, the decay per second, the cooldown. */
const RISE_TRIGGER = 2;
const FALL_TRIGGER = 2.5;
const ACC_DECAY = 1.5;
const REACT_COOLDOWN = 1.1;
const MAX_HEARTS = 10;

type HeartState = 'full' | 'half' | 'empty';
const HEART_RANK: Record<HeartState, number> = { empty: 0, half: 1, full: 2 };

export class HopeLantern {
  readonly el: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly heartsRow: HTMLDivElement;
  private readonly hearts: HTMLSpanElement[] = [];
  private hope = 100;
  private written = Number.NaN;
  private riseAcc = 0;
  private fallAcc = 0;
  private cooldown = 0;
  private pulseFlip = false;
  private shiverFlip = false;
  private heartsValue: number | null = null;
  private heartsMax = 5;

  constructor(hope: number) {
    this.body = h('div', { className: 'hud-lantern__body', role: 'img', 'aria-label': t('ui.hud.hope') });
    const halo = h('div', { className: 'hud-lantern__halo' });
    const art = h('div', { className: 'hud-lantern__art' });
    art.innerHTML = lanternSvg();
    this.body.append(halo, art);
    this.heartsRow = h('div', { className: 'hud-hearts', role: 'img' });
    this.heartsRow.hidden = true;
    this.el = h('div', { className: 'hud-lantern' }, this.body, this.heartsRow);
    this.setHope(hope, 0);
  }

  /** New Hope value; `delta` is the change that caused it (0 for a silent reset). */
  setHope(value: number, delta: number): void {
    this.hope = Math.max(0, Math.min(100, value));
    if (delta > 0) this.riseAcc += delta;
    else if (delta < 0) this.fallAcc -= delta;
    const atEnd = this.hope === 0 || this.hope === 100;
    if (!(Math.abs(this.hope - this.written) < WRITE_STEP) || (atEnd && this.hope !== this.written)) {
      this.written = this.hope;
      const k = this.hope / 100;
      this.el.style.setProperty('--flame', (FLAME_MIN + (1 - FLAME_MIN) * k).toFixed(3));
      this.el.style.setProperty('--glow', (GLOW_MIN + (1 - GLOW_MIN) * k).toFixed(3));
    }
    this.el.classList.toggle('is-low', this.hope < LOW_HOPE);
    this.el.classList.toggle('is-empty', this.hope <= 0);
  }

  get value(): number {
    return this.hope;
  }

  update(dt: number): void {
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.cooldown <= 0) {
      if (this.riseAcc >= RISE_TRIGGER) this.react('pulse');
      else if (this.fallAcc >= FALL_TRIGGER) this.react('shiver');
    }
    const decay = Math.exp(-ACC_DECAY * dt);
    this.riseAcc *= decay;
    this.fallAcc *= decay;
  }

  /**
   * Hearts row under the lantern (Chapter VIII). `n` may be fractional: x.5 draws a half heart (the
   * breastplate halves Apollyon's hits, GDD 2.7.6). null hides the row.
   */
  setHearts(n: number | null, max = 5): void {
    if (n === null || !Number.isFinite(n)) {
      this.heartsValue = null;
      setVisible(this.heartsRow, false);
      return;
    }
    const total = Math.max(1, Math.min(MAX_HEARTS, Math.round(max)));
    const value = Math.max(0, Math.min(total, Math.round(n * 2) / 2));
    if (total !== this.hearts.length) this.buildHearts(total);
    const wasShown = this.heartsValue !== null;
    for (let i = 0; i < total; i++) {
      const el = this.hearts[i]!;
      const next: HeartState = value >= i + 1 ? 'full' : value >= i + 0.5 ? 'half' : 'empty';
      const prev = el.dataset.state as HeartState | undefined;
      if (prev === next) continue;
      el.dataset.state = next;
      if (wasShown && prev) this.flipClass(el, HEART_RANK[next] < HEART_RANK[prev] ? 'lost' : 'gain');
    }
    this.heartsValue = value;
    this.heartsMax = total;
    this.labelHearts();
    setVisible(this.heartsRow, true);
  }

  /** Language changed. */
  refreshText(): void {
    this.body.setAttribute('aria-label', t('ui.hud.hope'));
    if (this.heartsValue !== null) this.labelHearts();
  }

  private buildHearts(total: number): void {
    for (const el of this.hearts) el.remove();
    this.hearts.length = 0;
    for (let i = 0; i < total; i++) {
      const el = h('span', { className: 'hud-heart' });
      el.innerHTML = heartSvg();
      this.hearts.push(el);
      this.heartsRow.appendChild(el);
    }
  }

  private labelHearts(): void {
    const label = t('ui.hud.heartsCount', { n: this.heartsValue ?? 0, max: this.heartsMax });
    this.heartsRow.setAttribute('aria-label', label);
  }

  private react(kind: 'pulse' | 'shiver'): void {
    this.cooldown = REACT_COOLDOWN;
    if (kind === 'pulse') {
      this.riseAcc = 0;
      this.pulseFlip = !this.pulseFlip;
      this.swap(this.body, this.pulseFlip ? 'pulse-a' : 'pulse-b', this.pulseFlip ? 'pulse-b' : 'pulse-a');
    } else {
      this.fallAcc = 0;
      this.shiverFlip = !this.shiverFlip;
      this.swap(
        this.body,
        this.shiverFlip ? 'shiver-a' : 'shiver-b',
        this.shiverFlip ? 'shiver-b' : 'shiver-a',
      );
    }
  }

  /** Restarts a one-shot CSS animation by alternating between two identical keyframe classes. */
  private flipClass(el: HTMLElement, base: 'lost' | 'gain'): void {
    const a = `${base}-a`;
    const b = `${base}-b`;
    if (el.classList.contains(a)) this.swap(el, b, a);
    else this.swap(el, a, b);
    el.classList.remove(base === 'lost' ? 'gain-a' : 'lost-a', base === 'lost' ? 'gain-b' : 'lost-b');
  }

  private swap(el: HTMLElement, add: string, remove: string): void {
    el.classList.remove(remove);
    el.classList.add(add);
  }
}
