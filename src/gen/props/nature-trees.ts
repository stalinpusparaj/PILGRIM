/**
 * Tree builders: cone (fir), round (leafy), dead and fruit (plus the tidy orchard form). Chunky toy trees:
 * stacked faceted cones or jittered blobs on a stubby trunk, one merged geometry, under 300 triangles each.
 */
import type * as THREE from 'three';
import { cone, cylinder, jitter, lowSphere, merge, paint, xform, type Vec3 } from '../geom';
import type { Palette } from '../palette';
import type { Rng } from '../rng';
import type { Collider, PropParams, PropResult } from '../types';
import {
  SINK,
  TAU,
  cylCollider,
  hsl,
  jiggle,
  lean,
  leanTip,
  natureColours,
  readOpts,
  scaleProp,
  speckle,
  tones,
} from './nature-kit';

const TREE_TRIS = 300;
/** A fruit is a detail-0 icosphere. */
const FRUIT_TRIS = 20;

/** A stubby tapered trunk from below ground up to `top`. */
function trunk(
  r: number,
  top: number,
  radial: number,
  bark: string,
  rotY: number,
  pr: Rng,
): THREE.BufferGeometry {
  const g = xform(cylinder(r * 0.68, r, top + SINK, radial), { pos: [0, -SINK, 0], rot: [0, rotY, 0] });
  return paint(g, speckle(tones(bark, 0.05), pr, { top: 0 }));
}

/** tree_cone: a fir of 2-4 stacked faceted cones. Variant 3 has a jaunty, slightly leaning top. */
export function treeCone(rng: Rng, pal: Palette, params: PropParams): PropResult {
  const o = readOpts(rng, params, [4.2, 6.4]);
  const jr = rng.fork('jitter');
  const pr = rng.fork('paint');
  const c = natureColours(pal);
  const H = o.height;
  const tiers = [3, 4, 2, 3][o.variant]!;
  const R = H * [0.27, 0.21, 0.33, 0.26][o.variant]!;
  const trunkR = Math.max(0.12, H * 0.045);
  const trunkH = H * 0.17;
  const radial = o.lod ? 5 : 7;
  const needles = tones(jiggle(o.colour ?? c.pine, rng), 0.06);
  const under = hsl(needles[0], 0, 0, -0.06);

  const parts = [trunk(trunkR, trunkH, o.lod ? 4 : 5, jiggle(c.bark, rng), rng.range(0, TAU), pr)];
  const y0 = trunkH * 0.75;
  const F = H - y0;
  const tierH = F * (tiers === 2 ? 0.64 : tiers === 3 ? 0.5 : 0.4);
  const step = (F - tierH) / (tiers - 1);
  const leanAz = rng.range(0, TAU);
  const leanAmt = o.variant === 3 ? R * rng.range(0.1, 0.18) : 0;
  for (let i = 0; i < tiers; i++) {
    const k = i / (tiers - 1);
    const r = R * (1 - 0.55 * k) * rng.range(0.94, 1.06);
    const off = leanAmt * k * k;
    const g = xform(cone(r, tierH * rng.range(0.95, 1.04), radial), {
      pos: [Math.cos(leanAz) * off, y0 + i * step, Math.sin(leanAz) * off],
      rot: [0, rng.range(0, TAU), 0],
    });
    jitter(g, r * 0.06, jr);
    parts.push(paint(g, speckle(needles, pr, { under })));
  }
  const geometry = merge(parts);
  // Low skirts: the collider is wider than the trunk so the player never walks into the bottom tier.
  const colliders: Collider[] = [cylCollider(Math.max(trunkR * 1.5, R * 0.42), H)];
  return { geometry, colliders };
}

interface Blob {
  r: number;
  x: number;
  y: number;
  z: number;
  sy: number;
  detail: 0 | 1;
  /** Yaw, so neighbouring blobs show different facets. */
  rot: number;
}

/** Canopy blob layouts in units of the main radius, y relative to the main blob's centre. */
function roundLayout(variant: number, rng: Rng): Blob[] {
  const a = rng.range(0, TAU);
  const ring = (n: number, dist: number, y: number, r: number): Blob[] =>
    Array.from({ length: n }, (_, i) => {
      const t = a + (i * TAU) / n + rng.range(-0.3, 0.3);
      const s = r * rng.range(0.9, 1.1);
      return {
        r: s,
        x: Math.cos(t) * dist,
        y,
        z: Math.sin(t) * dist,
        sy: 0.85,
        detail: 0,
        rot: rng.range(0, TAU),
      };
    });
  const main = (r: number, y: number, sy: number): Blob => ({
    r,
    x: 0,
    y,
    z: 0,
    sy,
    detail: 1,
    rot: rng.range(0, TAU),
  });
  switch (variant) {
    case 0: // big crown with two side puffs
      return [main(1, 0, 0.9), ...ring(2, 0.78, -0.28, 0.6)];
    case 1: // crown ringed by three puffs
      return [main(0.92, 0.08, 0.9), ...ring(3, 0.72, -0.22, 0.56)];
    case 2: // tall lollipop with one low puff
      return [main(0.88, 0.1, 1.28), ...ring(1, 0.62, -0.62, 0.48)];
    default: // two-tier stack
      return [
        main(1, 0, 0.82),
        { ...main(0.7, 0.95, 0.88), x: rng.range(-0.12, 0.12), z: rng.range(-0.12, 0.12) },
      ];
  }
}

