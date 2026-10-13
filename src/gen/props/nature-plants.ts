/**
 * Small plant builders: bush, reeds, grass tuft, flower cluster and water lily. These are instanced by the
 * hundred, so they stay tiny: grass < 40 triangles, flowers < 60, bushes < 150, reeds and lilies <= 80.
 */
import type * as THREE from 'three';
import { cone, cylinder, extrude, jitter, lowSphere, merge, paint, xform, type Vec3 } from '../geom';
import type { Palette } from '../palette';
import type { Rng } from '../rng';
import type { PropParams, PropResult } from '../types';
import {
  SINK,
  TAU,
  cylCollider,
  flattenBase,
  hsl,
  jiggle,
  lean,
  leanTip,
  natureColours,
  readOpts,
  speckle,
  tones,
} from './nature-kit';

/** bush: a squashed faceted blob with side puffs (variant 3: a berry bush). */
export function bush(rng: Rng, pal: Palette, params: PropParams): PropResult {
  const o = readOpts(rng, params, [0.7, 1.1]);
  const jr = rng.fork('jitter');
  const pr = rng.fork('paint');
  const c = natureColours(pal);
  const H = o.height;
  const R = H * 0.62;
  const sy = 0.8;
  const cy = H - R * sy;
  const leaf = tones(jiggle(o.colour ?? hsl(c.leaf, 0, 0, 0.03), rng), 0.06);
  const under = hsl(leaf[0], 0, 0, -0.06);
  const blob = (r: number, pos: Vec3, s: number, detail: 0 | 1, rot: number): THREE.BufferGeometry => {
    const g = xform(lowSphere(r, o.lod ? 0 : detail), { pos, rot: [0, rot, 0], scale: [1, s, 1] });
    jitter(g, r * 0.08, jr);
    flattenBase(g, -0.04);
    return paint(g, speckle(leaf, pr, { top: 0.25, under }));
  };
  const wide = o.variant === 2 ? 1.35 : 1;
  const main = xform(blob(R, [0, cy, 0], sy, 1, rng.range(0, TAU)), { scale: [wide, 1, 1] });
  const parts = [main];
  const puffs = [2, 3, 1, 0][o.variant]!;
  const a0 = rng.range(0, TAU);
  for (let i = 0; i < puffs; i++) {
    const t = a0 + (i * TAU) / Math.max(puffs, 2) + rng.range(-0.35, 0.35);
    const r = R * rng.range(0.5, 0.62);
    const d = R * 0.78 * (o.variant === 2 ? 1.25 : 1);
    parts.push(blob(r, [Math.cos(t) * d, r * 0.62, Math.sin(t) * d], 0.85, 0, rng.range(0, TAU)));
  }
  if (o.variant === 3) {
    // Three little berries on the camera-facing side.
    const berry = tones(rng.pick(c.fruit), 0.06);
    for (let i = 0; i < 3; i++) {
      const t = Math.PI * 0.5 + rng.range(-1.1, 1.1);
      const th = rng.range(0.35, 0.65) * Math.PI;
      const pos: Vec3 = [
        Math.sin(th) * Math.cos(t) * R * 0.98,
        cy + Math.cos(th) * R * sy,
        Math.sin(th) * Math.sin(t) * R * 0.98,
      ];
      parts.push(paint(xform(lowSphere(R * 0.14, 0), { pos }), speckle(berry, pr, { top: 0.3 })));
    }
  }
  const geometry = merge(parts);
  return { geometry, colliders: [cylCollider(R * 0.75 * wide, H)] };
}

