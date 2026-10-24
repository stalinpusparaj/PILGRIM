/**
 * North-up local map. In play it is a small round MAP button (bottom-left, over the lantern) so the play area keeps
 * only the controls; a tap opens the big map in the middle of the screen, and closing it (the X, a tap outside,
 * Esc) shrinks it back to the button. Routes are built once; only marker transforms update at 10 Hz.
 */
import * as THREE from 'three';
import type { World } from '../world/World';
import { services } from '../core/Services';
import { t } from '../core/I18n';
import { daily } from '../core/Daily';
import { openPaywallOver } from './Paywall';
import { h } from './dom';
import './minimap.css';

export interface MapPlayer {
  readonly renderPosition: THREE.Vector3;
  readonly forward: THREE.Vector3;
  readonly controller: { readonly velocity: THREE.Vector3 };
}
const NS = 'http://www.w3.org/2000/svg';
/** Metres from the player to the map's edge. */
const RANGE = 60;
function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
}

/** A folded paper map (our own drawing). */
const MAP_ICON =
  '<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true" focusable="false" fill="none" ' +
  'stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/>' +
  '<path d="M9 4v14M15 6v14"/></svg>';
const CLOSE_ICON =
  '<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true" focusable="false" stroke="currentColor" ' +
  'stroke-width="3" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

export class Minimap {
  /** Mounted beside the HUD (not inside it): the HUD sits under the touch controls, the map button over them. */
  readonly el = h('div', { className: 'pg-map' });
  private readonly button = h('button', { className: 'pg-map__btn', type: 'button' });
  private readonly panel = h('div', { className: 'hud-minimap', role: 'dialog' });
  private readonly close = h('button', { className: 'pg-map__close', type: 'button' });
  /** Map looks left today without the full journey (DECISIONS #403); hidden when unlimited. */
  private readonly left = h('span', { className: 'pg-map__left', 'aria-hidden': 'true' });
  private readonly rest = h('div', { className: 'hud-minimap__rest' });
  private readonly restText = h('p', { className: 'hud-minimap__rest-text' });
  private readonly unlock = h('button', { className: 'btn pg-map__unlock', type: 'button' });
  private open = false;
  private readonly title = h('div', { className: 'hud-minimap__title' });
  private readonly legend = h('div', { className: 'hud-minimap__legend' });
  private readonly map = svg('svg', { viewBox: '-48 -48 96 96', role: 'img' });
  private readonly north = h('span', { className: 'hud-minimap__north', 'aria-hidden': 'true' });
  private readonly route = svg('g', { class: 'minimap-routes' });
  private readonly marker = svg('path', { d: 'M0 -4.5 L3.2 3 L0 1.7 L-3.2 3 Z', class: 'minimap-player' });
  private readonly movement = svg('path', { class: 'minimap-movement' });
  private readonly goal = svg('circle', { r: 2.6, class: 'minimap-goal' });
  private player: MapPlayer | null = null;
  private world: World | null = null;
  private clock = 0;

  constructor() {
    this.map.append(this.route, this.movement, this.goal, this.marker);
    const frame = h('div', { className: 'hud-minimap__frame' }, this.map, this.north);
    this.close.innerHTML = CLOSE_ICON;
    const head = h('div', { className: 'hud-minimap__head' }, this.title, this.close);
    this.rest.append(this.restText, this.unlock);
    this.panel.append(head, frame, this.legend, this.rest);
    this.button.innerHTML = MAP_ICON;
    this.el.appendChild(this.left); // beside the button: its glass orb clips what it holds
    this.unlock.addEventListener('click', (e) => {
      e.preventDefault();
      this.setOpen(false); // the paywall takes Escape / Back from here
      openPaywallOver({ pauseGame: true });
    });
    const scrim = h('div', { className: 'pg-map__scrim' });
    this.el.append(this.button, scrim, this.panel);
    this.el.hidden = true;
    this.button.addEventListener('click', this.onOpen);
    this.close.addEventListener('click', this.onClose);
    scrim.addEventListener('click', this.onClose);
    window.addEventListener('keydown', this.onKey, true);
    this.setOpen(false);
  }

  get isOpen(): boolean {
    return this.open;
  }

  private readonly onOpen = (e: Event): void => {
    e.preventDefault();
    this.el.classList.toggle('is-rest', !daily.useMap());
    this.setOpen(true);
  };

