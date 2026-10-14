/**
 * The player's breadcrumb trail (GDD 2.8: "Off the Way they follow the player's breadcrumb trail"): grounded feet
 * positions about every 0.5 m in a fixed ring (no allocation after construction). A jump of more than 6 m between
 * two records (a teleport, a respawn) starts a new trail.
 */
import * as THREE from 'three';

/** Metres between crumbs. */
export const TRAIL_SPACING = 0.5;
/** A gap this long between records is a teleport: the trail restarts. */
const BREAK = 6;
/** Crumbs to skip ahead of the nearest one when steering (m ≈ n × spacing). */
const LEAD = 2;

export class Trail {
  readonly max: number;
  private readonly pts: THREE.Vector3[];
  /** Index of the newest crumb. */
  private head = -1;
  private n = 0;

  constructor(max = 64) {
    this.max = Math.max(4, Math.floor(max));
    this.pts = Array.from({ length: this.max }, () => new THREE.Vector3());
  }

  get count(): number {
    return this.n;
  }

  /** Crumb i, 0 = newest (i < count). */
  at(i: number): THREE.Vector3 {
    const k = (((this.head - i) % this.max) + this.max) % this.max;
    return this.pts[k]!;
  }

  clear(): void {
    this.head = -1;
    this.n = 0;
  }

  /** Adds `p` when it is at least TRAIL_SPACING from the newest crumb (only grounded positions are kept). */
  record(p: THREE.Vector3, grounded: boolean): void {
    if (!grounded) return;
    if (this.n > 0) {
      const last = this.at(0);
      const dx = p.x - last.x;
      const dz = p.z - last.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < TRAIL_SPACING * TRAIL_SPACING) return;
      if (d2 > BREAK * BREAK) this.clear();
    }
    this.head = (this.head + 1) % this.max;
    this.pts[this.head]!.copy(p);
    if (this.n < this.max) this.n++;
  }

  /**
   * Where to steer from `pos` along the trail: the crumb nearest to `pos`, then LEAD crumbs newer (toward the
   * player). False when the trail is empty.
   */
  nextTarget(pos: THREE.Vector3, out: THREE.Vector3): boolean {
    if (this.n === 0) return false;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < this.n; i++) {
      const c = this.at(i);
      const dx = c.x - pos.x;
      const dz = c.z - pos.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    out.copy(this.at(Math.max(0, best - LEAD)));
    return true;
  }
}
