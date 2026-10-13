/**
 * Scatter (GDD 2.12): places trees, bushes, rocks, grass, flowers and reeds from the level's rules (zone,
 * density per 100 m², min distance, slope limit, keep-clear distance from every Way). Each prop type is built
 * ONCE with buildProp() and drawn with instancing (per-instance colour jitter, random yaw and scale). Every type is
 * split into spatial chunks (~75 m cells), one InstancedMesh per type per chunk with chunk-sized bounds, so the
 * camera and the sun's shadow frustum both cull what they cannot see. Each chunk is a THREE.LOD: small types
 * (grass, flowers) hide beyond a quality-based distance; trees, bushes and rocks switch to their low-LOD build
 * (`lod: 1`, fewer segments; GDD 2.15 "simple LOD for distant trees") and hide only once fully fogged. Trees
 * and rocks return world colliders.
 */
import * as THREE from 'three';
import type { Palette } from './palette';
import type { Rng } from './rng';
import type { Yielder } from './yielder';
import type { Terrain } from './Terrain';
import type { Way } from './Way';
import type { QualityPreset } from '../core/Quality';
import type { LevelData, ScatterRule } from '../world/LevelTypes';
import { clearings, defaultsFor, DiscHash } from './terrain/scatterRules';
import { STRIDE, buildMeshes, type ScatterResult } from './scatter-meshes';
import {
  waterAt,
  zoneArea,
  zoneBounds,
  zoneDistance,
  zoneWay,
  WAY_ZONE_RADIUS,
  zoneCentre,
} from './terrain/zones';

export type { ScatterResult } from './scatter-meshes';

type LevelZone = LevelData['zones'][number];

interface Region {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  area: number;
  disc: { x: number; z: number; r: number } | null;
  /** A (turned) box zone: sampled in its own frame, so every attempt lands inside it. */
  box: { x: number; z: number; w: number; d: number; rot: number } | null;
  zone: LevelZone | null;
  way: Way | null;
}

function regionFor(
  rule: ScatterRule,
  zone: LevelZone | null,
  ways: readonly Way[],
  half: number,
): Region | null {
  const reg: Region = {
    x0: -half,
    x1: half,
    z0: -half,
    z1: half,
    area: 4 * half * half,
    disc: null,
    box: null,
    zone,
    way: null,
  };
  if (zone) {
    const b = zoneBounds(zone, ways);
    if (!b) return null;
    reg.x0 = Math.max(reg.x0, b.x0);
    reg.x1 = Math.min(reg.x1, b.x1);
    reg.z0 = Math.max(reg.z0, b.z0);
    reg.z1 = Math.min(reg.z1, b.z1);
    reg.area = zoneArea(zone, ways);
    if (zone.shape === 'circle' && typeof zone.r === 'number')
      reg.disc = { x: zoneCentre(zone)[0], z: zoneCentre(zone)[1], r: zone.r };
    if (zone.shape === 'way') reg.way = zoneWay(zone, ways);
    if (zone.shape === 'box' && Array.isArray(zone.size)) {
      const [x, z] = zoneCentre(zone);
      const rot = typeof zone.rotY === 'number' && Number.isFinite(zone.rotY) ? zone.rotY : 0;
      reg.box = { x, z, w: zone.size[0], d: zone.size[1], rot };
    }
  }
  if (rule.area) {
    const a = rule.area;
    reg.x0 = Math.max(reg.x0, a.x - a.r);
    reg.x1 = Math.min(reg.x1, a.x + a.r);
    reg.z0 = Math.max(reg.z0, a.z - a.r);
    reg.z1 = Math.min(reg.z1, a.z + a.r);
    reg.area = Math.min(reg.area, Math.PI * a.r * a.r);
    reg.disc = { ...a };
    reg.way = null;
    reg.box = null;
  }
  return reg.x1 > reg.x0 && reg.z1 > reg.z0 ? reg : null;
}

/** Draw a candidate point from the region's natural shape (disc, band along a Way, or rectangle). */
function candidate(
  reg: Region,
  rng: Rng,
  zone: LevelZone | null,
  out: THREE.Vector3,
  tan: THREE.Vector3,
): void {
  if (reg.disc) {
    const r = reg.disc.r * Math.sqrt(rng.next());
    const a = rng.next() * Math.PI * 2;
    out.set(reg.disc.x + Math.cos(a) * r, 0, reg.disc.z + Math.sin(a) * r);
  } else if (reg.way && zone) {
    const from = typeof zone.from === 'number' ? zone.from : 0;
    const to = typeof zone.to === 'number' ? zone.to : 1;
    const t = rng.range(from, to);
    const off = rng.range(-1, 1) * (typeof zone.r === 'number' ? zone.r : WAY_ZONE_RADIUS);
    reg.way.sample(t, out);
    reg.way.tangent(t, tan);
    const l = Math.hypot(tan.x, tan.z) || 1;
    out.x += (tan.z / l) * off;
    out.z -= (tan.x / l) * off;
  } else if (reg.box) {
    // Local box frame → world (the inverse of zoneDistance's turn by rotY).
    const b = reg.box;
    const lx = rng.range(-b.w / 2, b.w / 2);
    const lz = rng.range(-b.d / 2, b.d / 2);
    const c = Math.cos(b.rot);
    const sn = Math.sin(b.rot);
    out.set(b.x + c * lx + sn * lz, 0, b.z - sn * lx + c * lz);
  } else {
    out.set(rng.range(reg.x0, reg.x1), 0, rng.range(reg.z0, reg.z1));
  }
}

