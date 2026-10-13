/**
 * Character hats and head coverings (cap, hood, tall, droopy, wig, scarf, helmet, mirror mask) and the plume,
 * split out of char-head.ts to keep files under 400 lines.
 */
import type * as THREE from 'three';
import { cone, cylinder, extrude, jitter, lathe, lowSphere, part, xform } from './geom';
import { shade } from './palette';
import { type BuildCtx, bandProfile, clipTris, ellipse, skirt, slab } from './char-parts';
import { headSurfaceZ } from './rig';

type V3 = [number, number, number];

/**
 * The helmet's neck guard starts this far round from the face (rad, 0 = straight ahead): behind the ears, so its
 * edges stay hidden behind the head from the front and it covers the back the follow camera sees.
 */
const GUARD_FROM = 1.95;
const MASK_Y = 0.12;
const MASK_DEPTH = 0.06;
/** The headscarf: face-opening half-angle from the face axis (rad) and how far that axis tilts down. */
export const SCARF = { open: 0.86, tilt: 0.17 };

/**
 * A shell of revolution about the face axis (+Z tilted `tilt` rad down), centred on the head centre: `profile`
 * is [radius (head radii), angle from the face axis (rad)], back to front, so its rim is a clean circle.
 */
/**
 * Pulls a partial revolution (about Y, from `from` to 2π - `from`, 0 = the face) in onto the skull (radius r)
 * near its two open edges, so seen from any side the edge meets the head instead of standing off it.
 */
