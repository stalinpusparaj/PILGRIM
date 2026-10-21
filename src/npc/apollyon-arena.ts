/**
 * The Apollyon arena (GDD 2.9: a 40 x 18 m valley floor) read from the level's box zone of type 'arena': its
 * frame (centre, half sizes, turn), where each phase puts Christian and Apollyon, and the soft edge that keeps
 * Christian inside while the fight runs (no wall colliders, so the follow camera never bumps into them).
 * Everything is relative to the zone: no coordinates live in code.
 */
import * as THREE from 'three';
import type { LevelZone } from '../world/LevelTypes';

/** How far inside the edge Christian is held (m). */
const EDGE = 0.8;
/** Where the two stand at a phase start, as a share of the half length from the centre. */
const SPOT = 0.25;

export class Arena {
  readonly cx: number;
  readonly cz: number;
  readonly hx: number;
  readonly hz: number;
  private readonly cos: number;
  private readonly sin: number;

  constructor(zone: LevelZone) {
    const at = zone['at'];
    const atXZ = Array.isArray(at) ? (at as number[]) : null;
    this.cx = zone.x ?? atXZ?.[0] ?? 0;
    this.cz = zone.z ?? atXZ?.[2] ?? 0;
    const size = zone.size ?? [40, 18];
    this.hx = size[0] / 2;
    this.hz = size[1] / 2;
    const rot = typeof zone['rotY'] === 'number' ? (zone['rotY'] as number) : 0;
    this.cos = Math.cos(rot);
    this.sin = Math.sin(rot);
  }

  /** World point of arena-local (u along the length, v across). */
  point(u: number, v: number, out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.cx + this.cos * u + this.sin * v, out.y, this.cz - this.sin * u + this.cos * v);
  }

  /** Where Christian starts a phase (west end) and faces (toward the centre). */
  start(out: THREE.Vector3): THREE.Vector3 {
    return this.point(-this.hx * SPOT, 0, out);
  }

  /** Where Apollyon starts a phase (east end). */
  home(out: THREE.Vector3): THREE.Vector3 {
    return this.point(this.hx * SPOT, 0, out);
  }

  /**
   * Where Apollyon lands when the fight starts: `dist` m ahead of Christian along the arena (behind him when he
   * stands too near the far end), inside the edge.
   */
  landing(from: THREE.Vector3, dist: number, out: THREE.Vector3): THREE.Vector3 {
    const ahead = (sign: number): THREE.Vector3 => {
      out.set(from.x + this.cos * dist * sign, from.y, from.z - this.sin * dist * sign);
      this.clamp(out, 2);
      return out;
    };
    ahead(1);
    if (Math.hypot(out.x - from.x, out.z - from.z) < dist * 0.6) ahead(-1);
    return out;
  }

  /** Facing yaw (characters face +Z) along the arena's length, west to east. */
  get facing(): number {
    return Math.atan2(this.cos, -this.sin);
  }

  /** True when (x, z) is inside the box grown by `margin`. */
  contains(x: number, z: number, margin = 0): boolean {
    const dx = x - this.cx;
    const dz = z - this.cz;
    const u = this.cos * dx - this.sin * dz;
    const v = this.sin * dx + this.cos * dz;
    return Math.abs(u) <= this.hx + margin && Math.abs(v) <= this.hz + margin;
  }

  /** Pulls `p` back inside the box (shrunk by `inset`, default the soft edge). Returns true if it moved. */
  clamp(p: THREE.Vector3, inset = EDGE): boolean {
    const dx = p.x - this.cx;
    const dz = p.z - this.cz;
    const u = this.cos * dx - this.sin * dz;
    const v = this.sin * dx + this.cos * dz;
    const mu = this.hx - inset;
    const mv = this.hz - inset;
    const cu = Math.max(-mu, Math.min(mu, u));
    const cv = Math.max(-mv, Math.min(mv, v));
    if (cu === u && cv === v) return false;
    p.x = this.cx + this.cos * cu + this.sin * cv;
    p.z = this.cz - this.sin * cu + this.cos * cv;
    return true;
  }
}
