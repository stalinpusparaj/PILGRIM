/**
 * Gates: the town gate in a wall section (GDD Ch I, X) and the small wooden wicket gate in a high wall (Ch IV).
 * Both run along X, centred on the origin, facing +Z; the Way passes through along Z.
 */
import { cone, jitter, paint, xform, type Vec3 } from '../geom';
import type { Palette } from '../palette';
import type { Rng } from '../rng';
import type { PropParams, PropResult } from '../types';
import {
  arc,
  beam,
  bool,
  box,
  flame,
  gem,
  kit,
  num,
  Parts,
  rod,
  slab,
  tone,
  type Kit,
  type Pt,
} from './built-kit';
import { wallRun } from './built-walls';

/** Hinged leaf of planks with iron bands, built with its hinge at x = 0 extending towards +x·dir. */
function leaf(k: Kit, rng: Rng, w: number, h: number, dir: 1 | -1, color: string): Parts {
  const L = new Parts();
  L.add(box(w, h, 0.12, tone(color, 0.03, rng), { pos: [(dir * w) / 2, h / 2, 0] }, 0.02));
  L.add(box(0.03, h - 0.1, 0.03, k.woodDark, { pos: [(dir * w) / 2, h / 2, 0.065] }));
  for (const fy of [0.22, 0.78])
    L.add(box(w * 0.92, 0.1, 0.03, k.iron, { pos: [(dir * w) / 2, h * fy, 0.075] }));
  return L;
}

/** Wall-mounted torch: bracket, cup and a glowing flame. */
function torch(P: Parts, k: Kit, x: number, y: number, z: number): void {
  P.add(beam([x, y - 0.25, z], [x, y, z + 0.28], 0.06, k.iron));
  P.add(gem(0.1, k.iron, { pos: [x, y - 0.02, z + 0.28], scale: [1, 0.6, 1] }));
  flame(P, k, x, y + 0.02, z + 0.28, 0.07);
}

/** Pennant on a pole (shared with towers). */
export function pennant(P: Parts, rng: Rng, base: Vec3, h: number, color: string, k: Kit): void {
  P.add(rod(0.04, 0.05, h, k.woodDark, { pos: base }, 5));
  P.add(gem(0.07, k.gold, { pos: [base[0], base[1] + h + 0.04, base[2]] }));
  const top = base[1] + h - 0.08;
  const a = rng.range(0.15, 0.35);
  const fly: Pt[] = [
    [0, -0.42],
    [0.55, -0.32],
    [0.55, -0.08],
    [0, 0],
  ];
  P.add(slab(fly, 0.03, color, { pos: [base[0], top, base[2]], rot: [0, a, 0] }));
  const ex = base[0] + Math.cos(a) * 0.55;
  const ez = base[2] - Math.sin(a) * 0.55;
  const tip: Pt[] = [
    [0, -0.32],
    [0.5, -0.2],
    [0, -0.08],
  ];
  P.add(
    slab(tip, 0.03, tone(color, 0.06, rng), { pos: [ex, top, ez], rot: [0, a - rng.range(0.35, 0.6), 0] }),
  );
}

/** Rotate a local (x, z) offset about Y by `a` (three.js convention) and add it to a hinge point. */
function swing(hx: number, hz: number, lx: number, lz: number, a: number): [number, number] {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [hx + c * lx + s * lz, hz - s * lx + c * lz];
}

