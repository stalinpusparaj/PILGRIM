/**
 * World-space speech bubbles (GDD 2.8: "World-space speech bubbles over heads for barks and simple lines").
 * Registered as the 'bubbles' service.
 *
 * - A bubble is a DOM element anchored above a Character's head bone: projected every rendered frame by
 *   `update(camera)`, kept inside the screen edges (its tail still points at the head), hidden while the speaker
 *   is behind the camera, culled (World hides far NPCs) or too far away, and a little smaller with distance.
 * - Text is t(key), revealed by the dialogue typewriter (src/ui/typewriter.ts) with the speaker's babble voice
 *   (recipe.voice), positional at the head. The speaker's mouth flaps while it types (barks; dialogue lines leave
 *   the mouth to the runner).
 * - Barks auto-dismiss 2 s after the text is fully shown (`durationSec`); `Infinity` keeps a bubble until it is
 *   dismissed (dialogue lines: the DialoguePanel dismisses on 'dialogue:lineEnd').
 * - One bubble per speaker: a new one replaces the last, unless `pile` is set (Talkative's piling bubbles in
 *   Ch X): then the new bubble sits at the head and the older ones are pushed up. Bubbles that overlap on screen
 *   (several speakers, piles) stack upward with an eased offset (snapped under Reduce motion).
 * - Writing rule (GDD 2.8): max 2 short sentences per bubble; dev builds warn once per key that has more.
 *
 *   const bubbles = new SpeechBubbles();                       // registers services 'bubbles'
 *   const off = bubbles.show(pliable, 'ch02.pliable.bark1', { mood: 'excited' });
 *   loop.add({ render: () => bubbles.update(engine.camera) }, 999);
 */
import * as THREE from 'three';
import { events } from '../core/Events';
import { services } from '../core/Services';
import { t, type TranslateParams } from '../core/I18n';
import type { Character } from '../gen/CharacterFactory';
import type { Mood, Vec3, VoiceParams } from '../audio/types';
import { h, uiRoot } from '../ui/dom';
import { typewrite, type TypewriterController, type TypewriterOptions } from '../ui/typewriter';
import {
  headAnchor,
  layoutBubbles,
  projectAnchor,
  reduceMotion,
  type ScreenBox,
} from '../ui/dialogue-bubble-layout';
import '../ui/dialogue.css';

declare module '../core/Services' {
  interface ServiceMap {
    bubbles: SpeechBubbles;
  }
}

export interface BubbleOptions {
  mood?: Mood;
  /** Seconds the bubble stays after its text is fully shown. Default 2 (barks). Infinity: until dismissed. */
  durationSec?: number;
  /** Called once when the bubble is gone (dismissed, replaced, timed out, cleared). */
  onDone?: () => void;
  /** `{name}` parameters for the text. */
  params?: TranslateParams;
  /** Keep this speaker's earlier bubbles and stack the new one under them (Talkative). Default false. */
  pile?: boolean;
  /** Voice override; default the speaker's recipe voice; null = silent. */
  voice?: VoiceParams | null;
  /** Exact reveal speed (cps, 0 = instant); default the Settings text speed. */
  cps?: number;
  /** Custom voice player (the dialogue runner's speakLine); see TypewriterOptions.speak. */
  speak?: TypewriterOptions['speak'];
  /** Flap the speaker's mouth while the text types. Default true. */
  talk?: boolean;
  /** Called when the whole text is shown (typed out or skipped). */
  onRevealed?: () => void;
  /** Announce the line to screen readers (default true; false when the caller announces it itself). */
  announce?: boolean;
}

/** Control over one bubble (DialoguePanel uses it for node.bubble lines). */
export interface BubbleHandle {
  /** Shows the whole text now (stops the voice). */
  skip(): void;
  /** Removes the bubble (fades out). Safe to call more than once. */
  dismiss(): void;
  /** True once the whole text is shown. */
  readonly revealed: boolean;
  /** Resolves when the bubble is gone. */
  readonly closed: Promise<void>;
}

interface Bubble extends ScreenBox {
  readonly character: Character;
  readonly key: string;
  readonly opts: BubbleOptions;
  readonly el: HTMLDivElement;
  readonly box: HTMLDivElement;
  readonly text: HTMLDivElement;
  tw: TypewriterController | null;
  /** The text was fully shown once (the hold timer runs from then). */
  revealed: boolean;
  timer: number;
  tail: number;
  /** Last transform written (px, scale): the DOM is only touched when it changes. */
  shownLeft: number;
  shownTop: number;
  shownScale: number;
  resolveClosed: () => void;
  readonly closed: Promise<void>;
}

const BARK_HOLD_SEC = 2;
const MAX_PILE = 6;
const LEAVE_MS = 220;
const FAST_LEAVE_MS = 90;
/** Bubble lift easing time constant (s). */
const LIFT_EASE = 0.09;
const TAIL_MARGIN = 24;
const SENTENCE_END = /[.!?…।]+(?=\s|$)/gu;

