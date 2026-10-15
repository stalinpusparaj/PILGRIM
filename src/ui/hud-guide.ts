/**
 * The HUD guide (service 'guide', src/world/Guide.ts): a bobbing golden chevron floating over the goal when it
 * is on screen, and an arrow hugging the screen edge, turned towards the goal, when it is not. Inline SVG we
 * drew (GDD 2.3). Projection math as hud-bubble.ts. Rules (so it helps without nagging):
 *   - a chapter goal (custom): always shown until within ARRIVE_M;
 *   - the default "Way ahead": the edge arrow whenever the Way ahead is off screen (facing the wrong way), the
 *     chevron stays visible while moving so the route remains readable.
 */
import type * as THREE from 'three';
import * as THREE_ from 'three';
import { services } from '../core/Services';
import { h } from './dom';
import type { AvoidRects } from './hud-layout';

const NEAR = 0.05;
const ARRIVE_M = 2.5;

const EDGE = 18;
const CHEVRON_LIFT = 1.9; // m above the target's ground point

const CHEVRON_SVG =
  '<svg viewBox="0 0 48 48" aria-hidden="true"><path class="g-glow" d="M10 14l14 14 14-14" /><path class="g-line" d="M10 14l14 14 14-14" /><path class="g-line2" d="M14 26l10 10 10-10" /></svg>';
const ARROW_SVG =
  '<svg viewBox="0 0 48 48" aria-hidden="true"><path class="g-fill" d="M24 4l16 22H30v18H18V26H8z" /></svg>';

export class GuideMarker {
  readonly el: HTMLDivElement;
  private readonly chevron: HTMLDivElement;
  private readonly arrow: HTMLDivElement;
  private readonly view = new THREE_.Matrix4();
  private readonly p = new THREE_.Vector3();
  private mode: 'none' | 'chevron' | 'arrow' = 'none';

  constructor() {
    this.chevron = h('div', { className: 'hud-guide__chevron' });
    this.chevron.innerHTML = CHEVRON_SVG;
    this.arrow = h('div', { className: 'hud-guide__arrow' });
    this.arrow.innerHTML = ARROW_SVG;
    this.el = h('div', { className: 'hud-guide', 'aria-hidden': 'true' }, this.chevron, this.arrow);
  }

  /** Every rendered frame, with the camera that draws the scene. */
  render(camera: THREE.Camera, visible: boolean, vw: number, vh: number, avoid: AvoidRects): void {
    const guide = services.tryGet('guide');
    if (!visible || !guide || vw <= 0 || vh <= 0) return this.show('none');
    const s = guide.sample();
    const t = s.target;
    if (!t || (s.custom && s.distance < ARRIVE_M)) return this.show('none');

    camera.updateMatrixWorld();
    this.view.copy(camera.matrixWorld).invert();
    const p = this.p.set(t.x, t.y + CHEVRON_LIFT, t.z).applyMatrix4(this.view);
    // Reserve room for the objective, coaching panel and touch buttons.
    const minX = avoid.left + EDGE + 28;
    const maxX = Math.max(minX, vw - avoid.right - EDGE - 28);
    const minY = Math.min(vh * 0.4, avoid.top + (avoid.touch ? 170 : 110));
    const maxY = Math.max(minY, vh - avoid.bottom - (avoid.touch ? 230 : 140));
    const behind = p.z > -NEAR;
    if (!behind) p.applyMatrix4(camera.projectionMatrix);
    const screenX = (p.x * 0.5 + 0.5) * vw;
    const screenY = (-p.y * 0.5 + 0.5) * vh;
    const onScreen = !behind && screenX >= minX && screenX <= maxX && screenY >= minY && screenY <= maxY;

    if (onScreen) {
      // Keep the route readable while moving.
      this.show('chevron');
      const x = (p.x * 0.5 + 0.5) * vw;
      const y = (-p.y * 0.5 + 0.5) * vh;
      this.chevron.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      return;
    }

    // Work in screen pixels, not normalized coordinates (which distort direction on wide screens).
    // Behind-camera targets are still in view space: keep left/right intact and point down to turn back.
    let dx = behind ? p.x * camera.projectionMatrix.elements[0] * vw : p.x * vw;
    let dy = behind ? Math.max(Math.abs(p.z), NEAR) * camera.projectionMatrix.elements[5] * vh : -p.y * vh;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    // Slide the arrow to the edge of the safe rectangle along that direction, from the screen centre.
    const cx = Math.min(maxX, Math.max(minX, vw * 0.5));
    const cy = Math.min(maxY, Math.max(minY, vh * 0.5));
    const tx = dx > 0 ? (maxX - cx) / dx : dx < 0 ? (minX - cx) / dx : Infinity;
    const ty = dy > 0 ? (maxY - cy) / dy : dy < 0 ? (minY - cy) / dy : Infinity;
    const k = Math.max(0, Math.min(tx, ty));
    const x = cx + dx * k;
    const y = cy + dy * k;
    const deg = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    this.show('arrow');
    this.arrow.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${deg.toFixed(1)}deg)`;
  }

  private show(mode: 'none' | 'chevron' | 'arrow'): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.chevron.classList.toggle('is-on', mode === 'chevron');
    this.arrow.classList.toggle('is-on', mode === 'arrow');
  }

  dispose(): void {
    this.el.remove();
  }
}
