/**
 * Marker and story props: the waystone (save point), the arbour (GDD Ch VII), the plain wooden cross on its
 * mound and the open stone tomb cut into a bank (Ch VI). Facing +Z, standing on y = 0.
 */
import { cone, jitter, lowSphere, paint, xform } from '../geom';
import { mix, type Palette } from '../palette';
import type { Rng } from '../rng';
import type { PropParams, PropResult } from '../types';
import {
  arc,
  bar,
  beam,
  bool,
  box,
  dome,
  gem,
  kit,
  num,
  Parts,
  rod,
  slab,
  speckle,
  tone,
  topSide,
  type Geo,
  type Kit,
  type Pt,
} from './built-kit';

/** A small faceted stone (pebbles at the foot of things). */
function pebble(rng: Rng, hex: string, x: number, y: number, z: number, r: number): Geo {
  const g = jitter(lowSphere(r, 0), r * 0.18, rng);
  return xform(paint(g, hex), {
    pos: [x, y, z],
    rot: [rng.range(0, 3), rng.range(0, 3), 0],
    scale: [1, 0.7, 1],
  });
}

/** Grass tuft: three thin blades as a 4-sided cone cluster. */
function tuft(P: Parts, rng: Rng, k: Kit, x: number, z: number, s = 1): void {
  for (let i = 0; i < 2; i++) {
    P.add(
      xform(paint(cone(0.06 * s, 0.26 * s, 4), tone(k.leaf, 0.05, rng)), {
        pos: [x + rng.range(-0.05, 0.05), -0.02, z + rng.range(-0.05, 0.05)],
        rot: [rng.range(-0.3, 0.3), rng.range(0, 3), rng.range(-0.3, 0.3)],
      }),
    );
  }
}

/**
 * A friendly marker stone with the path-and-sun emblem raised on its face and a small glowing scroll slot.
 * params: none.
 */
export function buildWaystone(rng: Rng, pal: Palette, _p: PropParams): PropResult {
  const k = kit(pal);
  const P = new Parts();
  const stone = mix(k.stoneLight, k.path, 0.25);
  const outline: Pt[] = [
    [-0.42, 0],
    [0.42, 0],
    [0.38, 0.75],
    [0.32, 1.05],
    [0.18, 1.27],
    [0, 1.36],
    [-0.18, 1.27],
    [-0.32, 1.05],
    [-0.38, 0.75],
  ];
  const tilt = rng.range(-0.035, 0.035);
  const S = new Parts();
  S.add(jitter(slab(outline, 0.4, stone, {}, 0.05), 0.025, rng));
  const fz = 0.26;
  // Emblem: a rising half-sun with rays over a path that narrows to the horizon.
  const sunY = 0.92;
  S.add(slab([...arc(0, 0, 0.17, 0.17, 0, Math.PI, 6)], 0.04, k.gold, { pos: [0, sunY, fz] }));
  for (let i = 0; i < 5; i++) {
    const a = (Math.PI * (i + 1)) / 6;
    S.add(
      box(0.035, 0.09, 0.03, k.gold, {
        pos: [Math.cos(a) * 0.25, sunY + Math.sin(a) * 0.25, fz],
        rot: [0, 0, a - Math.PI / 2],
      }),
    );
  }
  S.add(box(0.52, 0.025, 0.03, k.stoneLight, { pos: [0, sunY - 0.01, fz] }));
  const road: Pt[] = [
    [-0.16, 0.36],
    [0.16, 0.36],
    [0.025, sunY - 0.03],
    [-0.025, sunY - 0.03],
  ];
  S.add(slab(road, 0.03, mix(k.path, '#FFFFFF', 0.2), { pos: [0, 0, fz] }));
  // Scroll slot near the foot.
  S.add(box(0.36, 0.12, 0.04, k.stoneDark, { pos: [0, 0.2, fz - 0.005] }));
  S.glow(box(0.27, 0.05, 0.03, k.windowGlow, { pos: [0, 0.2, fz + 0.012] }));
  P.absorb(S, { pos: [0, 0.08, 0], lean: [tilt, 0] });
  P.add(jitter(box(1.0, 0.16, 0.62, tone(k.stoneDark, 0.03, rng), { pos: [0, 0.05, 0] }, 0.04), 0.02, rng));
  for (let i = 0; i < 3; i++) {
    const a = rng.range(0, Math.PI * 2);
    P.add(
      pebble(
        rng,
        tone(k.stone, 0.06, rng),
        Math.cos(a) * 0.62,
        0.05,
        Math.sin(a) * 0.45,
        rng.range(0.1, 0.16),
      ),
    );
  }
  tuft(P, rng, k, -0.5, 0.25);
  tuft(P, rng, k, 0.45, -0.3);
  P.cylCol(0, 0, 0.5, 1.45);
  return P.done();
}