/** Build canopy blobs so the highest point lands at `top`. Returns the parts and the main blob centre y. */
function canopy(
  blobs: Blob[],
  Rc: number,
  top: number,
  lod: 0 | 1,
  leaf: readonly [string, string, string],
  jr: Rng,
  pr: Rng,
): { parts: THREE.BufferGeometry[]; cy: number } {
  const peak = Math.max(...blobs.map((b) => b.y + b.r * b.sy));
  const cy = top - peak * Rc;
  const under = hsl(leaf[0], 0, 0, -0.07);
  const parts = blobs.map((b) => {
    const g = xform(lowSphere(b.r * Rc, lod ? 0 : b.detail), {
      pos: [b.x * Rc, cy + b.y * Rc, b.z * Rc],
      rot: [0, b.rot, 0],
      scale: [1, b.sy, 1],
    });
    jitter(g, b.r * Rc * 0.07, jr);
    return paint(g, speckle(leaf, pr, { top: 0.25, under }));
  });
  return { parts, cy };
}

/** tree_round: a leafy tree, a faceted crown of blobs on a stubby trunk. */
export function treeRound(rng: Rng, pal: Palette, params: PropParams): PropResult {
  const o = readOpts(rng, params, [4, 6]);
  const jr = rng.fork('jitter');
  const pr = rng.fork('paint');
  const c = natureColours(pal);
  const H = o.height;
  const Rc = H * 0.3;
  const trunkR = Math.max(0.12, H * 0.056);
  const bark = jiggle(c.bark, rng);
  const leaf = tones(jiggle(o.colour ?? c.leaf, rng), 0.06);
  const trunkRot = rng.range(0, TAU);
  const crown = canopy(roundLayout(o.variant, rng), Rc, H, o.lod, leaf, jr, pr);
  const parts = [trunk(trunkR, crown.cy, o.lod ? 4 : 6, bark, trunkRot, pr), ...crown.parts];
  if (o.variant === 0) {
    // A little side branch stub for character.
    const base: Vec3 = [0, crown.cy * 0.55, 0];
    const g = lean(cone(trunkR * 0.45, Rc * 0.7, 4), base, rng.range(0, TAU), 0.95);
    parts.push(paint(g, speckle(tones(bark, 0.05), pr, { top: 0 })));
  }
  const geometry = merge(parts);
  return { geometry, colliders: [cylCollider(Math.max(0.25, trunkR * 1.5), crown.cy + Rc * 0.5)] };
}

/** tree_dead: a bare grey-brown snag with crooked branches and twigs. */
export function treeDead(rng: Rng, pal: Palette, params: PropParams): PropResult {
  const o = readOpts(rng, params, [3.5, 5.5]);
  const pr = rng.fork('paint');
  const c = natureColours(pal);
  const H = o.height;
  const r0 = Math.max(0.1, H * 0.055);
  const wood = tones(jiggle(o.colour ?? c.barkDead, rng), 0.06);
  const paintWood = (g: THREE.BufferGeometry): THREE.BufferGeometry =>
    paint(g, speckle(wood, pr, { top: 0.1 }));
  const radial = o.lod ? 4 : 5;

  // Trunk leans a touch; branches hang off it.
  const trunkAz = rng.range(0, TAU);
  const trunkTilt = rng.range(0.03, 0.09);
  const trunkLen = H * 0.66 + SINK;
  const tBase: Vec3 = [0, -SINK, 0];
  const parts = [paintWood(lean(cylinder(r0 * 0.42, r0, trunkLen, radial), tBase, trunkAz, trunkTilt))];
  const along = (k: number): Vec3 => leanTip(tBase, trunkAz, trunkTilt, trunkLen * k);

  const count = [3, 4, 2, 5][o.variant]!;
  const lenK = [0.36, 0.3, 0.42, 0.26][o.variant]!;
  const a0 = rng.range(0, TAU);
  const branch = (base: Vec3, az: number, tilt: number, len: number, r: number, twig: boolean): void => {
    parts.push(paintWood(lean(cylinder(r * 0.35, r, len, o.lod ? 3 : 4), base, az, tilt)));
    if (!twig) return;
    const tip = leanTip(base, az, tilt, len * 0.92);
    const tAz = az + rng.sign() * rng.range(0.5, 1.1);
    parts.push(paintWood(lean(cone(r * 0.3, len * 0.45, 3), tip, tAz, tilt * rng.range(0.4, 0.8))));
  };
  for (let i = 0; i < count; i++) {
    const az = a0 + (i * TAU) / count + rng.range(-0.4, 0.4);
    const base = along(rng.range(0.45, 0.95));
    branch(base, az, rng.range(0.55, 1.05), H * lenK * rng.range(0.8, 1.15), r0 * 0.55, rng.chance(0.75));
  }
  // Forked top: two short limbs from the trunk tip.
  const top = along(0.97);
  branch(top, a0 + 0.5, rng.range(0.25, 0.5), H * 0.26, r0 * 0.4, false);
  branch(top, a0 + 0.5 + Math.PI, rng.range(0.3, 0.55), H * 0.22, r0 * 0.36, o.variant === 2);

  const geometry = merge(parts);
  const colliders = [cylCollider(Math.max(0.2, r0 * 1.4), H * 0.7)];
  // Crooked branches overshoot the trunk; fit the whole snag to the requested height.
  geometry.computeBoundingBox();
  scaleProp(geometry, colliders, H / Math.max(0.01, geometry.boundingBox!.max.y));
  return { geometry, colliders };
}

