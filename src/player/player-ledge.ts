/**
 * Ledge climbing (GDD 2.6 "Climb", 2.15): while the player stands facing a ledge 0.6-1.8 m high
 * (CollisionWorld.ledgeAhead; 1.3 m at most while burdened, and a slower, heavier heave), a "Climb" bubble shows
 * through the Interactables service. Jump (or the bubble's use button) starts the climb: the 'climb' clip plays while the body rises along
 * the wall, then it steps over the top onto the ledge. The controller is placed along that path each fixed step.
 */
import * as THREE from 'three';
import '../audio/events';
import { events } from '../core/Events';
import { services } from '../core/Services';
import type { CollisionWorld } from '../world/Collision';
import type { Interactable } from '../world/Interactables';

export const LEDGE = {
  /** Fixed steps between ledge probes (20 Hz). */
  probeEvery: 3,
  minRise: 0.6,
  maxRise: 1.8,
  maxRiseBurdened: 1.3,
  /** Burdened climbs take this much longer (the sack is heavy). */
  burdenedSlow: 1.4,
  /** Bubble: focus radius around the ledge point, height above it. Below-default priority: a waystone or a
   *  friend right there keeps its bubble, and Space is then an ordinary jump. */
  radius: 1.6,
  bubbleHeight: 0.5,
  priority: -1,
  /** Rise time = base + perMetre * rise (s); then the step over the top (s). */
  riseBase: 0.3,
  risePerMetre: 0.32,
  over: 0.3,
  /** How far the body leans into the wall while rising (m). */
  hug: 0.12,
  /** 'climb' clip cadence (its speed param) while climbing. */
  animSpeed: 1.2,
} as const;

const tmp = new THREE.Vector3();

function smooth(t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
}

export class LedgeClimb {
  /** A ledge is in front and climbable right now. */
  available = false;
  /** Climbing in progress (the Player stops stepping the controller). */
  climbing = false;
  /** Climbs finished (tests / debug). */
  count = 0;

  private readonly target = new THREE.Vector3();
  private readonly from = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly item: Interactable;
  private remove: (() => void) | null = null;
  private requested = false;
  private probeN = 0;
  private t = 0;
  private riseT = 0;

  constructor(
    private readonly col: CollisionWorld,
    private readonly radius: number,
    private readonly height: number,
  ) {
    this.item = {
      id: 'player:climb',
      pos: new THREE.Vector3(),
      radius: LEDGE.radius,
      verb: 'ui.verb.climb',
      enabled: false,
      height: LEDGE.bubbleHeight,
      priority: LEDGE.priority,
      action: 'jump',
      onUse: () => {
        if (this.available) this.requested = true;
      },
    };
  }

  /** The ledge top the climb ends on (valid while available or climbing). */
  get top(): THREE.Vector3 {
    return this.target;
  }

  /**
   * Fixed step while not climbing: look for a ledge in front (`forward` = facing, unit, horizontal).
   * `allowed` = grounded and free to act; otherwise the bubble hides.
   */
  probe(pos: THREE.Vector3, forward: THREE.Vector3, allowed: boolean, burdened: boolean): void {
    this.attach();
    if (!allowed || this.climbing) {
      this.setAvailable(false);
      this.probeN = 0;
      return;
    }
    if (this.probeN-- > 0) return;
    this.probeN = LEDGE.probeEvery - 1;
    const hit = this.col.ledgeAhead(pos, forward, this.radius, this.height);
    const rise = hit ? hit.top - pos.y : 0;
    const max = burdened ? LEDGE.maxRiseBurdened : LEDGE.maxRise;
    if (!hit || rise < LEDGE.minRise - 0.02 || rise > max + 0.02) {
      this.setAvailable(false);
      return;
    }
    this.target.set(hit.at.x, hit.top, hit.at.z);
    this.item.pos.copy(this.target);
    this.dir.copy(forward);
    this.setAvailable(true);
  }

  /** Another interactable has the bubble (a waystone, a friend): jumping there is just a jump. */
  otherFocused(): boolean {
    const f = services.tryGet('interactables')?.focused;
    return !!f && f !== this.item;
  }

  /** True once after the bubble was used ([E] / X / USE). */
  consumeRequest(): boolean {
    const r = this.requested;
    this.requested = false;
    return r;
  }

  /** Start climbing from `pos`. Returns false when no ledge is available. */
  begin(pos: THREE.Vector3, burdened: boolean): boolean {
    if (!this.available || this.climbing) return false;
    this.climbing = true;
    this.requested = false;
    this.from.copy(pos);
    this.t = 0;
    this.riseT = LEDGE.riseBase + LEDGE.risePerMetre * Math.max(0, this.target.y - pos.y);
    if (burdened) this.riseT *= LEDGE.burdenedSlow;
    this.setAvailable(false);
    events.emit('sfx', { id: 'jump', at: [pos.x, pos.y, pos.z], volume: 0.6, pitch: 0.85 });
    return true;
  }

  /** Total climb time (s). */
  get duration(): number {
    return this.riseT + LEDGE.over;
  }

  /** Facing for the climb (toward the wall). */
  yaw(): number {
    return Math.atan2(this.dir.x, this.dir.z);
  }

  /**
   * Advance the climb and write the feet position to `out`. Returns false on the step it finishes (out is then
   * the standing spot on the ledge).
   */
  advance(dt: number, out: THREE.Vector3): boolean {
    if (!this.climbing) return false;
    this.t += dt;
    const f = this.from;
    const g = this.target;
    if (this.t < this.riseT) {
      const u = smooth(this.t / this.riseT);
      const hug = LEDGE.hug * u;
      out.set(f.x + this.dir.x * hug, f.y + (g.y - f.y) * u, f.z + this.dir.z * hug);
      return true;
    }
    const v = smooth((this.t - this.riseT) / LEDGE.over);
    tmp.set(f.x + this.dir.x * LEDGE.hug, g.y, f.z + this.dir.z * LEDGE.hug);
    out.set(tmp.x + (g.x - tmp.x) * v, g.y + 0.06 * Math.sin(Math.PI * v), tmp.z + (g.z - tmp.z) * v);
    if (this.t < this.riseT + LEDGE.over) return true;
    out.copy(g);
    this.climbing = false;
    this.count++;
    events.emit('sfx', { id: 'land', at: [g.x, g.y, g.z], volume: 0.5 });
    return false;
  }

  /** Stop a climb or hide the bubble (teleports, cutscenes). */
  cancel(): void {
    this.climbing = false;
    this.requested = false;
    this.setAvailable(false);
  }

  dispose(): void {
    this.cancel();
    this.remove?.();
    this.remove = null;
  }

  /** The Interactables service may start after the Player: join it once it exists. */
  private attach(): void {
    if (this.remove) return;
    const svc = services.tryGet('interactables');
    if (svc) this.remove = svc.add(this.item);
  }

  private setAvailable(on: boolean): void {
    this.available = on;
    this.item.enabled = on;
    if (!on) this.requested = false;
  }
}
