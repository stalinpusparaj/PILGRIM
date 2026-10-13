/**
 * Scatter meshes (split from Scatter.ts): turns the placement records into chunked, LOD'd InstancedMeshes and
 * world colliders. Every prop type is built ONCE with buildProp() (and once more with `lod: 1` for big props);
 * each ~75 m chunk gets one InstancedMesh per type with chunk-sized bounds, so the camera and the sun's shadow
 * frustum cull what they cannot see.
 */
import * as THREE from 'three';
import { mat } from './materials';
import type { Palette } from './palette';
import type { Rng } from './rng';
import type { Collider, PropResult } from './types';
import type { Yielder } from './yielder';
import type { Terrain } from './Terrain';
import type { QualityPreset } from '../core/Quality';
import { buildProp } from './props/index';
import { defaultsFor, type ScatterTypeDefaults } from './terrain/scatterRules';

/** Per-placement record stride: x, y, z, yaw, tiltX, tiltZ, scale, r, g, b. */
export const STRIDE = 10;
/**
 * Chunk sizes (m): small props (grass, flowers) ~75 m (≈4×4 on a 300 m map); big props ~100 m (≈3×3), a
 * balance between culling and draw calls. A type whose placements all fit in one cell (a wood, a bog, an
 * orchard) stays one chunk, centred on its placements.
 */
const CHUNK = { small: 75, big: 100 } as const;

interface Chunk {
  key: string;
  x: number;
  z: number;
  /** Bounding radius of the chunk's placements about (x, z), m. */
  r: number;
  idx: number[];
}

