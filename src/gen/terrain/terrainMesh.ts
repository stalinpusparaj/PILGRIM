/**
 * Terrain mesh: flat-shaded, non-indexed triangles with one vertex colour per face (GDD 2.11 toy diorama).
 * Colour = height band (palette low/mid/high) → slope colour on steep faces → zone tints → worn path tint near
 * the Way and detours → a small per-face value jitter for the hand-painted look. A darker earth skirt closes the
 * map edge like the side of a diorama base.
 */
import * as THREE from 'three';
import { colorOf } from '../geom';
import { mix, shade, type Palette } from '../palette';
import type { Yielder } from '../yielder';
import type { Way } from '../Way';
import type { LevelData } from '../../world/LevelTypes';
import { evenCell, type Grid } from './heightfield';
import { zoneBounds, zoneDistance, zoneTint } from './zones';

export interface TerrainPaintInput {
  h: Float32Array;
  g: Grid;
  level: LevelData;
  pal: Palette;
  ways: readonly Way[];
  wayMask: Float32Array;
  detourMask: Float32Array;
}

const SKIRT_DEPTH = 3; // metres below the lowest ground point
const JITTER = 0.085; // per-face value variation

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Stable hash → [0, 1) for per-face jitter (independent of build order). */
function hash01(a: number, b: number, c: number): number {
  let h = Math.imul(a, 0x27d4eb2d) ^ Math.imul(b, 0x165667b1) ^ Math.imul(c, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Height statistics: min, max and a median estimate (from a subsample) that anchors the 'mid' band. */
function heightStats(h: Float32Array): { min: number; max: number; median: number } {
  let min = Infinity,
    max = -Infinity;
  for (let i = 0; i < h.length; i++) {
    const v = h[i]!;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const stride = Math.max(1, Math.floor(h.length / 4096));
  const sub: number[] = [];
  for (let i = 0; i < h.length; i += stride) sub.push(h[i]!);
  sub.sort((a, b) => a - b);
  return { min, max, median: sub[Math.floor(sub.length / 2)] ?? 0 };
}

export async function buildTerrainGeometry(
  inp: TerrainPaintInput,
  y: Yielder,
  onProgress: (p: number) => void,
): Promise<{ geometry: THREE.BufferGeometry; minHeight: number; maxHeight: number }> {
  const { h, g, pal, ways, wayMask, detourMask, level } = inp;
  const stats = heightStats(h);
  const row = g.seg + 1;
  const faces = g.seg * g.seg * 2 + 4 * g.seg * 2;
  const pos = new Float32Array(faces * 9);
  const nor = new Float32Array(faces * 9);
  const col = new Float32Array(faces * 9);
  let f = 0; // face cursor

  const cLow = colorOf(pal.ground.low);
  const cMid = colorOf(pal.ground.mid);
  const cHigh = colorOf(pal.ground.high);
  const cSlope = colorOf(pal.ground.slope);
  const cWorn = colorOf(mix(pal.ground.pathEdge, pal.ground.mid, 0.35));
  const cWornDetour = colorOf(mix(pal.ground.detour, pal.ground.mid, 0.45));
  const cSkirt = colorOf(shade(pal.ground.slope, -0.14));
  const tints = level.zones.flatMap((z) => {
    const t = zoneTint(z, pal);
    const b = zoneBounds(z, ways);
    return t && b ? [{ zone: z, color: colorOf(t.hex), amount: t.amount, b }] : [];
  });
  const below = Math.max(0.5, stats.median - stats.min);
  const above = Math.max(0.5, stats.max - stats.median);
  const seed = level.seed | 0;
  const out = new THREE.Color();
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  const e1 = new THREE.Vector3(),
    e2 = new THREE.Vector3(),
    n = new THREE.Vector3();

  /** Write one triangle; with `outward`, flip the winding if its normal points the other way. */
  const emit = (
    p0: THREE.Vector3,
    p1: THREE.Vector3,
    p2: THREE.Vector3,
    color: THREE.Color,
    outward?: THREE.Vector3,
  ): void => {
    e1.subVectors(p1, p0);
    e2.subVectors(p2, p0);
    n.crossVectors(e1, e2).normalize();
    let q1 = p1,
      q2 = p2;
    if (outward && n.dot(outward) < 0) {
      q1 = p2;
      q2 = p1;
      n.negate();
    }
    const o = f * 9;
    const verts = [p0, q1, q2];
    for (let k = 0; k < 3; k++) {
      const v = verts[k]!;
      pos[o + k * 3] = v.x;
      pos[o + k * 3 + 1] = v.y;
      pos[o + k * 3 + 2] = v.z;
      nor[o + k * 3] = n.x;
      nor[o + k * 3 + 1] = n.y;
      nor[o + k * 3 + 2] = n.z;
      col[o + k * 3] = color.r;
      col[o + k * 3 + 1] = color.g;
      col[o + k * 3 + 2] = color.b;
    }
    f++;
  };

  /** Face colour from the centroid height, the face slope, zones and the path masks. */
  const shadeFace = (ia: number, ib: number, ic: number, i: number, j: number, tri: number): THREE.Color => {
    const cx = (a.x + b.x + c.x) / 3;
    const cy = (a.y + b.y + c.y) / 3;
    const cz = (a.z + b.z + c.z) / 3;
    if (cy < stats.median) out.copy(cMid).lerp(cLow, smoothstep(0, 1, (stats.median - cy) / below));
    else out.copy(cMid).lerp(cHigh, smoothstep(0.15, 1, (cy - stats.median) / above));
    e1.subVectors(b, a);
    e2.subVectors(c, a);
    n.crossVectors(e1, e2).normalize();
    const slopeDeg = (Math.acos(Math.min(1, Math.abs(n.y))) * 180) / Math.PI;
    out.lerp(cSlope, smoothstep(24, 42, slopeDeg));
    for (const t of tints) {
      if (cx < t.b.x0 - 4 || cx > t.b.x1 + 4 || cz < t.b.z0 - 4 || cz > t.b.z1 + 4) continue;
      const d = zoneDistance(t.zone, cx, cz, ways, 4);
      out.lerp(t.color, t.amount * (1 - smoothstep(-3, 1.5, d)));
    }
    const mw = (wayMask[ia]! + wayMask[ib]! + wayMask[ic]!) / 3;
    if (mw > 0) out.lerp(cWorn, 0.5 * mw);
    const md = (detourMask[ia]! + detourMask[ib]! + detourMask[ic]!) / 3;
    if (md > 0) out.lerp(cWornDetour, 0.45 * md);
    return out.multiplyScalar(1 + (hash01(i + seed, j, tri) - 0.5) * 2 * JITTER);
  };

  const vx = (i: number): number => -g.half + i * g.cell;
  const set = (v: THREE.Vector3, i: number, j: number): number => {
    const idx = j * row + i;
    v.set(vx(i), h[idx]!, vx(j));
    return idx;
  };

  for (let j = 0; j < g.seg; j++) {
    for (let i = 0; i < g.seg; i++) {
      // Corners: A (i, j), B (i+1, j), C (i, j+1), D (i+1, j+1); winding keeps normals up (see sampleGrid).
      if (evenCell(i, j)) {
        const ia = set(a, i, j),
          ic = set(b, i, j + 1),
          id = set(c, i + 1, j + 1);
        emit(a, b, c, shadeFace(ia, ic, id, i, j, 0));
        const ia2 = set(a, i, j),
          id2 = set(b, i + 1, j + 1),
          ib2 = set(c, i + 1, j);
        emit(a, b, c, shadeFace(ia2, id2, ib2, i, j, 1));
      } else {
        const ia = set(a, i, j),
          ic = set(b, i, j + 1),
          ib = set(c, i + 1, j);
        emit(a, b, c, shadeFace(ia, ic, ib, i, j, 0));
        const ib2 = set(a, i + 1, j),
          ic2 = set(b, i, j + 1),
          id2 = set(c, i + 1, j + 1);
        emit(a, b, c, shadeFace(ib2, ic2, id2, i, j, 1));
      }
    }
    onProgress((j + 1) / g.seg);
    await y.tick();
  }

  // Skirt: walls from each map edge down below the lowest point.
  const bottom = stats.min - SKIRT_DEPTH;
  const outward = new THREE.Vector3();
  const sides: Array<[number, number, number, number]> = [
    [0, 0, 1, 0], // z = -half, along +x
    [0, g.seg, 1, 0], // z = +half
    [0, 0, 0, 1], // x = -half, along +z
    [g.seg, 0, 0, 1], // x = +half
  ];
  const skirt = new THREE.Color();
  for (let s = 0; s < 4; s++) {
    const [si, sj, di, dj] = sides[s]!;
    outward.set(di === 0 ? (si === 0 ? -1 : 1) : 0, 0, dj === 0 ? (sj === 0 ? -1 : 1) : 0);
    for (let k = 0; k < g.seg; k++) {
      const i0 = si + di * k,
        j0 = sj + dj * k,
        i1 = i0 + di,
        j1 = j0 + dj;
      skirt.copy(cSkirt).multiplyScalar(1 + (hash01(s + seed, k, 7) - 0.5) * 2 * JITTER);
      set(a, i0, j0);
      set(b, i1, j1);
      c.set(a.x, bottom, a.z);
      emit(a, c, b, skirt, outward);
      e1.set(b.x, bottom, b.z); // reuse as the 4th corner
      a.copy(e1);
      emit(b, c, a, skirt, outward);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return { geometry, minHeight: stats.min, maxHeight: stats.max };
}
