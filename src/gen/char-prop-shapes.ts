/**
 * Hand and back props in the grip frame (staff, crook, lantern, candle, book, sword, shield...): the shapes
 * buildProps() places on the prop bones, split out of char-props.ts to keep files under 400 lines.
 */
import * as THREE from 'three';
import { bevelBox, cone, cylinder, extrude, jitter, lathe, lowSphere, xform, type Vec3 } from './geom';
import { shade } from './palette';
import { type BuildCtx, bandProfile, slab } from './char-parts';
import type { PropType } from './char-types';

export interface Piece {
  g: THREE.BufferGeometry;
  hex: string;
  glow?: boolean;
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const tmpA = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();

/** A round rod from a to b (grip-frame metres). */
function rod(a: Vec3, b: Vec3, r: number, radial = 5): THREE.BufferGeometry {
  tmpA.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = tmpA.length();
  tmpQ.setFromUnitVectors(Y_AXIS, tmpA.normalize());
  tmpE.setFromQuaternion(tmpQ, 'XYZ');
  return xform(cylinder(r, r, Math.max(1e-3, len), radial), { rot: [tmpE.x, tmpE.y, tmpE.z], pos: a });
}

function lanternPieces(s: number, c: Vec3, metal: string): Piece[] {
  const [x, y, z] = c;
  const out: Piece[] = [
    { g: xform(cone(0.08 * s, 0.07 * s, 6), { pos: [x, y + 0.075 * s, z] }), hex: metal },
    {
      g: xform(cylinder(0.062 * s, 0.062 * s, 0.13 * s, 6), { pos: [x, y - 0.06 * s, z] }),
      hex: '#FFE39A',
      glow: true,
    },
    { g: xform(cylinder(0.08 * s, 0.075 * s, 0.03 * s, 6), { pos: [x, y - 0.09 * s, z] }), hex: metal },
    {
      g: xform(lathe(bandProfile(0.045 * s, 0.014 * s, 0.008 * s), 6), {
        rot: [0, 0, Math.PI / 2],
        pos: [x, y + 0.17 * s, z],
      }),
      hex: metal,
    },
  ];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    const px = x + Math.sin(a) * 0.066 * s;
    const pz = z + Math.cos(a) * 0.066 * s;
    out.push({ g: rod([px, y - 0.065 * s, pz], [px, y + 0.08 * s, pz], 0.009 * s, 4), hex: metal });
  }
  return out;
}

