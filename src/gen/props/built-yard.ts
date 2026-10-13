/**
 * Yard and street furniture: well, bench, barrel, crate and handcart. Facing +Z, standing on y = 0.
 */
import { jitter, lathe, lowSphere, paint, xform } from '../geom';
import type { Palette } from '../palette';
import type { Rng } from '../rng';
import type { PropParams, PropResult } from '../types';
import { bar, beam, bool, box, kit, num, Parts, rod, speckle, tone, type Geo, type Kit } from './built-kit';

/** A bulging stave barrel with iron hoops and a dark lid (~130 triangles), base at y = 0. */
export function barrelGeo(rng: Rng, k: Kit, s = 1): Geo {
  const prof: Array<[number, number]> = [
    [0, 0],
    [0.31, 0],
    [0.33, 0.1],
    [0.35, 0.16],
    [0.39, 0.45],
    [0.35, 0.74],
    [0.33, 0.8],
    [0.31, 0.9],
    [0, 0.9],
  ];
  const wood = tone(k.wood, 0.05, rng);
  const light = tone(k.woodLight, 0.05, rng);
  const g = paint(lathe(prof, 8), (c, n) => {
    if (n.y > 0.9) return k.woodDark;
    if ((c.y > 0.1 && c.y < 0.16) || (c.y > 0.74 && c.y < 0.8)) return k.iron;
    const a = Math.atan2(c.z, c.x) + Math.PI;
    return Math.floor((a / (Math.PI * 2)) * 8) % 2 === 0 ? wood : light;
  });
  return xform(g, { rot: [0, rng.range(0, Math.PI), 0], scale: s });
}

/** params: none. Round stone well with a little roof, winch and bucket. */
export function buildWell(rng: Rng, pal: Palette, _p: PropParams): PropResult {
  const k = kit(pal);
  const P = new Parts();
  const ri = 0.55;
  const ro = 0.8;
  const ring = lathe(
    [
      [ro, 0],
      [ro + 0.04, 0.4],
      [ro, 0.78],
      [ro - 0.05, 0.85],
      [ri + 0.04, 0.85],
      [ri, 0.78],
      [ri, 0.3],
    ],
    9,
  );
  const tones = [k.stone, k.stoneLight, k.stoneDark, tone(k.stone, 0.06, rng)];
  P.add(jitter(paint(ring, speckle(tones)), 0.03, rng));
  P.add(rod(ri, ri, 0.02, k.water, { pos: [0, 0.42, 0] }, 9));
  for (const sx of [-1, 1]) {
    P.add(
      box(0.14, 2.0, 0.14, tone(k.wood, 0.05, rng), {
        pos: [sx * (ro - 0.02), 1.0, 0],
        rot: [0, 0, sx * 0.03],
      }),
    );
  }
  P.add(bar([-ro - 0.05, 1.55, 0], [ro + 0.3, 1.55, 0], 0.06, k.woodDark, 6));
  P.add(beam([ro + 0.3, 1.55, 0], [ro + 0.3, 1.38, 0.22], 0.05, k.iron));
  P.add(box(0.03, 0.55, 0.03, k.straw, { pos: [0.05, 1.27, 0] }));
  P.add(rod(0.15, 0.12, 0.22, tone(k.woodLight, 0.04, rng), { pos: [0.05, 0.78, 0] }, 7));
  const roof = rng.pick(k.roof);
  for (const sz of [-1, 1]) {
    P.add(
      box(
        2.1,
        0.08,
        0.82,
        tone(roof, 0.04, rng),
        {
          pos: [0, 2.12, sz * 0.32],
          rot: [sz * 0.62, 0, rng.range(-0.02, 0.02)],
        },
        0.02,
      ),
    );
  }
  P.cylCol(0, 0, ro + 0.05, 0.85);
  return P.done();
}

/** params: length (1.6), back (true). */
export function buildBench(rng: Rng, pal: Palette, p: PropParams): PropResult {
  const k = kit(pal);
  const P = new Parts();
  const L = num(p, 'length', 1.6, 0.8, 4);
  const back = bool(p, 'back', true);
  P.add(
    box(
      L,
      0.08,
      0.42,
      tone(k.woodLight, 0.04, rng),
      { pos: [0, 0.46, 0], rot: [0, 0, rng.range(-0.015, 0.015)] },
      0.02,
    ),
  );
  for (const sx of [-1, 1]) {
    P.add(box(0.08, 0.42, 0.38, tone(k.wood, 0.04, rng), { pos: [sx * (L / 2 - 0.2), 0.21, 0] }));
  }
  P.add(beam([-(L / 2 - 0.2), 0.12, 0], [L / 2 - 0.2, 0.12, 0], 0.06, k.woodDark));
  if (back) {
    for (const sx of [-1, 1]) {
      P.add(box(0.07, 0.52, 0.06, k.wood, { pos: [sx * (L / 2 - 0.22), 0.7, -0.2], rot: [-0.12, 0, 0] }));
    }
    P.add(
      box(
        L - 0.1,
        0.18,
        0.05,
        tone(k.woodLight, 0.04, rng),
        { pos: [0, 0.86, -0.23], rot: [-0.12, 0, 0] },
        0.015,
      ),
    );
  }
  P.boxCol(0, 0, L, 0.5, 0.46);
  return P.done();
}