/** reeds: thin tapered blades fanning out of the water, most with a cattail on a stalk. */
export function reeds(rng: Rng, pal: Palette, params: PropParams): PropResult {
  const o = readOpts(rng, params, [1.1, 1.6]);
  const pr = rng.fork('paint');
  const c = natureColours(pal);
  const H = o.height;
  const blade = tones(jiggle(o.colour ?? c.reed, rng), 0.07);
  const tip = hsl(blade[2], 0, 0, 0.04);
  const head = tones(jiggle(c.cattail, rng), 0.05);
  const [blades, tails] = (
    [
      [6, 1],
      [5, 2],
      [7, 0],
      [4, 2],
    ] as const
  )[o.variant]!;
  const parts: THREE.BufferGeometry[] = [];
  const a0 = rng.range(0, TAU);
  for (let i = 0; i < blades; i++) {
    const az = a0 + (i * TAU) / blades + rng.range(-0.4, 0.4);
    const d = rng.range(0.03, 0.2);
    const len = H * rng.range(0.55, 1) + SINK;
    const base: Vec3 = [Math.cos(az) * d, -SINK, Math.sin(az) * d];
    const g = lean(
      cone(H * 0.04 * rng.range(0.8, 1.2), len, 3),
      base,
      az,
      rng.range(0.06, 0.3 + d),
      [1, 1, 0.55],
    );
    // Taller blades get the sun-bleached tip colour.
    parts.push(paint(g, len > H * 0.85 ? tip : rng.pick(blade)));
  }
  for (let i = 0; i < tails; i++) {
    const az = a0 + Math.PI / blades + i * Math.PI + rng.range(-0.3, 0.3);
    const d = rng.range(0.02, 0.1);
    const base: Vec3 = [Math.cos(az) * d, -SINK, Math.sin(az) * d];
    const tilt = rng.range(0.02, 0.12);
    const len = H * rng.range(0.85, 0.98); // head top lands at about H
    parts.push(paint(lean(cone(H * 0.013, len, 3), base, az, tilt), blade[0]));
    const top = leanTip(base, az, tilt, len * 0.86);
    const hl = H * 0.16;
    const g = lean(cylinder(H * 0.026, H * 0.034, hl, 4), top, az, tilt);
    parts.push(paint(g, speckle(head, pr, { top: 0.1 })));
  }
  return { geometry: merge(parts), colliders: [] };
}

/** grass: a tuft of 4-6 three-sided blades (variant 3 is windswept, leaning one way). */
export function grass(rng: Rng, pal: Palette, params: PropParams): PropResult {
  const o = readOpts(rng, params, (v) => (v === 2 ? [0.5, 0.7] : v === 1 ? [0.28, 0.4] : [0.35, 0.55]));
  const c = natureColours(pal);
  const H = o.height;
  const base = tones(jiggle(o.colour ?? c.grass, rng), 0.05);
  const tip = jiggle(c.grassTip, rng);
  const count = [5, 6, 4, 6][o.variant]!;
  const width = [0.06, 0.072, 0.055, 0.06][o.variant]!;
  const wind = rng.range(0, TAU);
  const parts: THREE.BufferGeometry[] = [];
  const a0 = rng.range(0, TAU);
  for (let i = 0; i < count; i++) {
    const az = a0 + (i * TAU) / count + rng.range(-0.3, 0.3);
    const d = rng.range(0.02, 0.09);
    const len = H * rng.range(0.6, 1) + SINK * 0.5;
    const pos: Vec3 = [Math.cos(az) * d, -SINK * 0.5, Math.sin(az) * d];
    const windy = o.variant === 3;
    const g = lean(
      cone(width * rng.range(0.85, 1.15), len, 3),
      pos,
      windy ? wind + rng.range(-0.35, 0.35) : az,
      windy ? rng.range(0.35, 0.6) : rng.range(0.12, 0.5),
      [1, 1, 0.6],
    );
    parts.push(paint(g, len > H * 0.85 ? tip : rng.pick(base)));
  }
  return { geometry: merge(parts), colliders: [] };
}

/** One flower on a stem: inverted-cone head (pentagon face up), optional centre dot. */
function bloom(
  pos: Vec3,
  stemH: number,
  rHead: number,
  depth: number,
  radial: number,
  petal: string,
  stem: string,
  centre: string | null,
  rng: Rng,
): THREE.BufferGeometry[] {
  const az = rng.range(0, TAU);
  const tilt = rng.range(0, 0.18);
  const out = [paint(lean(cone(0.016, stemH + SINK, 3), [pos[0], -SINK, pos[2]], az, tilt), stem)];
  const top = leanTip([pos[0], -SINK, pos[2]], az, tilt, stemH + SINK);
  const head = xform(cone(rHead, depth, radial), {
    pos: [top[0], top[1] + depth * 0.65, top[2]],
    rot: [Math.PI + rng.range(-0.15, 0.15), rng.range(0, TAU), rng.range(-0.15, 0.15)],
  });
  const face = hsl(petal, 0, 0, 0.05);
  out.push(paint(head, (_p, n) => (n.y > 0.5 ? face : petal)));
  if (centre) {
    const dot = cone(rHead * 0.32, rHead * 0.42, 3);
    out.push(paint(xform(dot, { pos: [top[0], top[1] + depth * 0.62, top[2]] }), centre));
  }
  return out;
}

