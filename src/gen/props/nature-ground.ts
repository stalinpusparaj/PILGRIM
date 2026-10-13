/**
 * Ground-level nature builders: rock, mushroom, log, stump and vine_row (a vineyard row for Chapter XII).
 * Rocks are jittered polyhedra with a flattened base (< 80 triangles); wood shows pale end grain.
 */
import * as THREE from 'three';
import {
  bevelBox,
  cone,
  cylinder,
  finalize,
  jitter,
  lowSphere,
  merge,
  paint,
  xform,
  type Vec3,
} from '../geom';
import type { Palette } from '../palette';
import type { Rng } from '../rng';
import type { Collider, PropParams, PropResult } from '../types';
import {
  SINK,
  TAU,
  boxCollider,
  cylCollider,
  flattenBase,
  hsl,
  jiggle,
  lean,
  natureColours,
  num,
  readOpts,
  scaleProp,
  speckle,
  sphereCollider,
  tones,
  type NatureColours,
} from './nature-kit';

interface Stone {
  r: number;
  x: number;
  z: number;
  scale: Vec3;
  /** Dodecahedron (36 tris, chunky) or icosahedron (20 tris, pebbly). */
  dodeca: boolean;
}

function stoneLayout(variant: number, rng: Rng): Stone[] {
  const a = rng.range(0, TAU);
  const near = (r: number, d: number, t: number): Stone => ({
    r,
    x: Math.cos(a + t) * d,
    z: Math.sin(a + t) * d,
    scale: [1, rng.range(0.7, 0.85), 1],
    dodeca: false,
  });
  switch (variant) {
    case 0: // single boulder
      return [{ r: 1, x: 0, z: 0, scale: [1.12, 0.72, 0.95], dodeca: true }];
    case 1: // boulder and a small friend
      return [{ r: 1, x: 0, z: 0, scale: [1.05, 0.8, 1], dodeca: false }, near(0.52, 1.18, 0)];
    case 2: // cluster of three
      return [
        { r: 1, x: 0, z: 0, scale: [1.05, 0.82, 0.95], dodeca: true },
        near(0.5, 1.12, rng.range(-0.3, 0.3)),
        near(0.36, 1.05, 2.2 + rng.range(-0.3, 0.3)),
      ];
    default: // standing stone
      return [{ r: 1, x: 0, z: 0, scale: [0.62, 1.6, 0.5], dodeca: true }];
  }
}

/** rock: jittered boulders with flat bases; variant 3 is a tall standing stone. Some get mossy tops. */
export function rock(rng: Rng, pal: Palette, params: PropParams): PropResult {
  const o = readOpts(
    rng,
    params,
    (v) =>
      (
        [
          [0.6, 1.1],
          [0.5, 0.9],
          [0.7, 1.2],
          [1.3, 1.9],
        ] as const
      )[v]!,
  );
  const jr = rng.fork('jitter');
  const pr = rng.fork('paint');
  const c = natureColours(pal);
  const stone = tones(jiggle(o.colour ?? c.stone, rng), 0.06);
  const under = hsl(stone[0], 0, 0, -0.06);
  const moss = rng.chance(0.35) ? jiggle(c.moss, rng) : null;
  const base = speckle(stone, pr, { top: 0.15, under });
  const painter = (p: THREE.Vector3, n: THREE.Vector3): string => (moss && n.y > 0.78 ? moss : base(p, n));

  const parts: THREE.BufferGeometry[] = [];
  const colliders: Collider[] = [];
  for (const s of stoneLayout(o.variant, rng)) {
    const raw = s.dodeca ? finalize(new THREE.DodecahedronGeometry(s.r, 0)) : lowSphere(s.r, 0);
    // Random tumble first (so each rock shows different facets), then squash and place half-buried.
    xform(raw, { rot: [rng.range(0, TAU), rng.range(0, TAU), rng.range(0, TAU)] });
    const cy = s.r * s.scale[1] * 0.5;
    const g = xform(raw, { pos: [s.x, cy, s.z], scale: s.scale });
    jitter(g, s.r * 0.12, jr);
    flattenBase(g, -0.06 * s.r);
    parts.push(paint(g, painter));
    const top = cy + s.r * s.scale[1];
    const rad = s.r * Math.max(s.scale[0], s.scale[2]) * 0.85;
    if (s.r < 0.45) continue; // pebbles are walk-over
    colliders.push(s.dodeca ? cylCollider(rad, top, s.x, s.z) : sphereCollider([s.x, cy, s.z], s.r * 0.9));
  }
  const geometry = merge(parts);
  geometry.computeBoundingBox();
  scaleProp(geometry, colliders, o.height / Math.max(0.01, geometry.boundingBox!.max.y));
  // Jitter can pull the top down; never let a collider stand taller than the rock.
  for (const col of colliders) {
    if (col.kind !== 'cylinder' || col.height <= o.height) continue;
    col.height = o.height;
    col.center = [col.center[0], o.height / 2, col.center[2]];
  }
  return { geometry, colliders };
}

