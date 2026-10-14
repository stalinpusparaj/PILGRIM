/**
 * Static + dynamic colliders over the terrain for the in-house kinematic controller (GDD 2.15: no physics engine).
 *
 * - Ground: the terrain's exact triangle height, or the top of a walkable collider (bridges, stile steps, logs,
 *   rock caps, revealed Slough stones) reachable within `stepUp` of the feet.
 * - Walls: the player capsule (feet at pos.y) against boxes (turned by rotY), upright cylinders and spheres,
 *   pushed out sideways along the shortest separation, deepest contact first, up to 4 passes. A walkable collider
 *   whose top is within `stepUp` of the feet is a step, not a wall.
 * - Broadphase: a uniform ~8 m grid (collision-grid.ts). Queries never allocate.
 * World colliders (`world.colliders`) are added at construction (handles 0..n-1) as walkable, except upright
 * cylinders taller than 2.2 m (tree trunks, tall posts: nobody stands on those, and the camera floor must not
 * either); `addCollider` adds more (default not walkable: NPC blockers, closed gates).
 */
import * as THREE from 'three';
import type { Collider } from '../gen/types';
import { UniformGrid } from './collision-grid';
import {
  SPHERE,
  footprintOverlaps,
  makeEntry,
  penetration,
  topUnder,
  type ColEntry,
  type Push,
  type SurfaceKind,
} from './collision-shapes';
import { fitOnTop, rayColliders, rayTerrain } from './collision-query';
import { SurfaceMap } from './collision-surface';
import {
  makeGroundHit,
  type CollisionSource,
  type GroundField,
  type GroundHit,
  type LedgeHit,
} from './collision-types';

export type { SurfaceKind } from './collision-shapes';
export {
  makeGroundHit,
  type CollisionSource,
  type GroundField,
  type GroundHit,
  type LedgeHit,
} from './collision-types';

const EPS = 1e-5;
const MAX_CONTACTS = 8;
const LEDGE_MIN = 0.6;
const LEDGE_MAX = 1.8;
const LEDGE_PROBES = [0.1, 0.25, 0.4] as const;
/** World cylinders taller than this are trunks / posts: walls, never floors. */
const TALL_CYLINDER = 2.2;

export class CollisionWorld {
  /** Default step-up height (m) for groundAt / resolve when the caller does not pass one. */
  stepUp = 0.3;
  /** Number of contacts the last resolve() recorded; normals in contactNx / contactNz (unit, horizontal). */
  contactCount = 0;
  readonly contactNx = new Float64Array(MAX_CONTACTS);
  readonly contactNz = new Float64Array(MAX_CONTACTS);
  readonly contactHandle = new Int32Array(MAX_CONTACTS);
  /** Map width in metres (the controller keeps the player inside it). */
  readonly size: number;

  private readonly terrain: GroundField;
  private readonly surfaces: SurfaceMap;
  private readonly entries: ColEntry[] = [];
  private readonly grid: UniformGrid;
  private readonly push: Push = { nx: 0, nz: 0, depth: 0 };
  private readonly hit = makeGroundHit();
  private readonly tmpN = new THREE.Vector3();
  private readonly ledge: LedgeHit = { top: 0, at: new THREE.Vector3() };
  private readonly tmpP = new THREE.Vector3();
  private readonly fit = { x: 0, z: 0 };
  private cosLimit = Math.cos((40 * Math.PI) / 180);
  private capSin = Math.sin((40 * Math.PI) / 180);
  private limitDeg = 40;
  private disposed = false;
  private readonly acceptLive = (id: number): boolean => {
    const e = this.entries[id];
    return e !== undefined && e.alive && e.enabled;
  };

  constructor(world: CollisionSource) {
    this.terrain = world.terrain;
    this.size = world.terrain.size;
    this.surfaces = new SurfaceMap(world.level, [world.ways.main, ...world.ways.detours]);
    this.grid = new UniformGrid(this.size, 8);
    for (const c of world.colliders) {
      this.addCollider(c, { walkable: c.kind !== 'cylinder' || !(c.height > TALL_CYLINDER) });
    }
  }

