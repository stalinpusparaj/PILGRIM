/**
 * The Way (GDD 2.12): a centripetal Catmull-Rom spline through the level points, resampled into a dense,
 * evenly spaced polyline so that `sample(t)` is arc-length parameterised and O(1). A coarse bucket grid over the
 * polyline makes `closest()` O(1)-ish. The curve is a ground plan (x/z); Terrain.build drapes it onto the
 * terrain, after which `sample().y` is the ground height.
 */
import * as THREE from 'three';
import type { Vec3 } from './geom';
import type { Palette } from './palette';
import type { Rng } from './rng';
import type { Terrain } from './Terrain';
import { buildWayMesh } from './terrain/wayMesh';
import { evalSpline, resample } from './terrain/spline';

export type WayKind = 'way' | 'detour';
export interface ClosestResult {
  /** Arc-length parameter in [0, 1]. */
  t: number;
  /** Horizontal (x/z) distance from the query to the centre line, metres. */
  dist: number;
  point: THREE.Vector3;
}

const STEP = 0.5; // dense polyline spacing, metres
const CELL = 8; // bucket grid cell, metres
const MARGIN = 32; // grid margin around the polyline; queries further out fall back to a scan
const EPS = 1e-4;

export class Way {
  readonly id: string;
  readonly kind: WayKind;
  /** Ribbon width in metres. */
  readonly width: number;
  readonly halfWidth: number;
  readonly points: readonly Vec3[];
  /** Length of the ground plan in metres. */
  readonly length: number;
  /** Polyline bounds (x/z). */
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;

  private readonly n: number; // segment count of the dense polyline (n + 1 vertices)
  private readonly px: Float64Array;
  private readonly py: Float64Array;
  private readonly pz: Float64Array;
  private readonly tx: Float32Array;
  private readonly ty: Float32Array;
  private readonly tz: Float32Array;
  // Bucket grid (CSR): segment ids per cell.
  private readonly gx0: number;
  private readonly gz0: number;
  private readonly gw: number;
  private readonly gh: number;
  private readonly cellStart: Uint32Array;
  private readonly cellItems: Uint32Array;
  private readonly visit: Uint32Array;
  private stamp = 0;
  // Last query result (filled by nearest()).
  private qSeg = 0;
  private qF = 0;
  private qD2 = Infinity;
  private built: { object: THREE.Object3D; dispose(): void } | null = null;

  constructor(points: Vec3[], width: number, kind: WayKind, id: string) {
    this.id = id;
    this.kind = kind;
    this.width = width > 0 ? width : 3;
    this.halfWidth = this.width / 2;
    const pts = points.filter(
      (p, i) => i === 0 || Math.hypot(p[0] - points[i - 1]![0], p[2] - points[i - 1]![2]) > EPS,
    );
    if (pts.length < 2) throw new Error(`Way "${id}": needs at least 2 distinct points`);
    this.points = pts.map((p) => [p[0], p[1], p[2]] as Vec3);

    const raw = evalSpline(pts);
    const len = raw.cum[raw.cum.length - 1]!;
    this.length = len;
    this.n = Math.max(2, Math.ceil(len / STEP));
    const count = this.n + 1;
    this.px = new Float64Array(count);
    this.py = new Float64Array(count);
    this.pz = new Float64Array(count);
    this.tx = new Float32Array(count);
    this.ty = new Float32Array(count);
    this.tz = new Float32Array(count);
    resample(raw, len / this.n, count, this.px, this.py, this.pz);
    this.computeTangents();

    let minX = Infinity,
      maxX = -Infinity,
      minZ = Infinity,
      maxZ = -Infinity;
    for (let i = 0; i < count; i++) {
      minX = Math.min(minX, this.px[i]!);
      maxX = Math.max(maxX, this.px[i]!);
      minZ = Math.min(minZ, this.pz[i]!);
      maxZ = Math.max(maxZ, this.pz[i]!);
    }
    this.minX = minX;
    this.maxX = maxX;
    this.minZ = minZ;
    this.maxZ = maxZ;

    // Bucket grid: each segment is listed in every cell its bounding box touches.
    this.gx0 = minX - MARGIN;
    this.gz0 = minZ - MARGIN;
    this.gw = Math.max(1, Math.ceil((maxX - minX + 2 * MARGIN) / CELL));
    this.gh = Math.max(1, Math.ceil((maxZ - minZ + 2 * MARGIN) / CELL));
    const cells = this.gw * this.gh;
    const counts = new Uint32Array(cells + 1);
    this.forSegmentCells((c) => counts[c + 1]++);
    for (let c = 0; c < cells; c++) counts[c + 1] += counts[c]!;
    this.cellStart = counts;
    this.cellItems = new Uint32Array(counts[cells]!);
    const fill = counts.slice(0, cells);
    this.forSegmentCells((c, s) => (this.cellItems[fill[c]++] = s));
    this.visit = new Uint32Array(this.n);
  }

