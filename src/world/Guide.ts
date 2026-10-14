/**
 * The guide: where the game gently points next (GDD 2.2 pillar 2, "the way is narrow"; the right path always
 * reads). Service 'guide'. The HUD draws it (hud-guide.ts): a floating chevron over the goal when it is on
 * screen, an arrow at the screen edge when it is not.
 *
 * - Default target: a point on the main Way a little ahead of the player. Off the Way it points back to it;
 *   at the Way's end there is nothing to point at.
 * - Chapters aim it at something specific with `set()` (an NPC, a landmark, any live position) and `clear()`
 *   it to fall back to the Way.
 * - `sample()` also says whether the player is idle or off the Way, so the HUD can keep quiet while a child
 *   is clearly on the move and on the path.
 */
import * as THREE from 'three';
import { events } from '../core/Events';
import { services } from '../core/Services';
import type { Way } from '../gen/Way';

export type GuideTarget = THREE.Vector3 | (() => THREE.Vector3 | null);

export interface GuideSample {
  /** World point to point at, or null (nothing to show). */
  target: THREE.Vector3 | null;
  /** The player's feet (world). */
  player: THREE.Vector3;
  /** A chapter-set goal (true) or the default "the Way ahead" (false). */
  custom: boolean;
  /** Seconds the player has stood still. */
  idle: number;
  /** The player stands outside the Way's band. */
  offWay: boolean;
  /** Horizontal distance to the target (m). */
  distance: number;
}

declare module '../core/Services' {
  interface ServiceMap {
    guide: Guide;
  }
}
declare module '../core/Events' {
  interface EventMap {
    /** The guide's goal changed (custom set or cleared). */
    'guide:changed': { custom: boolean };
  }
}

/** How far along the Way the default target sits ahead of the player (m). */
export const GUIDE_AHEAD_M = 14;
/** Past this distance from the ribbon's edge the player counts as off the Way (m). */
export const OFF_WAY_M = 4;
/** Movement under this (m/s) counts as standing still. */
const IDLE_SPEED = 0.15;

export class Guide {
  private target: GuideTarget | null = null;
  private readonly way: Way;
  private readonly player: { readonly renderPosition: THREE.Vector3 };
  private readonly out = new THREE.Vector3();
  private readonly last = new THREE.Vector3();
  private readonly sampleOut: GuideSample;
  private idleSec = 0;
  private hasLast = false;
  private disposed = false;

  constructor(o: { way: Way; player: { readonly renderPosition: THREE.Vector3 } }) {
    this.way = o.way;
    this.player = o.player;
    this.sampleOut = { target: null, player: o.player.renderPosition, custom: false, idle: 0, offWay: false, distance: 0 };
    services.register('guide', this);
  }

  /** Aim at something specific. A function is read every frame (a walking NPC); null clears. */
  set(target: GuideTarget | null): void {
    if (this.disposed) return;
    this.target = target;
    events.emit('guide:changed', { custom: target !== null });
  }

  clear(): void {
    this.set(null);
  }

  get custom(): boolean {
    return this.target !== null;
  }

  /** Fixed step: idle timer. */
  update(dt: number): void {
    const p = this.player.renderPosition;
    if (this.hasLast) {
      const d = Math.hypot(p.x - this.last.x, p.z - this.last.z);
      this.idleSec = d / Math.max(dt, 1e-6) < IDLE_SPEED ? this.idleSec + dt : 0;
    }
    this.last.copy(p);
    this.hasLast = true;
  }

  /** Where to point now (reused object; copy what you keep). */
  sample(): GuideSample {
    const s = this.sampleOut;
    const p = this.player.renderPosition;
    s.player = p;
    s.idle = this.idleSec;
    s.custom = this.target !== null;
    const near = this.way.closest(p.x, p.z);
    s.offWay = near.dist > this.way.halfWidth + OFF_WAY_M;
    let t: THREE.Vector3 | null = null;
    if (this.target !== null) {
      t = typeof this.target === 'function' ? this.target() : this.target;
    } else if (near.t < 0.995) {
      // The Way ahead; from off the Way, the nearest point a little further on, so the arrow leads back and on.
      const ahead = s.offWay ? 4 : GUIDE_AHEAD_M;
      t = this.way.sample(Math.min(1, near.t + ahead / Math.max(this.way.length, 1)), this.out);
    }
    s.target = t;
    s.distance = t ? Math.hypot(t.x - p.x, t.z - p.z) : 0;
    return s;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.target = null;
    if (services.tryGet('guide') === this) services.unregister('guide');
  }
}
