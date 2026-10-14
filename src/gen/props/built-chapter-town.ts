/**
 * Town-scale chapter props for Chapters I-IV (GDD 2.10): the crooked crenellated town wall and the big town gate
 * (Ch I), the unreachable village facade of Morality under the leaning mountain (Ch III) and the gloomy castle
 * ridge that fires the arrows (Ch IV). Everything runs along X, faces +Z and stands on y = 0.
 */
import { jitter, type Vec3 } from '../geom';
import { mix, shade, type Palette } from '../palette';
import type { Rng } from '../rng';
import type { PropParams, PropResult } from '../types';
import { arc, bool, box, gem, hexParam, kit, num, Parts, slab, tone, type Kit, type Pt } from './built-kit';
import { buildGate } from './built-gates';
import { buildCastleTower, buildMountainPeak } from './built-towers';
import { wallRun } from './built-walls';

/** Merlons along the top of a wall between x0 and x1 at height y, every `step` metres, a few missing. */
function crenels(
  P: Parts,
  rng: Rng,
  hex: string,
  x0: number,
  x1: number,
  y: number,
  z: number,
  t: number,
  step = 1.0,
) {
  const n = Math.max(1, Math.floor((x1 - x0) / step));
  const u = (x1 - x0) / n;
  for (let i = 0; i < n; i++) {
    if (rng.chance(0.12)) continue; // a tooth knocked out
    const x = x0 + u * (i + 0.5);
    P.add(
      jitter(
        box(u * 0.52, 0.42 + rng.range(-0.05, 0.08), t * 0.9, tone(hex, 0.06, rng), {
          pos: [x, y + 0.2, z + rng.range(-0.02, 0.02)],
          rot: [0, rng.range(-0.03, 0.03), rng.range(-0.03, 0.03)],
        }),
        0.02,
        rng,
      ),
    );
  }
}

/**
 * params: length (8), height (3.2), thick (0.8), crenels (true), color (#hex). A long crooked stone wall segment
 * for the town of Ch I: two or three runs that step up and down and wobble in z, crenellations on top and a
 * buttress at each joint. ~220 lit triangles per 2.6 m. Colliders per run segment.
 */
export function buildTownWall(rng: Rng, pal: Palette, p: PropParams): PropResult {
  const k = kit(pal);
  const P = new Parts();
  const L = num(p, 'length', 8, 2, 80);
  const H = num(p, 'height', 3.2, 1.2, 8);
  const t = num(p, 'thick', 0.8, 0.4, 2);
  const teeth = bool(p, 'crenels', true);
  const wall = hexParam(p, 'color') ?? k.wall;
  const runs = L < 5 ? 1 : L < 11 ? 2 : 3;
  const u = L / runs;
  for (let i = 0; i < runs; i++) {
    const x0 = -L / 2 + u * i;
    const x1 = x0 + u;
    const h = H + (runs > 1 ? rng.range(-0.2, 0.22) : 0);
    const z = runs > 1 ? rng.range(-0.08, 0.08) : 0;
    wallRun(P, rng, { x0, x1, z, height: h, thick: t, color: wall, cap: k.stoneLight });
    if (teeth) crenels(P, rng, wall, x0 + 0.1, x1 - 0.1, h, z, t);
    if (i > 0) {
      // Buttress at the joint, leaning into the wall, hiding the step between runs.
      const bw = t * 0.7;
      P.add(
        jitter(
          box(bw, h * 0.72, t * 0.55, tone(k.stoneDark, 0.04, rng), {
            pos: [x0, h * 0.36, t / 2 + t * 0.22],
            rot: [-0.14, 0, 0],
          }),
          0.025,
          rng,
        ),
      );
      P.add(box(bw + 0.1, 0.12, t * 0.6, k.stoneLight, { pos: [x0, h * 0.7, t / 2 + t * 0.14] }, 0.03));
    }
  }
  return P.done();
}

/** params: as `gate` (width 4, height 4, length 14, open true). The bigger arched town gate of Ch I. */
export function buildTownGate(rng: Rng, pal: Palette, p: PropParams): PropResult {
  return buildGate(rng, pal, { width: 4, height: 4, length: 14, open: true, ...p });
}

/** params: as `mountain_peak` (height 110, radius 50, lean 0.55): the gigantic leaning mountain of Ch III. */
export function buildMountainOverhang(rng: Rng, pal: Palette, p: PropParams): PropResult {
  return buildMountainPeak(rng, pal, { height: 110, radius: 50, lean: 0.55, ...p });
}

