/**
 * Zone and water-area geometry shared by terrain painting and scatter: signed distances to circle / box / 'way'
 * band zones, water lookups and the ground tint a zone asks for.
 */
import * as THREE from 'three';
import { mix, shade, type Palette } from '../palette';
import type { Way, ClosestResult } from '../Way';
import type { LevelData, LevelWater, LevelZone } from '../../world/LevelTypes';

const hit: ClosestResult = { t: 0, dist: 0, point: new THREE.Vector3() };
const tmp = new THREE.Vector3();
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Default half-width of a 'way' band zone (beyond the centre line), metres. */
export const WAY_ZONE_RADIUS = 10;

/** Zone centre: `x`/`z`, or `at` (the level validator accepts either). */
export function zoneCentre(zone: LevelZone): [number, number] {
  const at = zone.at;
  if (Array.isArray(at) && at.length === 3) return [num(zone.x, num(at[0], 0)), num(zone.z, num(at[2], 0))];
  return [num(zone.x, 0), num(zone.z, 0)];
}

/** The Way a 'way' band zone follows: `path` (a detour id or 'way'), else the first main Way. */
export function zoneWay(zone: LevelZone, ways: readonly Way[]): Way | null {
  const path = typeof zone.path === 'string' && zone.path !== 'way' ? zone.path : null;
  return ways.find((w) => (path ? w.id === path : w.kind === 'way')) ?? null;
}

/**
 * Signed distance (metres) from (x, z) to the zone outline: <= 0 inside. Returns Infinity when the point is far
 * outside a 'way' band (beyond `reach`), so callers only pay for the bucket lookup near the band.
 */
export function zoneDistance(
  zone: LevelZone,
  x: number,
  z: number,
  ways: readonly Way[],
  reach = 30,
): number {
  if (zone.shape === 'way') {
    const way = zoneWay(zone, ways);
    if (!way) return Infinity;
    const r = num(zone.r, WAY_ZONE_RADIUS);
    if (!way.closestWithin(x, z, r + reach, hit)) return Infinity;
    const from = num(zone.from, 0);
    const to = num(zone.to, 1);
    if (hit.t < from || hit.t > to) {
      way.sample(hit.t < from ? from : to, tmp);
      return Math.hypot(x - tmp.x, z - tmp.z) - r;
    }
    return hit.dist - r;
  }
  const [cx, cz] = zoneCentre(zone);
  if (zone.shape === 'circle') return Math.hypot(x - cx, z - cz) - num(zone.r, 0);
  // Box, optionally turned by rotY (radians).
  const size = zone.size ?? [0, 0];
  const rot = num(zone.rotY, 0);
  const c = Math.cos(rot),
    s = Math.sin(rot);
  const dx = x - cx,
    dz = z - cz;
  const lx = c * dx - s * dz;
  const lz = s * dx + c * dz;
  const qx = Math.abs(lx) - size[0] / 2;
  const qz = Math.abs(lz) - size[1] / 2;
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
}

/** Axis-aligned bounds of a zone, for sampling. */
export function zoneBounds(
  zone: LevelZone,
  ways: readonly Way[],
): { x0: number; x1: number; z0: number; z1: number } | null {
  if (zone.shape === 'way') {
    const way = zoneWay(zone, ways);
    if (!way) return null;
    const r = num(zone.r, WAY_ZONE_RADIUS);
    return { x0: way.minX - r, x1: way.maxX + r, z0: way.minZ - r, z1: way.maxZ + r };
  }
  const [cx, cz] = zoneCentre(zone);
  if (zone.shape === 'circle') {
    const e = num(zone.r, 0);
    return { x0: cx - e, x1: cx + e, z0: cz - e, z1: cz + e };
  }
  // The true bounds of the (turned) box, not a square on its half-diagonal.
  const hw = (zone.size?.[0] ?? 0) / 2;
  const hd = (zone.size?.[1] ?? 0) / 2;
  const rot = num(zone.rotY, 0);
  const c = Math.abs(Math.cos(rot));
  const s = Math.abs(Math.sin(rot));
  const ex = c * hw + s * hd;
  const ez = s * hw + c * hd;
  return { x0: cx - ex, x1: cx + ex, z0: cz - ez, z1: cz + ez };
}

/** Approximate area of a zone in m² (for scatter densities). */
export function zoneArea(zone: LevelZone, ways: readonly Way[]): number {
  if (zone.shape === 'way') {
    const way = zoneWay(zone, ways);
    if (!way) return 0;
    const span = Math.max(0, num(zone.to, 1) - num(zone.from, 0));
    return 2 * num(zone.r, WAY_ZONE_RADIUS) * way.length * span;
  }
  if (zone.shape === 'circle') return Math.PI * num(zone.r, 0) ** 2;
  return (zone.size?.[0] ?? 0) * (zone.size?.[1] ?? 0);
}

/** The water/mud area covering (x, z), if any. */
export function waterAt(level: LevelData, x: number, z: number): LevelWater | null {
  for (const w of level.water ?? []) {
    if (w.shape === 'circle') {
      if (Math.hypot(x - w.x, z - w.z) <= (w.r ?? 0)) return w;
    } else if (Math.abs(x - w.x) <= (w.size?.[0] ?? 0) / 2 && Math.abs(z - w.z) <= (w.size?.[1] ?? 0) / 2) {
      return w;
    }
  }
  return null;
}

const MUDDY = new Set(['slough', 'bog', 'mud', 'marsh', 'swamp']);

/**
 * The ground colour a zone paints, if any: `tint` (a hex, or a palette key from ground / water / accents) with
 * `tintAmount` (0..1), or a muddy default for bog-like zone types.
 */
export function zoneTint(zone: LevelZone, pal: Palette): { hex: string; amount: number } | null {
  const amount = Math.min(1, Math.max(0, num(zone.tintAmount, 0.6)));
  if (typeof zone.tint === 'string') {
    const key = zone.tint;
    const ground = pal.ground as Record<string, string>;
    const water = pal.water as Record<string, string>;
    const hex = key.startsWith('#') ? key : (ground[key] ?? water[key] ?? pal.accents[key]);
    return hex ? { hex, amount } : null;
  }
  if (MUDDY.has(zone.type))
    return { hex: shade(mix(pal.ground.low, pal.ground.slope, 0.6), -0.06), amount: 0.7 };
  return null;
}