export class SpeechBubbles {
  private readonly parent: HTMLElement;
  private readonly layer: HTMLDivElement;
  private readonly list: Bubble[] = [];
  private readonly offs: Array<() => void> = [];
  private readonly resize: ResizeObserver | null;
  private readonly warned = new Set<string>();
  private readonly tmp = new THREE.Vector3();
  private camera: THREE.Camera | null;
  private width = 1;
  private height = 1;
  private lastUpdate = 0;
  private order = 0;
  private disposed = false;

  /** `camera` is used by update() calls that pass no camera (or a frame time). */
  constructor(camera?: THREE.Camera | null, parent: HTMLElement = uiRoot()) {
    this.camera = camera ?? null;
    this.parent = parent;
    this.layer = h('div', { className: 'dlg-bubbles', 'aria-live': 'polite' }); // announces each new bubble once
    parent.appendChild(this.layer);
    this.measureViewport();
    const onResize = (): void => this.measureViewport();
    window.addEventListener('resize', onResize);
    this.offs.push(
      () => window.removeEventListener('resize', onResize),
      events.on('lang:changed', () => this.relabel()),
    );
    this.resize =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver((entries) => {
            for (const e of entries) {
              const b = this.list.find((x) => x.box === e.target);
              if (b) this.measure(b);
            }
          });
    services.register('bubbles', this);
  }

  /** Live bubbles (leaving ones included). */
  get count(): number {
    return this.list.length;
  }

  /** Shows `t(key)` over `character`'s head. Returns a function that dismisses it. */
  show(character: Character, key: string, opts: BubbleOptions = {}): () => void {
    const handle = this.speak(character, key, opts);
    return () => handle.dismiss();
  }

  /** Like show(), with control over the reveal (skip) and the bubble's lifetime. */
  speak(character: Character, key: string, opts: BubbleOptions = {}): BubbleHandle {
    if (this.disposed) return closedHandle();
    this.replaceFor(character, opts.pile === true);
    const text = t(key, opts.params);
    this.checkLength(key, text);

    // The typing text is hidden from screen readers; the full line is announced once from its own span.
    const textEl = h('div', { className: 'dlg-bubble__text', 'aria-hidden': 'true' });
    const spoken = opts.announce === false ? null : h('span', { className: 'sr-only' }, text);
    const box = h(
      'div',
      { className: 'dlg-bubble__box' },
      textEl,
      spoken,
      h('span', { className: 'dlg-bubble__tail', 'aria-hidden': 'true' }),
    );
    const el = h('div', { className: 'dlg-bubble is-off' }, box);
    let resolveClosed: () => void = () => undefined;
    const closed = new Promise<void>((resolve) => (resolveClosed = resolve));
    const b: Bubble = {
      character,
      key,
      opts,
      el,
      box,
      text: textEl,
      tw: null,
      revealed: false,
      timer: 0,
      tail: 0,
      shownLeft: NaN,
      shownTop: NaN,
      shownScale: NaN,
      resolveClosed,
      closed,
      // ScreenBox
      order: this.order++,
      w: 0,
      h: 0,
      x: 0,
      bottom: 0,
      scale: 1,
      visible: false,
      leaving: false,
      lift: 0,
      targetLift: 0,
      anchorX: 0,
    };
    this.layer.appendChild(el);
    this.list.push(b);

    const at = headAnchor(character, this.tmp);
    const talk = opts.talk !== false;
    if (talk) character.setTalking(true);
    b.tw = typewrite(textEl, text, {
      voice: opts.voice === undefined ? character.recipe.voice : opts.voice,
      mood: opts.mood,
      at: [at.x, at.y, at.z] as Vec3,
      cps: opts.cps,
      speak: opts.speak,
    });
    void b.tw.done.then(() => this.onRevealed(b));
    this.measure(b);
    this.resize?.observe(box);
    if (this.camera) this.place(b, this.camera);
    return {
      skip: () => b.tw?.skip(),
      dismiss: () => this.dismiss(b, LEAVE_MS),
      get revealed() {
        return b.revealed || (b.tw?.finished ?? true);
      },
      closed,
    };
  }

  /**
   * Positions every bubble for this frame. Pass the rendering camera (or nothing / a frame time to use the
   * camera given to the constructor or the last update). Call once per rendered frame after the camera moved.
   */
  update(camera?: THREE.Camera | number | null): void {
    if (camera instanceof THREE.Camera) this.camera = camera;
    const cam = this.camera;
    const now = performance.now();
    const dt = this.lastUpdate ? Math.min(0.1, (now - this.lastUpdate) / 1000) : 0;
    this.lastUpdate = now;
    if (!cam || this.list.length === 0) return;
    cam.updateMatrixWorld();
    for (const b of this.list) if (!b.leaving) this.project(b, cam);
    layoutBubbles(this.list, this.width, this.height);
    const snap = reduceMotion();
    const k = snap ? 1 : 1 - Math.exp(-dt / LIFT_EASE);
    for (const b of this.list) {
      if (b.leaving) continue;
      b.lift += (b.targetLift - b.lift) * (b.lift === 0 && b.targetLift === 0 ? 1 : k);
      this.write(b);
    }
  }

  /** Removes every bubble at once (scene change, cutscene start). */
  clear(): void {
    for (const b of [...this.list]) this.dismiss(b, 0);
  }

