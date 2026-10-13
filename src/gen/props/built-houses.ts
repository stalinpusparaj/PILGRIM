/**
 * Three distinct crooked timber houses (GDD Ch I: "houses lean on each other"). All face +Z with the front door
 * on the +Z face; lit windows go into `glow`. Budget < 1500 triangles each.
 *  - house_a: tall, narrow and jettied; steep gable to the front; chimney on the slope.
 *  - house_b: wide low cottage; thatch or shingles with the ridge along X; end chimney and a lean-to shed.
 *  - house_c: a wobbly stack of three shrinking storeys under a crooked pyramid roof, with a balcony.
 * params (all): plaster, roof, door (#hex overrides).
 */
import { cone, jitter, paint, xform } from '../geom';
import type { Palette } from '../palette';
import type { Rng } from '../rng';
import type { PropParams, PropResult } from '../types';
import { beam, box, gem, hexParam, kit, lean, Parts, tone, type Kit } from './built-kit';
import { chimney, doorAt, flowerBox, gableRoof, roofHeightAt, storey, windowAt } from './built-house-kit';
import { barrelGeo } from './built-yard';

interface Look {
  plaster: string;
  roof: string;
  door: string;
  timber: string;
}

function look(rng: Rng, k: Kit, p: PropParams): Look {
  return {
    plaster: hexParam(p, 'plaster') ?? rng.pick(k.plaster),
    roof: hexParam(p, 'roof') ?? rng.pick(k.roof),
    door: hexParam(p, 'door') ?? rng.pick([k.gate, k.cloth[0] ?? k.gate, k.cloth[2] ?? k.wood, k.woodLight]),
    timber: tone(k.wood, 0.04, rng),
  };
}

/** Rotate (x, z) about Y by a (three.js convention). */
function rot(x: number, z: number, a: number): [number, number] {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c * x + s * z, -s * x + c * z];
}

function plinth(P: Parts, k: Kit, rng: Rng, w: number, d: number, rotY = 0): void {
  P.add(
    jitter(
      box(
        w + 0.3,
        0.34,
        d + 0.3,
        tone(k.stoneDark, 0.03, rng),
        { pos: [0, 0.05, 0], rot: [0, rotY, 0] },
        0.05,
      ),
      0.03,
      rng,
    ),
  );
}

export function buildHouseA(rng: Rng, pal: Palette, p: PropParams): PropResult {
  const k = kit(pal);
  const L = look(rng, k, p);
  const P = new Parts();
  const w = 3.5 + rng.range(-0.15, 0.25);
  const d = 3.8 + rng.range(-0.15, 0.2);
  const h1 = 2.6;
  const h2 = 2.3;
  const base = 0.22;
  const kx1 = rng.range(0.015, 0.04) * rng.sign();
  plinth(P, k, rng, w, d);

  const s1 = storey(rng, { w, d, h: h1, plaster: L.plaster, timber: L.timber, braces: true });
  doorAt(s1, k, rng, -w * 0.18, d, L.door);
  windowAt(s1, k, rng, 'front', w, d, w * 0.27, 1.45);
  windowAt(s1, k, rng, 'left', w, d, 0, 1.4);
  windowAt(s1, k, rng, 'right', w, d, 0.3, 1.4, { shutter: true });
  P.absorb(s1, { pos: [0, base, 0], lean: [kx1, 0] });

  // Jettied upper storey: wider, overhanging the front, twisted and leaning a little further.
  const w2 = w + 0.3;
  const d2 = d + 0.35;
  const rot2 = rng.range(-0.05, 0.05);
  const kx2 = kx1 + Math.sign(kx1) * rng.range(0.01, 0.03);
  const x2 = kx1 * h1;
  const y2 = base + h1;
  const s2 = storey(rng, {
    w: w2,
    d: d2,
    h: h2,
    plaster: tone(L.plaster, 0.03, rng),
    timber: L.timber,
    braces: true,
  });
  windowAt(s2, k, rng, 'front', w2, d2, -w2 * 0.24, 1.2);
  windowAt(s2, k, rng, 'front', w2, d2, w2 * 0.24, 1.2, { shutter: rng.chance(0.5) });
  windowAt(s2, k, rng, 'left', w2, d2, -0.4, 1.2);
  windowAt(s2, k, rng, 'right', w2, d2, 0.4, 1.2);
  windowAt(s2, k, rng, 'back', w2, d2, 0, 1.2, { lit: 0.5 });
  P.absorb(s2, { pos: [x2, y2, 0.12], rotY: rot2, lean: [kx2, 0] });

  // Steep gable to the front, a little round window in it and a chimney on the right slope.
  const ro = { w: w2, d: d2, pitch: 0.92, over: 0.35, rows: 3, thick: 0.16, color: L.roof, gable: L.plaster };
  const roof = gableRoof(rng, k, ro);
  const ridge = roofHeightAt(ro, 0);
  windowAt(roof, k, rng, 'front', w2, d2, 0, ridge * 0.36, { ww: 0.38, wh: 0.42, sill: false });
  const cx = w2 / 2 - 0.8;
  const cy = roofHeightAt(ro, cx) - 0.3;
  roof.absorb(chimney(rng, k, ridge + 0.75 - cy), {
    pos: [cx, cy, -d2 * 0.2],
    lean: [rng.range(-0.04, 0.04), 0],
  });
  const [ox, oz] = rot(kx2 * h2, 0, rot2);
  P.absorb(roof, { pos: [x2 + ox, y2 + h2, 0.12 + oz], rotY: rot2 });

  P.boxCol(x2 / 2, 0, w + 0.3, base + h1 + h2, d + 0.3);
  return P.done();
}

