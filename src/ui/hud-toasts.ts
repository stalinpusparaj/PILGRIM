/**
 * Toasts (GDD 2.14): "The Roll is updated", "A Promise!", "Oops! Back on the Way."... Requested with
 * 'hud:toast' {key, params}. One at a time near the top centre, 2.4 s each (in, read, out), in order; a toast
 * already showing or waiting is not queued twice. Each carries a small icon so colour is never the only
 * signal. Timers run in update(dt) and stand still while the HUD is hidden (cutscenes) or the game is paused.
 */
import '../audio/events';
import { events } from '../core/Events';
import { t, type TranslateParams } from '../core/I18n';
import { h, setText } from './dom';
import { badgeSvg, type BadgeIcon } from './hud-icons';

/** Total time on screen per toast, seconds (GDD-pinned by the brief). */
export const TOAST_SECONDS = 2.4;
/** The leave animation starts this long before the end (matches .hud-toast.is-out in hud.css). */
const TOAST_OUT = 0.35;
/** Breath between two toasts, so they read as separate messages. */
const TOAST_GAP = 0.12;
const MAX_WAITING = 6;

type Tone = 'gold' | 'leaf' | 'berry';

interface ToastRequest {
  key: string;
  params: TranslateParams | undefined;
}

/** Icon and rim colour from the toast key. */
function styleOf(key: string): { icon: BadgeIcon; tone: Tone } {
  if (key.startsWith('ui.toast.gift.')) return { icon: 'gift', tone: 'gold' };
  switch (key) {
    case 'ui.toast.promise':
      return { icon: 'scroll', tone: 'gold' };
    case 'ui.toast.rollUpdated':
      return { icon: 'scroll', tone: 'gold' };
    case 'ui.toast.rollFound':
      return { icon: 'scroll', tone: 'leaf' };
    case 'ui.toast.rollGone':
    case 'ui.toast.needRoll':
      return { icon: 'scroll', tone: 'berry' };
    case 'ui.toast.leftWay':
      return { icon: 'sign', tone: 'berry' };
    case 'ui.toast.backOnWay':
      return { icon: 'sign', tone: 'leaf' };
    case 'ui.toast.bonk':
      return { icon: 'dizzy', tone: 'gold' };
    default:
      return { icon: 'star', tone: 'gold' };
  }
}

function sameParams(a: TranslateParams | undefined, b: TranslateParams | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => a[k] === b[k]);
}

export class ToastQueue {
  readonly el: HTMLDivElement;
  private readonly card: HTMLDivElement;
  private readonly icon: HTMLSpanElement;
  private readonly text: HTMLSpanElement;
  private readonly waiting: ToastRequest[] = [];
  private current: ToastRequest | null = null;
  private shownIcon: BadgeIcon | null = null;
  private time = 0;
  private gap = 0;
  private leaving = false;

  constructor() {
    this.icon = h('span', { className: 'hud-toast__icon' });
    this.text = h('span', { className: 'hud-toast__text' });
    this.card = h('div', { className: 'hud-toast' }, this.icon, this.text);
    this.el = h('div', { className: 'hud-toasts', role: 'status', 'aria-live': 'polite' }, this.card);
  }

  push(key: string, params?: TranslateParams): void {
    if (typeof key !== 'string' || key === '') return;
    const same = (r: ToastRequest | null): boolean => !!r && r.key === key && sameParams(r.params, params);
    if (same(this.current) || this.waiting.some(same)) return;
    if (this.waiting.length >= MAX_WAITING) this.waiting.shift();
    this.waiting.push({ key, params: params ? { ...params } : undefined });
  }

  /** `running` is false while the HUD is hidden: the current toast and the queue wait. */
  update(dt: number, running: boolean): void {
    if (!running) return;
    if (!this.current) {
      if (this.gap > 0) {
        this.gap -= dt;
        return;
      }
      const next = this.waiting.shift();
      if (next) this.begin(next);
      return;
    }
    this.time += dt;
    if (!this.leaving && this.time >= TOAST_SECONDS - TOAST_OUT) {
      this.leaving = true;
      this.card.classList.remove('is-in');
      this.card.classList.add('is-out');
    }
    if (this.time >= TOAST_SECONDS) {
      this.current = null;
      this.card.classList.remove('is-out');
      this.gap = TOAST_GAP;
    }
  }

  /** Language changed: re-translate the toast on screen. */
  refreshText(): void {
    if (this.current) setText(this.text, t(this.current.key, this.current.params));
  }

  get active(): boolean {
    return this.current !== null;
  }

  get pending(): number {
    return this.waiting.length;
  }

  clear(): void {
    this.waiting.length = 0;
    this.current = null;
    this.card.classList.remove('is-in', 'is-out');
  }

  private begin(req: ToastRequest): void {
    this.current = req;
    this.time = 0;
    this.leaving = false;
    const { icon, tone } = styleOf(req.key);
    if (icon !== this.shownIcon) {
      this.icon.innerHTML = badgeSvg(icon);
      this.shownIcon = icon;
    }
    this.card.dataset.tone = tone;
    setText(this.text, t(req.key, req.params));
    this.card.classList.remove('is-out');
    this.card.classList.add('is-in');
    events.emit('sfx', { id: 'ui_toast', volume: 0.7 });
  }
}
