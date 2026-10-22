/**
 * Fair and street props: striped market stall (GDD Ch X), iron cage (Ch V, X), flag, signpost, lamp and
 * candles. Facing +Z, standing on y = 0. Flames, lantern panes and other light sources go into `glow`.
 */
import { cone, lowSphere, paint, xform, type Vec3 } from '../geom';
import type { Palette } from '../palette';
import type { Rng } from '../rng';
import type { PropParams, PropResult } from '../types';
import {
  beam,
  bool,
  box,
  flame,
  gem,
  hexParam,
  kit,
  num,
  Parts,
  rod,
  slab,
  str,
  tone,
  type Kit,
  type Pt,
} from './built-kit';

const CREAM = '#F6EEDC';

/** Goods laid out on a counter top at height y (z = counter centre). */
function goods(P: Parts, rng: Rng, k: Kit, kind: string, w: number, y: number, z: number): void {
  const n = Math.max(2, Math.floor(w / 0.75));
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + (w * (i + 0.5)) / n + rng.range(-0.08, 0.08);
    const c = rng.pick(k.cloth);
    if (kind === 'fruit') {
      P.add(rod(0.2, 0.15, 0.12, k.straw, { pos: [x, y, z] }, 6));
      for (let j = 0; j < 3; j++) {
        const fruit = rng.pick(['#D9483B', '#F2A33A', '#9CC94A', '#F2D04A']);
        const a = (j / 3) * Math.PI * 2 + rng.range(-0.3, 0.3);
        P.add(
          xform(paint(lowSphere(0.085, 0), fruit), {
            pos: [x + Math.cos(a) * 0.08, y + 0.16, z + Math.sin(a) * 0.08],
          }),
        );
      }
    } else if (kind === 'sweets') {
      P.add(rod(0.11, 0.12, 0.26, CREAM, { pos: [x, y, z] }, 6));
      P.add(rod(0.07, 0.07, 0.06, c, { pos: [x, y + 0.26, z] }, 6));
      for (let j = 0; j < 3; j++)
        P.add(gem(0.06, rng.pick(k.blossom), { pos: [x + rng.range(-0.25, 0.25), y + 0.05, z + 0.2] }));
    } else if (kind === 'hats') {
      P.add(rod(0.2, 0.2, 0.03, c, { pos: [x, y, z] }, 8));
      P.add(
        xform(paint(cone(0.12, 0.26, 6), tone(c, 0.08, rng)), {
          pos: [x, y + 0.03, z],
          rot: [rng.range(-0.2, 0.2), 0, rng.range(-0.2, 0.2)],
        }),
      );
    } else {
      P.add(box(0.22, 0.14, 0.18, c, { pos: [x, y + 0.07, z], rot: [0, rng.range(-0.4, 0.4), 0] }, 0.02));
      P.add(gem(0.07, k.gold, { pos: [x + 0.18, y + 0.07, z + 0.12] }));
    }
  }
}

/**
 * params: width (2.6), depth (1.5), colorA / colorB (#hex stripes), goods ('fruit'|'sweets'|'hats'|'trinkets').
 */
