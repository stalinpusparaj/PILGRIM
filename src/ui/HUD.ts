/**
 * The in-game HUD (GDD 2.14), service 'hud'. Plain DOM over the canvas, chunky and toy-like, system fonts,
 * safe-area aware, passive to pointer input (it never blocks the touch controls):
 *   - objective, top-left (under the satchel icon on touch): 'objective:changed', fades after 6 s, shows again
 *     briefly on 'satchel:closed';
 *   - Hope lantern, bottom-left, hearts under it when setHearts() is used (Chapter VIII);
 *   - interaction bubble over the focused interactable with the current device's button ('interact:focus',
 *     'interact:hold', 'interact:use' and the 'interactables' service);
 *   - toasts near the top centre ('hud:toast'), one at a time;
 *   - chapter card, centred ('hud:chapterCard').
 * 'hud:visible' {on} hides everything but the chapter card (cutscenes; a chapter card is a deliberate title
 * moment that chapter scripts often time over an intro shot). No letterbox: Phase 3's Cutscene owns it.
 *
 * The owner calls update(dt) from a fixed-step system and render(camera) once per rendered frame:
 *   const hud = new HUD();
 *   loop.add({ update: (dt) => hud.update(dt), render: () => hud.render(engine.camera) });
 */
import './hud.css';
import { Journey } from './Journey';
import { Minimap, type MapPlayer } from './Minimap';
import type { World } from '../world/World';
import type * as THREE from 'three';
import { events } from '../core/Events';
import { services } from '../core/Services';
import { h, listen, uiRoot } from './dom';
import { HopeLantern } from './hud-lantern';
import { InteractBubble } from './hud-bubble';
import { GuideMarker } from './hud-guide';
import './hud-guide.css';
import { ToastQueue } from './hud-toasts';
import { ChapterCard, ObjectiveLine } from './hud-banners';
import { HudLayout } from './hud-layout';
import { installHudDebug } from './hud-debug';

declare module '../core/Events' {
  interface EventMap {
    /** The Satchel was closed (Phase 3 SatchelUI emits it); the HUD shows the objective again briefly. */
    'satchel:closed': void;
  }
}

declare module '../core/Services' {
  interface ServiceMap {
    hud: HUD;
  }
}

/** Hope before any 'state' service exists (a full lantern). */
const DEFAULT_HOPE = 100;

export class HUD {
  readonly root: HTMLDivElement;
  private readonly main: HTMLDivElement;
  private readonly lantern: HopeLantern;
  private readonly bubble = new InteractBubble();
  private readonly guide = new GuideMarker();
  private readonly toasts = new ToastQueue();
  private readonly objective = new ObjectiveLine();
  private readonly card = new ChapterCard();
  private readonly journey = new Journey();
  private readonly minimap = new Minimap();
  private readonly layout: HudLayout;
  private readonly offs: Array<() => void> = [];
  private shown = true;
  private disposed = false;

  constructor(parent: HTMLElement = uiRoot()) {
    const state = services.tryGet('state');
    this.lantern = new HopeLantern(state?.hope ?? DEFAULT_HOPE);
    this.main = h(
      'div',
      { className: 'hud-main' },
      this.objective.el,
      this.toasts.el,
      this.lantern.el,
      this.bubble.el,
      this.guide.el,
      this.journey.el,
      this.minimap.el,
    );
    this.root = h('div', { className: 'hud ui-passive' }, this.main, this.card.el);
    parent.appendChild(this.root);
    this.layout = new HudLayout(this.root);

    const input = services.tryGet('input');
    const touch = input ? input.device === 'touch' : matchMedia('(pointer: coarse)').matches;
    this.setTouch(touch);
    if (state?.objective) this.objective.set(state.objective);

    this.wire();
    this.offs.push(installHudDebug(this));
    services.register('hud', this);
  }

  /** False while a cutscene asked the HUD to hide ('hud:visible' {on: false}). */
  get visible(): boolean {
    return this.shown;
  }

  /** Hope the lantern is showing (0..100). */
  get hope(): number {
    return this.lantern.value;
  }

