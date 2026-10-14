/**
 * Cutscene maths: easing curves, a centripetal Catmull-Rom rail walked by arc length (constant speed, no loops or
 * cusps at uneven spacing), point resolution for PointSource, head/eye positions and yaw helpers.
 * Nothing here allocates per frame once a Rail exists.
 */
import * as THREE from 'three';
import type { Character } from '../gen/CharacterFactory';
import type { ActorPoint, CutsceneContext, Easing, PointSource } from './cutscene-types';

// ------------------------------------------------------------------------------------------------ easing

export function clamp01(v: number): number {
  return v <= 0 ? 0 : v >= 1 ? 1 : v;
}

export function ease(e: Easing | undefined, u: number): number {
  const x = clamp01(u);
  if (typeof e === 'function') return clamp01(e(x));
  switch (e) {
    case 'linear':
      return x;
    case 'smoothstep':
      return x * x * (3 - 2 * x);
    case 'easeIn':
      return x * x * x;
    case 'easeOut':
      return 1 - (1 - x) * (1 - x) * (1 - x);
    case 'sineInOut':
      return 0.5 - 0.5 * Math.cos(Math.PI * x);
    default:
      return x * x * x * (x * (x * 6 - 15) + 10); // smootherstep
  }
}

// -------------------------------------------------------------------------------------------------- rail

const SAMPLES_PER_SEGMENT = 16;
const MAX_SAMPLES = 160;
const EPS = 1e-4;

/** Centripetal Catmull-Rom through `count` control points, sampled by arc length. */
export class Rail {
  readonly points: THREE.Vector3[] = [];
  private n = 0;
  private samples = 0;
  private lengths = new Float32Array(MAX_SAMPLES + 1);
  private total = 0;
  private readonly p0 = new THREE.Vector3();
  private readonly p3 = new THREE.Vector3();
  private readonly a1 = new THREE.Vector3();
  private readonly a2 = new THREE.Vector3();
  private readonly a3 = new THREE.Vector3();
  private readonly b1 = new THREE.Vector3();
  private readonly b2 = new THREE.Vector3();
  private readonly prev = new THREE.Vector3();
  private readonly cur = new THREE.Vector3();
  private readonly back = new THREE.Vector3();

  /** Grows the point list to `n` (reusing vectors) and returns it for the caller to fill; then call rebuild(). */
  setCount(n: number): THREE.Vector3[] {
    while (this.points.length < n) this.points.push(new THREE.Vector3());
    this.n = n;
    return this.points;
  }

  get count(): number {
    return this.n;
  }

  get length(): number {
    return this.total;
  }

  /** Re-measures the rail after its points changed. */
  rebuild(): void {
    const segs = Math.max(0, this.n - 1);
    this.samples = Math.min(MAX_SAMPLES, Math.max(1, segs * SAMPLES_PER_SEGMENT));
    this.lengths[0] = 0;
    if (segs === 0) {
      this.total = 0;
      return;
    }
    this.evalGlobal(0, this.prev);
    let sum = 0;
    for (let k = 1; k <= this.samples; k++) {
      this.evalGlobal((k / this.samples) * segs, this.cur);
      sum += this.cur.distanceTo(this.prev);
      this.lengths[k] = sum;
      this.prev.copy(this.cur);
    }
    this.total = sum;
  }

  /** Point at arc-length fraction u (0..1). */
  at(u: number, out: THREE.Vector3): THREE.Vector3 {
    if (this.n === 0) return out.set(0, 0, 0);
    if (this.n === 1 || this.total < EPS) return out.copy(this.points[0]!);
    return this.evalGlobal(this.paramAt(u), out);
  }

  /** Unit direction of travel at u (zero vector on a degenerate rail). */
  tangent(u: number, out: THREE.Vector3): THREE.Vector3 {
    if (this.n < 2 || this.total < EPS) return out.set(0, 0, 0);
    const segs = this.n - 1;
    const g = this.paramAt(u);
    const d = Math.min(0.02, segs * 0.5);
    const g0 = Math.max(0, g - d);
    const g1 = Math.min(segs, g + d);
    this.evalGlobal(g1, out);
    this.evalGlobal(g0, this.back);
    out.sub(this.back);
    const len = out.length();
    return len > EPS ? out.divideScalar(len) : out.set(0, 0, 0);
  }