  /** Slope limit in degrees (ground steeper than this is `steep`; sphere tops are walkable up to it). */
  get slopeLimit(): number {
    return this.limitDeg;
  }
  set slopeLimit(deg: number) {
    if (!Number.isFinite(deg) || deg === this.limitDeg) return;
    this.limitDeg = Math.max(1, Math.min(89, deg));
    this.cosLimit = Math.cos((this.limitDeg * Math.PI) / 180);
    this.capSin = Math.sin((this.limitDeg * Math.PI) / 180);
  }

  // ------------------------------------------------------------------------------------------- colliders

  /**
   * Adds a world-space collider. Walkable tops can be stood on (default false). `tag` 'wood' / 'stone'... `floor`:
   * only a floor (mud surfaces): its top holds up anything over it or sunk into it; its sides are no wall or ledge.
   */
  addCollider(c: Collider, opts?: { walkable?: boolean; tag?: string; floor?: boolean }): number {
    if (this.disposed) return -1;
    const e = makeEntry(c, opts?.walkable ?? false, opts?.tag ?? '', opts?.floor ?? false);
    const id = this.entries.length;
    this.entries.push(e);
    this.grid.insert(id, e.minX, e.minZ, e.maxX, e.maxZ, e.cells);
    return id;
  }

  removeCollider(handle: number): void {
    const e = this.entries[handle];
    if (!e || !e.alive) return;
    e.alive = false;
    this.grid.remove(handle, e.cells);
    e.cells.length = 0;
  }

  setEnabled(handle: number, on: boolean): void {
    const e = this.entries[handle];
    if (e && e.alive) e.enabled = on;
  }

  /** Number of live colliders (debug readouts). */
  get colliderCount(): number {
    let n = 0;
    for (const e of this.entries) if (e.alive) n++;
    return n;
  }

  // ------------------------------------------------------------------------------------------------ ground

  /** Terrain height, or the highest walkable top at/below fromY + stepUp (any height when fromY is omitted). */
  groundAt(x: number, z: number, fromY?: number): number {
    return this.probeGround(x, z, fromY ?? Infinity, this.stepUp, 0, this.hit).y;
  }

  /**
   * Support under a foot disc of `footRadius` at (x, z): the terrain, or a walkable top no higher than
   * fromY + stepUp (a floor's top at any height while fromY is inside it: feet sunk into the mud come up onto it).
   * Fills and returns `out` (normal: terrain normal, or straight up for collider tops).
   */
  probeGround(
    x: number,
    z: number,
    fromY: number,
    stepUp: number,
    footRadius: number,
    out: GroundHit,
  ): GroundHit {
    let y = this.terrain.heightAt(x, z);
    let handle = -1;
    const limit = fromY + stepUp + 1e-6;
    const fr = footRadius > 0 ? footRadius : 0;
    const n = this.grid.query(x - fr - 0.01, z - fr - 0.01, x + fr + 0.01, z + fr + 0.01, this.acceptLive);
    const found = this.grid.found;
    for (let k = 0; k < n; k++) {
      const e = this.entries[found[k]!]!;
      if (!e.walkable || e.top <= y) continue;
      const top = topUnder(e, x, z, fr, this.capSin);
      if (top > y && (top <= limit || (e.floor && fromY >= e.bottom))) {
        y = top;
        handle = found[k]!;
      }
    }
    out.y = y;
    out.handle = handle;
    if (handle < 0) {
      const nrm = this.terrain.normalAt(x, z, this.tmpN);
      out.nx = nrm.x;
      out.ny = nrm.y;
      out.nz = nrm.z;
      out.steep = nrm.y < this.cosLimit;
    } else {
      out.nx = 0;
      out.ny = 1;
      out.nz = 0;
      out.steep = false;
    }
    return out;
  }