/** One mushroom (stem + faceted frustum cap) standing at `pos`, `h` tall. ~48 triangles. */
function shroom(
  pos: Vec3,
  h: number,
  cap: string,
  spotted: boolean,
  c: NatureColours,
  rng: Rng,
): THREE.BufferGeometry[] {
  const rs = h * 0.16;
  const stemH = h * 0.62;
  const stem = xform(cylinder(rs * 0.8, rs, stemH + SINK, 5), { pos: [pos[0], pos[1] - SINK, pos[2]] });
  const rc = h * 0.42;
  const capG = xform(cylinder(rc * 0.42, rc, h * 0.42, 7), {
    pos: [pos[0], pos[1] + stemH * 0.92, pos[2]],
    rot: [rng.range(-0.12, 0.12), rng.range(0, TAU), rng.range(-0.12, 0.12)],
  });
  const capTones = tones(cap, 0.05);
  const gill = hsl(c.stem, 0, 0, 0.05);
  const spot = c.caps[2]!;
  return [
    paint(stem, c.stem),
    paint(capG, (_p, n) => {
      if (n.y < -0.5) return gill;
      if (spotted && n.y > -0.2 && rng.chance(0.3)) return spot;
      const r = rng.next();
      return r < 0.2 ? capTones[0] : r > 0.85 ? capTones[2] : capTones[1];
    }),
  ];
}

/** mushroom: one, two or three toy mushrooms; variant 3 is a big spotted toadstool. */
export function mushroom(rng: Rng, pal: Palette, params: PropParams): PropResult {
  const o = readOpts(rng, params, (v) => (v === 3 ? [0.35, 0.5] : [0.18, 0.32]));
  const c = natureColours(pal);
  const H = o.height;
  const red = c.caps[0]!;
  const capBase = o.colour ?? (o.variant === 3 ? red : rng.pick(c.caps));
  // Cream spots only on red caps (always on the toadstool).
  const spotted = o.variant === 3 || (capBase === red && rng.chance(0.6));
  const cap = jiggle(capBase, rng);
  const count = [1, 2, 3, 1][o.variant]!;
  const parts: THREE.BufferGeometry[] = [];
  const a0 = rng.range(0, TAU);
  for (let i = 0; i < count; i++) {
    const t = a0 + (i * TAU) / Math.max(count, 2);
    const d = i === 0 ? 0 : H * rng.range(0.4, 0.55);
    const h = H * (i === 0 ? 1 : rng.range(0.55, 0.8));
    parts.push(...shroom([Math.cos(t) * d, 0, Math.sin(t) * d], h, cap, spotted, c, rng));
  }
  // Giant toy mushrooms (set via `height`) block the player; little ones do not.
  const colliders = H >= 0.8 ? [cylCollider(H * 0.2, H)] : [];
  return { geometry: merge(parts), colliders };
}