  /** Arc-length fraction → global spline parameter (0 .. count-1). */
  private paramAt(u: number): number {
    const target = clamp01(u) * this.total;
    const L = this.lengths;
    let lo = 0;
    let hi = this.samples;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (L[mid]! < target) lo = mid;
      else hi = mid;
    }
    const span = L[hi]! - L[lo]!;
    const f = span > EPS ? (target - L[lo]!) / span : 0;
    return ((lo + f) / this.samples) * (this.n - 1);
  }

  /** Barry-Goldman evaluation of the centripetal segment containing global parameter g. */
  private evalGlobal(g: number, out: THREE.Vector3): THREE.Vector3 {
    const pts = this.points;
    const last = this.n - 1;
    const i = Math.min(last - 1, Math.max(0, Math.floor(g)));
    const s = Math.min(1, Math.max(0, g - i));
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    // Missing neighbours are mirrored, so the ends get natural tangents.
    if (i > 0) this.p0.copy(pts[i - 1]!);
    else this.p0.copy(p1).multiplyScalar(2).sub(p2);
    if (i + 2 <= last) this.p3.copy(pts[i + 2]!);
    else this.p3.copy(p2).multiplyScalar(2).sub(p1);
    const t0 = 0;
    const t1 = t0 + knot(this.p0, p1);
    const t2 = t1 + knot(p1, p2);
    const t3 = t2 + knot(p2, this.p3);
    const t = t1 + s * (t2 - t1);
    lerpK(this.a1, this.p0, p1, t0, t1, t);
    lerpK(this.a2, p1, p2, t1, t2, t);
    lerpK(this.a3, p2, this.p3, t2, t3, t);
    lerpK(this.b1, this.a1, this.a2, t0, t2, t);
    lerpK(this.b2, this.a2, this.a3, t1, t3, t);
    return lerpK(out, this.b1, this.b2, t1, t2, t);
  }
}

/** Centripetal knot spacing: sqrt of the distance (never zero, so coincident points stay finite). */
function knot(a: THREE.Vector3, b: THREE.Vector3): number {
  return Math.max(EPS, Math.sqrt(a.distanceTo(b)));
}

function lerpK(out: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, ta: number, tb: number, t: number) {
  const span = tb - ta;
  const f = span > EPS ? (t - ta) / span : 0;
  return out.copy(a).lerp(b, f);
}

// ---------------------------------------------------------------------------------------- actor points

const tmpQ = new THREE.Quaternion();
const tmpV = new THREE.Vector3();
const tmpS = new THREE.Vector3();

/** Head-centre radius used for eye level; measured by the Animator, guessed from the height otherwise. */
function headRadius(c: Character): number {
  return c.animator.params.rig?.headR ?? c.height * 0.15;
}

/** Eye level of a character in world space (the head bone, refreshed now, plus most of a head radius). */
export function headPosition(c: Character, out: THREE.Vector3): THREE.Vector3 {
  const head = c.bones['head'];
  if (!head) {
    c.root.updateWorldMatrix(true, false);
    return out.setFromMatrixPosition(c.root.matrixWorld).add(tmpV.set(0, c.height * 0.85, 0));
  }
  head.updateWorldMatrix(true, false);
  out.setFromMatrixPosition(head.matrixWorld);
  out.y += headRadius(c) * 0.8;
  return out;
}

/** A look/position target that follows a character's eyes (for CameraTrack.look and ActorPoint-free rails). */
export function headOf(c: Character): () => THREE.Vector3 {
  const v = new THREE.Vector3();
  return () => headPosition(c, v);
}