  /** Point at arc-length parameter t in [0, 1]. */
  sample(t: number, out = new THREE.Vector3()): THREE.Vector3 {
    const s = clamp01(t) * this.n;
    const i = Math.min(Math.floor(s), this.n - 1);
    const f = s - i;
    return out.set(
      this.px[i]! + (this.px[i + 1]! - this.px[i]!) * f,
      this.py[i]! + (this.py[i + 1]! - this.py[i]!) * f,
      this.pz[i]! + (this.pz[i + 1]! - this.pz[i]!) * f,
    );
  }

  /** Unit direction of travel at t (includes the ground slope once draped). */
  tangent(t: number, out = new THREE.Vector3()): THREE.Vector3 {
    const s = clamp01(t) * this.n;
    const i = Math.min(Math.floor(s), this.n - 1);
    const f = s - i;
    out.set(
      this.tx[i]! + (this.tx[i + 1]! - this.tx[i]!) * f,
      this.ty[i]! + (this.ty[i + 1]! - this.ty[i]!) * f,
      this.tz[i]! + (this.tz[i + 1]! - this.tz[i]!) * f,
    );
    const l = out.length();
    return l > EPS ? out.multiplyScalar(1 / l) : out.set(this.tx[i]!, this.ty[i]!, this.tz[i]!);
  }

  /** Closest point on the centre line (x/z distance). Pass `out` to avoid allocating in hot loops. */
  closest(x: number, z: number, out?: ClosestResult): ClosestResult {
    this.nearest(x, z, Infinity);
    const r = out ?? { t: 0, dist: 0, point: new THREE.Vector3() };
    this.fillResult(r);
    return r;
  }

  /**
   * Like closest(), but only when the centre line is within `maxDist` (x/z). Returns false fast for far points
   * (used per grid vertex by Terrain and per candidate by scatter).
   */
  closestWithin(x: number, z: number, maxDist: number, out?: ClosestResult): boolean {
    if (!this.nearest(x, z, maxDist)) return false;
    if (out) this.fillResult(out);
    return true;
  }

  /** Horizontal distance from (x, z) to the centre line, or Infinity when further than maxDist. */
  distanceWithin(x: number, z: number, maxDist: number): number {
    return this.nearest(x, z, maxDist) ? Math.sqrt(this.qD2) : Infinity;
  }

  /** Ribbon + instanced edge stones. Owned by this Way: dispose() frees it. Call once (later calls rebuild). */
  buildMesh(terrain: Terrain, pal: Palette, rng: Rng): THREE.Object3D {
    this.built?.dispose();
    this.built = buildWayMesh(this, terrain, pal, rng);
    return this.built.object;
  }

  /** Re-seat the centre line on the ground (Terrain.build calls this). */
  drape(heightAt: (x: number, z: number) => number): void {
    for (let i = 0; i <= this.n; i++) this.py[i] = heightAt(this.px[i]!, this.pz[i]!);
    this.computeTangents();
  }

  /** Frees the mesh made by buildMesh() (shared materials are kept). */
  dispose(): void {
    this.built?.dispose();
    this.built = null;
  }

  // ------------------------------------------------------------------------------------------- internals

  private computeTangents(): void {
    const last = this.n;
    for (let i = 0; i <= last; i++) {
      const a = Math.max(0, i - 1);
      const b = Math.min(last, i + 1);
      const dx = this.px[b]! - this.px[a]!;
      const dy = this.py[b]! - this.py[a]!;
      const dz = this.pz[b]! - this.pz[a]!;
      const l = Math.hypot(dx, dy, dz) || 1;
      this.tx[i] = dx / l;
      this.ty[i] = dy / l;
      this.tz[i] = dz / l;
    }
  }