/** log: a fallen log along X (pale end grain), with a branch stub, moss or mushrooms. `height` = thickness. */
export function log(rng: Rng, pal: Palette, params: PropParams): PropResult {
  const o = readOpts(rng, params, [0.38, 0.56]);
  const jr = rng.fork('jitter');
  const pr = rng.fork('paint');
  const c = natureColours(pal);
  const r = o.height / 2;
  const L = Math.max(r * 3, num(params, 'length') ?? r * rng.range(5.5, 7.5));
  const bark = tones(jiggle(o.colour ?? c.bark, rng), 0.06);
  const cut = jiggle(c.woodCut, rng);
  const cy = r * 0.9;

  const body = xform(cylinder(r * 0.92, r, L, 7), { rot: [0, rng.range(0, TAU), 0] });
  xform(body, { rot: [0, 0, Math.PI / 2], pos: [L / 2, cy, 0] });
  jitter(body, r * 0.06, jr);
  const barkPaint = speckle(bark, pr, { top: 0.15 });
  const parts = [paint(body, (p, n) => (Math.abs(n.x) > 0.85 ? cut : barkPaint(p, n)))];

  const x = L * rng.range(-0.25, 0.25);
  const topY = cy + r * 0.85;
  if (o.variant === 0 || o.variant === 3) {
    const g = lean(
      cone(r * 0.35, r * 1.5, 4),
      [x, topY - r * 0.2, 0],
      rng.range(0, TAU),
      rng.range(0.4, 0.8),
    );
    parts.push(paint(g, speckle(bark, pr, { top: 0 })));
  }
  if (o.variant === 1 || o.variant === 3) {
    const mx = x + rng.sign() * L * 0.2;
    const g = xform(lowSphere(r * 0.7, 0), { pos: [mx, topY, 0], scale: [1.4, 0.35, 1] });
    parts.push(paint(g, speckle(tones(jiggle(c.moss, rng), 0.05), pr)));
  }
  if (o.variant === 2) {
    for (let i = 0; i < 2; i++) {
      const sx = x + (i - 0.5) * r * 0.9;
      parts.push(
        ...shroom(
          [sx, topY - r * 0.1, rng.range(-0.3, 0.3) * r],
          r * rng.range(0.6, 0.8),
          c.caps[1]!,
          false,
          c,
          rng,
        ),
      );
    }
  }
  return { geometry: merge(parts), colliders: [boxCollider([0, cy, 0], [L / 2, r, r])] };
}

/** stump: a cut tree stump with roots; variants add growth rings, a snapped top or a mushroom. */
export function stump(rng: Rng, pal: Palette, params: PropParams): PropResult {
  const o = readOpts(rng, params, [0.35, 0.6]);
  const jr = rng.fork('jitter');
  const pr = rng.fork('paint');
  const c = natureColours(pal);
  const H = o.height;
  const r = Math.max(0.2, H * rng.range(0.62, 0.8));
  const bark = tones(jiggle(o.colour ?? c.bark, rng), 0.06);
  const cut = jiggle(c.woodCut, rng);
  const barkPaint = speckle(bark, pr, { top: 0 });

  const body = xform(cylinder(r * 0.86, r, H + SINK, 7), {
    pos: [0, -SINK, 0],
    rot: [0, rng.range(0, TAU), 0],
  });
  jitter(body, r * 0.03, jr);
  const parts = [paint(body, (p, n) => (n.y > 0.8 ? cut : barkPaint(p, n)))];
  if (o.variant === 1 || o.variant === 3) {
    const ring = xform(cylinder(r * 0.48, r * 0.48, 0.015, 7), { pos: [0, H + 0.004, 0] });
    parts.push(paint(ring, hsl(cut, 0, 0, -0.08)));
  }
  if (o.variant === 2) {
    // Snapped top: a few pale splinters (broken wood is light inside) around the rim.
    const splinter = tones(cut, 0.07);
    const a0 = rng.range(0, TAU);
    for (let i = 0; i < 3; i++) {
      const t = a0 + (i * TAU) / 3 + rng.range(-0.4, 0.4);
      const base: Vec3 = [Math.cos(t) * r * 0.55, H - 0.04, Math.sin(t) * r * 0.55];
      const g = lean(cone(r * 0.3, r * rng.range(0.45, 0.8), 3), base, t + Math.PI, rng.range(0.05, 0.3));
      parts.push(paint(g, (_p, n) => (n.y > 0.3 ? splinter[2] : n.y > -0.3 ? splinter[1] : splinter[0])));
    }
  }
  const roots = o.variant === 2 ? 4 : 3;
  const a1 = rng.range(0, TAU);
  for (let i = 0; i < roots; i++) {
    const t = a1 + (i * TAU) / roots + rng.range(-0.3, 0.3);
    // Tilted just past horizontal: thick end against the trunk, tip diving into the ground.
    const base: Vec3 = [Math.cos(t) * r * 0.62, H * 0.22, Math.sin(t) * r * 0.62];
    parts.push(paint(lean(cone(r * 0.28, r * 0.95, 3), base, t, rng.range(1.75, 1.9)), bark[0]));
  }
  if (o.variant === 3) {
    const t = rng.range(0, TAU);
    parts.push(
      ...shroom(
        [Math.cos(t) * r * 1.15, 0, Math.sin(t) * r * 1.15],
        H * 0.45,
        rng.pick(c.caps),
        false,
        c,
        rng,
      ),
    );
  }
  return { geometry: merge(parts), colliders: [cylCollider(r, H)] };
}