/** tree_fruit: a small round fruit tree dotted with red/orange fruit. `orchard: true` gives the tidy pruned form. */
export function treeFruit(rng: Rng, pal: Palette, params: PropParams): PropResult {
  const orchard = params.orchard === true || params.orchard === 1;
  const o = readOpts(rng, params, orchard ? [2.8, 3.3] : [2.8, 3.9]);
  const jr = rng.fork('jitter');
  const pr = rng.fork('paint');
  const c = natureColours(pal);
  const H = o.height;
  const Rc = H * (orchard ? 0.34 : 0.32);
  const trunkR = Math.max(0.1, H * 0.068);
  const leaf = tones(jiggle(o.colour ?? c.fruitLeaf, rng), 0.06);
  const blobs: Blob[] = [
    { r: 1, x: 0, y: 0, z: 0, sy: orchard ? 0.84 : 0.92, detail: 1, rot: rng.range(0, TAU) },
  ];
  if (!orchard && o.variant !== 0) {
    const n = o.variant === 3 ? 2 : 1;
    const a = rng.range(0, TAU);
    for (let i = 0; i < n; i++) {
      const t = a + i * Math.PI + rng.range(-0.4, 0.4);
      blobs.push({
        r: 0.55,
        x: Math.cos(t) * 0.75,
        y: -0.3,
        z: Math.sin(t) * 0.75,
        sy: 0.85,
        detail: 0,
        rot: t,
      });
    }
  }
  const bark = jiggle(c.bark, rng);
  const trunkRot = rng.range(0, TAU);
  const crown = canopy(blobs, Rc, H, o.lod, leaf, jr, pr);
  const parts = [trunk(trunkR, crown.cy, o.lod ? 4 : 6, bark, trunkRot, pr), ...crown.parts];

  // Fruit sits half out of the main crown, mostly around the sides and lower half where the camera sees it.
  const hue = rng.pick(c.fruit);
  const fruitTones = tones(hue, 0.07);
  const rf = 0.14 * (H / 3.2);
  // Budget from the full-detail layout (trunk 24 + crown 80 + 20 per side puff), so both LODs match.
  const used = 24 + 80 + 20 * (blobs.length - 1);
  const want = orchard ? 7 : 5 + rng.int(0, 3);
  const fruitCount = Math.min(want, Math.floor((TREE_TRIS - 4 - used) / FRUIT_TRIS));
  const main = blobs[0]!;
  const a0 = rng.range(0, TAU);
  for (let i = 0; i < fruitCount; i++) {
    const phi = a0 + (i * TAU) / fruitCount + rng.range(-0.25, 0.25);
    const theta = Math.PI * rng.range(0.32, 0.7); // 0 = straight up
    const d = Rc;
    const g = xform(lowSphere(rf * rng.range(0.85, 1.1), 0), {
      pos: [
        Math.sin(theta) * Math.cos(phi) * d,
        crown.cy + Math.cos(theta) * d * main.sy,
        Math.sin(theta) * Math.sin(phi) * d,
      ],
      scale: [1, 0.9, 1],
    });
    parts.push(paint(g, speckle(fruitTones, pr, { top: 0.3 })));
  }
  const geometry = merge(parts);
  return { geometry, colliders: [cylCollider(Math.max(0.22, trunkR * 1.6), crown.cy + Rc * 0.5)] };
}

/** fruit_tree_orchard: the tidy, evenly fruited orchard form of tree_fruit (rows in Chapter XII). */
export function treeOrchard(rng: Rng, pal: Palette, params: PropParams): PropResult {
  return treeFruit(rng, pal, { ...params, orchard: true });
}