export function buildHouseB(rng: Rng, pal: Palette, p: PropParams): PropResult {
  const k = kit(pal);
  const L = look(rng, k, p);
  const P = new Parts();
  const w = 5.4 + rng.range(-0.2, 0.3);
  const d = 3.6 + rng.range(-0.1, 0.2);
  const h = 2.45;
  const base = 0.22;
  const kx = rng.range(-0.03, 0.03);
  const kz = rng.range(0.01, 0.035) * rng.sign();
  plinth(P, k, rng, w, d);

  const s = storey(rng, { w, d, h, plaster: L.plaster, timber: L.timber, braces: false });
  doorAt(s, k, rng, -0.45, d, L.door);
  windowAt(s, k, rng, 'front', w, d, -1.75, 1.4);
  windowAt(s, k, rng, 'front', w, d, 1.05, 1.4, { shutter: true });
  flowerBox(s, k, rng, 1.05, 0.9, d / 2 + 0.03);
  windowAt(s, k, rng, 'back', w, d, 0.8, 1.4, { lit: 0.6 });
  windowAt(s, k, rng, 'back', w, d, -1.4, 1.4, { lit: 0.6 });
  P.absorb(s, { pos: [0, base, 0], lean: [kx, kz] });

  // Ridge along X: build across the depth and turn it a quarter. Thatch half the time.
  const thatch = rng.chance(0.5);
  const ro = thatch
    ? {
        w: d,
        d: w,
        pitch: 0.78,
        over: 0.45,
        rows: 2,
        thick: 0.3,
        color: k.straw,
        gable: L.plaster,
        bevel: 0.08,
        roundRidge: true,
      }
    : { w: d, d: w, pitch: 0.66, over: 0.4, rows: 3, thick: 0.15, color: L.roof, gable: L.plaster };
  const roof = gableRoof(rng, k, ro);
  const ridge = roofHeightAt(ro, 0);
  windowAt(roof, k, rng, 'front', d, w, 0, ridge * 0.35, { ww: 0.34, wh: 0.36, sill: false, lit: 0.7 });
  P.absorb(roof, { pos: [kx * h, base + h, kz * h], rotY: Math.PI / 2 });

  // Tall end chimney against the left gable, from the ground up.
  const ch = base + h + ridge + 0.9;
  P.absorb(chimney(rng, k, ch, 0.78), { pos: [-(w / 2 + 0.36), 0, 0.3], lean: [-0.015, 0] });
  P.boxCol(-(w / 2 + 0.36), 0.3, 0.9, ch, 0.9);

  // Lean-to shed on the right with a mono-pitch roof and a barrel.
  const sw = 1.5;
  const sd = 2.4;
  const sh = 1.7;
  const sx = w / 2 + sw / 2 + 0.06;
  const sz = -0.3;
  P.add(jitter(box(sw, sh, sd, tone(k.woodLight, 0.04, rng), { pos: [sx, sh / 2, sz] }, 0.03), 0.02, rng));
  for (let i = 0; i < 3; i++)
    P.add(
      box(0.04, sh - 0.1, 0.03, k.woodDark, {
        pos: [sx - sw / 2 + 0.38 * (i + 1), sh / 2, sz + sd / 2 + 0.01],
      }),
    );
  P.add(
    box(
      sw + 0.5,
      0.12,
      sd + 0.4,
      tone(L.roof, 0.04, rng),
      { pos: [sx + 0.05, sh + 0.32, sz], rot: [0, 0, -0.36] },
      0.03,
    ),
  );
  P.add(xform(barrelGeo(rng, k, 0.85), { pos: [sx + 0.2, 0, sz + sd / 2 + 0.45] }));
  P.boxCol(sx, sz, sw, sh, sd);
  P.cylCol(sx + 0.2, sz + sd / 2 + 0.45, 0.35, 0.8);

  P.boxCol(0, 0, w + 0.3, base + h, d + 0.3);
  return P.done();
}