/** vine_row: one vineyard row along X (posts, two wires, leafy vines, hanging grapes). Param `length` (m). */
export function vineRow(rng: Rng, pal: Palette, params: PropParams): PropResult {
  const o = readOpts(rng, params, [1.4, 1.7]);
  const jr = rng.fork('jitter');
  const pr = rng.fork('paint');
  const c = natureColours(pal);
  const H = o.height;
  const L = Math.min(16, Math.max(2, num(params, 'length') ?? 6));
  const wood = tones(jiggle(hsl(c.bark, 0, -0.04, 0.08), rng), 0.05);
  const leaf = tones(jiggle(o.colour ?? hsl(c.leafLight, 0.02, 0.04, -0.04), rng), 0.06);
  const grape = rng.chance(0.75) ? c.grape : hsl(c.leafLight, 0.04, 0.1, 0.06);
  const grapeTones = tones(jiggle(grape, rng), 0.06);
  const parts: THREE.BufferGeometry[] = [];

  const posts = Math.max(2, Math.round(L / 2.5) + 1);
  const postH = H + 0.1 + SINK;
  for (let i = 0; i < posts; i++) {
    const x = -L / 2 + (L * i) / (posts - 1);
    const g = xform(bevelBox(0.1, postH, 0.1, 0), {
      pos: [x, postH / 2 - SINK, 0],
      rot: [0, 0, rng.range(-0.025, 0.025)],
    });
    parts.push(paint(g, speckle(wood, pr, { top: 0 })));
  }
  for (const k of [0.5, 0.82]) {
    parts.push(paint(xform(bevelBox(L, 0.02, 0.02, 0), { pos: [0, H * k, 0] }), c.wire));
  }
  // Each bay between posts has one gnarled vine trunk.
  for (let i = 0; i < posts - 1; i++) {
    const x = -L / 2 + (L * (i + 0.5)) / (posts - 1) + rng.range(-0.3, 0.3);
    const g = lean(
      cylinder(0.03, 0.05, H * 0.8 + SINK, 3),
      [x, -SINK, 0],
      rng.range(0, TAU),
      rng.range(0.03, 0.1),
    );
    parts.push(paint(g, wood[0]));
  }
  const blobs = Math.max(2, Math.round(L * 1.3));
  for (let i = 0; i < blobs; i++) {
    const x = -L / 2 + (L * (i + 0.5)) / blobs + rng.range(-0.15, 0.15);
    const g = xform(lowSphere(0.42, 0), {
      pos: [x, H * 0.8 + rng.range(-0.06, 0.06), rng.range(-0.05, 0.05)],
      rot: [0, rng.range(0, TAU), 0],
      scale: [1.35, 0.85, 0.75],
    });
    jitter(g, 0.05, jr);
    parts.push(paint(g, speckle(leaf, pr, { top: 0.25 })));
  }
  const bunches = Math.max(1, Math.round(L));
  for (let i = 0; i < bunches; i++) {
    const x = -L / 2 + (L * (i + 0.5)) / bunches + rng.range(-0.2, 0.2);
    const z = (i % 2 === 0 ? 1 : -1) * rng.range(0.26, 0.32); // both sides of the row, peeking out
    const g = xform(cone(0.12, 0.28, 4), {
      pos: [x, H * 0.5 + 0.28, z],
      rot: [Math.PI, rng.range(0, TAU), 0],
    });
    parts.push(paint(g, speckle(grapeTones, pr, { top: 0.2 })));
  }
  return {
    geometry: merge(parts),
    colliders: [boxCollider([0, H / 2, 0], [L / 2 + 0.1, H / 2 + 0.05, 0.4])],
  };
}
