/**
 * Small chapter props for Chapters I-IV (GDD 2.10): the glowing Book on its table (Ch I), the far shining light
 * on the horizon (Ch I, III), Pliable's lost boot (Ch II), the cover rock (Ch IV) and the dark arrow (Ch IV).
 * Town-scale pieces (walls, gate, village facade, castle ridge) live in built-chapter-town.ts.
 */
import * as THREE from 'three';
import { cone, cylinder, extrude, jitter, lathe, lowSphere, paint, xform } from '../geom';
import { mix, shade, type Palette } from '../palette';
import type { Rng } from '../rng';
import type { PropParams, PropResult } from '../types';
import { bool, box, gem, hexParam, kit, num, Parts, rod, speckle, tone, type Kit } from './built-kit';

/** The warm "objective" glow of a palette: horizon light, safe light, candle... (GDD Ch I/IV accents). */
export function objectiveGlow(pal: Palette, k: Kit): string {
  const a = pal.accents;
  return a.horizonLight ?? a.safeLight ?? a.stepsGlow ?? a.candle ?? k.windowGlow;
}

/**
 * params: height (table 0.72), glow (true), color (#hex cover), open (false). A chunky closed book on a small
 * square table; the page block is glow geometry, so the pages shine with a soft golden rim between the covers
 * ("the Book glows on the table", Ch I). ~190 triangles. Collider: the table.
 */
export function buildBook(rng: Rng, pal: Palette, p: PropParams): PropResult {
  const k = kit(pal);
  const P = new Parts();
  const th = num(p, 'height', 0.72, 0.4, 1.2);
  const lit = bool(p, 'glow', true);
  const cover = hexParam(p, 'color') ?? mix('#7A3B2E', k.wood, 0.25);
  const pages = mix(objectiveGlow(pal, k), '#FFF6DC', 0.45);
  const tw = 0.86;
  const td = 0.7;
  // Table: four slightly splayed legs, an apron and a thick top.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      P.add(
        box(0.09, th - 0.06, 0.09, tone(k.woodDark, 0.04, rng), {
          pos: [sx * (tw / 2 - 0.1), (th - 0.06) / 2 - 0.02, sz * (td / 2 - 0.1)],
          rot: [sz * 0.03, 0, -sx * 0.03],
        }),
      );
    }
  }
  P.add(box(tw - 0.26, 0.1, td - 0.26, k.woodDark, { pos: [0, th - 0.12, 0] }));
  P.add(jitter(box(tw, 0.07, td, tone(k.wood, 0.04, rng), { pos: [0, th - 0.035, 0] }, 0.02), 0.01, rng));
  P.boxCol(0, 0, tw, th, td);

  // The Book: two bevelled cover boards, a rounded spine on -X, and the page block proud on the other three sides.
  const bw = 0.42;
  const bh = 0.1;
  const bd = 0.34;
  const by = th;
  const ry = rng.range(-0.12, 0.12);
  const B = new Parts();
  const boardT = 0.02;
  for (const y of [boardT / 2, bh - boardT / 2]) {
    B.add(box(bw, boardT, bd, cover, { pos: [0.01, y, 0] }, 0.006));
  }
  B.add(
    xform(paint(cylinder(bh / 2 + 0.002, bh / 2 + 0.002, bd, 6), cover), {
      rot: [Math.PI / 2, 0, 0],
      pos: [-bw / 2 + 0.01, bh / 2, -bd / 2],
    }),
  );
  // Gold clasp and corner studs on the top board.
  B.add(box(0.05, 0.016, 0.06, k.gold, { pos: [bw / 2 - 0.02, bh + 0.002, 0] }));
  for (const sz of [-1, 1])
    B.add(gem(0.014, k.gold, { pos: [bw / 2 - 0.04, bh + 0.006, sz * (bd / 2 - 0.05)] }));
  const block = box(bw - 0.03, bh - 2 * boardT + 0.004, bd - 0.02, pages, { pos: [0.03, bh / 2, 0] });
  if (lit) {
    B.glow(block);
    // The rim: a slightly larger, paler sliver that peeps out around the page edges, and a narrow pool of light
    // on the table just around the book.
    B.glow(box(bw + 0.02, 0.012, bd + 0.03, mix(pages, '#FFFFFF', 0.3), { pos: [0.03, bh / 2, 0] }));
    B.glow(box(bw + 0.1, 0.006, bd + 0.1, objectiveGlow(pal, k), { pos: [0.01, 0.004, 0] }));
  } else B.add(block);
  P.absorb(B, { pos: [0, by, 0], rotY: ry });
  return P.done();
}