/** A bench under a leafy arch with a few flowers (GDD 2.7.4: the arbour on Hill Difficulty). params: none. */
export function buildArbour(rng: Rng, pal: Palette, _p: PropParams): PropResult {
  const k = kit(pal);
  const P = new Parts();
  const W = 2.6;
  const D = 1.5;
  const ph = 1.9;
  const rise = 0.75;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      P.add(
        rod(
          0.07,
          0.085,
          ph,
          tone(k.wood, 0.05, rng),
          { pos: [sx * (W / 2), 0, sz * (D / 2)], rot: [0, 0, sx * -0.03] },
          5,
        ),
      );
      P.cylCol(sx * (W / 2), sz * (D / 2), 0.11, ph + rise);
    }
  }
  // Two leafy arches (a thick band of foliage over each pair of posts), a canopy of clumps between them and a
  // little ivy climbing two posts.
  const leaves = speckle([k.leaf, k.leafDark, tone(k.leaf, 0.06, rng)]);
  const crown = arc(0, ph - 0.1, W / 2 + 0.02, rise + 0.05, 0, Math.PI, 5);
  for (const sz of [-1, 1]) {
    for (let i = 0; i + 1 < crown.length; i++) {
      const a = crown[i]!;
      const b = crown[i + 1]!;
      // Overlapping chunky segments, like a clipped hedge bent over the posts.
      const ext = 0.12;
      const dx = (b[0] - a[0]) * ext;
      const dy = (b[1] - a[1]) * ext;
      const seg = beam(
        [a[0] - dx, a[1] - dy, sz * (D / 2)],
        [b[0] + dx, b[1] + dy, sz * (D / 2)],
        0.36,
        tone(k.leaf, 0.06, rng),
        0.44,
      );
      P.add(jitter(seg, 0.035, rng));
    }
  }
  const clumps: Array<[number, number, number, number]> = [];
  for (const sz of [-1, 1]) {
    for (const t of [0.3, 0.7]) {
      const a = Math.PI * t + rng.range(-0.08, 0.08);
      clumps.push([
        Math.cos(a) * (W / 2),
        ph + Math.sin(a) * rise + 0.12,
        sz * (D / 2 + 0.05),
        rng.range(0.24, 0.3),
      ]);
    }
  }
  for (const t of [0.3, 0.5, 0.7]) {
    const a = Math.PI * t;
    clumps.push([
      Math.cos(a) * (W / 2) * 0.92,
      ph + Math.sin(a) * rise + 0.1,
      rng.range(-0.12, 0.12),
      rng.range(0.32, 0.38),
    ]);
  }
  clumps.push([-W / 2, 1.2, D / 2, 0.2], [W / 2, 0.9, -D / 2, 0.2]);
  for (const [x, y, z, r] of clumps) {
    const g = jitter(lowSphere(r, 0), r * 0.15, rng);
    P.add(
      xform(paint(g, leaves), {
        pos: [x, y, z],
        rot: [rng.range(0, 3), rng.range(0, 3), 0],
        scale: [1.25, 0.8, 1.25],
      }),
    );
  }
  for (let i = 0; i < 6; i++) {
    const [x, y, z, r] = clumps[rng.int(0, clumps.length - 1)]!;
    const a = rng.range(0, Math.PI * 2);
    P.add(
      gem(0.07, rng.pick(k.blossom), {
        pos: [x + Math.cos(a) * r * 0.9, y + rng.range(-0.1, 0.25), z + Math.sin(a) * r * 0.9],
      }),
    );
  }
  // The bench.
  const bz = -0.15;
  P.add(box(W - 0.5, 0.08, 0.44, tone(k.woodLight, 0.04, rng), { pos: [0, 0.46, bz] }, 0.02));
  for (const sx of [-1, 1]) P.add(box(0.08, 0.42, 0.38, k.wood, { pos: [sx * (W / 2 - 0.45), 0.21, bz] }));
  P.add(
    box(W - 0.5, 0.2, 0.05, tone(k.woodLight, 0.04, rng), { pos: [0, 0.85, bz - 0.24], rot: [-0.12, 0, 0] }),
  );
  for (const sx of [-1, 1])
    P.add(box(0.06, 0.5, 0.05, k.wood, { pos: [sx * (W / 2 - 0.5), 0.68, bz - 0.22], rot: [-0.12, 0, 0] }));
  P.boxCol(0, bz, W - 0.5, 0.5, 0.48);
  return P.done();
}