/** Builds one prop in the grip frame. `gripY` = grip height above the ground, `top` = top of the head. */
export function propPieces(
  ctx: BuildCtx,
  type: PropType,
  side: number,
  gripY: number,
  top: number,
  onBack: boolean,
): Piece[] {
  const b = ctx.L.body;
  const s = Math.min(5, Math.max(0.6, ctx.L.height / 1.5));
  const wood = ctx.col(type, '#8A6A45');
  const ground = onBack ? -0.6 * s : -gripY;
  switch (type) {
    case 'staff': {
      const t = top - gripY + 0.22 * s;
      return [
        {
          g: jitter(rod([0, ground, 0.01 * s], [0, t, 0.03 * s], 0.03 * s, 6), 0.006 * s, ctx.rng),
          hex: wood,
        },
        { g: xform(lowSphere(0.055 * s, 0), { pos: [0, t, 0.03 * s] }), hex: shade(wood, -0.1) },
      ];
    }
    case 'crook': {
      const t = top - gripY + 0.1 * s;
      const out: Piece[] = [{ g: rod([0, ground, 0], [0, t, 0], 0.026 * s, 6), hex: wood }];
      const R = 0.11 * s;
      let prev: Vec3 = [0, t, 0];
      for (let i = 1; i <= 6; i++) {
        const a = (i / 6) * Math.PI * 1.25;
        const p: Vec3 = [0, t + Math.sin(a) * R, R - Math.cos(a) * R];
        out.push({ g: rod(prev, p, 0.024 * s, 5), hex: wood });
        prev = p;
      }
      return out;
    }
    case 'cane':
      return [
        { g: rod([0, ground, 0.05 * s], [0, 0.03 * s, 0], 0.022 * s, 5), hex: wood },
        { g: xform(lowSphere(0.045 * s, 0), { pos: [0, 0.05 * s, 0] }), hex: shade(wood, -0.15) },
      ];
    case 'pole': {
      const t = top * 1.25 - gripY;
      return [
        { g: rod([0, ground, 0], [0, t, 0], 0.03 * s, 6), hex: wood },
        { g: rod([0, t - 0.04 * s, 0], [0, t - 0.04 * s, 0.32 * s], 0.022 * s, 5), hex: wood },
        { g: rod([0, t - 0.04 * s, 0.3 * s], [0, t - 0.14 * s, 0.3 * s], 0.008 * s, 4), hex: '#3E3A36' },
        ...lanternPieces(s, [0, t - 0.32 * s, 0.3 * s], ctx.col('lantern', '#3E3A36')),
      ];
    }
    case 'lantern':
      return [
        { g: rod([0, 0.02 * s, 0], [0, -0.1 * s, 0.02 * s], 0.01 * s, 4), hex: '#3E3A36' },
        ...lanternPieces(s, [0, -0.28 * s, 0.03 * s], ctx.col('lantern', '#3E3A36')),
      ];
    case 'candle':
      return [
        {
          g: xform(cylinder(0.065 * s, 0.045 * s, 0.025 * s, 7), { pos: [0, b.handR * 0.8, 0] }),
          hex: ctx.col('candle', '#B08D57'),
        },
        {
          g: xform(cylinder(0.022 * s, 0.024 * s, 0.12 * s, 6), { pos: [0, b.handR * 0.8 + 0.02 * s, 0] }),
          hex: '#F4EBD8',
        },
        {
          g: xform(lowSphere(0.026 * s, 0), {
            scale: [0.8, 1.7, 0.8],
            pos: [0, b.handR * 0.8 + 0.18 * s, 0],
          }),
          hex: '#FFD36A',
          glow: true,
        },
      ];
    case 'keys': {
      const metal = ctx.col('keys', '#C9A24A');
      const out: Piece[] = [
        {
          g: xform(lathe(bandProfile(0.055 * s, 0.012 * s, 0.009 * s), 8), {
            rot: [Math.PI / 2, 0, 0],
            pos: [0, -0.07 * s, 0.02 * s],
          }),
          hex: metal,
        },
      ];
      for (const a of [-0.35, 0, 0.35]) {
        const x = Math.sin(a) * 0.05 * s;
        const y0 = -0.12 * s;
        const y1 = y0 - 0.12 * s;
        out.push({ g: rod([x, y0, 0.02 * s], [x * 1.6, y1, 0.02 * s], 0.009 * s, 4), hex: metal });
        out.push({
          g: xform(bevelBox(0.012 * s, 0.035 * s, 0.03 * s, 0.003 * s), {
            pos: [x * 1.6, y1 + 0.02 * s, 0.035 * s],
          }),
          hex: metal,
        });
      }
      return out;
    }
    case 'book': {
      const cover = ctx.col('book', '#7A3B2E');
      return [
        {
          g: xform(bevelBox(0.055 * s, 0.22 * s, 0.17 * s, 0.01 * s), {
            pos: [side * 0.07 * s, -0.04 * s, 0.03 * s],
          }),
          hex: cover,
        },
        {
          g: xform(bevelBox(0.045 * s, 0.2 * s, 0.16 * s, 0.004 * s), {
            pos: [side * 0.07 * s, -0.04 * s, 0.04 * s],
          }),
          hex: '#F4EBD8',
        },
      ];
    }
    case 'letter':
      return [
        {
          g: xform(bevelBox(0.014 * s, 0.11 * s, 0.16 * s, 0.003 * s), {
            pos: [side * 0.05 * s, -0.05 * s, 0.04 * s],
          }),
          hex: ctx.col('letter', '#F4F1E8'),
        },
        {
          g: xform(lowSphere(0.022 * s, 0), {
            scale: [0.5, 1, 1],
            pos: [side * 0.06 * s, -0.05 * s, 0.04 * s],
          }),
          hex: '#B03A2E',
        },
      ];
    case 'gavel': {
      const c = ctx.col('gavel', '#6B4A30');
      return [
        { g: rod([0, 0, -0.05 * s], [0, 0, 0.22 * s], 0.016 * s, 5), hex: c },
        {
          g: xform(cylinder(0.05 * s, 0.05 * s, 0.17 * s, 7), {
            rot: [0, 0, Math.PI / 2],
            pos: [0.085 * s, 0, 0.23 * s],
          }),
          hex: shade(c, -0.1),
        },
      ];
    }
    case 'sword': {
      const blade = ctx.col('sword', '#D9DEE3');
      const hilt = ctx.col('swordHilt', '#E8C25A');
      const outline: Array<[number, number]> = [
        [-0.035, 0],
        [0.035, 0],
        [0.03, 0.42],
        [0, 0.5],
        [-0.03, 0.42],
      ];
      const tilt: Vec3 = onBack ? [0, 0, 0] : [Math.PI / 2 - 0.45, 0, 0];
      const pcs: Piece[] = [
        { g: rod([0, -0.06 * s, 0], [0, 0.05 * s, 0], 0.02 * s, 5), hex: '#5A3E2B' },
        {
          g: xform(bevelBox(0.17 * s, 0.03 * s, 0.045 * s, 0.008 * s), { pos: [0, 0.065 * s, 0] }),
          hex: hilt,
        },
        {
          g: xform(
            extrude(
              outline.map(([x, y]) => [x * s, y * s]),
              0.016 * s,
            ),
            { pos: [0, 0.08 * s, 0] },
          ),
          hex: blade,
        },
        { g: xform(lowSphere(0.03 * s, 0), { pos: [0, -0.075 * s, 0] }), hex: hilt },
      ];
      for (const p of pcs) xform(p.g, { rot: tilt });
      return pcs;
    }
    case 'shield': {
      const R = 0.26 * s;
      const face = ctx.col('shield', '#4F7FA6');
      const rim = ctx.col('shieldRim', '#B8C2CC');
      const out = onBack ? 0 : b.armR * 1.05;
      const toOut: Vec3 = [0, 0, (-side * Math.PI) / 2];
      const c: Vec3 = [side * out, onBack ? 0 : 0.12 * s, 0.02 * s];
      const at = (dx: number): Vec3 => [c[0] + side * dx, c[1], c[2]];
      const emblem = (o: Array<[number, number]>, hex: string): Piece => ({
        g: xform(
          slab(
            o.map(([u, v]) => [u * R, v * R]),
            0.012 * s,
          ),
          { rot: [0, (side * Math.PI) / 2, 0], pos: at(0.04 * s) },
        ),
        hex,
      });
      const sunPts: Array<[number, number]> = [];
      for (let i = 0; i <= 6; i++)
        sunPts.push([Math.cos((i / 6) * Math.PI) * 0.36, 0.02 + Math.sin((i / 6) * Math.PI) * 0.36]);
      const pieces: Piece[] = [
        { g: xform(cylinder(R, R, 0.04 * s, 12), { rot: toOut, pos: c }), hex: face },
        {
          g: xform(lathe(bandProfile(R, 0.05 * s, 0.02 * s), 12), { rot: toOut, pos: at(0.02 * s) }),
          hex: rim,
        },
        emblem(sunPts, ctx.col('emblemSun', '#E8C25A')),
        emblem(
          [
            [-0.42, -0.72],
            [0.42, -0.72],
            [0.05, -0.02],
            [-0.05, -0.02],
          ],
          ctx.col('emblemPath', '#F6DFA8'),
        ),
      ];
      for (let i = 0; i < 5; i++) {
        const a = Math.PI * (0.12 + (0.76 * i) / 4);
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        pieces.push(
          emblem(
            [
              [ca * 0.45 - sa * 0.04, 0.02 + sa * 0.45 + ca * 0.04],
              [ca * 0.45 + sa * 0.04, 0.02 + sa * 0.45 - ca * 0.04],
              [ca * 0.62, 0.02 + sa * 0.62],
            ],
            ctx.col('emblemSun', '#E8C25A'),
          ),
        );
      }
      if (onBack) for (const p of pieces) xform(p.g, { rot: [0, Math.PI / 2, 0] });
      return pieces;
    }
    case 'toy': {
      // A painted wooden horse on wheels, sized from the mitten (not the body) and held out in front of it by
      // its tail end, so it clears the hand and reads at the gameplay camera distance.
      const h = b.handR;
      const c = ctx.col('toy', '#B8513A');
      const wheel = shade(ctx.col('toy', '#B8513A'), -0.45);
      const len = 3.2 * h;
      const z0 = 0.55 * h; // tail end, inside the fist
      const pcs: Piece[] = [
        {
          g: xform(bevelBox(0.9 * h, 0.85 * h, len, 0.22 * h), { pos: [0, -0.3 * h, z0 + len / 2] }),
          hex: c,
        },
        {
          g: xform(bevelBox(0.7 * h, 1.3 * h, 0.85 * h, 0.2 * h), {
            rot: [0.35, 0, 0],
            pos: [0, 0.45 * h, z0 + len - 0.35 * h],
          }),
          hex: c,
        },
        {
          g: xform(bevelBox(0.72 * h, 0.5 * h, 0.75 * h, 0.15 * h), {
            pos: [0, 0.95 * h, z0 + len + 0.05 * h],
          }),
          hex: shade(c, 0.08),
        },
      ];
      for (const [x, z] of [
        [1, 0.3],
        [-1, 0.3],
        [1, 0.85],
        [-1, 0.85],
      ] as const) {
        pcs.push({
          g: xform(xform(cylinder(0.42 * h, 0.42 * h, 0.22 * h, 6), { pos: [0, -0.11 * h, 0] }), {
            rot: [0, 0, Math.PI / 2],
            pos: [x * 0.56 * h, -0.85 * h, z0 + z * len],
          }),
          hex: wheel,
        });
      }
      return pcs;
    }
    case 'club': {
      const len = onBack ? 0.9 * s : gripY * 1.12;
      const g = lathe(
        [
          [0, -0.05 * len],
          [0.03 * s, -0.04 * len],
          [0.035 * s, 0.25 * len],
          [0.08 * s, 0.6 * len],
          [0.1 * s, 0.82 * len],
          [0.07 * s, 0.97 * len],
          [0, len],
        ],
        7,
      );
      const tilt: Vec3 = onBack ? [0, 0, 0] : [Math.PI + 0.55, 0, 0];
      const c = ctx.col('club', '#6B4A30');
      const pcs: Piece[] = [{ g: jitter(g, 0.012 * s, ctx.rng), hex: c }];
      for (let i = 0; i < 4; i++) {
        const a = i * 1.7;
        pcs.push({
          g: xform(lowSphere(0.035 * s, 0), {
            pos: [Math.sin(a) * 0.09 * s, len * (0.62 + i * 0.07), Math.cos(a) * 0.09 * s],
          }),
          hex: shade(c, -0.12),
        });
      }
      for (const p of pcs) xform(p.g, { rot: tilt });
      return pcs;
    }
  }
}