export async function scatter(
  level: LevelData,
  terrain: Terrain,
  ways: Way[],
  pal: Palette,
  rng: Rng,
  quality: QualityPreset,
  y: Yielder,
): Promise<ScatterResult> {
  const half = level.size / 2;
  const placed = new Map<string, number[]>();
  const sameType = new Map<string, DiscHash>();
  const solids = new DiscHash(4);
  const clear = clearings(level);
  const p = new THREE.Vector3();
  const tan = new THREE.Vector3();

  for (let ri = 0; ri < level.scatter.length; ri++) {
    const rule = level.scatter[ri]!;
    const d = defaultsFor(rule.type);
    const zone = rule.zone ? (level.zones.find((z) => z.id === rule.zone) ?? null) : null;
    if (rule.zone && !zone) {
      console.warn(`scatter: level "${level.id}" rule ${ri} names unknown zone "${rule.zone}"`);
      continue;
    }
    const reg = regionFor(rule, zone, ways, half - 0.5);
    if (!reg) continue;
    const rr = rng.fork(`scatter:${ri}:${rule.type}`);
    const list = placed.get(rule.type) ?? [];
    placed.set(rule.type, list);
    let spacing = sameType.get(rule.type);
    if (!spacing)
      sameType.set(rule.type, (spacing = new DiscHash(Math.max(1, (rule.minDist ?? d.minDist) * 2))));
    const minDist = Math.max(0, rule.minDist ?? d.minDist);
    const slopeMax = rule.slopeMax ?? d.slopeMax;
    const keepClear = rule.keepClear ?? d.keepClear;
    const [sMin, sMax] = Array.isArray(rule.scale) && rule.scale.length === 2 ? rule.scale : d.scale;
    const want = ((rule.density * reg.area) / 100) * (d.small ? quality.grassDensity : 1);
    const target = Math.min(Math.round(want), d.max - list.length / STRIDE);
    const maxAttempts = target * 6 + 50;
    let made = 0;
    for (let attempt = 0; made < target && attempt < maxAttempts; attempt++) {
      if ((attempt & 63) === 63) await y.tick();
      candidate(reg, rr, zone, p, tan);
      const x = p.x;
      const z = p.z;
      if (!terrain.contains(x, z, 0.5)) continue;
      if (zone && zoneDistance(zone, x, z, ways) > 0) continue;
      if (rule.area && Math.hypot(x - rule.area.x, z - rule.area.z) > rule.area.r) continue;
      const water = waterAt(level, x, z);
      if ((water && d.water === 'never') || (!water && d.water === 'only')) continue;
      if (clear.some((c) => (x - c.x) ** 2 + (z - c.z) ** 2 < c.r * c.r)) continue;
      if (ways.some((w) => w.distanceWithin(x, z, w.halfWidth + keepClear) < Infinity)) continue;
      if (!water && terrain.slopeAt(x, z) > slopeMax) continue;
      if (minDist > 0 && spacing.hits(x, z, minDist / 2)) continue;
      const s = rr.range(sMin, sMax);
      if (d.footprint > 0 && solids.hits(x, z, d.footprint * s)) continue;
      // Accepted.
      const ground = water && d.water === 'only' ? water.level + 0.02 : terrain.heightAt(x, z) - d.sink * s;
      const v = 1 + rr.range(-d.valueJitter, d.valueJitter);
      const hue = rr.range(-d.hueJitter, d.hueJitter);
      list.push(
        x,
        ground,
        z,
        rr.range(0, Math.PI * 2),
        rr.range(-d.tilt, d.tilt),
        rr.range(-d.tilt, d.tilt),
        s,
        v * (1 + 0.8 * hue),
        v,
        v * (1 - 0.8 * hue),
      );
      if (minDist > 0) spacing.add(x, z, minDist / 2);
      if (d.footprint > 0) solids.add(x, z, d.footprint * s);
      made++;
    }
    await y.tick();
  }

  return buildMeshes(placed, terrain, pal, rng, quality, y);
}
