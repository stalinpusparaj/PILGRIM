/**
 * Companion steering (GDD 2.8): keep a slot 2-3 m behind-left (or right) of the player, matching the player's
 * speed; far away, run along the main Way spline toward the player, or along the player's breadcrumb trail when
 * either of them is off the Way. Local avoidance: personal space round the player and other NPCs, and a sidestep
 * when a collider holds the body back (the controller does the push-out itself). Hops where the player hopped
 * (gaps, logs), or along with a standing player's hop. Allocation-free per step.
 */
import * as THREE from 'three';
import type { ClosestResult, Way } from '../gen/Way';
import type { CollisionWorld } from '../world/Collision';
import { NPC } from './NPC';
import type { Trail } from './npc-trail';

/** The slot: metres behind the player's heading and to the side (≈ 2.5 m away). */
export const SLOT = { behind: 2.2, side: 1.2 } as const;
const NEAR = 7;
/** Way steering: how far ahead along the spline to aim (m), and how close to the band counts as on it. */
const WAY_LEAD = 4;
const WAY_MARGIN = 3;
/** Slot tracking gain (1/s) and the speed caps (m/s). */
const GAIN = 2.2;
const MAX_SPEED = 6.6;
const RUN = 6.2;
/** Standing still near the slot: start moving again only past this (m), stop inside ARRIVE. */
const RESTART = 1.1;
const ARRIVE = 0.3;
/** Personal space (m) round the player and round other NPCs, and how hard it pushes (1/s). */
const SPACE_PLAYER = 1.3;
const SPACE_NPC = 0.9;
const PUSH = 4;
/** Sidestep after being held back this long (s), for this long (s). */
const BLOCKED_AFTER = 0.35;
const SIDESTEP_FOR = 0.7;
/** Hops: follow the player's take-off within this radius (m) of it, give up after (s); the player's hop counts
 *  as "with me" within this distance (m). */
const HOP_REACH = 0.9;
const HOP_EXPIRE = 2.5;
const HOP_NEAR = 8;
const HOP_TOGETHER = 3.5;
const HOP_DELAY = 0.18;
/** Heading smoothing (1/s) and the speed (m/s) above which the player's motion sets it. */
const HEADING_EASE = 5;
const HEADING_MOVE = 0.4;

export interface FollowTarget {
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  readonly forward: THREE.Vector3;
  readonly speed: number;
}

export type FollowMode = 'slot' | 'way' | 'trail' | 'idle';

export class FollowSteer {
  /** 1 = left of the player, -1 = right. */
  side: 1 | -1;
  /** The slot the companion aims for (world space, feet height of the player). */
  readonly slot = new THREE.Vector3();
  /** Where the steering aims this step. */
  readonly aim = new THREE.Vector3();
  mode: FollowMode = 'idle';
  private hx = 0;
  private hz = 1;
  private hasHeading = false;
  private resting = true;
  private sidestepT = 0;
  private sidestepSign = 1;
  private readonly hopAt = new THREE.Vector3();
  private hopT = -1;
  private hopTogether = false;
  private readonly col: CollisionWorld;
  private readonly way: Way;
  private readonly out = { x: 0, z: 0 };
  private readonly cn: ClosestResult = { t: 0, dist: 0, point: new THREE.Vector3() };
  private readonly cp: ClosestResult = { t: 0, dist: 0, point: new THREE.Vector3() };

  constructor(col: CollisionWorld, way: Way, side: 1 | -1) {
    this.col = col;
    this.way = way;
    this.side = side;
  }