/** Groups placements into grid chunks of about `target` metres (or one chunk when they all fit in one cell). */
function chunksOf(rec: number[], count: number, size: number, target: number): Chunk[] {
  const n = Math.max(2, Math.min(8, Math.round(size / target)));
  const cellSize = size / n;
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (let i = 0; i < count; i++) {
    const x = rec[i * STRIDE]!;
    const z = rec[i * STRIDE + 2]!;
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    z0 = Math.min(z0, z);
    z1 = Math.max(z1, z);
  }
  const groups = new Map<string, number[]>();
  const compact = x1 - x0 <= cellSize && z1 - z0 <= cellSize;
  const cell = (v: number): number => Math.min(n - 1, Math.max(0, Math.floor((v + size / 2) / cellSize)));
  for (let i = 0; i < count; i++) {
    const key = compact ? 'all' : `${cell(rec[i * STRIDE]!)},${cell(rec[i * STRIDE + 2]!)}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = []));
    g.push(i);
  }
  const out: Chunk[] = [];
  for (const [key, idx] of groups) {
    let cx: number;
    let cz: number;
    if (compact) {
      cx = (x0 + x1) / 2;
      cz = (z0 + z1) / 2;
    } else {
      const [i, j] = key.split(',').map(Number) as [number, number];
      cx = -size / 2 + (i + 0.5) * cellSize;
      cz = -size / 2 + (j + 0.5) * cellSize;
    }
    let r = 0;
    for (const i of idx) r = Math.max(r, Math.hypot(rec[i * STRIDE]! - cx, rec[i * STRIDE + 2]! - cz));
    out.push({ key, x: cx, z: cz, r, idx });
  }
  return out;
}

export interface ScatterResult {
  object: THREE.Object3D;
  colliders: Collider[];
  dispose(): void;
}

const mtx = new THREE.Matrix4();
const quat = new THREE.Quaternion();
const eul = new THREE.Euler();
const pos = new THREE.Vector3();
const scl = new THREE.Vector3();
const tint = new THREE.Color();

/** Fill an InstancedMesh from the placement records listed in `idx`, positions relative to (ox, oz). */
function fillInstances(
  mesh: THREE.InstancedMesh,
  rec: number[],
  idx: readonly number[],
  ox: number,
  oz: number,
  colours: boolean,
): void {
  for (let i = 0; i < idx.length; i++) {
    const o = idx[i]! * STRIDE;
    eul.set(rec[o + 4]!, rec[o + 3]!, rec[o + 5]!, 'YXZ');
    pos.set(rec[o]! - ox, rec[o + 1]!, rec[o + 2]! - oz);
    scl.setScalar(rec[o + 6]!);
    mesh.setMatrixAt(i, mtx.compose(pos, quat.setFromEuler(eul), scl));
    if (colours) mesh.setColorAt(i, tint.setRGB(rec[o + 7]!, rec[o + 8]!, rec[o + 9]!));
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
}

/** Local prop colliders → world space for one placement (yaw + uniform scale; tilt is ignored). */
function placeColliders(local: Collider[], rec: number[], o: number, out: Collider[]): void {
  const x = rec[o]!,
    y = rec[o + 1]!,
    z = rec[o + 2]!,
    yaw = rec[o + 3]!,
    s = rec[o + 6]!;
  const c = Math.cos(yaw),
    sn = Math.sin(yaw);
  for (const col of local) {
    const [lx, ly, lz] = col.center;
    const center: [number, number, number] = [
      x + (c * lx + sn * lz) * s,
      y + ly * s,
      z + (-sn * lx + c * lz) * s,
    ];
    if (col.kind === 'box') {
      out.push({
        kind: 'box',
        center,
        half: [col.half[0] * s, col.half[1] * s, col.half[2] * s],
        rotY: col.rotY + yaw,
      });
    } else if (col.kind === 'cylinder') {
      out.push({ kind: 'cylinder', center, radius: col.radius * s, height: col.height * s });
    } else {
      out.push({ kind: 'sphere', center, radius: col.radius * s });
    }
  }
}

/** Colliders for a prop that did not provide any: trunk cylinder or a sphere from its bounds. */
function fallbackColliders(geo: THREE.BufferGeometry, kind: 'cylinder' | 'sphere'): Collider[] {
  if (!geo.boundingBox) geo.computeBoundingBox();
  const b = geo.boundingBox!;
  const h = Math.max(0.5, b.max.y);
  if (kind === 'cylinder') return [{ kind: 'cylinder', center: [0, h / 2, 0], radius: 0.3, height: h }];
  const r = 0.42 * Math.max(b.max.x - b.min.x, b.max.z - b.min.z);
  return [{ kind: 'sphere', center: [0, (b.min.y + b.max.y) / 2, 0], radius: r }];
}

/** Triangles in a non-indexed or indexed geometry. */
function trianglesOf(g: THREE.BufferGeometry): number {
  return (g.index ? g.index.count : g.getAttribute('position').count) / 3;
}

export async function buildMeshes(
  placed: Map<string, number[]>,
  terrain: Terrain,
  pal: Palette,
  rng: Rng,
  quality: QualityPreset,
  y: Yielder,
): Promise<ScatterResult> {
  const root = new THREE.Group();
  root.name = 'scatter';
  const colliders: Collider[] = [];
  const meshes: THREE.InstancedMesh[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  // LOD distances are measured to a chunk's centre, so each adds its chunk's radius.
  // Small props hide beyond this distance from the camera.
  const cullAt = Math.min(90, Math.max(35, quality.drawDistance * 0.35));
  // Big props switch to their low-LOD build here and hide only where the fog has swallowed them.
  const farAt = Math.min(90, Math.max(30, quality.drawDistance * 0.3));

  const addMesh = (
    type: string,
    geo: THREE.BufferGeometry,
    glow: boolean,
    d: ScatterTypeDefaults,
    rec: number[],
    idx: number[],
    ox: number,
    oz: number,
  ): THREE.InstancedMesh => {
    const mesh = new THREE.InstancedMesh(geo, mat(glow ? 'glow' : 'lambert'), idx.length);
    mesh.name = `scatter:${type}${glow ? ':glow' : ''}`;
    fillInstances(mesh, rec, idx, ox, oz, !glow);
    mesh.castShadow = d.shadow && !glow;
    mesh.receiveShadow = !glow;
    meshes.push(mesh);
    return mesh;
  };
  const level = (
    type: string,
    geo: THREE.BufferGeometry,
    glow: THREE.BufferGeometry | null,
    d: ScatterTypeDefaults,
    rec: number[],
    idx: number[],
    ox: number,
    oz: number,
  ): THREE.Group => {
    const g = new THREE.Group();
    g.add(addMesh(type, geo, false, d, rec, idx, ox, oz));
    if (glow) g.add(addMesh(type, glow, true, d, rec, idx, ox, oz));
    return g;
  };

  for (const [type, rec] of placed) {
    const count = rec.length / STRIDE;
    if (count === 0) continue;
    const d = defaultsFor(type);
    let prop: PropResult;
    try {
      prop = buildProp(type, rng.fork(`prop:${type}`), pal);
    } catch (err) {
      console.warn(`scatter: cannot build prop "${type}"`, err);
      continue;
    }
    geometries.push(prop.geometry);
    if (prop.glow) geometries.push(prop.glow);
    // The distant build: same layout and colours, fewer segments (kept only when it really is lighter).
    let low: PropResult | null = null;
    if (!d.small) {
      try {
        low = buildProp(type, rng.fork(`prop:${type}`), pal, { lod: 1 });
        if (trianglesOf(low.geometry) > 0.85 * trianglesOf(prop.geometry)) {
          low.geometry.dispose();
          low.glow?.dispose();
          low = null;
        } else {
          geometries.push(low.geometry);
          if (low.glow) geometries.push(low.glow);
        }
      } catch {
        low = null;
      }
    }
    if (d.collide) {
      const local = prop.colliders.length > 0 ? prop.colliders : fallbackColliders(prop.geometry, d.collide);
      for (let i = 0; i < count; i++) placeColliders(local, rec, i * STRIDE, colliders);
    }
    for (const c of chunksOf(rec, count, terrain.size, d.small ? CHUNK.small : CHUNK.big)) {
      const lod = new THREE.LOD();
      lod.name = `scatter:${type}:${c.key}`;
      lod.position.set(c.x, 0, c.z);
      lod.addLevel(level(type, prop.geometry, prop.glow ?? null, d, rec, c.idx, c.x, c.z), 0);
      if (d.small) {
        lod.addLevel(new THREE.Object3D(), cullAt + c.r);
      } else {
        if (low)
          lod.addLevel(
            level(type, low.geometry, low.glow ?? prop.glow ?? null, d, rec, c.idx, c.x, c.z),
            farAt + c.r * 0.5,
          );
        lod.addLevel(new THREE.Object3D(), pal.fog.far + c.r);
      }
      root.add(lod);
    }
    await y.tick();
  }

  return {
    object: root,
    colliders,
    dispose(): void {
      root.removeFromParent();
      for (const m of meshes) m.dispose();
      for (const g of geometries) g.dispose();
      meshes.length = 0;
      geometries.length = 0;
    },
  };
}