/** One toy house front (plaster, timber, two windows, gable and roof), base centred, facing +Z. ~190 tris. */
function facade(
  rng: Rng,
  k: Kit,
  w: number,
  h: number,
  d: number,
  plaster: string,
  roof: string,
  lit: boolean,
): Parts {
  const F = new Parts();
  const timber = tone(k.wood, 0.04, rng);
  F.add(jitter(box(w, h, d, plaster, { pos: [0, h / 2, 0] }, 0.05), 0.02, rng));
  for (const sx of [-1, 1]) F.add(box(0.16, h, 0.16, timber, { pos: [sx * (w / 2), h / 2, d / 2 - 0.08] }));
  F.add(box(w + 0.1, 0.14, 0.14, timber, { pos: [0, h - 0.07, d / 2] }));
  F.add(box(w + 0.1, 0.14, 0.14, timber, { pos: [0, h * 0.5, d / 2] }));
  for (const sx of [-1, 1]) {
    const W = new Parts();
    W.add(box(0.62, 0.72, 0.06, k.woodDark, {}));
    const pane = box(0.48, 0.58, 0.05, lit ? k.windowGlow : k.glass, { pos: [0, 0, 0.02] });
    if (lit) W.glow(pane);
    else W.add(pane);
    W.add(box(0.05, 0.58, 0.03, k.woodDark, { pos: [0, 0, 0.05] }));
    W.add(box(0.72, 0.08, 0.14, k.woodLight, { pos: [0, -0.4, 0.04] }));
    F.absorb(W, { pos: [sx * w * 0.26, h * 0.74, d / 2 + 0.03] });
  }
  // Gable and a two-slab roof, ridge along Z so the little houses read as a row of pointed fronts.
  const pitch = 0.95;
  const ridge = (w / 2) * Math.tan(pitch);
  const tri: Pt[] = [
    [-w / 2, 0],
    [w / 2, 0],
    [0, ridge],
  ];
  F.add(slab(tri, d, plaster, { pos: [0, h, 0] }));
  const slant = (w / 2 + 0.3) / Math.cos(pitch);
  for (const s of [-1, 1]) {
    F.add(
      box(slant, 0.14, d + 0.5, tone(roof, 0.05, rng), {
        pos: [s * (w / 4 + 0.08), h + ridge / 2 + 0.1, 0],
        rot: [0, 0, -s * pitch],
      }),
    );
  }
  F.add(box(0.2, 0.2, d + 0.6, k.woodDark, { pos: [0, h + ridge + 0.1, 0], rot: [0, 0, Math.PI / 4] }));
  return F;
}

/**
 * params: width (per house 3.0), lit (true), door (#hex). The village of Morality seen from the side road
 * (Ch III): a pretty row of three toy house fronts, the middle one taller with a big arched door, flowers along
 * the step. Cheap (< 900 lit triangles) because the player never reaches it; one box collider across the row.
 */
export function buildVillageDoor(rng: Rng, pal: Palette, p: PropParams): PropResult {
  const k = kit(pal);
  const P = new Parts();
  const w = num(p, 'width', 3.0, 1.8, 6);
  const lit = bool(p, 'lit', true);
  const door = hexParam(p, 'door') ?? k.gate;
  const d = 1.1;
  const hs = [2.4, 3.3, 2.7];
  const xs = [-w - 0.1, 0, w + 0.1];
  for (let i = 0; i < 3; i++) {
    const plaster = k.plaster[(i * 2 + 1) % k.plaster.length]!;
    const roof = k.roof[i % k.roof.length]!;
    const F = facade(rng, k, w, hs[i]!, d, plaster, roof, lit && rng.chance(0.85));
    P.absorb(F, { pos: [xs[i]!, 0, 0], lean: [rng.range(-0.025, 0.025), 0], rotY: rng.range(-0.04, 0.04) });
  }
  // The big door on the middle house: arched leaf, stone surround, iron bands, a brass ring, and a doorstep.
  const dw = 1.5;
  const spring = 1.9;
  const rise = 0.55;
  const leaf: Pt[] = [[-dw / 2, 0], [dw / 2, 0], ...arc(0, spring, dw / 2, rise, 0, Math.PI, 7)];
  const ring: Pt[] = [
    ...arc(0, spring, dw / 2 + 0.22, rise + 0.22, 0, Math.PI, 7),
    [-dw / 2 - 0.22, 0],
    [-dw / 2, 0],
    ...arc(0, spring, dw / 2, rise, Math.PI, 0, 7),
    [dw / 2 + 0.22, 0],
  ];
  P.add(slab(ring, 0.2, tone(k.stoneLight, 0.03, rng), { pos: [0, 0, d / 2 + 0.06] }));
  P.add(slab(leaf, 0.12, tone(door, 0.03, rng), { pos: [0, 0, d / 2 + 0.12] }));
  for (const y of [0.5, 1.4]) P.add(box(dw * 0.76, 0.09, 0.03, k.iron, { pos: [0, y, d / 2 + 0.2] }));
  P.add(box(0.04, spring + rise - 0.1, 0.03, k.woodDark, { pos: [0, (spring + rise) / 2, d / 2 + 0.2] }));
  P.add(gem(0.07, k.brass, { pos: [dw * 0.3, 1.1, d / 2 + 0.22] }));
  if (lit) P.glow(box(0.3, 0.22, 0.03, k.windowGlow, { pos: [0, spring + 0.12, d / 2 + 0.19] }));
  P.add(
    jitter(
      box(dw + 0.8, 0.2, 0.7, tone(k.stone, 0.04, rng), { pos: [0, 0.06, d / 2 + 0.4] }, 0.04),
      0.02,
      rng,
    ),
  );
  // Flowers along the fronts.
  for (let i = 0; i < 8; i++) {
    const x = -1.5 * w + 3 * w * ((i + 0.5) / 8) + rng.range(-0.15, 0.15);
    if (Math.abs(x) < dw / 2 + 0.6) continue;
    P.add(gem(0.14, k.leafDark, { pos: [x, 0.1, d / 2 + 0.3], scale: [1.2, 0.7, 1] }));
    P.add(gem(0.09, rng.pick(k.blossom), { pos: [x, 0.24, d / 2 + 0.32] }));
  }
  P.boxCol(0, 0, 3 * w + 0.4, hs[1]! + 0.5, d + 0.3);
  return P.done();
}