export function buildStall(rng: Rng, pal: Palette, p: PropParams): PropResult {
  const k = kit(pal);
  const P = new Parts();
  const W = num(p, 'width', 2.6, 1.4, 5);
  const D = num(p, 'depth', 1.5, 1, 3);
  const cA = hexParam(p, 'colorA') ?? hexParam(p, 'color') ?? rng.pick(k.cloth);
  const cB = hexParam(p, 'colorB') ?? CREAM;
  const cz = D / 2 - 0.3;
  P.add(box(W, 0.95, 0.6, tone(k.wood, 0.04, rng), { pos: [0, 0.475, cz] }, 0.03));
  P.add(box(W + 0.12, 0.08, 0.72, tone(k.woodLight, 0.04, rng), { pos: [0, 0.99, cz] }, 0.02));
  const n = Math.max(3, Math.round(W / 0.42));
  const sw = W / n;
  for (let i = 0; i < n; i++) {
    P.add(box(sw, 0.72, 0.02, i % 2 === 0 ? cA : cB, { pos: [-W / 2 + sw * (i + 0.5), 0.5, cz + 0.31] }));
  }
  const front = 2.0;
  const back = 2.45;
  for (const sx of [-1, 1]) {
    P.add(
      box(0.1, front, 0.1, k.woodDark, {
        pos: [sx * (W / 2 - 0.05), front / 2, D / 2 - 0.05],
        rot: [0, 0, rng.range(-0.02, 0.02)],
      }),
    );
    P.add(box(0.1, back, 0.1, k.woodDark, { pos: [sx * (W / 2 - 0.05), back / 2, -D / 2 + 0.05] }));
  }
  // Sloping striped awning that reaches out over the customer, with a scalloped valance.
  const reach = 0.45;
  const run = D + reach;
  const drop = back - front + 0.1;
  const len = Math.hypot(run, drop);
  const tilt = Math.atan2(drop, run);
  const mz = (-D / 2 + D / 2 + reach) / 2;
  const my = (back + 0.05 + front - 0.05) / 2;
  for (let i = 0; i < n; i++) {
    const x = -W / 2 + sw * (i + 0.5);
    P.add(box(sw + 0.01, 0.04, len, i % 2 === 0 ? cA : cB, { pos: [x, my + 0.04, mz], rot: [tilt, 0, 0] }));
    const flap: Pt[] = [
      [-sw / 2, 0],
      [sw / 2, 0],
      [sw * 0.32, -0.24],
      [-sw * 0.32, -0.24],
    ];
    P.add(
      slab(flap, 0.03, i % 2 === 0 ? cB : cA, {
        pos: [x, front - 0.04, D / 2 + reach],
        rot: [rng.range(-0.06, 0.06), 0, 0],
      }),
    );
  }
  goods(P, rng, k, str(p, 'goods', rng.pick(['fruit', 'sweets', 'hats', 'trinkets'])), W - 0.3, 1.03, cz);
  P.boxCol(0, 0, W + 0.12, 1.05, D);
  return P.done();
}