/**
 * params: height (40), radius (1.6), color (#hex). The objective light on the horizon (Ch I, III): a tall soft
 * shining pillar (a bright core inside a paler sheath) with a star at the top, all glow geometry, under 120
 * triangles. The little pale mound at its foot is the only lit piece. No collider.
 */
export function buildFarLight(rng: Rng, pal: Palette, p: PropParams): PropResult {
  const k = kit(pal);
  const P = new Parts();
  const H = num(p, 'height', 40, 4, 400);
  const R = num(p, 'radius', 1.6, 0.2, 20);
  const core = hexParam(p, 'color') ?? objectiveGlow(pal, k);
  const bright = mix(core, '#FFFFFF', 0.6);
  const soft = mix(core, pal.sky.horizon, 0.5);
  const mid = mix(core, pal.sky.horizon, 0.2);
  // Bright round core, wrapped by two crossed thin flares in the soft sky-mixed tint: from any side the core
  // shows with a pale fringe either side of it, the cheapest "soft" a flat unlit mesh can do.
  P.glow(
    paint(
      lathe(
        [
          [R * 0.2, 0],
          [R * 0.5, H * 0.14],
          [R * 0.4, H * 0.6],
          [R * 0.12, H * 0.93],
          [0, H],
        ],
        6,
      ),
      bright,
    ),
  );
  const flare: Array<[number, number]> = [
    [-R * 0.5, 0],
    [R * 0.5, 0],
    [R * 1.5, H * 0.2],
    [R * 0.9, H * 0.6],
    [R * 0.2, H * 0.96],
    [-R * 0.2, H * 0.96],
    [-R * 0.9, H * 0.6],
    [-R * 1.5, H * 0.2],
  ];
  const spin = rng.range(0, Math.PI / 4);
  for (let i = 0; i < 2; i++) {
    const g = paint(extrude(flare, 0.04), (c) => (Math.abs(c.x) < R * 0.6 ? mid : soft));
    P.glow(xform(g, { rot: [0, spin + (i * Math.PI) / 2, 0] }));
  }
  // A four-point star where the pillar thins out, turning so it never reads as a plain diamond.
  const sy = H * 0.9;
  P.glow(gem(R * 1.4, bright, { pos: [0, sy, 0], scale: [1, 2.6, 0.35], rot: [0, spin, 0] }));
  P.glow(gem(R * 1.4, mid, { pos: [0, sy, 0], scale: [3, 0.9, 0.35], rot: [0, spin + 0.3, 0] }));
  P.add(
    paint(
      lathe(
        [
          [R * 1.4, -0.3],
          [R * 1.1, R * 0.35],
          [0, R * 0.5],
        ],
        7,
      ),
      mix(k.stoneLight, core, 0.35),
    ),
  );
  return P.done();
}

/**
 * params: color (#hex), tilt (0.35 rad, heel sunk and toe up as if left behind in mud), scale (1). Pliable's comic
 * boot (Ch II): a chunky foot with a round toe, a flared shaft and a thick sole, toe towards +Z. ~150 triangles.
 * Walk-over: no collider.
 */
export function buildBoot(rng: Rng, pal: Palette, p: PropParams): PropResult {
  const k = kit(pal);
  const s = num(p, 'scale', 1, 0.3, 4);
  const tilt = num(p, 'tilt', 0.35, -1, 1);
  const leather = hexParam(p, 'color') ?? mix(k.wood, '#8A5A3B', 0.5);
  const sole = shade(leather, -0.22);
  const B = new Parts();
  const fw = 0.17;
  const fh = 0.12;
  const fd = 0.3;
  // Thick sole, chunky foot, a round toe that overlaps the foot, and a raised heel.
  B.add(box(fw + 0.02, 0.035, fd + 0.03, sole, { pos: [0, 0.018, 0.0] }, 0.01));
  const foot = tone(leather, 0.03, rng);
  B.add(box(fw, fh, fd * 0.72, foot, { pos: [0, 0.035 + fh / 2, -fd * 0.12] }, 0.035));
  B.add(
    xform(paint(lowSphere(fw * 0.58, 1), foot), {
      pos: [0, 0.035 + fh * 0.48, fd * 0.14],
      scale: [0.95, fh / (fw * 1.16), 1.05],
    }),
  );
  B.add(box(fw * 0.9, 0.03, 0.08, sole, { pos: [0, 0.05, -fd * 0.38] }));
  // Shaft with a rolled cuff and a pull loop at the back; it leans back a touch, so the boot looks slumped.
  const ax = -fd * 0.22;
  B.add(rod(0.08, 0.075, 0.2, leather, { pos: [0, 0.035 + fh - 0.03, ax], rot: [0.12, 0, 0] }, 7));
  B.add(rod(0.09, 0.082, 0.04, shade(leather, -0.1), { pos: [0, 0.035 + fh + 0.14, ax - 0.02] }, 7));
  B.add(box(0.03, 0.05, 0.012, shade(leather, -0.14), { pos: [0, 0.035 + fh + 0.17, ax - 0.1] }));
  // Tilt about the heel so the toe points up out of the mud, scale, then sit it back on the ground.
  const out = B.done();
  xform(out.geometry, { rot: [-tilt, 0, 0], pos: [0, 0, fd * 0.2] });
  xform(out.geometry, { scale: s });
  out.geometry.computeBoundingBox();
  const sink = Math.min(0, out.geometry.boundingBox!.min.y);
  if (sink < -0.01) xform(out.geometry, { pos: [0, -sink - 0.03 * s, 0] });
  return out;
}