  private forSegmentCells(fn: (cell: number, seg: number) => void): void {
    for (let s = 0; s < this.n; s++) {
      const x0 = Math.min(this.px[s]!, this.px[s + 1]!);
      const x1 = Math.max(this.px[s]!, this.px[s + 1]!);
      const z0 = Math.min(this.pz[s]!, this.pz[s + 1]!);
      const z1 = Math.max(this.pz[s]!, this.pz[s + 1]!);
      const cx0 = this.cellX(x0),
        cx1 = this.cellX(x1),
        cz0 = this.cellZ(z0),
        cz1 = this.cellZ(z1);
      for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) fn(cz * this.gw + cx, s);
    }
  }

  private cellX(x: number): number {
    return Math.min(this.gw - 1, Math.max(0, Math.floor((x - this.gx0) / CELL)));
  }

  private cellZ(z: number): number {
    return Math.min(this.gh - 1, Math.max(0, Math.floor((z - this.gz0) / CELL)));
  }

  private testSegment(s: number, x: number, z: number): void {
    const ax = this.px[s]!,
      az = this.pz[s]!;
    const dx = this.px[s + 1]! - ax,
      dz = this.pz[s + 1]! - az;
    const l2 = dx * dx + dz * dz;
    let f = l2 > 0 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
    f = f < 0 ? 0 : f > 1 ? 1 : f;
    const ex = ax + dx * f - x,
      ez = az + dz * f - z;
    const d2 = ex * ex + ez * ez;
    if (d2 < this.qD2) {
      this.qD2 = d2;
      this.qSeg = s;
      this.qF = f;
    }
  }

  /** Ring search over the bucket grid. True when the nearest segment lies within maxDist. */
  private nearest(x: number, z: number, maxDist: number): boolean {
    this.qD2 = Infinity;
    if (
      x < this.minX - maxDist ||
      x > this.maxX + maxDist ||
      z < this.minZ - maxDist ||
      z > this.maxZ + maxDist
    ) {
      return false;
    }
    const fx = Math.floor((x - this.gx0) / CELL);
    const fz = Math.floor((z - this.gz0) / CELL);
    if (fx < 0 || fz < 0 || fx >= this.gw || fz >= this.gh) {
      for (let s = 0; s < this.n; s++) this.testSegment(s, x, z); // far outside: plain scan
      return this.qD2 <= maxDist * maxDist;
    }
    if (++this.stamp === 0xffffffff) {
      this.visit.fill(0);
      this.stamp = 1;
    }
    const maxRing = Math.max(this.gw, this.gh);
    for (let ring = 0; ring <= maxRing; ring++) {
      for (let cz = fz - ring; cz <= fz + ring; cz++) {
        if (cz < 0 || cz >= this.gh) continue;
        const edgeRow = cz === fz - ring || cz === fz + ring;
        for (let cx = fx - ring; cx <= fx + ring; cx += edgeRow || ring === 0 ? 1 : 2 * ring) {
          if (cx < 0 || cx >= this.gw) continue;
          const c = cz * this.gw + cx;
          for (let k = this.cellStart[c]!; k < this.cellStart[c + 1]!; k++) {
            const s = this.cellItems[k]!;
            if (this.visit[s] === this.stamp) continue;
            this.visit[s] = this.stamp;
            this.testSegment(s, x, z);
          }
        }
      }
      // Anything in ring + 1 is at least ring * CELL away.
      const bound = ring * CELL;
      if (this.qD2 <= bound * bound || bound > maxDist) break;
    }
    return this.qD2 <= maxDist * maxDist;
  }

  private fillResult(r: ClosestResult): void {
    const s = this.qSeg,
      f = this.qF;
    r.t = (s + f) / this.n;
    r.dist = Math.sqrt(this.qD2);
    r.point.set(
      this.px[s]! + (this.px[s + 1]! - this.px[s]!) * f,
      this.py[s]! + (this.py[s + 1]! - this.py[s]!) * f,
      this.pz[s]! + (this.pz[s + 1]! - this.pz[s]!) * f,
    );
  }
}

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}
