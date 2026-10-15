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
  private readonly forward = new THREE_.Vector3();
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

    // A navigation arrow expresses the ground bearing, independent of pitch or target elevation.
    // Match camera-relative movement: right = (-forward.z, forward.x), ahead = screen up.
    camera.getWorldDirection(this.forward);
    let fx = this.forward.x, fz = this.forward.z;
    const horizontal = Math.hypot(fx, fz);
    if (horizontal > 1e-5) { fx /= horizontal; fz /= horizontal; }
    else { fx = 0; fz = -1; }
    const wx = t.x - s.player.x, wz = t.z - s.player.z;
    let dx = -fz * wx + fx * wz;
    let dy = -(fx * wx + fz * wz);
    if (Math.abs(dx) + Math.abs(dy) < 1e-5) dy = -1;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    // Slide the arrow to the edge of the safe rectangle along that direction, from the screen centre.
    const cx = Math.min(maxX, Math.max(minX, vw * 0.5));
    const cy = Math.min(maxY, Math.max(minY, vh * 0.5));
    const tx = dx > 0 ? (maxX - cx) / dx : dx < 0 ? (minX - cx) / dx : Infinity;
    const ty = dy > 0 ? (maxY - cy) / dy : dy < 0 ? (minY - cy) / dy : Infinity;
    const k = Math.max(0, Math.min(tx, ty));
    let x = cx + dx * k;
    let y = cy + dy * k;
    // Keep the arrow clear of cached map/control rectangles without per-frame layout reads.
    for (let i = 0; i < avoid.corners.length + avoid.buttons.length; i++) {
      const rect = i < avoid.corners.length ? avoid.corners[i]! : avoid.buttons[i - avoid.corners.length]!;
      if (rect.w <= 0 || rect.h <= 0) continue;
      if (x + 36 > rect.x && x - 36 < rect.x + rect.w && y + 36 > rect.y && y - 36 < rect.y + rect.h) {
        const left = rect.x - 40, above = rect.y - 40;
        if (left >= minX) x = Math.min(maxX, left);
        else if (above >= minY) y = Math.min(maxY, above);
      }
    }
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
