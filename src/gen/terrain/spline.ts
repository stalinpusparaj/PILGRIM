/**
 * Spline helpers for the Way: centripetal Catmull-Rom evaluation (Barry-Goldman form) into a raw polyline, and
 * resampling that polyline at an even arc-length spacing.
 */
import type { Vec3 } from '../geom';

const RAW_STEP = 0.25; // spline evaluation spacing before resampling, metres
const EPS = 1e-4;

export interface RawCurve {
  x: number[];
  y: number[];
  z: number[];
  cum: number[];
}

/**
 * Centripetal Catmull-Rom (alpha 0.5, Barry-Goldman form) in x/z; y is blended along each span. The ends get
 * mirrored phantom points so the curve passes through the first and last level points.
 */
export function evalSpline(pts: Vec3[]): RawCurve {
  const n = pts.length;
  const get = (i: number): Vec3 => {
    if (i < 0) return mirror(pts[0]!, pts[1]!);
    if (i >= n) return mirror(pts[n - 1]!, pts[n - 2]!);
    return pts[i]!;
  };
  const out: RawCurve = { x: [], y: [], z: [], cum: [] };
  const push = (x: number, y: number, z: number): void => {
    const k = out.x.length;
    const d = k === 0 ? 0 : Math.hypot(x - out.x[k - 1]!, z - out.z[k - 1]!);
    out.x.push(x);
    out.y.push(y);
    out.z.push(z);
    out.cum.push(k === 0 ? 0 : out.cum[k - 1]! + d);
  };
  push(pts[0]![0], pts[0]![1], pts[0]![2]);
  for (let i = 0; i < n - 1; i++) {
    const p0 = get(i - 1),
      p1 = get(i),
      p2 = get(i + 1),
      p3 = get(i + 2);
    const t1 = knot(p0, p1);
    const t2 = t1 + knot(p1, p2);
    const t3 = t2 + knot(p2, p3);
    const steps = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[2] - p1[2]) / RAW_STEP));
    for (let k = 1; k <= steps; k++) {
      const u = k / steps;
      const t = t1 + (t2 - t1) * u;
      push(
        barryGoldman(p0[0], p1[0], p2[0], p3[0], t1, t2, t3, t),
        p1[1] + (p2[1] - p1[1]) * (u * u * (3 - 2 * u)),
        barryGoldman(p0[2], p1[2], p2[2], p3[2], t1, t2, t3, t),
      );
    }
  }
  return out;
}

function mirror(a: Vec3, b: Vec3): Vec3 {
  return [2 * a[0] - b[0], 2 * a[1] - b[1], 2 * a[2] - b[2]];
}

/** Centripetal knot spacing: sqrt of the chord length (never zero). */
function knot(a: Vec3, b: Vec3): number {
  return Math.max(EPS, Math.sqrt(Math.hypot(b[0] - a[0], b[2] - a[2])));
}

/** One coordinate of the Barry-Goldman pyramid with t0 = 0. */
function barryGoldman(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  t1: number,
  t2: number,
  t3: number,
  t: number,
): number {
  const a1 = ((t1 - t) * p0 + t * p1) / t1;
  const a2 = ((t2 - t) * p1 + (t - t1) * p2) / (t2 - t1);
  const a3 = ((t3 - t) * p2 + (t - t2) * p3) / (t3 - t2);
  const b1 = ((t2 - t) * a1 + t * a2) / t2;
  const b2 = ((t3 - t) * a2 + (t - t1) * a3) / (t3 - t1);
  return ((t2 - t) * b1 + (t - t1) * b2) / (t2 - t1);
}

/** Walk the raw polyline and write `count` points spaced `step` apart along it. */
export function resample(
  raw: RawCurve,
  step: number,
  count: number,
  ox: Float64Array,
  oy: Float64Array,
  oz: Float64Array,
): void {
  let j = 0;
  const last = raw.cum.length - 1;
  for (let i = 0; i < count; i++) {
    const s = i === count - 1 ? raw.cum[last]! : i * step;
    while (j < last - 1 && raw.cum[j + 1]! < s) j++;
    const seg = raw.cum[j + 1]! - raw.cum[j]!;
    const f = seg > 0 ? Math.min(1, Math.max(0, (s - raw.cum[j]!) / seg)) : 0;
    ox[i] = raw.x[j]! + (raw.x[j + 1]! - raw.x[j]!) * f;
    oy[i] = raw.y[j]! + (raw.y[j + 1]! - raw.y[j]!) * f;
    oz[i] = raw.z[j]! + (raw.z[j + 1]! - raw.z[j]!) * f;
  }
}