  /** Lowest collider underside above `headY` over the disc (x, z, radius); Infinity when the sky is clear. */
  ceilingAbove(x: number, z: number, headY: number, radius: number): number {
    let best = Infinity;
    const n = this.grid.query(x - radius, z - radius, x + radius, z + radius, this.acceptLive);
    const found = this.grid.found;
    for (let k = 0; k < n; k++) {
      const e = this.entries[found[k]!]!;
      if (e.kind === SPHERE || e.bottom < headY - 1e-3 || e.bottom >= best) continue;
      if (footprintOverlaps(e, x, z, radius)) best = e.bottom;
    }
    return best;
  }

  // ---------------------------------------------------------------------------------------------- push-out

  /**
   * Capsule (feet at pos.y) vs colliders: pushes pos out horizontally, in place. Returns true if anything was hit.
   * Contacts (normals pointing away from what was hit) are left in contactNx / contactNz / contactCount.
   */
  resolve(pos: THREE.Vector3, radius: number, height: number, stepUp = this.stepUp): boolean {
    this.contactCount = 0;
    const m = radius + 0.5;
    const n = this.grid.query(pos.x - m, pos.z - m, pos.x + m, pos.z + m, this.acceptLive);
    if (n === 0) return false;
    const found = this.grid.found;
    const p = this.push;
    let hit = false;
    for (let iter = 0; iter < 4; iter++) {
      // Deepest first, so a face push wins over a neighbour's corner (no snagging on wall seams)...
      let best = -1;
      let bestD = EPS;
      let bx = 0;
      let bz = 0;
      for (let k = 0; k < n; k++) {
        const d = penetration(this.entries[found[k]!]!, pos, radius, height, stepUp, p);
        if (d > bestD) {
          bestD = d;
          best = k;
          bx = p.nx;
          bz = p.nz;
        }
      }
      if (best < 0) break;
      hit = true;
      pos.x += bx * bestD;
      pos.z += bz * bestD;
      this.addContact(found[best]!, bx, bz);
      // ...then the rest in order, each re-measured after the pushes before it.
      for (let k = 0; k < n; k++) {
        if (k === best) continue;
        const d = penetration(this.entries[found[k]!]!, pos, radius, height, stepUp, p);
        if (d > EPS) {
          pos.x += p.nx * d;
          pos.z += p.nz * d;
          this.addContact(found[k]!, p.nx, p.nz);
        }
      }
    }
    return hit;
  }

  /** True when a capsule at (x, feetY, z) overlaps any collider (walkable tops within stepUp do not count). */
  overlaps(
    x: number,
    feetY: number,
    z: number,
    radius: number,
    height: number,
    stepUp = this.stepUp,
  ): boolean {
    const n = this.grid.query(x - radius, z - radius, x + radius, z + radius, this.acceptLive);
    const found = this.grid.found;
    this.tmpP.set(x, feetY, z);
    for (let k = 0; k < n; k++) {
      if (penetration(this.entries[found[k]!]!, this.tmpP, radius, height, stepUp, this.push) > 1e-4)
        return true;
    }
    return false;
  }

  private addContact(handle: number, nx: number, nz: number): void {
    for (let i = 0; i < this.contactCount; i++) {
      if (this.contactHandle[i] === handle) {
        this.contactNx[i] = nx;
        this.contactNz[i] = nz;
        return;
      }
    }
    if (this.contactCount >= MAX_CONTACTS) return;
    const i = this.contactCount++;
    this.contactHandle[i] = handle;
    this.contactNx[i] = nx;
    this.contactNz[i] = nz;
  }

  // ------------------------------------------------------------------------------------------------- rays

