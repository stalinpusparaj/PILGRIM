/**
 * The Way's visible path (GDD 2.11): a smooth ribbon that hugs the terrain, warm in the middle with subtle
 * per-face variation and a softer edge band, plus little edge stones (one InstancedMesh) along both sides with
 * gaps. Detours use the palette's duller, cooler detour colour and tuck under the main ribbon at junctions.
 */
import * as THREE from 'three';
import { colorOf, jitter, lowSphere, paint, xform } from '../geom';
import { mat } from '../materials';
import { mix, shade, vary, type Palette } from '../palette';
import type { Rng } from '../rng';
import type { Terrain } from '../Terrain';
import type { Way } from '../Way';

const RIBBON_STEP = 1; // metres between cross-sections
/** Cross-section columns as fractions of the half-width. Strips 0 and 5 are the edge band. */
const COLS = [-1, -0.8, -0.42, 0, 0.42, 0.8, 1] as const;
const LIFT = { way: 0.035, detour: 0.025 } as const;
const STONE_GAP_CHANCE = 0.1;

/** Ribbon colour ramp per strip: edge, shoulder, body, body, shoulder, edge. */
function stripColors(body: string, edge: string, rng: Rng): THREE.Color[][] {
  const shoulder = mix(body, edge, 0.3);
  const variants = (hex: string, amount: number): THREE.Color[] =>
    Array.from({ length: 6 }, () => colorOf(vary(hex, amount, rng.next())));
  const e = variants(edge, 0.03),
    s = variants(shoulder, 0.025),
    b = variants(body, 0.02);
  return [e, s, b, b, s, e];
}

/** A small, slightly squashed faceted pebble; vertex colour is a light/dark facet ramp, tinted per instance. */
function stoneGeometry(rng: Rng): THREE.BufferGeometry {
  const g = paint(lowSphere(0.5, 0), (_p, n) =>
    n.y > 0.55 ? '#FFFFFF' : n.y > -0.2 ? '#E2DED8' : '#C9C4BC',
  );
  return xform(jitter(g, 0.07, rng), { scale: [1, 0.62, 1], pos: [0, 0.12, 0] });
}