/**
 * params: width (20), height (16), glow (false: dim ember slits), color (#hex). The gloomy castle on the ridge
 * (Ch IV, castle #3E3548): three crooked castle towers of different heights joined by a plain dark battlement, one
 * merged prop (< 2500 lit triangles). Colliders: a cylinder per tower and a box per wall.
 */
export function buildCastleRidge(rng: Rng, pal: Palette, p: PropParams): PropResult {
  const k = kit(pal);
  const P = new Parts();
  const W = num(p, 'width', 20, 8, 80);
  const H = num(p, 'height', 16, 6, 40);
  const lit = bool(p, 'glow', false);
  const c = hexParam(p, 'color') ?? k.castle;
  const towers: Array<{ x: number; z: number; h: number; r: number }> = [
    { x: -W / 2 + 2.6, z: rng.range(-1, 1), h: H * 0.82, r: 2.4 },
    { x: rng.range(-1.5, 1.5), z: -rng.range(0.5, 2), h: H, r: 3 },
    { x: W / 2 - 2.6, z: rng.range(-1, 1), h: H * 0.7, r: 2.1 },
  ];
  for (const t of towers) {
    const res = buildCastleTower(rng.fork(`tower@${t.x.toFixed(1)}`), pal, {
      height: t.h,
      radius: t.r,
      glow: lit,
    });
    const rotY = rng.range(0, Math.PI * 2);
    const place = (g: typeof res.geometry) => {
      g.rotateY(rotY);
      g.translate(t.x, 0, t.z);
      return g;
    };
    P.add(place(res.geometry));
    if (res.glow) P.glow(place(res.glow));
    P.cylCol(t.x, t.z, t.r * 1.15, t.h);
  }
  // A plain battlemented wall between the towers: one dark block and a row of merlons per span.
  const wallH = H * 0.42;
  const thick = 2.2;
  const dark = speckled(c, rng);
  for (let i = 0; i + 1 < towers.length; i++) {
    const a = towers[i]!;
    const b = towers[i + 1]!;
    const x0 = a.x + a.r * 0.6;
    const x1 = b.x - b.r * 0.6;
    const len = x1 - x0;
    const z = (a.z + b.z) / 2;
    const angle = Math.atan2(a.z - b.z, len);
    const S = new Parts();
    S.add(jitter(box(len, wallH, thick, dark, { pos: [0, wallH / 2, 0] }), 0.08, rng));
    S.add(box(len + 0.3, 0.3, thick + 0.4, shade(c, 0.04), { pos: [0, wallH + 0.15, 0] }));
    crenels(S, rng, c, -len / 2, len / 2, wallH + 0.3, thick * 0.28, thick * 0.4, 1.6);
    if (lit) {
      const ember = pal.accents.embers ?? pal.accents.fire ?? '#B5523B';
      for (let j = 0; j < 2; j++) {
        S.glow(box(0.3, 0.9, 0.3, ember, { pos: [(j - 0.5) * len * 0.4, wallH * 0.55, thick / 2] }));
      }
    }
    P.absorb(S, { pos: [(x0 + x1) / 2, 0, z], rotY: angle });
    P.boxCol((x0 + x1) / 2, z, len, wallH + 0.5, thick + 0.4, angle);
  }
  // The ridge itself: a dark rocky mound the castle sits on, so it never floats on the terrain.
  const mound: Vec3 = [0, 0.1, -0.5];
  P.add(jitter(box(W + 4, 2.2, 9, mix(c, k.stoneDark, 0.5), { pos: mound }, 0.6), 0.3, rng));
  return P.done();
}

/** Face tints for the big dark castle blocks. */
function speckled(hex: string, rng: Rng): string {
  return tone(shade(hex, -0.02), 0.04, rng);
}
