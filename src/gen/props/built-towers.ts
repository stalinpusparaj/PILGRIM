/**
 * Big silhouettes: the gentle palace tower (GDD Ch VII, palace #F4EEE2 with blue roofs #6C8FB3), the dark
 * gloomy castle tower (Ch IV, XI) and the huge leaning mountain of Ch III (very low triangle count).
 */
import * as THREE from 'three';
import { cone, jitter, lathe, paint, xform } from '../geom';
import { mix, shade, type Palette } from '../palette';
import type { Rng } from '../rng';
import type { PropParams, PropResult } from '../types';
import {
  arc,
  bool,
  box,
  gem,
  hexParam,
  kit,
  num,
  Parts,
  rod,
  slab,
  speckle,
  tone,
  type Geo,
  type Pt,
} from './built-kit';
import { pennant } from './built-gates';

/** Unit vector pointing out of a round tower at angle `a` (0 = +Z, the front). */
function around(a: number, r: number, y: number): { pos: [number, number, number]; rotY: number } {
  return { pos: [Math.sin(a) * r, y, Math.cos(a) * r], rotY: a };
}

/** params: height (12), radius (2.2). Round tower with arched glowing windows and a flared blue spire. */
export function buildPalaceTower(rng: Rng, pal: Palette, p: PropParams): PropResult {
  const k = kit(pal);
  const P = new Parts();
  const H = num(p, 'height', 12, 6, 30);
  const R = num(p, 'radius', 2.2, 1.2, 5);
  const wall = k.palace;
  const roof = k.palaceRoof;
  const trim = shade(wall, -0.07);
  const radial = 10;
  const top = H * 0.86;
  P.add(
    paint(
      lathe(
        [
          [R + 0.4, -0.1],
          [R + 0.3, 0.55],
          [R, 0.7],
        ],
        radial,
      ),
      trim,
    ),
  );
  P.add(
    paint(
      lathe(
        [
          [R, 0.6],
          [R * 0.94, H * 0.72],
        ],
        radial,
      ),
      speckle([wall, tone(wall, 0.03, rng)]),
    ),
  );
  P.add(rod(R * 0.97 + 0.12, R * 0.97 + 0.12, 0.26, trim, { pos: [0, H * 0.45, 0] }, radial));
  P.add(
    paint(
      lathe(
        [
          [R * 0.94, H * 0.72],
          [R * 1.12, H * 0.76],
          [R * 1.12, top],
          [R * 0.9, top],
        ],
        radial,
      ),
      (c) => (c.y < H * 0.755 ? trim : wall),
    ),
  );
  // Flared spire with alternating tile bands.
  const spire = lathe(
    [
      [R * 1.32, top],
      [R * 1.02, top + 0.55],
      [R * 0.56, top + 2.0],
      [0, top + 4.6],
    ],
    radial,
  );
  P.add(paint(spire, (c) => (Math.floor((c.y - top) / 0.7) % 2 === 0 ? roof : shade(roof, 0.06))));
  pennant(P, rng, [0, top + 4.45, 0], 1.6, k.gold, k);
  // Windows: frame, warm pane and a little pointed hood, in two rows plus the gallery.
  const rows: Array<[number, number[]]> = [
    [H * 0.3, [0.5, -0.5, Math.PI / 2 + 0.3]],
    [H * 0.58, [0, 1.3, -1.3]],
    [H * 0.81, [0.35, -0.35]],
  ];
  for (const [y, angles] of rows) {
    const r = y < H * 0.72 ? R - (R * 0.06 * (y - 0.6)) / (H * 0.72 - 0.6) : R * 1.12;
    for (const a of angles) {
      const W = new Parts();
      W.add(box(0.62, 0.95, 0.1, roof, {}));
      W.glow(box(0.42, 0.72, 0.08, k.windowGlow, { pos: [0, -0.04, 0.03] }));
      const hood = xform(paint(cone(0.42, 0.34, 4), roof), { rot: [0, Math.PI / 4, 0] });
      W.add(xform(hood, { pos: [0, 0.47, 0.02], scale: [1, 1, 0.35] }));
      P.absorb(W, around(a, r + 0.01, y));
    }
  }
  // Arched front door with a blue frame.
  const door: Pt[] = [[-0.55, 0], [0.55, 0], ...arc(0, 1.5, 0.55, 0.45, 0, Math.PI, 5)];
  P.add(slab(door, 0.16, roof, { pos: [0, 0.55, R - 0.02], scale: [1.25, 1.1, 1] }));
  P.add(slab(door, 0.2, tone(k.wood, 0.03, rng), { pos: [0, 0.55, R + 0.02] }));
  P.add(gem(0.06, k.brass, { pos: [0.3, 1.3, R + 0.13] }));
  P.cylCol(0, 0, R + 0.35, H);
  return P.done();
}

