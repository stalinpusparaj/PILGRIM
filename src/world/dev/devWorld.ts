/**
 * Geometry for the Phase 0 test scene (see DevScene.ts): a faceted ground disc with gentle hills at the rim,
 * a few chunky toy-like props, puffy clouds and a spinning gem. Everything is generated from one seed by
 * placement rules (rings, distances); there are no level coordinates here. Each builder returns ONE merged,
 * flat-shaded, vertex-coloured geometry, so the whole scene costs a handful of draw calls.
 */
import * as THREE from 'three';
import { createRng, type Rng } from './rng';
import { flatten, jitter, mergeFlat, paintFaces } from './geom';

/** All colours of the test scene (GDD 2.12: colours come from a palette). */
export const DEV_PALETTE = {
  skyTop: '#3f93db',
  skyHorizon: '#d9eef0',
  skyBottom: '#e8e1c4',
  sun: '#fff0c8',
  sunLight: '#fff1d6',
  hemiSky: '#d8ecff',
  hemiGround: '#8a7650',
  grass: ['#86c453', '#7dbb4c', '#91cc5c', '#78b44a'],
  hillTop: '#c4d36f',
  trunk: ['#8a5a3b', '#7a4f33'],
  leaves: ['#58a447', '#4c9640', '#63b04f'],
  pine: ['#2f7d4c', '#3b8c57'],
  rock: ['#a39a8e', '#968d82', '#b0a89b'],
  bush: ['#6fb84f', '#5fa947'],
  stone: ['#c9b48a', '#bba67c'],
  gem: ['#ffcf4d', '#ffbf33', '#ffe07a'],
  cloud: ['#ffffff', '#f4f7fb'],
} as const;

/** Triangle edges grow with distance (small near the camera, big at the fogged rim). */
const GROUND = { radius: 260, edge: 2.2, edgeGrowth: 30, flatRadius: 32, hillRadius: 110, bump: 0.12 };
const INNER = { min: 3.6, max: 11, spacing: 2.3, trees: 5, rocks: 4, bushes: 5 };
const OUTER = { min: 28, max: 80, spacing: 5, trees: 22, rocks: 7 };
const CLOUDS = { count: 8, minR: 70, maxR: 160, minY: 38, maxY: 58 };

// ------------------------------------------------------------------------------------------------- ground

/** Analytic ground height: flat around the centre, rolling low hills towards the rim. */
export function groundHeight(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const ramp = smoothstep(GROUND.flatRadius, GROUND.hillRadius, r);
  if (ramp === 0) return 0;
  const n =
    0.5 * Math.sin(x * 0.045 + 1.3) * Math.cos(z * 0.05 + 0.4) +
    0.3 * Math.sin((x + z) * 0.09 + 2.1) +
    0.2 * Math.cos((x - z) * 0.13 + 0.7);
  return ramp * (3 + 5 * n);
}

interface Ring {
  /** Vertex indices, in increasing angle. */
  ids: number[];
  /** Angles in radians, increasing, within [angles[0], angles[0] + 2π). */
  angles: number[];
}

const TAU = Math.PI * 2;

/**
 * Joins two neighbouring rings with a strip of triangles (counter-clockwise seen from above), always
 * advancing along whichever ring's next vertex comes first, so rings may have different vertex counts.
 */
function stitch(inner: Ring, outer: Ring, index: number[]): void {
  const base = inner.angles[0];
  const unwrap = (a: number): number => base + ((((a - base) % TAU) + TAU) % TAU);
  let start = 0;
  for (let j = 1; j < outer.angles.length; j++) {
    if (unwrap(outer.angles[j]) < unwrap(outer.angles[start])) start = j;
  }
  const na = inner.ids.length;
  const nb = outer.ids.length;
  const innerAngle = (i: number): number => (i < na ? inner.angles[i] : inner.angles[0] + TAU);
  const outerAngle = (j: number): number => {
    const a = unwrap(outer.angles[(start + j) % nb]);
    return j < nb ? a : a + TAU;
  };
  const innerId = (i: number): number => inner.ids[i % na];
  const outerId = (j: number): number => outer.ids[(start + j) % nb];
  let i = 0;
  let j = 0;
  while (i < na || j < nb) {
    if (j >= nb || (i < na && innerAngle(i + 1) < outerAngle(j + 1))) {
      index.push(innerId(i), innerId(i + 1), outerId(j));
      i++;
    } else {
      index.push(innerId(i), outerId(j + 1), outerId(j));
      j++;
    }
  }
}