  /** Fixed step: timers, focus, hold progress. Stands still while the loop is paused (menus). */
  update(dt: number): void {
    if (this.disposed) return;
    // A HUD made before the session state (or a state swapped under it) catches up silently.
    const state = services.tryGet('state');
    if (state && state.hope !== this.lantern.value) this.lantern.setHope(state.hope, 0);
    this.layout.update(dt);
    this.lantern.update(dt);
    this.card.update(dt);
    this.toasts.update(dt, this.shown);
    this.objective.update(dt, this.shown && !this.card.active);
    this.bubble.update(dt);
    this.journey.update(dt, this.shown && !this.card.active);
    this.minimap.update(dt, this.shown && !this.card.active);
  }

  /** Every rendered frame: projects the interaction bubble with the camera that draws the scene. */
  render(camera: THREE.Camera): void {
    if (this.disposed) return;
    this.layout.ensure();
    this.bubble.render(camera, this.shown, this.layout.width, this.layout.height, this.layout.avoid);
    this.guide.render(camera, this.shown, this.layout.width, this.layout.height, this.layout.avoid);
  }

  /** Hearts under the lantern (Chapter VIII, GDD 2.7.7); fractional values draw half hearts; null hides. */
  setHearts(n: number | null, max = 5): void {
    this.lantern.setHearts(n, max);
  }

  /** Debug: show a Hope value on the lantern without a 'state' service. */
  previewHope(value: number): void {
    const v = Math.max(0, Math.min(100, value));
    this.lantern.setHope(v, v - this.lantern.value);
  }

  setNavigation(world: World, player: MapPlayer): void {
    this.minimap.setSource(world, player);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const off of this.offs.splice(0)) off();
    this.journey.dispose();
    this.minimap.dispose();
    this.toasts.clear();
    this.card.clear();
    this.root.remove();
    if (services.tryGet('hud') === this) services.unregister('hud');
  }

  // ------------------------------------------------------------------------------------------ events

  private wire(): void {
    const o = this.offs;
    o.push(
      events.on('hud:toast', ({ key, params }) => this.toasts.push(key, params)),
      events.on('hud:chapterCard', ({ chapter }) => {
        this.card.show(chapter);
      }),
      events.on('hud:visible', ({ on }) => this.setShown(on)),
      events.on('objective:changed', ({ key }) => this.objective.set(key)),
      events.on('satchel:closed', () => this.objective.reshow()),
      events.on('hope:changed', ({ value, delta }) => this.lantern.setHope(value, delta)),
      events.on('state:reset', () => {
        const s = services.tryGet('state');
        if (!s) return;
        this.lantern.setHope(s.hope, 0);
        this.objective.set(s.objective);
      }),
      events.on('input:device', ({ device }) => {
        this.setTouch(device === 'touch');
        this.bubble.refresh();
      }),
      events.on('input:bindings', () => this.bubble.refresh()),
      events.on('lang:changed', () => this.refreshText()),
      events.on('settings:changed', ({ key }) => {
        if (key === 'textSize') this.invalidateSize();
      }),
      events.on('resize', () => this.invalidateSize()),
      listen(window, 'resize', () => this.invalidateSize()),
      events.on('interact:focus', () => this.bubble.onFocusEvent()),
      events.on('interact:use', ({ id }) => this.bubble.onUse(id)),
      events.on('interact:hold', ({ progress }) => this.bubble.onHoldEvent(progress)),
    );
  }

  private setShown(on: boolean): void {
    if (on === this.shown) return;
    this.shown = on;
    this.main.classList.toggle('is-hidden', !on);
  }

  private setTouch(touch: boolean): void {
    this.root.classList.toggle('is-touch', touch);
    this.layout.setTouch(touch);
    this.bubble.invalidateSize();
  }

  private invalidateSize(): void {
    this.layout.invalidate();
    this.bubble.invalidateSize();
  }

  private refreshText(): void {
    this.objective.refreshText();
    this.toasts.refreshText();
    this.card.refreshText();
    this.lantern.refreshText();
    this.bubble.refresh();
    this.invalidateSize();
  }
}