/** params: height (4.2), mound (true). A plain wooden cross on a small grassy mound; no figure. */
export function buildCross(rng: Rng, pal: Palette, p: PropParams): PropResult {
  const k = kit(pal);
  const P = new Parts();
  const H = num(p, 'height', 4.2, 2, 8);
  const mound = bool(p, 'mound', true);
  const y0 = mound ? 0.46 : 0; // ground level at the foot of the cross
  if (mound) {
    const grass = speckle([k.grass, tone(k.grass, 0.05, rng), mix(k.grass, k.leaf, 0.5)]);
    const g = xform(dome(9), { pos: [0, -0.12, 0], scale: [2.3, 0.6, 2.0] });
    P.add(paint(jitter(g, 0.06, rng), (c, n) => (n.y > 0.2 ? grass(c) : k.earth)));
  }
  const wood = k.cross;
  P.add(box(0.3, H, 0.3, wood, { pos: [0, y0 - 0.25 + H / 2, 0] }, 0.03));
  P.add(box(2.0, 0.28, 0.28, tone(wood, 0.03, rng), { pos: [0, y0 + H - 1.15, 0.01] }, 0.03));
  for (let i = 0; i < 4; i++) {
    const a = (Math.PI / 2) * i + rng.range(-0.4, 0.4);
    P.add(
      pebble(rng, tone(k.stone, 0.05, rng), Math.cos(a) * 0.32, y0, Math.sin(a) * 0.32, rng.range(0.1, 0.15)),
    );
  }
  P.cylCol(0, 0, 0.28, H + y0);
  // The crossbeam too, so the follow camera's spring arm and the Cross's cameras keep out of it (y0 = its bottom).
  P.boxCol(0, 0.01, 2.0, 0.28, 0.28, 0, y0 + H - 1.15 - 0.14);
  return P.done();
}

/**
 * An open stone tomb cut into a little grassy bank: an arched stone front with a dark opening and the round
 * stone rolled to one side (GDD Ch VI). params: none.
 */
export function buildTomb(rng: Rng, pal: Palette, _p: PropParams): PropResult {
  const k = kit(pal);
  const P = new Parts();
  // The bank stays behind the stone front (its foot reaches z = 0.7; the front face is at z = 0.9).
  const bz = -1.3;
  const bank = xform(dome(9), { pos: [0, 0, bz], scale: [3.0, 1.75, 2.0] });
  P.add(paint(jitter(bank, 0.08, rng), topSide(k.grass, k.earth, 0.45)));
  const front: Pt[] = [
    [-1.5, 0],
    [-1.62, 1.0],
    [-1.3, 1.6],
    [-0.6, 1.92],
    [0.5, 1.96],
    [1.25, 1.66],
    [1.56, 1.05],
    [1.5, 0],
    [0.62, 0],
    ...arc(0, 0.95, 0.62, 0.55, 0, Math.PI, 5),
    [-0.62, 0],
  ];
  const rough = speckle([k.tomb, k.stoneLight, tone(k.tomb, 0.05, rng)]);
  P.add(
    jitter(
      slab(front, 0.7, (c, n) => (Math.abs(n.z) > 0.5 ? k.tomb : rough(c)), { pos: [0, 0, 0.55] }),
      0.03,
      rng,
    ),
  );
  // Darkness inside, set just behind the front so the opening reads as deep from every angle.
  P.add(box(1.3, 1.52, 0.5, k.hollow, { pos: [0, 0.76, 0.45] }));
  P.add(box(1.55, 0.08, 0.55, k.stoneLight, { pos: [0, 0.03, 1.05] }, 0.02));
  // The great round stone, rolled away and resting on its edge.
  const sx = 2.05;
  P.add(jitter(bar([sx, 0.85, 0.8], [sx + 0.06, 0.85, 1.14], 0.85, tone(k.tomb, 0.04, rng), 10), 0.03, rng));
  P.boxCol(sx + 0.03, 0.97, 1.7, 1.7, 0.34);
  for (let i = 0; i < 4; i++) {
    // Flowers on the bank: height of the scaled half-sphere at (x, z).
    const x = rng.range(-1.6, 1.6);
    const z = rng.range(-2.0, -0.9);
    const y = 1.75 * Math.sqrt(Math.max(0, 1 - (x / 3) ** 2 - ((z - bz) / 2.0) ** 2));
    P.add(gem(0.07, rng.pick(k.blossom), { pos: [x, y + 0.02, z] }));
  }
  tuft(P, rng, k, -1.6, 0.9);
  tuft(P, rng, k, 1.0, 1.0, 0.8);
  P.boxCol(0, bz, 4.8, 1.6, 3.0);
  P.boxCol(0, 0.55, 3.2, 1.95, 0.7);
  return P.done();
}