/**
 * params: width (1.6), height (1.3), color (#hex), moss (true). A big rounded boulder to hide behind (Ch IV):
 * one faceted stone, 80 lit triangles plus a pebble, with a cylinder collider the controller can hug. Sits a
 * little sunk so it never floats.
 */
export function buildCoverRock(rng: Rng, pal: Palette, p: PropParams): PropResult {
  const k = kit(pal);
  const P = new Parts();
  const W = num(p, 'width', 1.6, 0.6, 6);
  const H = num(p, 'height', 1.3, 0.4, 5);
  const D = W * 0.86;
  const base = hexParam(p, 'color') ?? k.stone;
  const stones = speckle([base, tone(base, 0.05, rng), shade(base, -0.05), shade(base, 0.04)]);
  const under = shade(base, -0.14);
  const moss = bool(p, 'moss', true) ? mix(k.leaf, base, 0.35) : null;
  const painter = (c: THREE.Vector3, n: THREE.Vector3): string =>
    n.y < -0.3 ? under : moss && n.y > 0.72 && c.y > H * 0.55 ? moss : stones(c);
  const sink = 0.1;
  const body = lowSphere(1, 1);
  xform(body, { rot: [rng.range(0, 6.28), rng.range(0, 6.28), 0] });
  xform(body, { scale: [W / 2, (H + sink) / 2, D / 2], pos: [0, (H - sink) / 2, 0] });
  jitter(body, Math.min(W, H) * 0.045, rng);
  P.add(paint(body, painter));
  // A pebble at the foot on a random side.
  const a = rng.range(0, Math.PI * 2);
  const pr = W * 0.14;
  const pebble = jitter(lowSphere(pr, 0), pr * 0.15, rng);
  P.add(
    xform(
      paint(pebble, (c, n) => (n.y < -0.3 ? under : stones(c))),
      {
        pos: [Math.sin(a) * (W / 2 + pr * 0.6), pr * 0.7, Math.cos(a) * (D / 2 + pr * 0.6)],
        scale: [1, 0.75, 1],
      },
    ),
  );
  P.cylCol(0, 0, Math.max(W, D) * 0.47, H);
  return P.done();
}

/**
 * params: length (0.9), color (#hex fletching). A dark arrow for the Ch IV volleys: shaft + head + two crossed
 * fletchings, 48 triangles, built along +Z (the flight direction) with the shaft axis on y = 0, centred on the
 * origin (tip at +length/2). The chapter instances and orients it. No collider.
 */
export function buildArrow(rng: Rng, pal: Palette, p: PropParams): PropResult {
  const k = kit(pal);
  const P = new Parts();
  const L = num(p, 'length', 0.9, 0.3, 3);
  const dark = shade(k.castle, -0.1);
  const fletch = hexParam(p, 'color') ?? mix(pal.accents.castle ?? dark, '#8C2F39', 0.35);
  const half = L / 2;
  const headL = L * 0.13;
  // Shaft along +Z: build upright then lay it down (a +90° turn about X takes +Y onto +Z).
  P.add(
    xform(paint(cylinder(0.013, 0.011, L - headL, 4), shade(k.woodDark, -0.28)), {
      rot: [Math.PI / 2, 0, 0],
      pos: [0, 0, -half],
    }),
  );
  P.add(
    xform(paint(cone(0.04, headL, 4), k.iron), {
      rot: [Math.PI / 2, 0, 0],
      pos: [0, 0, half - headL],
    }),
  );
  // Two crossed vanes at the nock, slightly swept.
  const vz = -half + L * 0.1;
  for (const r of [0, Math.PI / 2]) {
    P.add(
      box(0.006, 0.075, L * 0.16, tone(fletch, 0.04, rng), {
        pos: [0, 0, vz],
        rot: [0.12, 0, r + rng.range(-0.05, 0.05)],
      }),
    );
  }
  return P.done();
}
