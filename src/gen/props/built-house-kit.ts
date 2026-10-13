/**
 * Pieces for the crooked timber houses (built-houses.ts): a timber-framed storey, windows that glow, doors,
 * shingle gable roofs and chimneys. Each piece is a sub-assembly (`Parts`) built around its own base centre,
 * so the house can lean, twist and stack storeys with `Parts.absorb`.
 */
import { jitter, type Vec3 } from '../geom';
import type { Rng } from '../rng';
import { beam, box, gem, Parts, rod, slab, tone, type Kit, type Pt } from './built-kit';

export type Face = 'front' | 'back' | 'left' | 'right';

export interface StoreySpec {
  w: number;
  d: number;
  h: number;
  plaster: string;
  timber: string;
  /** Diagonal braces on the front and sides (else plain studs). */
  braces: boolean;
}

/** Plaster box with sill and plate rings, corner posts and braces (~150 triangles). */
export function storey(rng: Rng, s: StoreySpec): Parts {
  const P = new Parts();
  const { w, d, h, timber } = s;
  P.add(jitter(box(w, h, d, s.plaster, { pos: [0, h / 2, 0] }, 0.05), 0.025, rng));
  P.add(box(w + 0.1, 0.16, d + 0.1, timber, { pos: [0, 0.08, 0] }));
  P.add(box(w + 0.12, 0.16, d + 0.12, tone(timber, 0.03, rng), { pos: [0, h - 0.08, 0] }));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) P.add(box(0.17, h, 0.17, timber, { pos: [sx * (w / 2), h / 2, sz * (d / 2)] }));
  }
  const y0 = 0.16;
  const y1 = h - 0.16;
  const f = d / 2 + 0.035;
  const r = w / 2 + 0.035;
  if (s.braces) {
    for (const sx of [-1, 1]) {
      P.add(beam([sx * (w / 2 - 0.1), y0, f], [sx * (w / 2 - 0.75), y1, f], 0.13, timber, 0.06));
      P.add(beam([sx * r, y0, -d / 2 + 0.12], [sx * r, y1, -d / 2 + 0.85], 0.06, timber, 0.13));
    }
  } else {
    for (const sx of [-1, 1]) {
      P.add(box(0.13, h - 0.3, 0.06, timber, { pos: [sx * w * 0.25, h / 2, f] }));
      P.add(box(0.06, h - 0.3, 0.13, timber, { pos: [sx * r, h / 2, 0] }));
    }
  }
  P.add(box(0.13, h - 0.3, 0.06, timber, { pos: [0, h / 2, -f] }));
  return P;
}

/** Where a point (u along the face, y up) on a w×d storey face sits, and which way the face looks. */
export function facePos(
  face: Face,
  w: number,
  d: number,
  u: number,
  y: number,
  off = 0.03,
): { pos: Vec3; rotY: number } {
  switch (face) {
    case 'front':
      return { pos: [u, y, d / 2 + off], rotY: 0 };
    case 'back':
      return { pos: [-u, y, -d / 2 - off], rotY: Math.PI };
    case 'right':
      return { pos: [w / 2 + off, y, -u], rotY: Math.PI / 2 };
    case 'left':
      return { pos: [-w / 2 - off, y, u], rotY: -Math.PI / 2 };
  }
}

export interface WindowOpts {
  ww?: number;
  wh?: number;
  sill?: boolean;
  shutter?: boolean;
  /** Probability the window is lit (warm glow) rather than dark glass. */
  lit?: number;
}

/** A window on a storey face: frame, warm glowing pane (or dark glass), cross mullion, sill, maybe a shutter. */
export function windowAt(
  P: Parts,
  k: Kit,
  rng: Rng,
  face: Face,
  w: number,
  d: number,
  u: number,
  y: number,
  o: WindowOpts = {},
): void {
  const ww = o.ww ?? 0.55;
  const wh = o.wh ?? 0.66;
  const W = new Parts();
  W.add(box(ww + 0.16, wh + 0.16, 0.06, k.woodDark, {}));
  const lit = rng.chance(o.lit ?? 0.85);
  const pane = box(ww, wh, 0.04, lit ? k.windowGlow : k.glass, { pos: [0, 0, 0.03] });
  if (lit) W.glow(pane);
  else W.add(pane);
  W.add(box(0.05, wh, 0.03, k.woodDark, { pos: [0, 0, 0.06] }));
  W.add(box(ww, 0.05, 0.03, k.woodDark, { pos: [0, 0, 0.06] }));
  if (o.sill ?? true) W.add(box(ww + 0.26, 0.08, 0.16, k.woodLight, { pos: [0, -wh / 2 - 0.1, 0.05] }));
  if (o.shutter) {
    const side = rng.sign();
    W.add(
      box(ww * 0.5, wh + 0.08, 0.04, tone(k.woodLight, 0.06, rng), {
        pos: [side * (ww / 2 + ww * 0.25 + 0.1), -0.03, 0.04],
        rot: [0, 0, rng.range(-0.22, 0.22)],
      }),
    );
  }
  const at = facePos(face, w, d, u, y);
  P.absorb(W, at);
}

