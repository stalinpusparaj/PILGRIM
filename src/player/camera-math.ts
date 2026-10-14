/**
 * Small, allocation-free maths for the follow camera: frame-rate independent damping, angle wrapping and the
 * interpolated parameter snapshot that update() writes and render(alpha) blends.
 */

export const TAU = Math.PI * 2;

/** Wraps an angle to (-PI, PI]. */
export function wrapAngle(a: number): number {
  let d = (a + Math.PI) % TAU;
  if (d < 0) d += TAU;
  return d - Math.PI;
}

/** Shortest-way interpolation between two angles. */
export function lerpAngle(a: number, b: number, t: number): number {
  return a + wrapAngle(b - a) * t;
}

/** Exponential approach: frame-rate independent (`rate` per second). */
export function damp(from: number, to: number, rate: number, dt: number): number {
  return from + (to - from) * (1 - Math.exp(-rate * dt));
}

/** Exponential approach for angles, the short way round. */
export function dampAngle(from: number, to: number, rate: number, dt: number): number {
  return wrapAngle(from + wrapAngle(to - from) * (1 - Math.exp(-rate * dt)));
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Everything render(alpha) needs to rebuild the camera around the player's interpolated position. */
export class CamParams {
  /** Look direction (rad): forward = (sin yaw, 0, cos yaw), the player's facing convention. */
  yaw = 0;
  /** Arm elevation above the pivot (rad). */
  pitch = 0;
  /** Unobstructed arm length (m) and the fraction of it collision allows (0..1). */
  arm = 0;
  armFrac = 1;
  /** Extra camera height when the arm is pulled in close (m). */
  lift = 0;
  /** Look point moved forward when the arm is pulled in close (m). */
  ahead = 0;
  /** Sideways offset of pivot and look point (m, camera right), after collision. */
  shoulder = 0;
  /** Look-at height above the feet (m). */
  lookH = 0;
  /** Sideways camera sway (m). */
  sway = 0;
  /** Vertical thud offset (m). */
  bob = 0;
  /** Smoothed height minus the player's height (m). */
  lag = 0;
  /** Extra field of view (degrees). */
  fovKick = 0;

  copy(o: CamParams): this {
    this.yaw = o.yaw;
    this.pitch = o.pitch;
    this.arm = o.arm;
    this.armFrac = o.armFrac;
    this.lift = o.lift;
    this.ahead = o.ahead;
    this.shoulder = o.shoulder;
    this.lookH = o.lookH;
    this.sway = o.sway;
    this.bob = o.bob;
    this.lag = o.lag;
    this.fovKick = o.fovKick;
    return this;
  }

  /** this = a..b at t (angles the short way). */
  lerp(a: CamParams, b: CamParams, t: number): this {
    this.yaw = lerpAngle(a.yaw, b.yaw, t);
    this.pitch = a.pitch + (b.pitch - a.pitch) * t;
    this.arm = a.arm + (b.arm - a.arm) * t;
    this.armFrac = a.armFrac + (b.armFrac - a.armFrac) * t;
    this.lift = a.lift + (b.lift - a.lift) * t;
    this.ahead = a.ahead + (b.ahead - a.ahead) * t;
    this.shoulder = a.shoulder + (b.shoulder - a.shoulder) * t;
    this.lookH = a.lookH + (b.lookH - a.lookH) * t;
    this.sway = a.sway + (b.sway - a.sway) * t;
    this.bob = a.bob + (b.bob - a.bob) * t;
    this.lag = a.lag + (b.lag - a.lag) * t;
    this.fovKick = a.fovKick + (b.fovKick - a.fovKick) * t;
    return this;
  }
}