/** params: width (2), height (2.4), open (false). Iron cage with square bars, a floor plate and a pointed top. */
export function buildCage(rng: Rng, pal: Palette, p: PropParams): PropResult {
  const k = kit(pal);
  const P = new Parts();
  const W = num(p, 'width', 2, 1.2, 4);
  const H = num(p, 'height', 2.4, 1.5, 4);
  const open = bool(p, 'open', false);
  const iron = k.iron;
  const h = W / 2;
  P.add(box(W + 0.3, 0.2, W + 0.3, tone(k.stoneDark, 0.03, rng), { pos: [0, 0.08, 0] }, 0.04));
  P.add(box(W, 0.06, W, iron, { pos: [0, 0.21, 0] }));
  P.add(box(W + 0.12, 0.1, W + 0.12, iron, { pos: [0, H, 0] }));
  P.add(
    xform(paint(cone(h * 1.15, 0.6, 4), tone(iron, 0.04, rng)), {
      pos: [0, H + 0.05, 0],
      rot: [0, Math.PI / 4, 0],
    }),
  );
  P.add(gem(0.1, k.brass, { pos: [0, H + 0.7, 0] }));
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) P.add(box(0.1, H - 0.2, 0.1, iron, { pos: [sx * h, H / 2 + 0.1, sz * h] }));
  const bars = Math.max(3, Math.round(W / 0.3) - 1);
  const dw = 0.8;
  const barH = H - 0.24;
  // Sides: rotation of the "front" layout around the cage; the front (+Z) leaves room for the door.
  for (let side = 0; side < 4; side++) {
    const a = (side * Math.PI) / 2;
    const S = new Parts();
    for (let i = 1; i <= bars; i++) {
      const x = -h + (W * i) / (bars + 1);
      if (side === 0 && Math.abs(x) < dw / 2) continue;
      S.add(
        box(0.05, barH, 0.05, iron, { pos: [x, 0.24 + barH / 2, h], rot: [0, 0, rng.range(-0.012, 0.012)] }),
      );
    }
    S.add(box(W, 0.07, 0.07, iron, { pos: [0, H * 0.55, h] }));
    P.absorb(S, { rotY: a });
  }
  // Door leaf, hinged on its left edge.
  const D = new Parts();
  D.add(
    box(0.07, barH, 0.07, iron, { pos: [0.035, barH / 2, 0] }),
    box(0.07, barH, 0.07, iron, { pos: [dw - 0.035, barH / 2, 0] }),
  );
  D.add(
    box(dw, 0.07, 0.07, iron, { pos: [dw / 2, 0.1, 0] }),
    box(dw, 0.07, 0.07, iron, { pos: [dw / 2, barH - 0.1, 0] }),
  );
  for (const fx of [0.33, 0.66]) D.add(box(0.05, barH, 0.05, iron, { pos: [dw * fx, barH / 2, 0] }));
  D.add(box(0.16, 0.2, 0.08, k.brass, { pos: [dw - 0.08, barH * 0.5, 0.05] }));
  const doorA = open ? -(Math.PI / 2 + 0.2) : 0;
  P.absorb(D, { pos: [-dw / 2, 0.24, h], rotY: doorA });
  P.boxCol(0, -h, W + 0.1, H, 0.14);
  P.boxCol(-h, 0, 0.14, H, W + 0.1);
  P.boxCol(h, 0, 0.14, H, W + 0.1);
  const sideW = h - dw / 2;
  P.boxCol(-(h - sideW / 2), h, sideW, H, 0.14);
  P.boxCol(h - sideW / 2, h, sideW, H, 0.14);
  if (!open) P.boxCol(0, h, dw, H, 0.14);
  return P.done();
}

/** params: height (3.6), color / colorB (#hex). Pole with a two-part swallow-tail banner. */
export function buildFlag(rng: Rng, pal: Palette, p: PropParams): PropResult {
  const k = kit(pal);
  const P = new Parts();
  const H = num(p, 'height', 3.6, 1.5, 10);
  const cA = hexParam(p, 'color') ?? rng.pick(k.cloth);
  const cB = hexParam(p, 'colorB') ?? CREAM;
  P.add(box(0.42, 0.3, 0.42, tone(k.stone, 0.04, rng), { pos: [0, 0.12, 0] }, 0.04));
  P.add(rod(0.045, 0.065, H, k.woodDark, { pos: [0, 0, 0] }, 6));
  P.add(gem(0.09, k.gold, { pos: [0, H + 0.05, 0] }));
  const top = H - 0.1;
  const a1 = rng.range(0.2, 0.4);
  const a2 = a1 - rng.range(0.4, 0.7);
  const s = H / 3.6;
  const seg1: Pt[] = [
    [0, 0],
    [0.75 * s, -0.04 * s],
    [0.75 * s, -0.6 * s],
    [0, -0.66 * s],
  ];
  P.add(slab(seg1, 0.03, cA, { pos: [0, top, 0], rot: [0, a1, 0] }));
  P.add(
    slab(
      [
        [0, -0.26 * s],
        [0.75 * s, -0.27 * s],
        [0.75 * s, -0.37 * s],
        [0, -0.4 * s],
      ],
      0.04,
      cB,
      { pos: [0, top, 0], rot: [0, a1, 0] },
    ),
  );
  const ex = Math.cos(a1) * 0.75 * s;
  const ez = -Math.sin(a1) * 0.75 * s;
  const seg2: Pt[] = [
    [0, -0.04 * s],
    [0.6 * s, 0],
    [0.38 * s, -0.3 * s],
    [0.6 * s, -0.62 * s],
    [0, -0.6 * s],
  ];
  P.add(slab(seg2, 0.03, tone(cA, 0.05, rng), { pos: [ex, top, ez], rot: [0, a2, 0] }));
  P.cylCol(0, 0, 0.24, H);
  return P.done();
}