/**
 * A disc of evenly sized, jittered triangles: concentric rings whose spacing and vertex count follow the
 * target edge length, stitched together. One colour per triangle, lighter and yellower on the hills.
 */
export function buildGround(seed: number): THREE.BufferGeometry {
  const rng = createRng(seed);
  const edgeAt = (r: number): number => GROUND.edge * (1 + r / GROUND.edgeGrowth);
  const verts: number[] = [0, groundHeight(0, 0), 0];
  const rings: Ring[] = [];
  for (let r = edgeAt(0); ;) {
    const last = r >= GROUND.radius;
    const radius = Math.min(r, GROUND.radius);
    const step = edgeAt(radius);
    const count = Math.max(6, Math.round((TAU * radius) / step));
    const offset = rng.range(0, TAU);
    const ring: Ring = { ids: [], angles: [] };
    for (let k = 0; k < count; k++) {
      const a = offset + ((k + rng.range(-0.3, 0.3)) / count) * TAU;
      const rr = last ? radius : radius + rng.range(-0.25, 0.25) * step;
      const x = Math.cos(a) * rr;
      const z = Math.sin(a) * rr;
      ring.ids.push(verts.length / 3);
      ring.angles.push(a);
      verts.push(x, groundHeight(x, z) + rng.range(-1, 1) * GROUND.bump, z);
    }
    rings.push(ring);
    if (last) break;
    r += step * 0.87; // ring spacing for roughly equilateral triangles
  }
  const index: number[] = [];
  const first = rings[0];
  for (let k = 0; k < first.ids.length; k++) {
    index.push(0, first.ids[(k + 1) % first.ids.length], first.ids[k]);
  }
  for (let k = 1; k < rings.length; k++) stitch(rings[k - 1], rings[k], index);

  const indexed = new THREE.BufferGeometry();
  indexed.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  indexed.setIndex(index);
  const ground = flatten(indexed);

  const grass = DEV_PALETTE.grass.map((c) => new THREE.Color(c));
  const hill = new THREE.Color(DEV_PALETTE.hillTop);
  paintFaces(ground, (center, _face, out) => {
    out.copy(rng.pick(grass)).lerp(hill, smoothstep(1.5, 7, center.y) * 0.8);
    out.multiplyScalar(rng.range(0.94, 1.05));
  });
  return mergeFlat([ground]);
}

// -------------------------------------------------------------------------------------------------- props

type Shape = 'roundTree' | 'pine' | 'rock' | 'bush';

/** A primitive, jittered, placed and painted with one palette entry (slight per-face variation). */
function part(
  rng: Rng,
  geometry: THREE.BufferGeometry,
  colors: readonly string[],
  place: THREE.Matrix4,
  wobble: number,
): THREE.BufferGeometry {
  const g = flatten(geometry);
  if (wobble > 0) jitter(g, wobble, rng.int(0, 1 << 30));
  g.applyMatrix4(place);
  const base = new THREE.Color(rng.pick(colors));
  paintFaces(g, (_c, _f, out) => {
    out.copy(base).multiplyScalar(rng.range(0.93, 1.06));
  });
  return g;
}

function placed(x: number, y: number, z: number, rotY: number, sx: number, sy = sx, sz = sx): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY),
    new THREE.Vector3(sx, sy, sz),
  );
}

function buildShape(rng: Rng, shape: Shape, x: number, z: number, out: THREE.BufferGeometry[]): void {
  const y = groundHeight(x, z) - 0.15; // sink a little so nothing floats on a slope
  const rot = rng.range(0, Math.PI * 2);
  const s = rng.range(0.8, 1.25);
  const P = DEV_PALETTE;
  switch (shape) {
    case 'roundTree': {
      out.push(
        part(
          rng,
          new THREE.CylinderGeometry(0.16, 0.26, 1.5, 6),
          P.trunk,
          placed(x, y + 0.75 * s, z, rot, s),
          0,
        ),
      );
      const crown = new THREE.IcosahedronGeometry(1.15, 1);
      out.push(part(rng, crown, P.leaves, placed(x, y + 2.3 * s, z, rot, s, s * 1.05, s), 0.12));
      break;
    }
    case 'pine': {
      out.push(
        part(
          rng,
          new THREE.CylinderGeometry(0.14, 0.22, 1.0, 6),
          P.trunk,
          placed(x, y + 0.5 * s, z, rot, s),
          0,
        ),
      );
      out.push(
        part(rng, new THREE.ConeGeometry(1.2, 2.0, 7), P.pine, placed(x, y + 1.8 * s, z, rot, s), 0.08),
      );
      out.push(
        part(
          rng,
          new THREE.ConeGeometry(0.85, 1.6, 7),
          P.pine,
          placed(x, y + 2.9 * s, z, rot + 0.4, s),
          0.06,
        ),
      );
      break;
    }
    case 'rock': {
      const flat = rng.range(0.55, 0.8);
      out.push(
        part(
          rng,
          new THREE.DodecahedronGeometry(0.7, 0),
          P.rock,
          placed(x, y + 0.3 * s, z, rot, s, s * flat, s * 1.15),
          0.12,
        ),
      );
      break;
    }
    case 'bush': {
      out.push(
        part(
          rng,
          new THREE.IcosahedronGeometry(0.62, 0),
          P.bush,
          placed(x, y + 0.42 * s, z, rot, s, s * 0.8, s),
          0.08,
        ),
      );
      break;
    }
  }
}

