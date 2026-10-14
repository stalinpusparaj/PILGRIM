/**
 * Scripted walks for NPCs (NPC.walkTo / followPath): a list of ground points walked in order at a set speed,
 * slowing into the last one, with a promise that resolves on arrival (or when stopped / replaced / disposed: a
 * script awaiting it never hangs). A walk that makes no progress for STUCK_SEC (a wall, too steep a slope) ends
 * by placing the walker on the point when it is free, else where it stands.
 */
import * as THREE from 'three';

/** Default speeds (m/s): an unhurried story walk, a run. */
export const WALK_SPEED = 1.8;
export const RUN_SPEED = 5;
/** Arrival radius at the last point, and the corner-cutting radius at the ones before (m). */
const ARRIVE = 0.25;
const CORNER = 0.7;
/** Slow-down gain into the last point (1/s): speed = min(speed, distance × gain). */
const BRAKE_GAIN = 3;
const STUCK_SEC = 2.5;
const PROGRESS = 0.1;

export interface WalkStep {
  /** Desired horizontal velocity (m/s). */
  x: number;
  z: number;
}

export class WalkPlan {
  private pts: THREE.Vector3[] = [];
  private i = 0;
  private speed = WALK_SPEED;
  private resolve: (() => void) | null = null;
  private best = Infinity;
  private stuckT = 0;

  get active(): boolean {
    return this.resolve !== null;
  }

  /** The point being walked to (null when idle). */
  get target(): THREE.Vector3 | null {
    return this.resolve ? (this.pts[this.i] ?? null) : null;
  }

  /** Starts a walk; any running one resolves first. */
  start(points: readonly THREE.Vector3[], speed: number): Promise<void> {
    this.finish();
    if (points.length === 0) return Promise.resolve();
    this.pts = points.map((p) => p.clone());
    this.i = 0;
    this.speed = Number.isFinite(speed) && speed > 0.05 ? speed : WALK_SPEED;
    this.best = Infinity;
    this.stuckT = 0;
    return new Promise<void>((res) => {
      this.resolve = res;
    });
  }

  /** Ends the walk now; its promise resolves. */
  finish(): void {
    const r = this.resolve;
    this.resolve = null;
    this.pts = [];
    r?.();
  }

  /**
   * One fixed step from `pos`: fills `out` with the wish velocity. Returns 'walk', 'arrived' (finish() was called)
   * or 'stuck' (the caller decides where to put the walker, then calls finish()).
   */
  step(dt: number, pos: THREE.Vector3, out: WalkStep): 'walk' | 'arrived' | 'stuck' {
    out.x = 0;
    out.z = 0;
    if (!this.resolve) return 'arrived';
    let p = this.pts[this.i]!;
    let dx = p.x - pos.x;
    let dz = p.z - pos.z;
    let d = Math.sqrt(dx * dx + dz * dz);
    const last = this.i === this.pts.length - 1;
    if (!last && d < CORNER) {
      this.i++;
      this.best = Infinity;
      this.stuckT = 0;
      p = this.pts[this.i]!;
      dx = p.x - pos.x;
      dz = p.z - pos.z;
      d = Math.sqrt(dx * dx + dz * dz);
    } else if (last && d < ARRIVE) {
      this.finish();
      return 'arrived';
    }
    if (d < this.best - PROGRESS) {
      this.best = d;
      this.stuckT = 0;
    } else if ((this.stuckT += dt) > STUCK_SEC) {
      return 'stuck';
    }
    const isLast = this.i === this.pts.length - 1;
    const v = isLast ? Math.min(this.speed, Math.max(0.4, d * BRAKE_GAIN)) : this.speed;
    out.x = (dx / d) * v;
    out.z = (dz / d) * v;
    return 'walk';
  }
}
