/**
 * Chapter XII beat 2 (GDD 2.7.6 #8, 2.10): the looking glass on Hill Clear. "[E] Look" puts the glass to
 * Christian's eye: the view narrows to a brass circle and zooms toward the far east, where the hands wobble; hold
 * Pray to steady them (they also settle slowly on their own, so nobody is stuck). Held steady, the Celestial Gate
 * shines on the horizon for a few seconds, then the glass comes down. First time: the "Far Sight" badge.
 *
 * The glimpse is a small golden gate built here, standing at the 'celestial_glimpse' spot zone (`lift` metres up),
 * drawn with its own unfogged material, and only while the glass is up.
 */
import * as THREE from 'three';
import '../audio/events';
import { events } from '../core/Events';
import { services } from '../core/Services';
import { t } from '../core/I18n';
import { bevelBox, cone, cylinder, lowSphere, merge, part } from '../gen/geom';
import { h, uiRoot } from '../ui/dom';
import './ch12-glass.css';
import { spot, zone } from './ch10-kit';
import type { ChapterContext } from './types';

const GLASS = { fov: 9, zoomIn: 0.7, steadyNeed: 1.2, show: 2.6, settle: 12, wobble: 9, aimUp: 5, scale: 0.6 } as const;

export class LookingGlass {
  private readonly gate: THREE.Mesh | null = null;
  private readonly target = new THREE.Vector3();
  private readonly head = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private overlay: HTMLDivElement | null = null;
  private meter: HTMLElement | null = null;
  private active = false;
  private time = 0;
  private amp = 1;
  private steady = 0;
  private shown = -1;
  private fromFov = 55;
  private finger = false;