/** params: width (opening 3.4), height (wall 3.2), length (12; total incl. towers), open (true). */
export function buildGate(rng: Rng, pal: Palette, p: PropParams): PropResult {
  const k = kit(pal);
  const P = new Parts();
  const w = num(p, 'width', 3.4, 2, 6);
  const h = num(p, 'height', 3.2, 2, 7);
  const open = bool(p, 'open', true);
  const tw = 1.9;
  const L = num(p, 'length', 12, 0, 80);
  const spring = Math.min(3, Math.max(2.2, h * 0.7));
  const rise = (w / 2) * 0.6;
  const top = Math.max(h, spring + rise + 0.45);
  const towerH = top + 1.3;
  const depth = tw - 0.25;

  // Flanking towers with crenellations, a warm window, a torch by the opening and a pennant.
  for (const sx of [-1, 1] as const) {
    const x = sx * (w / 2 + tw / 2);
    // Three big stone courses, each a little askew, read as chunky masonry from gameplay distance.
    const courses = 3;
    const ch = towerH / courses;
    for (let i = 0; i < courses; i++) {
      const c = box(tw + rng.range(-0.04, 0.06), ch, tw + rng.range(-0.04, 0.06), tone(k.wall, 0.06, rng), {
        pos: [x + rng.range(-0.03, 0.03), ch * (i + 0.5), rng.range(-0.03, 0.03)],
        rot: [0, rng.range(-0.025, 0.025), 0],
      });
      P.add(jitter(c, 0.03, rng));
    }
    P.add(box(tw + 0.3, 0.26, tw + 0.3, tone(k.stoneLight, 0.03, rng), { pos: [x, towerH + 0.13, 0] }));
    for (const cx of [-1, 1]) {
      for (const cz of [-1, 1]) {
        const m = box(0.5, 0.45, 0.5, tone(k.wall, 0.05, rng), {
          pos: [x + cx * (tw / 2 - 0.12), towerH + 0.48, cz * (tw / 2 - 0.12)],
        });
        P.add(m);
      }
    }
    P.add(box(0.5, 0.7, 0.06, k.woodDark, { pos: [x, towerH - 1.0, tw / 2 + 0.02] }));
    P.glow(box(0.36, 0.56, 0.05, k.windowGlow, { pos: [x, towerH - 1.0, tw / 2 + 0.04] }));
    torch(P, k, x - sx * (tw / 2 - 0.25), spring - 0.4, tw / 2);
    pennant(P, rng, [x, towerH + 0.26, 0], 1.4, rng.pick(k.cloth), k);
    P.boxCol(x, 0, tw + 0.1, towerH, tw + 0.1);
  }

  // Arch over the opening, with a ring of alternating voussoirs proud of the front face.
  const outline: Pt[] = [[-w / 2, top], ...arc(0, spring, w / 2, rise, Math.PI, 0, 8), [w / 2, top]];
  const archA = tone(k.wall, 0.03, rng);
  const archB = k.stoneLight;
  const voussoir = (c: { x: number; y: number }): string =>
    Math.floor((Math.atan2((c.y - spring) / rise, c.x / (w / 2)) / Math.PI) * 7) % 2 === 0 ? archA : archB;
  P.add(slab(outline, depth, (c, n) => (Math.abs(n.z) > 0.5 || c.y > top - 0.05 ? archA : voussoir(c))));
  const ring: Pt[] = [
    ...arc(0, spring, w / 2 + 0.38, rise + 0.38, Math.PI, 0, 7),
    ...arc(0, spring, w / 2, rise, 0, Math.PI, 7),
  ];
  P.add(slab(ring, 0.12, voussoir, { pos: [0, 0, depth / 2 + 0.04] }));
  P.boxCol(0, 0, w, top - spring, depth, 0, spring);

  // Wooden leaves: swung open against the front of the towers, or shut across the opening.
  const lw = w / 2;
  const lh = spring + rise * 0.45;
  const hz = depth / 2 - 0.08;
  const angle = open ? Math.PI / 2 + 0.12 : 0;
  for (const sx of [-1, 1] as const) {
    const dir = sx === -1 ? 1 : -1;
    const a = sx === -1 ? -angle : angle;
    P.absorb(leaf(k, rng, lw, lh, dir, k.gate), { pos: [sx * (w / 2), 0, hz], rotY: a });
    const [cx, cz] = swing(sx * (w / 2), hz, (dir * lw) / 2, 0, a);
    P.boxCol(cx, cz, lw, lh, 0.16, a);
  }

  // Wall stubs out to the full length.
  const stub = L / 2 - (w / 2 + tw);
  if (stub > 0.4) {
    const o = { height: h, thick: 0.7, color: k.wall, cap: k.stoneLight };
    wallRun(P, rng, { ...o, x0: -L / 2, x1: -(w / 2 + tw) });
    wallRun(P, rng, { ...o, x0: w / 2 + tw, x1: L / 2 });
  }
  return P.done();
}

/**
 * params: length (12), height (4.2), open (false). A high wall with a small arched wooden door, a little hood
 * roof and a lantern of safe light (GDD Ch IV: wall #C9BBA0, gate #8A5A3B, safe light #FFF2C2).
 */
