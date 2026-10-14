/**
 * In-house kinematic controller (GDD 2.15): heightfield ground, capsule vs simple colliders, slope limit, step-up,
 * coyote time 0.1 s and jump buffer 0.1 s. No physics engine.
 *
 * Feel (kids 6-12): ground acceleration is quick and stopping / turning quicker still; air control is reduced;
 * gravity is a snappy cartoon -24 m/s² and jumps reach exactly `jumpHeight` (exact parabola per sub-step).
 * Walking downhill snaps to the ground (no hopping down hills); ground steeper than `slopeLimit` cannot be climbed
 * (walking or jumping into it is blocked) and slides you gently down.
 *
 * Deterministic for a fixed dt and allocation-free. `step()` returns a reused StepResult (read it before the next
 * call). The controller emits no events: the Player turns `landed` / `jumped` into `player:landed`, dust and sfx.
 */
import * as THREE from 'three';
import { makeGroundHit, type CollisionWorld } from '../world/Collision';
import { approach2, clipAgainstContacts } from './controller-math';

export interface MoveParams {
  walkSpeed: number;
  runSpeed: number;
  jumpHeight: number;
  /** Gravity magnitude in m/s² (the sign is ignored: 24 and -24 are the same). */
  gravity: number;
  /** Ground acceleration toward the wish velocity, m/s² (braking / turning use 1.6×). */
  accel: number;
  /** Fraction of `accel` available in the air. */
  airControl: number;
  /** Degrees (40). */
  slopeLimit: number;
  /** Metres (0.3). */
  stepUp: number;
}

export interface StepResult {
  jumped: boolean;
  landed: boolean;
  /** Downward speed at touchdown (m/s, >= 0) when `landed`. */
  landSpeed: number;
  grounded: boolean;
  /** Pushing into a wall, a too-steep slope or the map edge this step. */
  blocked: boolean;
}

/** Free-walking defaults (GDD 2.7.1 free speeds; the Burden system supplies its own). */
export const DEFAULT_MOVE_PARAMS: Readonly<MoveParams> = {
  walkSpeed: 3.4,
  runSpeed: 6,
  jumpHeight: 1.1,
  gravity: 24,
  accel: 30,
  airControl: 0.5,
  slopeLimit: 40,
  stepUp: 0.3,
};

/** Seconds after leaving walkable ground that a jump still works. */
export const COYOTE_TIME = 0.1;
/** Seconds a jump press is remembered before landing. */
export const JUMP_BUFFER = 0.1;
/** Ledge forgiveness while airborne: tops this far above the feet are landed on, not bumped into (m). */
const AIR_STEP = 0.05;
const MAX_FALL = 30;
/** Gentle slide speed down ground steeper than the slope limit (m/s). */
const SLIDE_SPEED = 3;
/** Support disc radius as a fraction of the capsule radius (feet overhang edges a little before dropping). */
const FOOT = 0.75;
const BRAKE = 1.6;
const MAX_SUBSTEPS = 8;
const WIN_EPS = 1e-6;
/** teleport() snaps to ground this close below the feet (m). */
const TELEPORT_SNAP = 0.05;
/** stepOffset eases away at this rate (1/s): a 0.28 m stile step settles in about 0.15 s. */
const STEP_EASE = 22;

export class KinematicController {
  /** Feet position (bottom of the capsule). */
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  /** Normal of the ground under the feet (straight up while airborne). */
  readonly groundNormal = new THREE.Vector3(0, 1, 0);
  readonly radius: number;
  readonly height: number;

  private readonly col: CollisionWorld;
  private onGround = false;
  private onSteep = false;
  private groundId = -1;
  /** Seconds since the feet left the ground. */
  private air = 0;
  /** True while a coyote jump is allowed (left walkable ground without jumping). */
  private coyoteOk = false;
  private sincePress = Infinity;
  private jumpHeld = false;
  private wishX = 0;
  private wishZ = 0;
  private wishLen = 0;
  private smoothY = 0;
  private readonly hit = makeGroundHit();
  private readonly res: StepResult = {
    jumped: false,
    landed: false,
    landSpeed: 0,
    grounded: false,
    blocked: false,
  };