/** Door on the front face (+Z) of a storey at x: frame, plank leaf, hinges, knob, peep window, stone step. */
export function doorAt(
  P: Parts,
  k: Kit,
  rng: Rng,
  x: number,
  d: number,
  color: string,
  w = 0.95,
  h = 1.95,
): void {
  const z = d / 2;
  P.add(box(w + 0.22, h + 0.12, 0.1, k.woodDark, { pos: [x, (h + 0.12) / 2, z + 0.01] }));
  P.add(box(w, h, 0.08, tone(color, 0.04, rng), { pos: [x, h / 2, z + 0.06] }, 0.02));
  for (const fy of [0.25, 0.75])
    P.add(box(w * 0.72, 0.07, 0.03, k.iron, { pos: [x - w * 0.12, h * fy, z + 0.11] }));
  P.add(gem(0.05, k.brass, { pos: [x + w * 0.36, h * 0.48, z + 0.13] }));
  if (rng.chance(0.6)) P.glow(box(0.2, 0.2, 0.03, k.windowGlow, { pos: [x, h * 0.8, z + 0.1] }));
  P.add(
    jitter(box(w + 0.5, 0.18, 0.5, tone(k.stone, 0.04, rng), { pos: [x, 0.04, z + 0.3] }, 0.03), 0.02, rng),
  );
}

export interface RoofOpts {
  /** Footprint the roof sits on (ridge runs along Z; rotate the sub-assembly for an X ridge). */
  w: number;
  d: number;
  pitch: number;
  over: number;
  rows: number;
  thick: number;
  color: string;
  gable: string;
  bevel?: number;
  /** Rounded ridge log (thatch) instead of a diamond ridge cap. */
  roundRidge?: boolean;
}

/** Gable roof of overlapping shingle rows over a gable prism; base (eaves) at y = 0. */
export function gableRoof(rng: Rng, k: Kit, o: RoofOpts): Parts {
  const P = new Parts();
  const tan = Math.tan(o.pitch);
  const ridgeY = (o.w / 2) * tan;
  const tri: Pt[] = [
    [-o.w / 2, 0],
    [o.w / 2, 0],
    [0, ridgeY],
  ];
  P.add(slab(tri, o.d, o.gable));
  const half = o.w / 2 + o.over;
  const slant = half / Math.cos(o.pitch);
  const rowL = slant / o.rows;
  const depth = o.d + 2 * o.over;
  for (const s of [-1, 1]) {
    const nx = s * Math.sin(o.pitch);
    const ny = Math.cos(o.pitch);
    for (let i = 0; i < o.rows; i++) {
      const t = rowL * (i + 0.5);
      const lift = o.thick / 2 + i * 0.03;
      P.add(
        box(
          rowL + 0.12,
          o.thick,
          depth + rng.range(-0.04, 0.06),
          tone(o.color, 0.05, rng),
          {
            pos: [
              s * t * Math.cos(o.pitch) + nx * lift,
              ridgeY - t * Math.sin(o.pitch) + ny * lift,
              rng.range(-0.03, 0.03),
            ],
            rot: [rng.range(-0.015, 0.015), 0, -s * o.pitch],
          },
          o.bevel ?? 0,
        ),
      );
    }
  }
  const ry = ridgeY + o.thick * 0.8;
  if (o.roundRidge)
    P.add(
      rod(
        o.thick * 0.9,
        o.thick * 0.9,
        depth + 0.1,
        tone(o.color, 0.04, rng),
        { pos: [0, ry, -(depth + 0.1) / 2], rot: [Math.PI / 2, 0, 0] },
        6,
      ),
    );
  else
    P.add(
      box(o.thick * 1.5, o.thick * 1.5, depth + 0.1, k.woodDark, {
        pos: [0, ry, 0],
        rot: [0, 0, Math.PI / 4],
      }),
    );
  // Collar beam and a short king post high on the front gable (clear of any gable window below).
  const gz = o.d / 2 + 0.03;
  const collar = ridgeY * 0.64;
  P.add(box(o.w * (1 - 0.64) + 0.1, 0.12, 0.06, k.woodDark, { pos: [0, collar, gz] }));
  P.add(box(0.12, ridgeY - collar, 0.06, k.woodDark, { pos: [0, (ridgeY + collar) / 2, gz] }));
  return P;
}

/** Height of the gable roof surface above the eaves at distance |x| from the ridge line. */
export function roofHeightAt(o: { w: number; pitch: number }, x: number): number {
  return (o.w / 2 - Math.abs(x)) * Math.tan(o.pitch);
}

/** Stone chimney with a band and a pot; base at y = 0. */
export function chimney(rng: Rng, k: Kit, h: number, size = 0.62): Parts {
  const P = new Parts();
  P.add(jitter(box(size, h, size, tone(k.stone, 0.05, rng), { pos: [0, h / 2, 0] }, 0.04), 0.03, rng));
  P.add(box(size + 0.14, 0.16, size + 0.14, k.stoneDark, { pos: [0, h - 0.06, 0] }));
  P.add(
    rod(
      0.12,
      0.15,
      0.3,
      tone(k.roof[0] ?? k.stoneDark, 0.04, rng),
      { pos: [rng.range(-0.08, 0.08), h + 0.02, 0] },
      6,
    ),
  );
  return P;
}

/** Window box of flowers under a front window. */
export function flowerBox(P: Parts, k: Kit, rng: Rng, x: number, y: number, z: number): void {
  P.add(box(0.78, 0.18, 0.2, k.woodLight, { pos: [x, y, z + 0.1] }));
  for (let i = 0; i < 4; i++) {
    const fx = x - 0.27 + i * 0.18 + rng.range(-0.03, 0.03);
    P.add(gem(0.08, k.leafDark, { pos: [fx, y + 0.13, z + 0.1], scale: [1, 0.7, 1] }));
    P.add(gem(0.06, rng.pick(k.blossom), { pos: [fx, y + 0.22, z + 0.12] }));
  }
}