/** params: arrows (0..3; 0 = notice board with a little roof). Text is never rendered on the boards. */
export function buildSign(rng: Rng, pal: Palette, p: PropParams): PropResult {
  const k = kit(pal);
  const P = new Parts();
  const arrows = Math.round(num(p, 'arrows', rng.int(1, 2), 0, 3));
  const H = arrows === 0 ? 1.7 : 2.1;
  const lean0 = rng.range(-0.04, 0.04);
  const S = new Parts();
  S.add(box(0.13, H, 0.13, tone(k.wood, 0.04, rng), { pos: [0, H / 2, 0] }, 0.02));
  S.add(xform(paint(cone(0.11, 0.14, 4), k.woodDark), { pos: [0, H, 0], rot: [0, Math.PI / 4, 0] }));
  if (arrows === 0) {
    S.add(box(1.0, 0.66, 0.07, tone(k.woodLight, 0.04, rng), { pos: [0, H - 0.4, 0.1] }, 0.02));
    for (let i = 0; i < 3; i++)
      S.add(box(0.6 - i * 0.12, 0.035, 0.02, k.woodDark, { pos: [-0.05 * i, H - 0.25 - i * 0.13, 0.145] }));
    for (const sx of [-1, 1])
      S.add(
        box(
          0.62,
          0.06,
          0.32,
          k.woodDark,
          { pos: [sx * 0.27, H + 0.08, 0.1], rot: [0, 0, -sx * 0.45] },
          0.015,
        ),
      );
  } else {
    const arrow: Pt[] = [
      [-0.45, -0.13],
      [0.3, -0.13],
      [0.47, 0],
      [0.3, 0.13],
      [-0.45, 0.13],
    ];
    for (let i = 0; i < arrows; i++) {
      const dir = i % 2 === 0 ? 1 : -1;
      const y = H - 0.32 - i * 0.34;
      const yaw = (dir === 1 ? 0 : Math.PI) + rng.range(-0.25, 0.25);
      const B = new Parts();
      B.add(slab(arrow, 0.06, tone(k.woodLight, 0.05, rng), { rot: [0, 0, rng.range(-0.05, 0.05)] }));
      B.add(
        box(0.42, 0.03, 0.02, k.woodDark, { pos: [-0.1, 0.03, 0.04] }),
        box(0.3, 0.03, 0.02, k.woodDark, { pos: [-0.16, -0.04, 0.04] }),
      );
      S.absorb(B, { pos: [Math.cos(yaw) * 0.3, y, -Math.sin(yaw) * 0.3 + 0.08], rotY: yaw });
    }
  }
  P.absorb(S, { lean: [lean0, 0] });
  P.cylCol(0, 0, 0.15, H);
  return P.done();
}

/** A small iron lantern with a glowing pane, centred on (x, y, z) (y = bottom plate). */
function lantern(P: Parts, k: Kit, x: number, y: number, z: number, lit = true): void {
  P.add(box(0.28, 0.04, 0.28, k.iron, { pos: [x, y, z] }));
  for (const cx of [-1, 1])
    for (const cz of [-1, 1])
      P.add(box(0.03, 0.32, 0.03, k.iron, { pos: [x + cx * 0.12, y + 0.17, z + cz * 0.12] }));
  P.add(xform(paint(cone(0.22, 0.18, 4), k.iron), { pos: [x, y + 0.32, z], rot: [0, Math.PI / 4, 0] }));
  P.add(gem(0.05, k.iron, { pos: [x, y + 0.53, z] }));
  const glass = box(0.2, 0.28, 0.2, lit ? k.windowGlow : k.iron, { pos: [x, y + 0.17, z] });
  if (lit) P.glow(glass);
  else P.add(glass);
}