  constructor(col: CollisionWorld, radius = 0.35, height = 1.5) {
    this.col = col;
    this.radius = radius > 0.05 ? radius : 0.35;
    this.height = height > this.radius * 2 ? height : Math.max(1.5, this.radius * 2);
  }

  get grounded(): boolean {
    return this.onGround;
  }
  /** On ground steeper than the slope limit (grounded, sliding down, no jumping). */
  get sliding(): boolean {
    return this.onSteep;
  }
  /** Collider handle under the feet, -1 for terrain or airborne. */
  get groundHandle(): number {
    return this.onGround ? this.groundId : -1;
  }
  /** Visual-only height offset (m) for the drawn body: stepping onto or off a collider eases instead of popping. */
  get stepOffset(): number {
    return this.smoothY;
  }
  /** Seconds since the feet left the ground (0 while grounded). */
  get airTime(): number {
    return this.onGround ? 0 : this.air;
  }

  /**
   * One fixed step. `wish` is the desired horizontal velocity (m/s); `jump` is the jump button (held or pressed:
   * a press is its rising edge, so holding never bunny-hops).
   */
  step(dt: number, wish: { x: number; z: number }, jump: boolean, p: MoveParams): StepResult {
    const r = this.res;
    r.jumped = false;
    r.landed = false;
    r.landSpeed = 0;
    r.blocked = false;
    if (!(dt > 0) || !Number.isFinite(dt)) {
      r.grounded = this.onGround;
      return r;
    }
    const g = Math.abs(p.gravity) > 0.1 ? Math.abs(p.gravity) : 24;
    const stepUp = Math.max(0, Math.min(1, Number.isFinite(p.stepUp) ? p.stepUp : 0.3));
    this.col.slopeLimit = p.slopeLimit;
    this.wishX = Number.isFinite(wish.x) ? wish.x : 0;
    this.wishZ = Number.isFinite(wish.z) ? wish.z : 0;
    this.wishLen = Math.sqrt(this.wishX * this.wishX + this.wishZ * this.wishZ);

    // Input windows.
    const pressed = jump && !this.jumpHeld;
    this.jumpHeld = jump;
    this.sincePress = pressed ? 0 : this.sincePress + dt;
    if (!this.onGround) this.air += dt;
    this.smoothY = Math.abs(this.smoothY) < 1e-4 ? 0 : this.smoothY * Math.exp(-STEP_EASE * dt);

    // Horizontal velocity toward the wish (sliding: no uphill wish, plus a gentle pull downhill).
    const v = this.velocity;
    let tx = this.wishX;
    let tz = this.wishZ;
    if (this.onGround && this.onSteep) {
      const hl = Math.hypot(this.groundNormal.x, this.groundNormal.z);
      if (hl > 1e-6) {
        const dx = this.groundNormal.x / hl;
        const dz = this.groundNormal.z / hl;
        const up = -(tx * dx + tz * dz);
        if (up > 0) {
          tx += up * dx;
          tz += up * dz;
          if (up > 0.3 * this.wishLen) r.blocked = true;
        }
        tx += dx * SLIDE_SPEED;
        tz += dz * SLIDE_SPEED;
      }
    }
    let rate = p.accel * (this.onGround ? 1 : Math.max(0, p.airControl));
    if (this.onGround && tx * v.x + tz * v.z < v.x * v.x + v.z * v.z - 1e-9) rate *= BRAKE;
    approach2(v, tx, tz, Math.max(0, rate) * dt);

    if (this.sincePress <= JUMP_BUFFER + WIN_EPS && this.canJump()) this.jumpNow(g, p.jumpHeight);

    // Sub-step so nothing moves more than half a radius per pass (no tunnelling through thin walls).
    const travel = Math.max(Math.hypot(v.x, v.z), Math.abs(v.y)) * dt;
    const n = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(travel / (this.radius * 0.5))));
    const sdt = dt / n;
    for (let i = 0; i < n; i++) this.substep(sdt, g, stepUp, p.jumpHeight);

    if (!this.onGround) this.groundNormal.set(0, 1, 0);
    r.grounded = this.onGround;
    return r;
  }

  /**
   * Puts the feet exactly at `p` and clears velocity and input windows. Grounded when p is on the ground or a
   * walkable top (within 5 cm; a point under the terrain is lifted onto it), else it falls from there. Tops
   * above p are ignored, so scripted paths (ledge climbs) can call this every step.
   */
  teleport(p: THREE.Vector3): void {
    this.position.copy(p);
    this.velocity.set(0, 0, 0);
    this.smoothY = 0;
    const h = this.col.probeGround(p.x, p.z, p.y, TELEPORT_SNAP, this.radius * FOOT, this.hit);
    if (p.y - h.y <= TELEPORT_SNAP) {
      this.position.y = h.y;
      this.setGround(true);
    } else {
      this.onGround = false;
      this.onSteep = false;
      this.groundNormal.set(0, 1, 0);
    }
    this.air = 0;
    this.coyoteOk = false;
    this.sincePress = Infinity;
  }

  /** Forgets a buffered jump press, so it cannot fire on the next landing (a script is taking control). */
  cancelJump(): void {
    this.sincePress = Infinity;
  }

  /** Throws the controller upward at `vy` m/s (bounce pads, joy hops scripted by others). */
  launch(vy: number): void {
    if (!(vy > 0)) return;
    this.velocity.y = vy;
    this.onGround = false;
    this.onSteep = false;
    this.coyoteOk = false;
    this.air = 0;
    this.groundNormal.set(0, 1, 0);
  }

  private canJump(): boolean {
    if (this.onGround) return !this.onSteep;
    return this.coyoteOk && this.air <= COYOTE_TIME + WIN_EPS;
  }

  private jumpNow(g: number, jumpHeight: number): void {
    this.velocity.y = Math.sqrt(2 * g * Math.max(0, jumpHeight));
    this.onGround = false;
    this.onSteep = false;
    this.coyoteOk = false;
    this.sincePress = Infinity;
    this.air = 0;
    this.groundNormal.set(0, 1, 0);
    this.res.jumped = true;
  }

  private setGround(on: boolean): void {
    const h = this.hit;
    this.onGround = on;
    this.onSteep = on && h.steep;
    this.groundId = on ? h.handle : -1;
    if (on) {
      this.groundNormal.set(h.nx, h.ny, h.nz);
      this.air = 0;
      this.velocity.y = 0;
      this.coyoteOk = !h.steep;
    }
  }

  private substep(sdt: number, g: number, stepUp: number, jumpHeight: number): void {
    const pos = this.position;
    const v = this.velocity;
    const col = this.col;
    const h = this.hit;
    const fr = this.radius * FOOT;
    const x0 = pos.x;
    const y0 = pos.y;
    const z0 = pos.z;
    const vy0 = v.y;
    let mx = v.x * sdt;
    let mz = v.z * sdt;

    // Walking into ground steeper than the limit: drop the uphill part of the move (slide along its foot).
    if (this.onGround && (mx !== 0 || mz !== 0)) {
      col.probeGround(x0 + mx, z0 + mz, y0, stepUp, fr, h);
      if (h.steep && h.y > y0 + 1e-3) {
        const hl = Math.hypot(h.nx, h.nz);
        if (hl > 1e-6) {
          const ux = -h.nx / hl;
          const uz = -h.nz / hl;
          const a = mx * ux + mz * uz;
          if (a > 0) {
            mx -= a * ux;
            mz -= a * uz;
          }
          const va = v.x * ux + v.z * uz;
          if (va > 0) {
            v.x -= va * ux;
            v.z -= va * uz;
          }
          if (this.wishX * ux + this.wishZ * uz > 0.3 * this.wishLen) this.res.blocked = true;
          col.probeGround(x0 + mx, z0 + mz, y0, stepUp, fr, h);
          if (h.steep && h.y > y0 + 1e-3) mx = mz = 0;
        }
      }
    }
    pos.x = x0 + mx;
    pos.z = z0 + mz;

    if (!this.onGround) {
      // Exact parabola over the sub-step, so jump apexes match jumpHeight.
      pos.y = y0 + v.y * sdt - 0.5 * g * sdt * sdt;
      v.y = Math.max(v.y - g * sdt, -MAX_FALL);
      if (pos.y > y0) {
        const ceil = col.ceilingAbove(pos.x, pos.z, y0 + this.height, this.radius * 0.9);
        if (pos.y + this.height > ceil) {
          pos.y = Math.max(y0, ceil - this.height);
          if (v.y > 0) v.y = 0;
        }
      }
    }

    // Walls (steps within stepUp are climbed while grounded; in the air a top the feet were above is a landing).
    const step = this.onGround ? stepUp : Math.max(AIR_STEP, y0 - pos.y + AIR_STEP);
    if (col.resolve(pos, this.radius, this.height, step)) {
      if (clipAgainstContacts(v, col, this.wishX, this.wishZ, this.wishLen)) this.res.blocked = true;
    }
    this.keepOnMap();

    if (this.onGround) {
      col.probeGround(pos.x, pos.z, y0, stepUp, fr, h);
      const snap = Math.max(stepUp, 0.05);
      if (h.y >= y0 - snap && (!h.steep || this.onSteep || h.y >= y0 - 1e-4)) {
        const dy = h.y - y0;
        if (h.handle !== this.groundId && Math.abs(dy) > 0.04) {
          this.smoothY = Math.max(-0.4, Math.min(0.4, this.smoothY - dy));
        }
        pos.y = h.y;
        this.setGround(true);
      } else {
        // Walked off an edge (or onto a cliff face): fall, with coyote time if the ground was walkable.
        this.coyoteOk = !this.onSteep;
        this.onGround = false;
        this.onSteep = false;
        this.air = 0;
        v.y = 0;
      }
      return;
    }

    col.probeGround(pos.x, pos.z, Math.max(y0, pos.y), AIR_STEP, fr, h);
    if (pos.y > h.y + 1e-6) return;
    if (h.steep && h.handle < 0 && h.y > y0 + 1e-3) {
      // Steep ground rising above the feet is a wall in the air too (no jump-climbing cliffs).
      pos.x = x0;
      pos.z = z0;
      const hl = Math.hypot(h.nx, h.nz);
      if (hl > 1e-6) {
        const ux = -h.nx / hl;
        const uz = -h.nz / hl;
        const va = v.x * ux + v.z * uz;
        if (va > 0) {
          v.x -= va * ux;
          v.z -= va * uz;
        }
        if (this.wishX * ux + this.wishZ * uz > 0.3 * this.wishLen) this.res.blocked = true;
      }
      col.probeGround(x0, z0, Math.max(y0, pos.y), AIR_STEP, fr, h);
      if (pos.y > h.y + 1e-6) return;
    }
    if (v.y > 0) {
      pos.y = h.y; // rising over walkable ground that climbs faster than the jump
      return;
    }
    // Exact touchdown speed on the parabola (not the end-of-sub-step speed).
    const landSpeed = Math.min(MAX_FALL, Math.sqrt(vy0 * vy0 + 2 * g * Math.max(0, y0 - h.y)));
    pos.y = h.y;
    this.setGround(true);
    this.res.landed = true;
    if (landSpeed > this.res.landSpeed) this.res.landSpeed = landSpeed;
    // A jump pressed just before touchdown fires now.
    if (this.sincePress <= JUMP_BUFFER + WIN_EPS && !this.onSteep) this.jumpNow(g, jumpHeight);
  }

  private keepOnMap(): void {
    const half = this.col.size / 2 - 0.5;
    const pos = this.position;
    const v = this.velocity;
    if (pos.x > half || pos.x < -half) {
      pos.x = pos.x > half ? half : -half;
      if (Math.sign(v.x) === Math.sign(pos.x)) v.x = 0;
      if (Math.sign(this.wishX) === Math.sign(pos.x) && Math.abs(this.wishX) > 0.3 * this.wishLen)
        this.res.blocked = true;
    }
    if (pos.z > half || pos.z < -half) {
      pos.z = pos.z > half ? half : -half;
      if (Math.sign(v.z) === Math.sign(pos.z)) v.z = 0;
      if (Math.sign(this.wishZ) === Math.sign(pos.z) && Math.abs(this.wishZ) > 0.3 * this.wishLen)
        this.res.blocked = true;
    }
  }
}