function hugEdges(g: THREE.BufferGeometry, r: number, from: number): THREE.BufferGeometry {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    let phi = Math.atan2(x, z);
    if (phi < 0) phi += Math.PI * 2;
    const t = Math.min(1, Math.max(0, Math.min(phi - from, Math.PI * 2 - from - phi) / 0.55));
    const rho = Math.hypot(x, z);
    if (rho < 1e-6) continue;
    const skull = Math.sqrt(Math.max(0, r * r - y * y)) * 1.02;
    const k = (skull + (rho - skull) * t * t * (3 - 2 * t)) / rho;
    pos.setXYZ(i, x * k, y, z * k);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

export function zRing(r: number, tilt: number, radial: number, profile: Array<[number, number]>) {
  const pts = profile.map(([k, th]): [number, number] => [k * r * Math.sin(th), k * r * Math.cos(th)]);
  return xform(lathe(pts, radial), { rot: [Math.PI / 2 + tilt, 0, 0] });
}

/** z of the mirror mask's front relative to the head centre (eyes and brows sit there; see buildHat). */
export function maskFrontZ(r: number): number {
  return headSurfaceZ(r, 0, r * MASK_Y) * 0.97 + r * MASK_DEPTH;
}

/** Height of the top of the hat above the head centre (radius units), for the plume. */
function hatTop(hat: string): number {
  switch (hat) {
    case 'helmet':
      return 1.12;
    case 'tall':
      return 1.85;
    case 'droopy':
      return 1.42;
    case 'cap':
      return 0.95;
    case 'hood':
      return 1.16;
    default:
      return 1.06;
  }
}

export function buildHat(ctx: BuildCtx): void {
  const { L, parts, seg, rng } = ctx;
  const r = L.body.headR;
  const c = L.headC;
  const hat = ctx.recipe.parts.hat ?? 'none';
  const hatC = ctx.col('hat', shade(ctx.col('top', '#8A6A4A'), -0.12));
  const trimC = ctx.col('trim', ctx.col('accent', shade(hatC, -0.25)));
  const at = (x: number, y: number, z: number): V3 => [c.x + x, c.y + y, c.z + z];
  const R = (pts: Array<[number, number]>): Array<[number, number]> => pts.map(([a, b]) => [a * r, b * r]);
  const shellClip = (k: number, keep: (xn: number, yn: number, zn: number) => boolean) =>
    clipTris(lowSphere(r * k, seg.sphere), (x, y, z) => keep(x / r, y / r, z / r));

  switch (hat) {
    case 'cap': {
      const dome = lathe(
        R([
          [1.09, 0.12],
          [1.11, 0.32],
          [0.96, 0.62],
          [0.6, 0.86],
          [0, 0.94],
        ]),
        seg.round,
      );
      parts.add(part(dome, hatC, { rot: [-0.08, 0, 0], pos: at(0, 0, 0) }), 'hat');
      const brim = extrude(
        ellipse(r * 0.85, r * 0.6, 10).filter(([, y]) => y <= 0.001),
        r * 0.06,
      );
      parts.add(
        part(brim, shade(hatC, -0.1), { rot: [-Math.PI / 2 + 0.2, 0, 0], pos: at(0, r * 0.22, r * 0.82) }),
        'hat',
      );
      break;
    }
    case 'tall': {
      const tilt: V3 = [-0.12, 0, 0.04];
      const g = (geo: Parameters<typeof part>[0], hex: string, y: number) =>
        part(xform(geo, { pos: [0, y, 0] }), hex, { rot: tilt, pos: at(0, 0, 0) });
      parts.add(g(cylinder(r * 1.3, r * 1.3, r * 0.07, seg.round + 1), hatC, r * 0.6), 'hat');
      parts.add(g(cylinder(r * 0.78, r * 0.84, r * 1.2, seg.round), hatC, r * 0.62), 'hat');
      parts.add(g(cylinder(r * 0.86, r * 0.86, r * 0.17, seg.round), trimC, r * 0.66), 'hat');
      break;
    }
    case 'droopy': {
      const g = lathe(
        R([
          [1.75, 0.02],
          [1.45, 0.36],
          [1.0, 0.55],
          [0.9, 0.62],
          [0.82, 1.0],
          [0.55, 1.32],
          [0.2, 1.42],
          [0, 1.43],
        ]),
        seg.round + 1,
      );
      parts.add(part(jitter(g, r * 0.06, rng), hatC, { rot: [-0.1, 0, 0.12], pos: at(0, 0, 0) }), 'hat');
      break;
    }
    case 'helmet': {
      const dome = clipTris(
        lathe(
          R([
            [1.12, -0.18],
            [1.16, 0.12],
            [1.08, 0.5],
            [0.78, 0.86],
            [0.35, 1.08],
            [0, 1.12],
          ]),
          seg.round + 1,
        ),
        (x, y, z) => !(z / r > 0.42 && y / r < 0.45),
      );
      // Its open edges (the face opening, the lower rim) get a skirt into the skull: a solid edge, no gap.
      parts.add(part(skirt(dome, 0.92 * r), hatC, { pos: at(0, 0, 0) }), 'head');
      // Neck guard: the back and sides come down to the nape (a clean partial revolution, open at the face),
      // so the gameplay camera behind the player never sees a bare scalp under the rim.
      const guard = skirt(
        hugEdges(
          lathe(
            R([
              [1.12, -0.66],
              [1.08, -0.42],
              [1.12, -0.15],
            ]),
            seg.round + 1,
            GUARD_FROM,
            Math.PI * 2 - 2 * GUARD_FROM,
          ),
          r,
          GUARD_FROM,
        ),
        0.92 * r,
      );
      parts.add(part(guard, shade(hatC, -0.05), { pos: at(0, 0, 0) }), 'head');
      parts.add(
        part(lathe(bandProfile(r * 1.13, r * 0.12, r * 0.04), seg.round + 1), trimC, {
          pos: at(0, r * 0.52, 0),
        }),
        'head',
      );
      parts.add(
        part(
          lathe(
            [
              [0, -0.2 * r],
              [0.04 * r, -0.18 * r],
              [0.05 * r, 0.2 * r],
              [0, 0.22 * r],
            ],
            4,
          ),
          hatC,
          { scale: [1.4, 1, 0.8], pos: at(0, r * 0.25, headSurfaceZ(r, 0, r * 0.25) + r * 0.08) },
        ),
        'head',
      );
      break;
    }
    case 'hood': {
      const shell = shellClip(
        1.16,
        (xn, yn, zn) => yn > -0.72 && !(zn > 0.18 && yn < 0.62 && Math.abs(xn) < 0.86),
      );
      parts.add(part(shell, hatC, { pos: at(0, 0, 0) }), 'head');
      parts.add(
        part(cone(r * 0.32, r * 0.55, 5), hatC, { rot: [-2.3, 0, 0], pos: at(0, r * 0.35, -r * 1.0) }),
        'head',
      );
      const b = L.body;
      const n = L.pos.neck!;
      parts.add(
        part(
          lathe(
            [
              [b.torsoRX * 1.12, -b.torsoLen * 0.16],
              [b.torsoRX * 0.85, -b.torsoLen * 0.02],
              [b.torsoRX * 0.45, b.torsoLen * 0.06],
              [0, b.torsoLen * 0.07],
            ],
            seg.round,
          ),
          hatC,
          { scale: [1, 1, b.torsoRZ / b.torsoRX + 0.12], pos: [n.x, n.y, n.z] },
        ),
        'chest',
      );
      break;
    }
    case 'scarf': {
      // A kerchief: the cloth is turned around the face axis (a lathe about +Z, tilted a little down), so the
      // face opening is a clean oval with a darker rolled hem; it covers the crown, the sides and the back, wraps
      // under the chin to a small knot, and a point hangs at the back of the neck. Her dark fringe shows under
      // the hem (zRing, char-head.ts).
      const { open, tilt } = SCARF;
      const cloth = clipTris(
        zRing(r, tilt, seg.round + 7, [
          [1.09, Math.PI],
          [1.09, 2.45],
          [1.09, 1.85],
          [1.09, 1.35],
          [1.09, open + 0.08],
        ]),
        (_x, y, z) => !(y < -0.85 * r && z < 0.25 * r),
      );
      parts.add(part(cloth, hatC, { pos: at(0, 0, 0) }), 'head');
      const hem = zRing(r, tilt, seg.round + 7, [
        [1.12, open + 0.3],
        [1.135, open + 0.12],
        [1.1, open],
        [1.04, open - 0.03],
      ]);
      parts.add(part(hem, shade(hatC, -0.16), { pos: at(0, 0, 0) }), 'head');
      parts.add(
        part(lowSphere(r * 0.15, 1), shade(hatC, -0.1), { pos: at(r * 0.22, -r * 1.0, r * 0.52) }),
        'head',
      );
      parts.add(
        part(xform(cone(r * 0.34, r * 0.5, 4), { scale: [1, 1, 0.35] }), hatC, {
          rot: [Math.PI + 0.35, 0, 0],
          pos: at(0, -r * 0.55, -r * 0.92),
        }),
        'head',
      );
      break;
    }
    case 'wig': {
      parts.add(
        part(
          shellClip(1.14, (_x, yn, zn) => yn > 0.25 || (zn < -0.1 && yn > -0.35)),
          hatC,
          { pos: at(0, 0, 0) },
        ),
        'head',
      );
      for (let row = 0; row < 3; row++) {
        const y = (0.12 - 0.42 * row) * r;
        for (const ang of [1.45, 2.05, 2.65, Math.PI, -2.65, -2.05, -1.45]) {
          const k = r * (1.06 + row * 0.07);
          parts.add(
            part(jitter(lowSphere(r * 0.27, 0), r * 0.025, rng), hatC, {
              pos: at(Math.sin(ang) * k, y, Math.cos(ang) * k),
            }),
            'head',
          );
        }
      }
      break;
    }
    case 'mirrorMask': {
      const y = r * MASK_Y;
      const mask = slab(ellipse(r * 0.82, r * 0.42, 14), r * MASK_DEPTH);
      const maskC = ctx.col('hat', '#DCE3EA');
      const shine = (p: { x: number; y: number }): string =>
        Math.abs(p.x * 0.8 + p.y - r * 0.15) < r * 0.08 ? '#FFFFFF' : maskC;
      parts.add(part(mask, shine, { pos: at(0, y, headSurfaceZ(r, 0, y) * 0.97) }), 'head');
      break;
    }
    default:
      break;
  }
  if (ctx.extras.has('plume')) {
    // A crest of chunky feathers arching from the brow to the back of the head.
    const plumeC = ctx.col('plume', ctx.col('accent', '#4F7FA6'));
    const top = hatTop(hat);
    for (let i = 0; i < 4; i++) {
      const a = 0.55 - i * 0.42;
      parts.add(
        part(lowSphere(r * 0.2, 0), i % 2 === 0 ? plumeC : shade(plumeC, 0.07), {
          scale: [0.45, 1.5, 0.9],
          rot: [-a, 0, 0],
          pos: at(0, r * (top * Math.cos(a) + 0.18), r * top * Math.sin(a)),
        }),
        'hat',
      );
    }
  }
}