  /** The player took off at `at` (feet). Hop there too, or along with them when standing close. */
  noteJump(at: THREE.Vector3, npc: NPC): void {
    const dx = at.x - npc.position.x;
    const dz = at.z - npc.position.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > HOP_NEAR) return;
    this.hopAt.copy(at);
    this.hopT = 0;
    this.hopTogether = d < HOP_TOGETHER;
  }

  /** Forget the heading and pending hops (after a teleport). */
  reset(): void {
    this.hasHeading = false;
    this.hopT = -1;
    this.resting = true;
    this.sidestepT = 0;
  }

  /** One fixed step: steers `npc` (npc.steer / npc.jump). */
  step(dt: number, npc: NPC, player: FollowTarget, trail: Trail): void {
    this.updateHeading(dt, player);
    const p = player.position;
    const n = npc.position;
    this.placeSlot(p);
    const dpx = p.x - n.x;
    const dpz = p.z - n.z;
    const dp = Math.sqrt(dpx * dpx + dpz * dpz);
    const o = this.out;
    o.x = 0;
    o.z = 0;

    if (dp < NEAR) this.steerSlot(npc, player);
    else this.steerFar(npc, player, trail, dp);

    this.avoid(npc, player);
    this.sidestep(dt, npc);
    const v = Math.sqrt(o.x * o.x + o.z * o.z);
    if (v > MAX_SPEED) {
      o.x *= MAX_SPEED / v;
      o.z *= MAX_SPEED / v;
    }
    npc.steer(o.x, o.z);
    this.hop(dt, npc);
  }

  // ------------------------------------------------------------------------------------------- inside

  private updateHeading(dt: number, player: FollowTarget): void {
    const v = player.velocity;
    const vh = Math.sqrt(v.x * v.x + v.z * v.z);
    if (!this.hasHeading) {
      this.hx = player.forward.x;
      this.hz = player.forward.z;
      this.hasHeading = true;
    }
    if (vh < HEADING_MOVE) return;
    const k = 1 - Math.exp(-HEADING_EASE * dt);
    this.hx += (v.x / vh - this.hx) * k;
    this.hz += (v.z / vh - this.hz) * k;
    const len = Math.sqrt(this.hx * this.hx + this.hz * this.hz) || 1;
    this.hx /= len;
    this.hz /= len;
  }

  /** Behind the heading and to the side; the other side, then straight behind, when that spot is blocked. */
  private placeSlot(p: THREE.Vector3): void {
    // Left of a +Z-facing body is +X: left = (hz, -hx).
    const lx = this.hz;
    const lz = -this.hx;
    const s = this.slot;
    for (let k = 0; k < 3; k++) {
      const side = k === 0 ? this.side : k === 1 ? -this.side : 0;
      s.set(
        p.x - this.hx * SLOT.behind + lx * SLOT.side * side,
        p.y,
        p.z - this.hz * SLOT.behind + lz * SLOT.side * side,
      );
      const y = this.col.groundAt(s.x, s.z, p.y + 0.5);
      if (!this.col.overlaps(s.x, y, s.z, 0.32, 1.4)) {
        s.y = y;
        return;
      }
    }
    s.set(p.x - this.hx * SLOT.behind, p.y, p.z - this.hz * SLOT.behind);
  }

  /** Close: track the slot with the player's own velocity fed forward; rest when there and the player stands. */
  private steerSlot(npc: NPC, player: FollowTarget): void {
    this.mode = 'slot';
    const s = this.slot;
    const n = npc.position;
    const dx = s.x - n.x;
    const dz = s.z - n.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    const still = player.speed < HEADING_MOVE;
    if (still) {
      if (this.resting && d < RESTART) return;
      if (d < ARRIVE) {
        this.resting = true;
        return;
      }
    }
    this.resting = false;
    this.aim.copy(s);
    const ff = still ? 0 : 1;
    this.out.x = player.velocity.x * ff + dx * GAIN;
    this.out.z = player.velocity.z * ff + dz * GAIN;
    // Walking pace when only a little behind: a gentle catch-up, never a sprint for half a metre.
    const v = Math.sqrt(this.out.x * this.out.x + this.out.z * this.out.z);
    const cap = Math.max(player.speed + 1.2, 2.2);
    if (v > cap) {
      this.out.x *= cap / v;
      this.out.z *= cap / v;
    }
  }

  /** Far: along the Way when both are on it, else along the breadcrumbs; run when well behind. */
  private steerFar(npc: NPC, player: FollowTarget, trail: Trail, dp: number): void {
    this.resting = false;
    const n = npc.position;
    const p = player.position;
    const way = this.way;
    const band = way.halfWidth + WAY_MARGIN;
    const cn = way.closest(n.x, n.z, this.cn);
    const tn = cn.t;
    const onN = cn.dist < band;
    const cp = way.closest(p.x, p.z, this.cp);
    const onP = cp.dist < band;
    const len = Math.max(1, way.length);
    const ahead = (cp.t - tn) * len;
    if (onN && onP && Math.abs(ahead) > WAY_LEAD) {
      this.mode = 'way';
      way.sample(clamp01(tn + (Math.sign(ahead) * WAY_LEAD) / len), this.aim);
    } else if (trail.nextTarget(n, this.aim)) {
      this.mode = 'trail';
    } else {
      this.mode = 'slot';
      this.aim.copy(this.slot);
    }
    const dx = this.aim.x - n.x;
    const dz = this.aim.z - n.z;
    const d = Math.sqrt(dx * dx + dz * dz) || 1;
    const speed = dp > NEAR + 3 ? RUN : Math.max(player.speed + 1.5, 3.4);
    this.out.x = (dx / d) * speed;
    this.out.z = (dz / d) * speed;
  }

  /** Personal space: never bump into the player or another NPC. */
  private avoid(npc: NPC, player: FollowTarget): void {
    const n = npc.position;
    this.push(n, player.position, SPACE_PLAYER);
    const all = NPC.all;
    for (let i = 0; i < all.length; i++) {
      const other = all[i]!;
      if (other !== npc) this.push(n, other.position, SPACE_NPC);
    }
  }

  private push(n: THREE.Vector3, from: THREE.Vector3, space: number): void {
    const dx = n.x - from.x;
    const dz = n.z - from.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d >= space || Math.abs(n.y - from.y) > 2) return;
    const k = ((space - d) * PUSH) / (d > 1e-3 ? d : 1);
    this.out.x += (d > 1e-3 ? dx : 1) * k;
    this.out.z += (d > 1e-3 ? dz : 0) * k;
  }

  /** Held back by a collider: slide sideways for a moment, toward the side the aim lies on. */
  private sidestep(dt: number, npc: NPC): void {
    const o = this.out;
    if (this.sidestepT <= 0 && npc.blockedTime > BLOCKED_AFTER) {
      const n = npc.position;
      const cross = o.x * (this.aim.z - n.z) - o.z * (this.aim.x - n.x);
      this.sidestepSign = cross >= 0 ? 1 : -1;
      this.sidestepT = SIDESTEP_FOR;
    }
    if (this.sidestepT <= 0) return;
    this.sidestepT -= dt;
    const v = Math.sqrt(o.x * o.x + o.z * o.z);
    if (v < 0.1) return;
    // Perpendicular to the wish, as fast as the wish.
    const px = (-o.z / v) * this.sidestepSign;
    const pz = (o.x / v) * this.sidestepSign;
    o.x = (o.x * 0.3 + px * v) / 1.05;
    o.z = (o.z * 0.3 + pz * v) / 1.05;
  }

  private hop(dt: number, npc: NPC): void {
    if (this.hopT < 0) return;
    this.hopT += dt;
    if (this.hopT > HOP_EXPIRE) {
      this.hopT = -1;
      return;
    }
    if (!npc.grounded) return;
    let go: boolean;
    if (this.hopTogether) go = this.hopT >= HOP_DELAY;
    else {
      const dx = this.hopAt.x - npc.position.x;
      const dz = this.hopAt.z - npc.position.z;
      go = dx * dx + dz * dz < HOP_REACH * HOP_REACH;
    }
    if (go) {
      npc.jump();
      this.hopT = -1;
    }
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