/** flower: a little cluster (daisies, tulips, one big bloom, or mixed wildflowers). */
export function flower(rng: Rng, pal: Palette, params: PropParams): PropResult {
  const o = readOpts(rng, params, [0.28, 0.45]);
  const c = natureColours(pal);
  const H = o.height;
  const stem = jiggle(hsl(c.grass, 0, 0, -0.1), rng);
  const petal = jiggle(o.colour ?? rng.pick(c.petals), rng);
  const centre = jiggle(c.centre, rng);
  const parts: THREE.BufferGeometry[] = [];
  // [count, head radius, head depth, radial, centre dot, leaves]
  const spec = (
    [
      [2, 0.07, 0.035, 5, true, 1],
      [3, 0.05, 0.075, 5, false, 1],
      [1, 0.1, 0.045, 6, true, 2],
      [3, 0.05, 0.03, 5, false, 0],
    ] as const
  )[o.variant]!;
  const [count, rHead, depth, radial, dot, leaves] = spec;
  const a0 = rng.range(0, TAU);
  for (let i = 0; i < count; i++) {
    const az = a0 + (i * TAU) / count;
    const d = count === 1 ? 0 : rng.range(0.05, 0.1);
    const h = H * (i === 0 ? 1 : rng.range(0.7, 0.92));
    // Wildflowers mix colours; the other clusters share one.
    const p = o.variant === 3 && o.colour === null ? jiggle(rng.pick(c.petals), rng) : petal;
    const s = (H / 0.36) * 1.35; // chunky heads so they read at gameplay distance
    parts.push(
      ...bloom(
        [Math.cos(az) * d, 0, Math.sin(az) * d],
        h,
        rHead * s,
        depth * s,
        radial,
        p,
        stem,
        dot ? centre : null,
        rng,
      ),
    );
  }
  for (let i = 0; i < leaves; i++) {
    const az = a0 + Math.PI * (0.5 + i);
    const g = lean(cone(0.035, H * 0.42, 3), [0, -0.02, 0], az, rng.range(0.9, 1.15), [1, 1, 0.3]);
    parts.push(paint(g, hsl(stem, 0, 0, 0.04)));
  }
  return { geometry: merge(parts), colliders: [] };
}

/** A lily pad: a flat disc with the classic notch, floating on y = 0 (the water surface). */
function pad(
  r: number,
  rim: number,
  colour: readonly [string, string, string],
  rng: Rng,
): THREE.BufferGeometry {
  const notch = rng.range(0.28, 0.4);
  const start = -Math.PI / 2 + notch; // the notch points along -Y in the shape, i.e. +Z once laid flat
  const shape: Array<[number, number]> = [[0, 0]];
  for (let i = 0; i < rim; i++) {
    const t = start + ((TAU - 2 * notch) * i) / (rim - 1);
    const k = r * rng.range(0.94, 1.04);
    shape.push([Math.cos(t) * k, Math.sin(t) * k]);
  }
  const g = xform(extrude(shape, 0.03), { rot: [-Math.PI / 2, 0, 0], pos: [0, 0.005, 0] });
  return paint(g, (_p, n) => (n.y > 0.5 ? (rng.chance(0.3) ? colour[2] : colour[1]) : colour[0]));
}

/** lily: water-lily pads (y = 0 is the water surface); variants add a flower or a second pad. */
export function lily(rng: Rng, pal: Palette, params: PropParams): PropResult {
  const o = readOpts(rng, params, [0.36, 0.5]);
  const c = natureColours(pal);
  const R = o.height; // flat prop: `height` is the pad radius
  const green = tones(jiggle(c.lilyPad, rng), 0.05);
  const bloomCol = jiggle(o.colour ?? c.lilyFlower, rng);
  const parts = [xform(pad(R, 8, green, rng), { rot: [0, rng.range(-0.6, 0.6), 0] })];
  if (o.variant >= 2) {
    const t = rng.range(0, TAU);
    const r2 = R * rng.range(0.5, 0.62);
    const d = R + r2 * 0.9;
    parts.push(
      xform(pad(r2, 6, green, rng), {
        pos: [Math.cos(t) * d, 0, Math.sin(t) * d],
        rot: [0, rng.range(0, TAU), 0],
      }),
    );
  }
  if (o.variant === 1 || o.variant === 3) {
    const x = R * rng.range(-0.25, 0.25);
    const z = R * rng.range(-0.3, 0.1);
    const h = R * 0.32;
    const cup = xform(cone(R * 0.32, h, 6), { pos: [x, 0.03 + h, z], rot: [Math.PI, rng.range(0, TAU), 0] });
    jitter(cup, R * 0.03, rng);
    const inner = hsl(bloomCol, 0, 0, 0.06);
    parts.push(paint(cup, (_p, n) => (n.y > 0.5 ? inner : bloomCol)));
    parts.push(paint(xform(cone(R * 0.1, R * 0.1, 3), { pos: [x, 0.03 + h, z] }), c.centre));
  }
  return { geometry: merge(parts), colliders: [] };
}