export function buildHouseC(rng: Rng, pal: Palette, p: PropParams): PropResult {
  const k = kit(pal);
  const L = look(rng, k, p);
  const P = new Parts();
  const ws = [3.3, 3.0, 2.6].map((v) => v + rng.range(-0.1, 0.1));
  const ds = [3.2, 2.9, 2.5].map((v) => v + rng.range(-0.1, 0.1));
  const hs = [2.5, 2.2, 1.95];
  const dir = rng.sign();
  const rot0 = rng.range(-0.06, 0.06);
  plinth(P, k, rng, ws[0]!, ds[0]!, rot0);
  let x = 0;
  let y = 0.22;
  let z = 0;
  let r = 0;
  for (let i = 0; i < 3; i++) {
    const w = ws[i]!;
    const d = ds[i]!;
    const h = hs[i]!;
    r = i === 0 ? rot0 : rng.range(-0.1, 0.1);
    const kx = (i % 2 === 0 ? 1 : -1) * dir * rng.range(0.03, 0.06);
    const kz = rng.range(-0.02, 0.02);
    const S = storey(rng, {
      w,
      d,
      h,
      plaster: tone(L.plaster, 0.03, rng),
      timber: L.timber,
      braces: i !== 1,
    });
    if (i === 0) {
      doorAt(S, k, rng, w * 0.15, d, L.door);
      windowAt(S, k, rng, 'front', w, d, -w * 0.27, 1.4);
      windowAt(S, k, rng, 'left', w, d, 0.2, 1.4);
      windowAt(S, k, rng, 'right', w, d, -0.2, 1.4, { shutter: true });
    } else if (i === 1) {
      windowAt(S, k, rng, 'front', w, d, -w * 0.22, 1.15, { shutter: true });
      windowAt(S, k, rng, 'front', w, d, w * 0.22, 1.15, { sill: false });
      windowAt(S, k, rng, 'right', w, d, 0, 1.15, { sill: false });
      // Little balcony with three balusters.
      const bz = d / 2 + 0.3;
      S.add(box(1.3, 0.1, 0.55, L.timber, { pos: [w * 0.22, 0.05, bz - 0.02] }));
      for (const bx of [-0.55, 0, 0.55])
        S.add(box(0.06, 0.55, 0.06, k.woodLight, { pos: [w * 0.22 + bx, 0.35, bz + 0.2] }));
      S.add(box(1.3, 0.07, 0.08, k.woodLight, { pos: [w * 0.22, 0.65, bz + 0.2] }));
      S.absorb(chimney(rng, k, hs[2]! + 2.7, 0.55), { pos: [w / 2 + 0.3, 0, -0.35], lean: [0.05 * dir, 0] });
    } else {
      windowAt(S, k, rng, 'front', w, d, 0, 1.0, { ww: 0.5, wh: 0.55, sill: false });
      windowAt(S, k, rng, 'left', w, d, 0, 1.0, { sill: false, lit: 0.6 });
    }
    P.absorb(S, { pos: [x, y, z], rotY: r, lean: [kx, kz] });
    if (i === 0) P.boxCol(0, 0, w + 0.3, 0.22 + h, d + 0.3, rot0);
    const [ox, oz] = rot(kx * h, kz * h, r);
    x += ox;
    z += oz;
    y += h;
  }

  // Crooked pyramid roof on a chunky eave slab, with a finial.
  const w = ws[2]! + 0.7;
  const d = ds[2]! + 0.7;
  const R = new Parts();
  R.add(box(w, 0.14, d, tone(L.roof, 0.04, rng), { pos: [0, 0.07, 0] }, 0.03));
  const hip = xform(paint(cone((w / 2) * Math.SQRT2, 2.5, 4), L.roof), {
    pos: [0, 0.12, 0],
    rot: [0, Math.PI / 4, 0],
  });
  xform(hip, { scale: [1, 1, d / w] });
  R.add(lean(hip, 0.1 * dir, 0.03));
  R.add(beam([0.25 * dir, 2.55, 0.075], [0.3 * dir, 3.05, 0.09], 0.06, k.woodDark));
  R.add(gem(0.12, k.gold, { pos: [0.3 * dir, 3.1, 0.09] }));
  P.absorb(R, { pos: [x, y, z], rotY: r });
  return P.done();
}