/** params: height (16), radius (3), glow (false: dim ember slits). A crooked, dark tower for silhouettes. */
export function buildCastleTower(rng: Rng, pal: Palette, p: PropParams): PropResult {
  const k = kit(pal);
  const P = new Parts();
  const H = num(p, 'height', 16, 6, 40);
  const R = num(p, 'radius', 3, 1.5, 8);
  const lit = bool(p, 'glow', false);
  const c = k.castle;
  const tones = [c, shade(c, -0.04), shade(c, 0.04)];
  const body = lathe(
    [
      [R * 1.18, -0.3],
      [R, H * 0.16],
      [R * 0.86, H * 0.82],
    ],
    6,
  );
  P.add(jitter(paint(body, speckle(tones)), R * 0.05, rng));
  const corbel = lathe(
    [
      [R * 0.86, H * 0.82],
      [R * 1.06, H * 0.86],
      [R * 1.06, H * 0.9],
      [R * 0.78, H * 0.9],
    ],
    6,
  );
  P.add(jitter(paint(corbel, shade(c, 0.03)), R * 0.03, rng));
  for (let i = 0; i < 6; i++) {
    if (rng.chance(0.15)) continue; // a broken merlon or two
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    P.add(
      box(R * 0.42, R * 0.32, 0.5, tone(c, 0.04, rng), {
        pos: [Math.sin(a) * R * 0.92, H * 0.9 + R * 0.16, Math.cos(a) * R * 0.92],
        rot: [0, a, rng.range(-0.06, 0.06)],
      }),
    );
  }
  // A crooked turret with a sharp hat, leaning off one shoulder.
  const T = new Parts();
  T.add(rod(R * 0.36, R * 0.42, H * 0.22, speckle(tones), {}, 6));
  T.add(xform(paint(cone(R * 0.55, H * 0.24, 6), shade(c, -0.08)), { pos: [0, H * 0.22, 0] }));
  P.absorb(T, { pos: [R * 0.32, H * 0.88, -R * 0.25], lean: [0.12 * rng.sign(), 0.05] });
  // Narrow slits on the front; dark, or a dim ember glow.
  const slit = lit ? (pal.accents.embers ?? pal.accents.fire ?? '#B5523B') : k.hollow;
  for (let i = 0; i < 4; i++) {
    const a = rng.range(-0.7, 0.7);
    const y = H * (0.25 + i * 0.15) + rng.range(-0.4, 0.4);
    const r = R - (R * 0.14 * (y - H * 0.16)) / (H * 0.66) - 0.05;
    const g = box(0.26, 1.1, 0.4, slit, { rot: [0, a, 0], pos: [Math.sin(a) * r, y, Math.cos(a) * r] });
    if (lit) P.glow(g);
    else P.add(g);
  }
  pennant(P, rng, [-R * 0.4, H * 0.9 + 0.2, R * 0.3], 2.4, shade(c, -0.1), k);
  P.cylCol(0, 0, R * 1.15, H);
  return P.done();
}

/** Bend a geometry so it leans further the higher it goes: z += lean·H·(y/H)². */
function overhang(g: Geo, lean: number, H: number): Geo {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const t = Math.max(0, pos.getY(i)) / H;
    pos.setZ(i, pos.getZ(i) + lean * H * t * t);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/**
 * params: height (90), radius (45), lean (0.35), color (#hex). A huge faceted mountain that leans out over +Z,
 * plus a lower shoulder peak. About 90 triangles.
 */
export function buildMountainPeak(rng: Rng, pal: Palette, p: PropParams): PropResult {
  const k = kit(pal);
  const P = new Parts();
  const H = num(p, 'height', 90, 10, 300);
  const R = num(p, 'radius', 45, 5, 200);
  const leanK = num(p, 'lean', 0.35, -1, 1);
  const base = hexParam(p, 'color') ?? k.mountain;
  const low = shade(base, -0.05);
  const high = mix(base, pal.sky.horizon, 0.18);
  const under = shade(base, -0.12);
  const mid = speckle([base, tone(base, 0.05, rng), shade(base, 0.03)]);
  const painter = (c: THREE.Vector3, n: THREE.Vector3): string => {
    if (n.y < -0.05) return under;
    const t = c.y / H;
    return t < 0.3 ? low : t > 0.7 ? high : mid(c);
  };
  const main = lathe(
    [
      [R, -2],
      [R * 0.72, H * 0.3],
      [R * 0.42, H * 0.65],
      [R * 0.13, H * 0.92],
      [0, H],
    ],
    7,
  );
  jitter(main, R * 0.07, rng);
  overhang(main, leanK, H);
  P.add(paint(main, painter));
  const h2 = H * 0.55;
  const shoulder = lathe(
    [
      [R * 0.5, -2],
      [R * 0.32, h2 * 0.5],
      [0, h2],
    ],
    6,
  );
  jitter(shoulder, R * 0.05, rng);
  overhang(shoulder, leanK * 0.6, H);
  P.add(
    xform(paint(shoulder, painter), {
      pos: [R * 0.55 * rng.sign(), 0, -R * 0.3],
      rot: [0, rng.range(0, 1), 0],
    }),
  );
  P.cylCol(0, 0, R * 0.8, H * 0.5);
  return P.done();
}