/** World yaw a character faces (0 = +z), from its root's world rotation. */
export function yawOf(c: Character): number {
  c.root.updateWorldMatrix(true, false);
  c.root.matrixWorld.decompose(tmpV, tmpQ, tmpS);
  const fx = 2 * (tmpQ.x * tmpQ.z + tmpQ.w * tmpQ.y);
  const fz = 1 - 2 * (tmpQ.x * tmpQ.x + tmpQ.y * tmpQ.y);
  return Math.atan2(fx, fz);
}

/** Unit vector a yaw faces, on the ground plane. */
export function forwardOf(yaw: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(Math.sin(yaw), 0, Math.cos(yaw));
}

function actorPoint(p: ActorPoint, c: Character, out: THREE.Vector3): THREE.Vector3 {
  if (p.at === 'head') headPosition(c, out);
  else if (p.at === 'chest' && c.bones['chest']) {
    const chest = c.bones['chest'];
    chest.updateWorldMatrix(true, false);
    out.setFromMatrixPosition(chest.matrixWorld);
  } else {
    c.root.updateWorldMatrix(true, false);
    out.setFromMatrixPosition(c.root.matrixWorld);
  }
  const o = p.offset;
  if (o) {
    if (p.local) {
      const yaw = c.root.rotation.y;
      const cs = Math.cos(yaw);
      const sn = Math.sin(yaw);
      out.x += o[0] * cs + o[2] * sn;
      out.y += o[1];
      out.z += -o[0] * sn + o[2] * cs;
    } else {
      out.x += o[0];
      out.y += o[1];
      out.z += o[2];
    }
  }
  return out;
}

/** True when a source can change from frame to frame (functions and actor points). */
export function isDynamic(src: PointSource): boolean {
  return typeof src === 'function' || (typeof src === 'object' && 'actor' in src);
}

/**
 * Writes a PointSource into `out`. 'camera' resolves to `anchor` (the caller's choice). Returns false when the
 * source cannot be resolved (unknown actor, a function that threw): `out` then holds `anchor`.
 */
export function resolvePoint(
  src: PointSource,
  actors: CutsceneContext['actors'],
  anchor: THREE.Vector3,
  out: THREE.Vector3,
): boolean {
  if (src === 'camera') {
    out.copy(anchor);
    return true;
  }
  if (src instanceof THREE.Vector3) {
    out.copy(src);
    return true;
  }
  if (typeof src === 'function') {
    try {
      const v = src();
      if (v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)) {
        out.copy(v);
        return true;
      }
    } catch (err) {
      console.error('[cutscene] point function threw', err);
    }
    out.copy(anchor);
    return false;
  }
  if ('actor' in src) {
    const c = actors?.[src.actor];
    if (!c) {
      out.copy(anchor);
      return false;
    }
    actorPoint(src, c, out);
    return true;
  }
  out.set(src[0], src[1], src[2]);
  return true;
}

// ------------------------------------------------------------------------------------------------- yaw

/** Shortest signed angle from a to b, in (-PI, PI]. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/** Turns `from` toward `to`: eased (a quarter of the gap per 1/20 s) and capped at `rate` rad/s. */
export function turnToward(from: number, to: number, rate: number, dt: number): number {
  const d = angleDelta(from, to);
  if (Math.abs(d) < 1e-4) return to;
  const eased = d * (1 - Math.exp(-dt * 6));
  const cap = rate * dt;
  return from + Math.max(-cap, Math.min(cap, eased));
}

/** Yaw that faces from `a` toward `b` on the ground plane, or `fallback` when they share a spot. */
export function yawToward(a: THREE.Vector3, b: THREE.Vector3, fallback: number): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  return dx * dx + dz * dz > 1e-6 ? Math.atan2(dx, dz) : fallback;
}

/** Ground height from either sampler shape (Terrain.heightAt or CollisionWorld.groundAt). */
export function groundHeight(g: CutsceneContext['ground'], x: number, z: number, fallback: number): number {
  if (!g) return fallback;
  const h = 'heightAt' in g ? g.heightAt(x, z) : g.groundAt(x, z);
  return Number.isFinite(h) ? h : fallback;
}