  /** Distance along `dir` to the first terrain or collider hit within maxDist (camera arm), else null. */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): number | null {
    const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
    if (!(len > 1e-9) || !(maxDist > 0)) return null;
    const dx = dir.x / len;
    const dy = dir.y / len;
    const dz = dir.z / len;
    const ox = origin.x;
    const oy = origin.y;
    const oz = origin.z;
    const terrain = rayTerrain(this.terrain, ox, oy, oz, dx, dy, dz, maxDist);
    const best = rayColliders(
      this.grid,
      this.entries,
      this.acceptLive,
      ox,
      oy,
      oz,
      dx,
      dy,
      dz,
      maxDist,
      terrain,
    );
    return best <= maxDist ? best : null;
  }

  // ------------------------------------------------------------------------------------------ surfaces

  /**
   * What the feet stand on (footstep sounds, dust colour): a tagged collider top under the feet, then water /
   * mud areas and mud/water zones (or a zone's own `surface`), then the Way band 'dirt', else 'grass'.
   * `y` (feet height) picks the right layer under bridges and arches; omitted, the highest ground is used.
   */
  surfaceAt(x: number, z: number, y?: number): SurfaceKind {
    const feet = y ?? this.groundAt(x, z);
    const ground = this.terrain.heightAt(x, z);
    const n = this.grid.query(x - 0.21, z - 0.21, x + 0.21, z + 0.21, this.acceptLive);
    const found = this.grid.found;
    for (let k = 0; k < n; k++) {
      const e = this.entries[found[k]!]!;
      if (!e.walkable || e.top < ground - 0.05) continue;
      const top = topUnder(e, x, z, 0.2, this.capSin);
      if (top > -Infinity && Math.abs(top - feet) <= 0.15) return e.surface;
    }
    return this.surfaces.at(x, z, feet);
  }

  // --------------------------------------------------------------------------------------------- ledges

  /**
   * A walkable top 0.6-1.8 m above the feet within radius + 0.4 m ahead, with room to stand (the capsule fits
   * on it) and headroom: the climb target. Terrain steps are never ledges. Returns a scratch object, valid until
   * the next call.
   */
  ledgeAhead(pos: THREE.Vector3, forward: THREE.Vector3, radius: number, height = 1.5): LedgeHit | null {
    const fl = Math.sqrt(forward.x * forward.x + forward.z * forward.z);
    if (fl < 1e-6) return null;
    const fx = forward.x / fl;
    const fz = forward.z / fl;
    const lo = pos.y + LEDGE_MIN;
    const hi = pos.y + LEDGE_MAX;
    for (let i = 0; i < LEDGE_PROBES.length; i++) {
      const extra = LEDGE_PROBES[i]!;
      const px = pos.x + fx * (radius + extra);
      const pz = pos.z + fz * (radius + extra);
      const n = this.grid.query(px - 0.01, pz - 0.01, px + 0.01, pz + 0.01, this.acceptLive);
      let best: ColEntry | null = null;
      let bestTop = -Infinity;
      for (let k = 0; k < n; k++) {
        const e = this.entries[this.grid.found[k]!]!;
        if (!e.walkable || e.floor) continue;
        const top = topUnder(e, px, pz, 0, this.capSin);
        if (top >= lo && top <= hi && top > bestTop) {
          bestTop = top;
          best = e;
        }
      }
      if (!best || this.terrain.heightAt(px, pz) > bestTop - 0.05) continue;
      if (!fitOnTop(best, px, pz, radius * 0.8, this.capSin, this.fit)) continue;
      const tx = this.fit.x;
      const tz = this.fit.z;
      const top = topUnder(best, tx, tz, 0, this.capSin);
      if (top < lo || top > hi) continue;
      // Nothing higher stands on the target (terrain or another top), and the capsule fits there and on the way up.
      if (this.probeGround(tx, tz, top, 0.02, 0, this.hit).y > top + 0.01) continue;
      if (this.overlaps(tx, top + 0.02, tz, radius, height)) continue;
      if (this.overlaps(pos.x, top + 0.02, pos.z, radius * 0.9, height)) continue;
      this.ledge.top = top;
      this.ledge.at.set(tx, top, tz);
      return this.ledge;
    }
    return null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.grid.clear();
    for (const e of this.entries) e.alive = false;
    this.entries.length = 0;
    this.surfaces.dispose();
    this.contactCount = 0;
  }
}