  private readonly onClose = (e: Event): void => {
    e.preventDefault();
    this.setOpen(false);
  };

  /** Esc closes the big map first (and is not passed on as Pause). */
  private readonly onKey = (e: KeyboardEvent): void => {
    if (!this.open || e.code !== 'Escape') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    this.setOpen(false);
  };

  private setOpen(open: boolean): void {
    this.open = open;
    this.el.classList.toggle('is-open', open);
    this.button.setAttribute('aria-expanded', String(open));
    this.clock = 1;
    if (!open && document.activeElement === this.close) this.button.focus({ preventScroll: true });
  }

  setSource(world: World, player: MapPlayer): void {
    this.world = world;
    this.player = player;
    this.route.replaceChildren();
    for (const way of [world.ways.main, ...world.ways.detours]) {
      const point = new THREE.Vector3();
      let d = '';
      for (let i = 0; i <= 160; i++) {
        way.sample(i / 160, point);
        d += `${i ? 'L' : 'M'}${point.x.toFixed(2)} ${point.z.toFixed(2)} `;
      }
      this.route.appendChild(svg('path', { d, class: way === world.ways.main ? 'minimap-way' : 'minimap-detour' }));
    }
    for (const stone of world.level.waystones) {
      this.route.appendChild(svg('rect', { x: stone.at[0] - 1.2, y: stone.at[2] - 1.2, width: 2.4, height: 2.4, rx: 0.5, class: 'minimap-stone' }));
    }
    this.clock = 1;
  }

  update(dt: number, visible: boolean): void {
    this.el.hidden = !visible || !this.player || !this.world;
    if (this.el.hidden && this.open) this.setOpen(false);
    if (this.el.hidden || !this.player) return;
    this.button.setAttribute('aria-label', t('ui.minimap.open'));
    this.close.setAttribute('aria-label', t('ui.minimap.close'));
    const left = daily.mapLeft;
    this.left.hidden = !Number.isFinite(left);
    if (Number.isFinite(left)) this.left.textContent = String(left);
    if (!this.open) return;
    if (this.el.classList.contains('is-rest')) {
      this.title.textContent = t('ui.minimap.title');
      this.restText.textContent = t('ui.minimap.rest');
      this.unlock.textContent = t('ui.minimap.unlock');
      return;
    }
    this.clock += dt;
    if (this.clock < 0.1) return;
    this.clock = 0;
    const p = this.player.renderPosition;
    this.map.setAttribute('viewBox', `${p.x - RANGE} ${p.z - RANGE} ${RANGE * 2} ${RANGE * 2}`);
    const f = this.player.forward;
    const heading = Math.atan2(f.x, -f.z) * 180 / Math.PI;
    this.marker.setAttribute('transform', `translate(${p.x} ${p.z}) rotate(${heading})`);
    const v = this.player.controller.velocity;
    const speed = Math.hypot(v.x, v.z);
    this.movement.style.display = speed > 0.15 ? '' : 'none';
    if (speed > 0.15) {
      const dx = v.x / speed, dz = v.z / speed;
      const x = p.x + dx * 14, z = p.z + dz * 14;
      this.movement.setAttribute('d', `M${p.x} ${p.z} L${x} ${z} M${x - dx * 4 - dz * 2.5} ${z - dz * 4 + dx * 2.5} L${x} ${z} L${x - dx * 4 + dz * 2.5} ${z - dz * 4 - dx * 2.5}`);
    }
    const target = services.tryGet('guide')?.sample().target;
    this.goal.style.display = target ? '' : 'none';
    if (target) {
      const dx = target.x - p.x, dz = target.z - p.z;
      const scale = Math.min(1, (RANGE - 5) / Math.max(Math.abs(dx), Math.abs(dz), 1));
      this.goal.setAttribute('cx', String(p.x + dx * scale));
      this.goal.setAttribute('cy', String(p.z + dz * scale));
    }
    this.title.textContent = t('ui.minimap.title');
    this.legend.textContent = t('ui.minimap.legend');
    this.north.textContent = t('ui.minimap.north');
    this.map.setAttribute('aria-label', t('ui.minimap.label'));
  }

  dispose(): void {
    this.world = null;
    this.player = null;
    this.route.replaceChildren();
    window.removeEventListener('keydown', this.onKey, true);
    this.el.remove();
  }
}
