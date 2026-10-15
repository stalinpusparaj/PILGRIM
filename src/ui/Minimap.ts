/** North-up local map. Routes are built once; only marker transforms update at 10 Hz. */
import * as THREE from 'three';
import type { World } from '../world/World';
import { services } from '../core/Services';
import { t } from '../core/I18n';
import { h } from './dom';
import './minimap.css';

export interface MapPlayer {
  readonly renderPosition: THREE.Vector3;
  readonly forward: THREE.Vector3;
  readonly controller: { readonly velocity: THREE.Vector3 };
}
const NS = 'http://www.w3.org/2000/svg';
const RANGE = 48;
function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
}

export class Minimap {
  readonly el = h('div', { className: 'hud-minimap' });
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
    this.el.append(this.title, frame, this.legend);
    this.el.hidden = true;
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
    if (this.el.hidden || !this.player) return;
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
    this.el.remove();
  }
}