export function buildWicketGate(rng: Rng, pal: Palette, p: PropParams): PropResult {
  const k = kit(pal);
  const P = new Parts();
  const L = num(p, 'length', 12, 3, 80);
  const H = num(p, 'height', 4.2, 3, 8);
  const open = bool(p, 'open', false);
  const t = 0.8;
  const sw = 0.95; // half-width of the stone surround
  const dw = 1.25; // door width
  const spring = 1.85;
  const rise = 0.42;
  const surroundTop = 2.75;
  const o = { height: H, thick: t, color: k.wall, cap: k.stoneLight };
  wallRun(P, rng, { ...o, x0: -L / 2, x1: -sw });
  wallRun(P, rng, { ...o, x0: sw, x1: L / 2 });
  wallRun(P, rng, { ...o, x0: -sw, x1: sw, y0: surroundTop, height: H - surroundTop, maxSeg: 2 });

  // U-shaped stone surround with an arched opening.
  const surround: Pt[] = [
    [-sw, 0],
    [-sw, surroundTop],
    [sw, surroundTop],
    [sw, 0],
    [dw / 2, 0],
    ...arc(0, spring, dw / 2, rise, 0, Math.PI, 6),
    [-dw / 2, 0],
  ];
  P.add(jitter(slab(surround, t + 0.16, tone(k.stoneLight, 0.03, rng)), 0.02, rng));
  P.add(box(0.34, 0.42, t + 0.24, k.stoneLight, { pos: [0, spring + rise + 0.12, 0] }, 0.03));
  P.boxCol(-(sw + dw / 2) / 2, 0, sw - dw / 2, surroundTop, t + 0.16);
  P.boxCol((sw + dw / 2) / 2, 0, sw - dw / 2, surroundTop, t + 0.16);

  // The door: an arched leaf with plank seams, iron straps, a knocker and a tiny grille.
  const D = new Parts();
  const leafShape: Pt[] = [[0, 0], [dw, 0], ...arc(dw / 2, spring, dw / 2, rise, 0, Math.PI, 6)];
  D.add(slab(leafShape, 0.12, tone(k.gate, 0.02, rng)));
  for (const fx of [0.25, 0.5, 0.75]) {
    const x = dw * fx;
    const top = spring + rise * Math.sqrt(1 - ((x - dw / 2) / (dw / 2)) ** 2) - 0.06;
    D.add(box(0.03, top - 0.06, 0.03, k.woodDark, { pos: [x, top / 2, 0.07] }));
  }
  for (const y of [0.4, 1.55]) D.add(box(dw * 0.7, 0.09, 0.03, k.iron, { pos: [dw * 0.35, y, 0.08] }));
  D.add(rod(0.07, 0.07, 0.03, k.iron, { pos: [dw * 0.72, 1.1, 0.07], rot: [Math.PI / 2, 0, 0] }, 8));
  D.add(box(0.26, 0.2, 0.03, k.hollow, { pos: [dw / 2, 1.62, 0.065] }));
  D.add(box(0.03, 0.2, 0.04, k.iron, { pos: [dw / 2, 1.62, 0.08] }));
  const hinge: Vec3 = [-dw / 2, 0, open ? -0.05 : 0.02];
  const a = open ? Math.PI / 2 - 0.2 : 0;
  P.absorb(D, { pos: hinge, rotY: a });
  if (!open) P.boxCol(0, 0, dw, spring + rise, 0.3);
  else {
    const [cx, cz] = swing(hinge[0], hinge[2], dw / 2, 0, a);
    P.boxCol(cx, cz, dw, spring + rise, 0.16, a);
  }

  // Hood roof on two brackets, and a lantern of safe light beside the door.
  const fz = t / 2 + 0.08;
  for (const sx of [-1, 1]) {
    P.add(
      box(
        0.62,
        0.08,
        0.72,
        tone(k.gate, 0.04, rng),
        {
          pos: [sx * 0.27, surroundTop + 0.22, fz + 0.3],
          rot: [0, 0, -sx * 0.55],
        },
        0.02,
      ),
    );
    P.add(
      beam([sx * 0.5, surroundTop - 0.25, fz], [sx * 0.5, surroundTop + 0.05, fz + 0.55], 0.07, k.woodDark),
    );
  }
  const lx = sw + 0.35;
  P.add(beam([lx, 2.35, fz - 0.04], [lx, 2.55, fz + 0.4], 0.06, k.iron));
  P.add(xform(paint(cone(0.17, 0.16, 4), k.iron), { pos: [lx, 2.3, fz + 0.4], rot: [0, Math.PI / 4, 0] }));
  P.add(box(0.24, 0.04, 0.24, k.iron, { pos: [lx, 1.98, fz + 0.4] }));
  for (const cx of [-1, 1]) {
    for (const cz of [-1, 1]) {
      P.add(box(0.03, 0.3, 0.03, k.iron, { pos: [lx + cx * 0.1, 2.14, fz + 0.4 + cz * 0.1] }));
    }
  }
  P.glow(box(0.17, 0.26, 0.17, k.windowGlow, { pos: [lx, 2.14, fz + 0.4] }));
  return P.done();
}