/** params: scale (1). */
export function buildBarrel(rng: Rng, pal: Palette, p: PropParams): PropResult {
  const P = new Parts();
  const s = num(p, 'scale', 1, 0.4, 3);
  P.add(barrelGeo(rng, kit(pal), s));
  P.cylCol(0, 0, 0.4 * s, 0.9 * s);
  return P.done();
}

/** params: size (0.8), stack (1..3). */
export function buildCrate(rng: Rng, pal: Palette, p: PropParams): PropResult {
  const k = kit(pal);
  const P = new Parts();
  let s = num(p, 'size', 0.8, 0.3, 2);
  const stack = Math.round(num(p, 'stack', 1, 1, 3));
  const base = s;
  let y = 0;
  for (let i = 0; i < stack; i++) {
    const C = new Parts();
    const wood = tone(k.woodLight, 0.06, rng);
    C.add(box(s, s, s, wood, { pos: [0, s / 2, 0] }, 0.04));
    for (const sz of [-1, 1]) {
      const z = sz * (s / 2 + 0.015);
      C.add(box(s - 0.04, 0.1, 0.03, k.wood, { pos: [0, 0.07, z] }));
      C.add(box(s - 0.04, 0.1, 0.03, k.wood, { pos: [0, s - 0.07, z] }));
      C.add(beam([-s / 2 + 0.08, 0.1, z], [s / 2 - 0.08, s - 0.1, z], 0.08, k.wood, 0.03));
    }
    C.add(box(s + 0.03, 0.1, s + 0.03, k.woodDark, { pos: [0, s / 2, 0] }));
    P.absorb(C, { pos: [rng.range(-0.06, 0.06), y, rng.range(-0.06, 0.06)], rotY: rng.range(-0.3, 0.3) });
    y += s;
    s *= rng.range(0.75, 0.9);
  }
  P.boxCol(0, 0, base, y, base);
  return P.done();
}

/** params: cargo (true). A two-wheeled handcart with sacks. */
export function buildCart(rng: Rng, pal: Palette, p: PropParams): PropResult {
  const k = kit(pal);
  const P = new Parts();
  const bedY = 0.62;
  const wood = tone(k.woodLight, 0.05, rng);
  P.add(box(1.2, 0.12, 1.8, wood, { pos: [0, bedY, 0] }, 0.02));
  for (const sx of [-1, 1])
    P.add(box(0.06, 0.32, 1.8, tone(k.wood, 0.04, rng), { pos: [sx * 0.6, bedY + 0.2, 0] }));
  P.add(box(1.2, 0.32, 0.06, k.wood, { pos: [0, bedY + 0.2, 0.9] }));
  P.add(box(1.2, 0.22, 0.06, k.wood, { pos: [0, bedY + 0.15, -0.9] }));
  for (const sx of [-1, 1]) {
    const x = sx * 0.72;
    P.add(
      rod(
        0.45,
        0.45,
        0.1,
        tone(k.wood, 0.04, rng),
        { pos: [x + sx * 0.05, 0.45, 0], rot: [0, 0, sx * (Math.PI / 2)] },
        8,
      ),
    );
    P.add(
      rod(0.09, 0.09, 0.2, k.iron, { pos: [x + sx * 0.12, 0.45, 0], rot: [0, 0, sx * (Math.PI / 2)] }, 6),
    );
    for (const a of [0.3, 0.3 + Math.PI / 2]) {
      P.add(box(0.04, 0.78, 0.06, k.woodDark, { pos: [x + sx * 0.06, 0.45, 0], rot: [a, 0, 0] }));
    }
    P.add(beam([sx * 0.45, bedY - 0.02, 0.85], [sx * 0.45, bedY + 0.08, 1.9], 0.07, k.woodDark));
    P.add(box(0.08, bedY - 0.06, 0.08, k.woodDark, { pos: [sx * 0.45, (bedY - 0.06) / 2, 0.8] }));
  }
  P.add(bar([-0.78, 0.45, 0], [0.78, 0.45, 0], 0.04, k.iron, 6));
  P.add(bar([-0.5, bedY + 0.08, 1.88], [0.5, bedY + 0.08, 1.88], 0.035, k.woodDark, 6));
  if (bool(p, 'cargo', true)) {
    const n = rng.int(2, 3);
    for (let i = 0; i < n; i++) {
      const sack = lowSphere(0.32, 0);
      jitter(sack, 0.04, rng);
      P.add(
        xform(paint(sack, tone(k.straw, 0.08, rng)), {
          pos: [rng.range(-0.25, 0.25), bedY + 0.3, -0.5 + i * 0.5],
          rot: [rng.range(-0.3, 0.3), rng.range(0, 3), 0],
          scale: [1, 0.75, 1.1],
        }),
      );
    }
  }
  P.boxCol(0, 0.35, 1.6, 1.0, 2.6);
  return P.done();
}
