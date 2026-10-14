/**
 * UI juice: sparkle bursts, soft edge vignettes, HUD jolts, button squash and the title's light motes
 * (juice.css). Everything is generated DOM and CSS (GDD 2.3); no new text. Listens to game events only, so
 * no system has to know it exists; `installJuice()` once at boot, the returned function removes it all.
 * Reduce motion (Settings or the OS) spawns nothing: the CSS animations are already instant then.
 */
import './juice.css';
import { events } from '../core/Events';
import { h, uiRoot } from './dom';
// The event payloads ('player:bonk', 'gift:given', 'flow:state'...) are declared by their own modules; tsc sees
// every file in src, so no import is needed to type them here (and none would be: this file must stay light).

type Tone = 'gold' | 'leaf' | 'berry' | 'white';

const GOLD = ['#ffd27a', '#f2b33d', '#fff2c2', '#ffffff'];
const LEAF = ['#9ed26a', '#5aa25a', '#fff2c2', '#ffe8a3'];
const BERRY = ['#d8574a', '#ffb07a', '#fff2c2'];
const MAX_SPARKS = 160;
const MOTES = 16;

/** Point on screen (CSS px) to burst from; null = the middle of the screen. */
interface Point { x: number; y: number }

function reduceMotion(): boolean {
  if (document.body.classList.contains('reduce-motion')) return true;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Centre of the first element matching `sel`, or null. */
function centerOf(sel: string): Point | null {
  const el = document.querySelector(sel);
  if (!(el instanceof HTMLElement)) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function screenCenter(): Point {
  return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}

export class Juice {
  private readonly vignette: HTMLDivElement;
  private readonly sparks: HTMLDivElement;
  private motes: HTMLDivElement | null = null;
  private flip = false;
  private hudFlip = false;
  private btnFlip = false;
  private seed = 1234567;
  private disposed = false;
  private readonly offs: Array<() => void> = [];

  constructor(private readonly parent: HTMLElement = uiRoot()) {
    this.vignette = h('div', { className: 'pg-vignette', 'aria-hidden': 'true' });
    this.sparks = h('div', { className: 'pg-sparks', 'aria-hidden': 'true' });
    parent.append(this.vignette, this.sparks);
    this.listen();
  }

  private rnd(): number {
    // mulberry32, so bursts need no Math.random (deterministic in tests)
    this.seed = (this.seed + 0x6d2b79f5) | 0;
    let t = this.seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  private listen(): void {
    const on = events.on.bind(events);
    this.offs.push(
      on('promise:collected', () => {
        this.vignetteFlash('gold');
        this.burst(centerOf('.hud-toasts') ?? centerOf('.hud-lantern__body'), 22, GOLD, 90);
        this.burst(centerOf('.hud-lantern__body'), 10, GOLD, 50);
      }),
      on('gift:given', () => {
        this.vignetteFlash('gold', true);
        this.ring(screenCenter(), GOLD[0], 14);
        this.burst(screenCenter(), 44, GOLD, 220, 1.4);
      }),
      on('waystone:read', () => {
        this.vignetteFlash('leaf');
        this.burst(centerOf('.hud-toasts') ?? centerOf('.hud-lantern__body'), 18, LEAF, 80);
      }),
      on('burden:dropped', () => {
        this.vignetteFlash('white', true);
        this.ring(screenCenter(), '#fff8ea', 16);
        this.burst(screenCenter(), 60, GOLD, 320, 1.8);
      }),
      on('burden:joyJump', () => this.burst(centerOf('.hud-lantern__body'), 12, GOLD, 70)),
      on('player:bonk', () => {
        this.vignetteFlash('berry');
        this.hudJolt('jolt');
        this.burst(screenCenter(), 8, BERRY, 60);
      }),
      on('player:landed', ({ hard }) => {
        if (hard) this.hudJolt('thud');
      }),
      on('hope:changed', ({ delta }) => {
        if (delta >= 10) this.burst(centerOf('.hud-lantern__body'), 8, GOLD, 44);
      }),
      on('flow:state', ({ state }) => {
        if (state === 'title') this.spawnMotes(0);
        else this.clearMotes();
      }),
    );
    // Button squash on any press (pointer or keyboard activation), with a few sparks for gold buttons.
    const press = (e: Event): void => {
      const target = e.target instanceof Element ? e.target.closest('.btn') : null;
      if (!(target instanceof HTMLElement) || target.hasAttribute('disabled')) return;
      this.btnFlip = !this.btnFlip;
      target.classList.remove('squash-a', 'squash-b');
      target.classList.add(this.btnFlip ? 'squash-a' : 'squash-b');
      if (e instanceof PointerEvent && !target.classList.contains('btn-secondary')) {
        this.burst({ x: e.clientX, y: e.clientY }, 6, GOLD, 34, 0.7);
      }
    };
    document.addEventListener('pointerdown', press, { passive: true });
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Enter' || e.key === ' ') press(e);
    };
    document.addEventListener('keydown', key, { passive: true });
    this.offs.push(
      () => document.removeEventListener('pointerdown', press),
      () => document.removeEventListener('keydown', key),
    );
  }

  /** A soft colour at the screen edges that fades out (0.9 s; `long` 2.2 s). */
  vignetteFlash(tone: Tone, long = false): void {
    if (this.disposed) return;
    this.flip = !this.flip;
    this.vignette.dataset['tone'] = tone;
    this.vignette.classList.toggle('is-long', long);
    this.vignette.classList.remove('flash-a', 'flash-b');
    this.vignette.classList.add(this.flip ? 'flash-a' : 'flash-b');
  }

  private hudJolt(kind: 'jolt' | 'thud'): void {
    const main = this.parent.querySelector('.hud-main');
    if (!(main instanceof HTMLElement)) return;
    this.hudFlip = !this.hudFlip;
    main.classList.remove('jolt-a', 'jolt-b', 'thud-a', 'thud-b');
    main.classList.add(`${kind}-${this.hudFlip ? 'a' : 'b'}`);
  }

  /** A burst of stars and dots from `at` (screen px), flung `spread` px, lasting ~`life` s. */
  burst(at: Point | null, count: number, colors: readonly string[], spread: number, life = 0.9): void {
    if (this.disposed || reduceMotion()) return;
    const p = at ?? screenCenter();
    const room = MAX_SPARKS - this.sparks.childElementCount;
    const n = Math.min(count, room);
    for (let i = 0; i < n; i++) {
      const a = this.rnd() * Math.PI * 2;
      const d = spread * (0.35 + this.rnd() * 0.65);
      const star = this.rnd() < 0.55;
      const size = star ? 9 + this.rnd() * 13 : 5 + this.rnd() * 7;
      const el = h('span', { className: `pg-spark ${star ? 'pg-spark--star' : 'pg-spark--dot'}` });
      el.style.setProperty('--x', `${p.x.toFixed(1)}px`);
      el.style.setProperty('--y', `${p.y.toFixed(1)}px`);
      el.style.setProperty('--dx', `${(Math.cos(a) * d).toFixed(1)}px`);
      el.style.setProperty('--dy', `${(Math.sin(a) * d - spread * 0.25).toFixed(1)}px`);
      el.style.setProperty('--rot', `${Math.round(this.rnd() * 360 - 180)}deg`);
      el.style.setProperty('--s', `${size.toFixed(1)}px`);
      el.style.setProperty('--c', colors[Math.floor(this.rnd() * colors.length)] ?? GOLD[0]);
      el.style.setProperty('--t', `${(life * (0.7 + this.rnd() * 0.6)).toFixed(2)}s`);
      this.attach(el);
    }
  }

  /** A growing ring of light for big moments. */
  ring(at: Point, color: string, grow: number): void {
    if (this.disposed || reduceMotion()) return;
    const el = h('span', { className: 'pg-spark pg-spark--ring' });
    el.style.setProperty('--x', `${at.x.toFixed(1)}px`);
    el.style.setProperty('--y', `${at.y.toFixed(1)}px`);
    el.style.setProperty('--s', '60px');
    el.style.setProperty('--c', color);
    el.style.setProperty('--t', '1.2s');
    el.style.setProperty('--grow', String(grow));
    this.attach(el);
  }

  private attach(el: HTMLElement): void {
    const remove = (): void => el.remove();
    el.addEventListener('animationend', remove, { once: true });
    el.addEventListener('animationcancel', remove, { once: true });
    this.sparks.appendChild(el);
  }

  /** Light motes drifting up over the title landscape (inside .pg-title, under its menu). */
  private spawnMotes(tries: number): void {
    if (this.disposed) return;
    const title = document.querySelector('.pg-title');
    if (!(title instanceof HTMLElement)) {
      if (tries < 12) requestAnimationFrame(() => this.spawnMotes(tries + 1));
      return;
    }
    this.clearMotes();
    if (reduceMotion()) return;
    const layer = h('div', { className: 'pg-motes', 'aria-hidden': 'true' });
    for (let i = 0; i < MOTES; i++) {
      const m = h('span', { className: 'pg-mote' });
      m.style.setProperty('--mx', `${(this.rnd() * 100).toFixed(1)}%`);
      m.style.setProperty('--ms', `${(3 + this.rnd() * 6).toFixed(1)}px`);
      m.style.setProperty('--mt', `${(11 + this.rnd() * 12).toFixed(1)}s`);
      m.style.setProperty('--md', `${(-this.rnd() * 20).toFixed(1)}s`);
      m.style.setProperty('--mw', `${(this.rnd() * 80 - 40).toFixed(0)}px`);
      layer.appendChild(m);
    }
    // Between the shade and the menu column, so motes never sit on the text.
    const shade = title.querySelector('.pg-title__shade');
    if (shade) shade.after(layer);
    else title.prepend(layer);
    this.motes = layer;
  }

  private clearMotes(): void {
    this.motes?.remove();
    this.motes = null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const off of this.offs) off();
    this.offs.length = 0;
    this.clearMotes();
    this.vignette.remove();
    this.sparks.remove();
  }
}

let current: Juice | null = null;

/** Install once at boot (main.ts). Returns the remover. */
export function installJuice(parent?: HTMLElement): () => void {
  current?.dispose();
  const j = new Juice(parent);
  current = j;
  return () => {
    if (current === j) current = null;
    j.dispose();
  };
}