  dispose(): void {
    if (this.disposed) return;
    this.clear();
    this.disposed = true;
    for (const off of this.offs.splice(0)) off();
    this.resize?.disconnect();
    this.layer.remove();
    if (services.tryGet('bubbles') === this) services.unregister('bubbles');
  }

  // ------------------------------------------------------------------------------------------ internals

  private replaceFor(character: Character, pile: boolean): void {
    const mine = this.list.filter((b) => b.character === character && !b.leaving);
    if (!pile) {
      for (const b of mine) this.dismiss(b, FAST_LEAVE_MS);
      return;
    }
    for (let i = 0; i <= mine.length - MAX_PILE; i++) this.dismiss(mine[i], FAST_LEAVE_MS);
  }

  private onRevealed(b: Bubble): void {
    if (b.leaving || b.revealed) return;
    b.revealed = true;
    if (b.opts.talk !== false) b.character.setTalking(false);
    b.opts.onRevealed?.();
    const hold = b.opts.durationSec ?? BARK_HOLD_SEC;
    if (Number.isFinite(hold))
      b.timer = window.setTimeout(() => this.dismiss(b, LEAVE_MS), Math.max(0, hold) * 1000);
  }

  private dismiss(b: Bubble, ms: number): void {
    if (b.leaving) return;
    b.leaving = true;
    window.clearTimeout(b.timer);
    b.tw?.cancel();
    if (b.opts.talk !== false) b.character.setTalking(false);
    this.resize?.unobserve(b.box);
    const remove = (): void => {
      b.el.remove();
      const i = this.list.indexOf(b);
      if (i >= 0) this.list.splice(i, 1);
      b.resolveClosed();
      try {
        b.opts.onDone?.();
      } catch (err) {
        console.error('[SpeechBubbles] onDone threw', err);
      }
    };
    if (ms <= 0 || this.disposed) {
      remove();
      return;
    }
    b.el.classList.add('is-leaving');
    b.timer = window.setTimeout(remove, ms);
  }

  private project(b: Bubble, cam: THREE.Camera): void {
    const c = b.character;
    const shown = c.root.visible && c.mesh.visible && c.root.parent !== null;
    const anchor = shown ? headAnchor(c, this.tmp) : null;
    const p = anchor ? projectAnchor(anchor, cam, this.width, this.height) : null;
    b.visible = p !== null;
    if (!p) return;
    b.anchorX = p.x;
    b.x = p.x;
    b.bottom = p.y;
    b.scale = p.scale;
  }

  private place(b: Bubble, cam: THREE.Camera): void {
    this.project(b, cam);
    layoutBubbles(this.list, this.width, this.height);
    b.lift = b.targetLift;
    this.write(b);
  }

  private write(b: Bubble): void {
    b.el.classList.toggle('is-off', !b.visible);
    if (!b.visible) return;
    const w = b.w * b.scale;
    const hgt = b.h * b.scale;
    const left = Math.round((b.x - w / 2) * 2) / 2;
    const top = Math.round((b.bottom - b.lift - hgt) * 2) / 2;
    const scale = Math.round(b.scale * 500) / 500;
    if (left !== b.shownLeft || top !== b.shownTop || scale !== b.shownScale) {
      b.shownLeft = left;
      b.shownTop = top;
      b.shownScale = scale;
      b.el.style.transform = `translate3d(${left}px, ${top}px, 0) scale(${scale})`;
    }
    const half = Math.max(0, b.w / 2 - TAIL_MARGIN);
    const tail = Math.round(Math.max(-half, Math.min(half, (b.anchorX - b.x) / Math.max(0.01, b.scale))));
    if (tail !== b.tail) {
      b.tail = tail;
      b.box.style.setProperty('--tail-x', `${tail}px`);
    }
  }

  private measure(b: Bubble): void {
    b.w = b.box.offsetWidth;
    b.h = b.box.offsetHeight;
  }

  private measureViewport(): void {
    this.width = Math.max(1, this.parent.clientWidth || window.innerWidth);
    this.height = Math.max(1, this.parent.clientHeight || window.innerHeight);
  }

  /** New language: bubbles show their text in it at once (no second voice). */
  private relabel(): void {
    for (const b of this.list) {
      if (b.leaving) continue;
      b.tw?.cancel(); // a line still typing counts as revealed now (its done resolves)
      const text = t(b.key, b.opts.params);
      const spoken = b.box.querySelector('.sr-only');
      if (spoken) spoken.textContent = text;
      b.tw = typewrite(b.text, text, { cps: 0, voice: null });
      this.measure(b);
    }
  }

  private checkLength(key: string, text: string): void {
    if (!import.meta.env.DEV || this.warned.has(key)) return;
    const sentences = text.trim().match(SENTENCE_END)?.length ?? 0;
    if (sentences <= 2) return;
    this.warned.add(key);
    console.warn(`[SpeechBubbles] "${key}" has ${sentences} sentences (GDD 2.8: max 2 per bubble)`);
  }
}

function closedHandle(): BubbleHandle {
  return { skip: () => {}, dismiss: () => {}, revealed: true, closed: Promise.resolve() };
}
