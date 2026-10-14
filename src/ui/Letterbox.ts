/**
 * Cinematic letterbox (GDD 2.5 "Cutscenes: ... letterbox bars"): two dark bars that slide in from the top and
 * bottom in 0.4 s (instantly with Reduce camera motion or the OS reduce-motion setting). Registered as the
 * 'letterbox' service; cutscenes and dialogue cuts share one.
 *
 *   const lb = services.tryGet('letterbox') ?? new Letterbox();
 *   lb.show(true);   // slide in
 *   lb.show(false);  // slide out; the bars are removed from layout once they are gone
 *
 * `bottom` is the lower bar's element: cutscene UI (the hold-to-skip ring, captions) mounts inside it so it
 * slides with the bar. The bars never take pointer input themselves.
 */
import './letterbox.css';
import { services } from '../core/Services';
import { h, uiRoot } from './dom';

declare module '../core/Services' {
  interface ServiceMap {
    letterbox: Letterbox;
  }
}

/** Slide time; matches the transition in letterbox.css. */
export const LETTERBOX_SLIDE_MS = 400;

/** Settings > Reduce camera motion, or the OS reduce-motion preference. */
export function reducedMotion(): boolean {
  if (services.tryGet('settings')?.data.reduceMotion === true) return true;
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export class Letterbox {
  readonly root: HTMLDivElement;
  readonly top: HTMLDivElement;
  readonly bottom: HTMLDivElement;
  private on = false;
  private hideTimer: number | null = null;
  private disposed = false;

  constructor(parent: HTMLElement = uiRoot()) {
    this.top = h('div', { className: 'pg-letterbox__bar pg-letterbox__bar--top' });
    this.bottom = h('div', { className: 'pg-letterbox__bar pg-letterbox__bar--bottom' });
    this.root = h('div', { className: 'pg-letterbox', hidden: true }, this.top, this.bottom);
    parent.appendChild(this.root);
    if (!services.has('letterbox')) services.register('letterbox', this);
  }

  /** True while the bars are in (or sliding in). */
  get shown(): boolean {
    return this.on;
  }

  show(on: boolean, opts?: { instant?: boolean }): void {
    if (this.disposed || on === this.on) return;
    this.on = on;
    const instant = opts?.instant === true || reducedMotion();
    this.root.classList.toggle('is-instant', instant);
    this.clearTimer();
    if (on) {
      this.root.hidden = false;
      // Lay the bars out off-screen first, so adding the class slides them in instead of popping.
      if (!instant) void this.root.getBoundingClientRect();
      this.root.classList.add('is-on');
      return;
    }
    this.root.classList.remove('is-on');
    if (instant) this.root.hidden = true;
    else {
      // A timer, not transitionend: hidden tabs and reduce-motion may never fire it.
      this.hideTimer = window.setTimeout(() => {
        this.hideTimer = null;
        if (!this.on) this.root.hidden = true;
      }, LETTERBOX_SLIDE_MS + 40);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearTimer();
    this.root.remove();
    if (services.tryGet('letterbox') === this) services.unregister('letterbox');
  }

  private clearTimer(): void {
    if (this.hideTimer !== null) window.clearTimeout(this.hideTimer);
    this.hideTimer = null;
  }
}