/** Scatters `count` spots in a ring, keeping `spacing` metres between them (rejection sampling). */
function scatterRing(rng: Rng, count: number, min: number, max: number, spacing: number, taken: number[][]) {
  const spots: Array<[number, number]> = [];
  for (let tries = 0; spots.length < count && tries < count * 40; tries++) {
    const a = rng.range(0, Math.PI * 2);
    const r = Math.sqrt(rng.range(min * min, max * max)); // uniform over the ring's area
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (taken.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < spacing)) continue;
    taken.push([x, z]);
    spots.push([x, z]);
  }
  return spots;
}

/** Trees, rocks and bushes in two rings plus a chunky stone plinth in the middle, merged into one geometry. */
export function buildProps(seed: number): THREE.BufferGeometry {
  const rng = createRng(seed);
  const parts: THREE.BufferGeometry[] = [];
  const taken: number[][] = [];
  const add = (shape: Shape, count: number, ring: { min: number; max: number; spacing: number }): void => {
    for (const [x, z] of scatterRing(rng, count, ring.min, ring.max, ring.spacing, taken)) {
      buildShape(rng, shape, x, z, parts);
    }
  };
  add('roundTree', Math.ceil(INNER.trees / 2), INNER);
  add('pine', Math.floor(INNER.trees / 2), INNER);
  add('rock', INNER.rocks, INNER);
  add('bush', INNER.bushes, INNER);
  add('roundTree', Math.ceil(OUTER.trees / 2), OUTER);
  add('pine', Math.floor(OUTER.trees / 2), OUTER);
  add('rock', OUTER.rocks, OUTER);
  // The plinth under the gem: two stacked bevel-less boxes, slightly wonky like a hand-cut toy block.
  parts.push(
    part(rng, new THREE.BoxGeometry(1.6, 0.5, 1.6), DEV_PALETTE.stone, placed(0, 0.2, 0, 0.3, 1), 0.05),
  );
  parts.push(
    part(rng, new THREE.BoxGeometry(1.0, 0.5, 1.0), DEV_PALETTE.stone, placed(0, 0.65, 0, 0.9, 1), 0.04),
  );
  return mergeFlat(parts);
}

// ------------------------------------------------------------------------------------------ clouds + gem

/** Puffy low-poly clouds: 3-5 squashed icosahedrons each, spread around the sky. */
export function buildClouds(seed: number): THREE.BufferGeometry {
  const rng = createRng(seed);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < CLOUDS.count; i++) {
    const a = (i / CLOUDS.count) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const r = rng.range(CLOUDS.minR, CLOUDS.maxR);
    const cx = Math.cos(a) * r;
    const cz = Math.sin(a) * r;
    const cy = rng.range(CLOUDS.minY, CLOUDS.maxY);
    const puffs = rng.int(3, 5);
    for (let p = 0; p < puffs; p++) {
      const s = rng.range(4, 7) * (p === 0 ? 1.3 : 1);
      const off = (p - (puffs - 1) / 2) * 5.5;
      const m = placed(
        cx - Math.sin(a) * off,
        cy + rng.range(-1, 1.5),
        cz + Math.cos(a) * off,
        a,
        s,
        s * 0.6,
        s,
      );
      parts.push(part(rng, new THREE.IcosahedronGeometry(1, 0), DEV_PALETTE.cloud, m, 0.08));
    }
  }
  return mergeFlat(parts);
}

/** A faceted golden gem (an octahedron, stretched), centred on its own origin so it can spin. */
export function buildGem(seed: number): THREE.BufferGeometry {
  const rng = createRng(seed);
  return mergeFlat([
    part(rng, new THREE.OctahedronGeometry(0.6, 0), DEV_PALETTE.gem, placed(0, 0, 0, 0, 1, 1.45, 1), 0),
  ]);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