export function buildWayMesh(
  way: Way,
  terrain: Terrain,
  pal: Palette,
  rng: Rng,
): { object: THREE.Group; dispose(): void } {
  const isDetour = way.kind !== 'way';
  const others = terrain.ways.filter((w) => w !== way);
  const mains = others.filter((w) => w.kind === 'way');
  const body = isDetour ? pal.ground.detour : pal.ground.path;
  const edge = isDetour ? shade(pal.ground.detour, -0.07) : pal.ground.pathEdge;
  const strips = stripColors(body, edge, rng.fork('ribbon'));
  const hw = way.halfWidth;
  const lift = isDetour ? LIFT.detour : LIFT.way;

  // ---- ribbon cross-sections
  const m = Math.max(1, Math.ceil(way.length / RIBBON_STEP));
  const nc = COLS.length;
  const grid = new Float32Array((m + 1) * nc * 3);
  const keep = new Uint8Array(m + 1);
  const p = new THREE.Vector3();
  const tan = new THREE.Vector3();
  for (let k = 0; k <= m; k++) {
    way.sample(k / m, p);
    way.tangent(k / m, tan);
    const sl = Math.hypot(tan.x, tan.z) || 1;
    const sx = tan.z / sl,
      sz = -tan.x / sl;
    for (let c = 0; c < nc; c++) {
      const x = p.x + sx * COLS[c]! * hw;
      const z = p.z + sz * COLS[c]! * hw;
      const o = (k * nc + c) * 3;
      grid[o] = x;
      grid[o + 1] = terrain.heightAt(x, z) + lift;
      grid[o + 2] = z;
    }
    // A detour stops where it runs under the main Way, so the junction stays clean.
    keep[k] = isDetour && mains.some((w) => w.distanceWithin(p.x, p.z, w.halfWidth + 0.1) < Infinity) ? 0 : 1;
  }

  const maxTris = m * (nc - 1) * 2;
  const pos = new Float32Array(maxTris * 9);
  const nor = new Float32Array(maxTris * 9);
  const col = new Float32Array(maxTris * 9);
  let f = 0;
  const v0 = new THREE.Vector3(),
    v1 = new THREE.Vector3(),
    v2 = new THREE.Vector3();
  const e1 = new THREE.Vector3(),
    e2 = new THREE.Vector3(),
    n = new THREE.Vector3();
  const verts = [v0, v1, v2] as const;
  const vert = (v: THREE.Vector3, k: number, c: number): THREE.Vector3 => {
    const o = (k * nc + c) * 3;
    return v.set(grid[o]!, grid[o + 1]!, grid[o + 2]!);
  };
  const tri = (color: THREE.Color): void => {
    n.crossVectors(e1.subVectors(v1, v0), e2.subVectors(v2, v0)).normalize();
    let o = f * 9;
    for (const v of verts) {
      pos[o] = v.x;
      pos[o + 1] = v.y;
      pos[o + 2] = v.z;
      nor[o] = n.x;
      nor[o + 1] = n.y;
      nor[o + 2] = n.z;
      col[o] = color.r;
      col[o + 1] = color.g;
      col[o + 2] = color.b;
      o += 3;
    }
    f++;
  };
  for (let k = 0; k < m; k++) {
    if (!keep[k] || !keep[k + 1]) continue;
    for (let s = 0; s < nc - 1; s++) {
      const ramp = strips[s]!;
      // Winding (k,s)→(k+1,s)→(k,s+1) faces up for this side vector (tangent × side = +Y).
      vert(v0, k, s);
      vert(v1, k + 1, s);
      vert(v2, k, s + 1);
      tri(ramp[Math.floor(rng.next() * ramp.length)]!);
      vert(v0, k, s + 1);
      vert(v1, k + 1, s);
      vert(v2, k + 1, s + 1);
      tri(ramp[Math.floor(rng.next() * ramp.length)]!);
    }
  }
  const ribbonGeo = new THREE.BufferGeometry();
  ribbonGeo.setAttribute('position', new THREE.BufferAttribute(pos.slice(0, f * 9), 3));
  ribbonGeo.setAttribute('normal', new THREE.BufferAttribute(nor.slice(0, f * 9), 3));
  ribbonGeo.setAttribute('color', new THREE.BufferAttribute(col.slice(0, f * 9), 3));
  ribbonGeo.computeBoundingBox();
  ribbonGeo.computeBoundingSphere();
  const ribbon = new THREE.Mesh(ribbonGeo, mat('path'));
  ribbon.name = `ribbon:${way.id}`;
  ribbon.receiveShadow = true;
  ribbon.renderOrder = isDetour ? 0 : 1; // the main Way draws over a detour where they meet

  // ---- edge stones
  const srng = rng.fork('stones');
  const stoneGeo = stoneGeometry(srng);
  const tones = (
    isDetour
      ? [
          shade(pal.ground.detour, -0.05),
          mix(pal.ground.detour, pal.ground.slope, 0.4),
          shade(pal.ground.detour, -0.13),
          mix(pal.ground.detour, pal.ground.pathEdge, 0.35),
        ]
      : [
          pal.ground.pathEdge,
          shade(pal.ground.pathEdge, -0.08),
          mix(pal.ground.pathEdge, pal.ground.slope, 0.5),
          shade(pal.ground.path, -0.1),
        ]
  ).map((h) => colorOf(h));
  const capacity = Math.ceil((2 * way.length) / 0.8) + 4;
  const stones = new THREE.InstancedMesh(stoneGeo, mat('lambert'), capacity);
  stones.name = `stones:${way.id}`;
  const mtx = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const eul = new THREE.Euler();
  const scl = new THREE.Vector3();
  const tint = new THREE.Color();
  let count = 0;
  for (const side of [-1, 1]) {
    let s = srng.range(0.3, 1.2);
    while (s < way.length && count < capacity) {
      if (srng.chance(STONE_GAP_CHANCE)) {
        s += srng.range(2, 4.5); // a gap in the row
        continue;
      }
      const t = s / way.length;
      way.sample(t, p);
      way.tangent(t, tan);
      s += srng.range(0.8, 1.5);
      const sl = Math.hypot(tan.x, tan.z) || 1;
      const off = side * (hw + srng.range(0.08, 0.28));
      const x = p.x + (tan.z / sl) * off;
      const z = p.z - (tan.x / sl) * off;
      if (!terrain.contains(x, z, 0.5)) continue;
      if (others.some((w) => w.distanceWithin(x, z, w.halfWidth + 0.45) < Infinity)) continue; // junctions stay open
      const size = srng.range(0.2, 0.38);
      eul.set(srng.range(-0.15, 0.15), srng.range(0, Math.PI * 2), srng.range(-0.15, 0.15), 'YXZ');
      scl.set(size * srng.range(0.9, 1.25), size * srng.range(0.7, 1.05), size);
      p.set(x, terrain.heightAt(x, z) - 0.03, z);
      stones.setMatrixAt(count, mtx.compose(p, q.setFromEuler(eul), scl));
      stones.setColorAt(
        count,
        tint.copy(tones[srng.int(0, tones.length - 1)]!).multiplyScalar(srng.range(0.9, 1.08)),
      );
      count++;
    }
  }
  stones.count = count;
  stones.instanceMatrix.needsUpdate = true;
  if (stones.instanceColor) stones.instanceColor.needsUpdate = true;
  stones.computeBoundingSphere();
  stones.receiveShadow = true;

  const group = new THREE.Group();
  group.name = `way:${way.id}`;
  group.add(ribbon, stones);
  return {
    object: group,
    dispose(): void {
      group.removeFromParent();
      ribbonGeo.dispose();
      stoneGeo.dispose();
      stones.dispose();
    },
  };
}