  constructor(private readonly ctx: ChapterContext) {
    const at = spot(ctx, 'celestial_glimpse');
    if (at) {
      const lift = Number(zone(ctx, 'celestial_glimpse')?.['lift'] ?? 20);
      this.target.copy(at).setY(at.y + lift);
      const mesh = new THREE.Mesh(
        gateGeometry(),
        new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, toneMapped: false, transparent: true }),
      );
      mesh.name = 'ch12:celestial-glimpse';
      mesh.position.copy(this.target);
      mesh.scale.setScalar(GLASS.scale);
      mesh.renderOrder = 10;
      mesh.visible = false;
      ctx.session.world.scene.add(mesh);
      this.gate = mesh;
    }
    ctx.own(() => this.dispose());
  }

  get looking(): boolean {
    return this.active;
  }

  /** "[E] Look": the glass goes up. Resolves when it comes down again. */
  async use(): Promise<void> {
    const ctx = this.ctx;
    if (this.active || !this.gate || ctx.session.player.mode !== 'play') return;
    this.active = true;
    this.time = 0;
    this.amp = 1;
    this.steady = 0;
    this.shown = -1;
    const cam = ctx.session.view;
    this.fromFov = cam.fov;
    ctx.session.player.mode = 'locked';
    services.tryGet('cameraRig')?.suspend();
    events.emit('hud:visible', { on: false });
    this.openOverlay();
    while (this.active && !ctx.session.isDisposed) await ctx.wait(0.1);
  }

  update(dt: number): void {
    if (!this.active || !this.gate) return;
    const ctx = this.ctx;
    const cam = ctx.session.view;
    this.time += dt;
    const steadying = this.finger || services.tryGet('input')?.held('pray') === true;
    const settle = Math.max(0.15, 1 - this.time / GLASS.settle);
    const goal = steadying ? 0.06 : settle;
    this.amp += (goal - this.amp) * Math.min(1, dt * (steadying ? 3 : 1.5));
    if (this.amp < 0.3) this.steady += dt;
    if (this.meter) this.meter.style.width = `${Math.min(100, (this.steady / GLASS.steadyNeed) * 100)}%`;
    if (this.shown < 0 && this.steady >= GLASS.steadyNeed) this.reveal();
    if (this.shown >= 0) {
      this.shown += dt;
      const m = this.gate.material as THREE.MeshBasicMaterial;
      m.opacity = Math.min(1, this.shown / 0.6);
      if (this.shown > GLASS.show) this.lower();
    }
    // The view: from his eye toward the far east, wobbling with his hands.
    const p = ctx.session.player.renderPosition;
    this.head.set(p.x, p.y + 1.55, p.z);
    this.look.set(this.target.x, this.target.y + GLASS.aimUp, this.target.z).sub(this.head).normalize();
    this.right.set(-this.look.z, 0, this.look.x).normalize();
    const w = GLASS.wobble * this.amp;
    const ox = (Math.sin(this.time * 1.7) * 0.6 + Math.sin(this.time * 3.3 + 1) * 0.4) * w;
    const oy = (Math.cos(this.time * 1.3) * 0.6 + Math.sin(this.time * 2.9 + 2) * 0.4) * w * 0.7;
    cam.position.copy(this.head);
    cam.lookAt(this.target.x + this.right.x * ox, this.target.y + GLASS.aimUp + oy, this.target.z + this.right.z * ox);
    const k = Math.min(1, this.time / GLASS.zoomIn);
    // GLASS.fov is the zoom across the shorter side: on a phone held upright the vertical angle opens up to match.
    const zoom = GLASS.fov / Math.min(1, cam.aspect);
    const fov = this.fromFov + (zoom - this.fromFov) * (1 - (1 - k) ** 3);
    if (Math.abs(cam.fov - fov) > 1e-3) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }

  private reveal(): void {
    if (!this.gate) return;
    this.shown = 0;
    this.gate.rotation.y = Math.atan2(this.head.x - this.target.x, this.head.z - this.target.z); // face the viewer
    this.gate.visible = true;
    (this.gate.material as THREE.MeshBasicMaterial).opacity = 0;
    events.emit('sfx', { id: 'bells', volume: 0.5 });
    this.overlay?.classList.add('is-seen');
    const say = this.overlay?.querySelector('.pg-glass__say');
    if (say) say.textContent = t('ch12.glass.seen');
  }

  private lower(): void {
    const ctx = this.ctx;
    this.active = false;
    if (this.gate) this.gate.visible = false;
    this.closeOverlay();
    if (ctx.session.isDisposed) return;
    ctx.session.view.fov = this.fromFov;
    ctx.session.view.updateProjectionMatrix();
    services.tryGet('cameraRig')?.resume(0.6);
    events.emit('hud:visible', { on: true });
    ctx.session.player.mode = 'play';
    ctx.objective('ch12.objective.followWay');
    ctx.state.setFlag('ch12.glassDone', true);
    ctx.state.unlock('farSight'); // after the glass comes down, so its card does not sit in the lens
  }

  private openOverlay(): void {
    const input = services.tryGet('input');
    const touch = input?.device === 'touch';
    const glyph = h('span', { className: 'pg-glass__glyph' });
    // On touch the overlay covers the round buttons: a finger held anywhere on the screen steadies the glass.
    if (!touch) glyph.innerHTML = input?.glyph('pray') ?? 'Q';
    this.meter = h('span', { className: 'pg-glass__fill' });
    this.overlay = h(
      'div',
      { className: 'pg-glass', role: 'status', 'aria-live': 'polite' },
      h('div', { className: 'pg-glass__ring', 'aria-hidden': 'true' }),
      h(
        'div',
        { className: 'pg-glass__hint' },
        h('p', { className: 'pg-glass__say' }, t(touch ? 'ch12.glass.holdTouch' : 'ch12.glass.hold')),
        h('p', { className: 'pg-glass__keys' }, glyph),
        h('span', { className: 'pg-glass__meter', 'aria-hidden': 'true' }, this.meter),
      ),
    );
    if (touch) {
      this.overlay.classList.add('is-touch');
      const down = (e: PointerEvent): void => {
        e.preventDefault();
        this.finger = true;
      };
      const up = (): void => {
        this.finger = false;
      };
      this.overlay.addEventListener('pointerdown', down);
      for (const ev of ['pointerup', 'pointercancel', 'pointerleave'] as const) this.overlay.addEventListener(ev, up);
    }
    uiRoot().append(this.overlay);
  }

  private closeOverlay(): void {
    this.finger = false;
    this.overlay?.remove();
    this.overlay = null;
    this.meter = null;
  }

  private dispose(): void {
    if (this.active) {
      this.active = false;
      services.tryGet('cameraRig')?.resume(0);
    }
    this.closeOverlay();
    if (this.gate) {
      this.gate.removeFromParent();
      this.gate.geometry.dispose();
      (this.gate.material as THREE.Material).dispose();
    }
  }
}

/** A tall golden gate with two towers and a bright doorway on a bank of cloud (our own design), about 16 m high. */
function gateGeometry(): THREE.BufferGeometry {
  const gold = '#FFD978';
  const light = '#FFF6DC';
  const parts: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    parts.push(part(cylinder(1.3, 1.6, 13, 8), gold, { pos: [s * 5, 6.5, 0] }));
    parts.push(part(cone(1.8, 3.2, 8), light, { pos: [s * 5, 14.6, 0] }));
  }
  parts.push(part(bevelBox(11.5, 1.6, 2, 0.2), gold, { pos: [0, 12.2, 0] }));
  parts.push(part(bevelBox(6.8, 10.5, 0.6, 0.1), light, { pos: [0, 5.6, 0] }));
  parts.push(part(cone(3.4, 2.6, 4), gold, { pos: [0, 14.3, 0], rot: [0, Math.PI / 4, 0] }));
  // It stands on a bank of bright cloud.
  for (const [x, y, z, r] of [[-7, 0, 1, 3.4], [-2.5, -0.6, 2, 3.8], [2.5, -0.5, 1.6, 3.6], [7, 0.2, 0.8, 3.2], [0, -1.4, -1, 4.4]] as const)
    parts.push(part(lowSphere(r, 1), '#FFFFFF', { pos: [x, y, z], scale: [1.3, 0.6, 1] }));
  return merge(parts);
}