/** params: height (2.6), style ('post' | 'hang'), lit (true: a dark lantern waits to be lit, Ch V). */
export function buildLamp(rng: Rng, pal: Palette, p: PropParams): PropResult {
  const k = kit(pal);
  const P = new Parts();
  const H = num(p, 'height', 2.6, 1.2, 5);
  const hang = str(p, 'style', 'post') === 'hang';
  const lit = bool(p, 'lit', true);
  P.add(box(0.4, 0.26, 0.4, tone(k.stone, 0.04, rng), { pos: [0, 0.1, 0] }, 0.04));
  P.add(
    rod(
      0.06,
      0.085,
      H,
      k.iron,
      { pos: [0, 0.2, 0], rot: [rng.range(-0.02, 0.02), 0, rng.range(-0.02, 0.02)] },
      6,
    ),
  );
  P.add(rod(0.1, 0.1, 0.1, k.iron, { pos: [0, 0.5, 0] }, 6));
  if (hang) {
    const top: Vec3 = [0, H + 0.2, 0];
    P.add(
      beam(top, [0.32, H + 0.32, 0], 0.05, k.iron),
      beam([0.32, H + 0.32, 0], [0.6, H + 0.22, 0], 0.05, k.iron),
    );
    P.add(box(0.02, 0.2, 0.02, k.iron, { pos: [0.6, H + 0.1, 0] }));
    lantern(P, k, 0.6, H - 0.48, 0, lit);
  } else {
    lantern(P, k, 0, H + 0.2, 0, lit);
  }
  P.cylCol(0, 0, 0.2, H + 0.6);
  return P.done();
}

/** params: count (1..5), height (0.25), stand (false: on a dish; true: on a tall iron stand). */
export function buildCandle(rng: Rng, pal: Palette, p: PropParams): PropResult {
  const k = kit(pal);
  const P = new Parts();
  const count = Math.round(num(p, 'count', 1, 1, 5));
  const H = num(p, 'height', 0.25, 0.08, 1);
  const stand = bool(p, 'stand', false);
  let y = 0;
  if (stand) {
    for (let i = 0; i < 3; i++) {
      const a = (i * Math.PI * 2) / 3 + 0.3;
      P.add(beam([0, 0.18, 0], [Math.cos(a) * 0.24, 0, Math.sin(a) * 0.24], 0.04, k.iron));
    }
    P.add(rod(0.025, 0.03, 1.1, k.iron, { pos: [0, 0.1, 0] }, 6));
    y = 1.18;
    P.cylCol(0, 0, 0.24, y + H);
  }
  P.add(rod(count > 1 ? 0.2 : 0.11, count > 1 ? 0.22 : 0.13, 0.03, k.brass, { pos: [0, y, 0] }, 8));
  for (let i = 0; i < count; i++) {
    const a = (i * Math.PI * 2) / Math.max(1, count - 1);
    const r = i === 0 || count === 1 ? 0 : 0.12;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const h = H * (i === 0 ? 1 : rng.range(0.55, 0.85));
    const rad = 0.03 + H * 0.06;
    P.add(rod(rad * 0.95, rad, h, tone(k.wax, 0.03, rng), { pos: [x, y + 0.03, z] }, 6));
    P.add(
      gem(rad * 0.38, k.wax, { pos: [x + rad * 0.85, y + 0.03 + h - rad * 0.3, z], scale: [0.8, 1.2, 0.8] }),
    );
    const top = y + 0.03 + h;
    P.add(box(0.01, 0.03, 0.01, k.hollow, { pos: [x, top + 0.012, z] }));
    flame(P, k, x, top + 0.02, z, rad * 0.55);
  }
  return P.done();
}
