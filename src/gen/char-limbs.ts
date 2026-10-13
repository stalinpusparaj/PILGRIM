/**
 * Character arms (sleeves, cuffs, mitten hands), legs (trousers, boots) and body extras (belts, apron, cape,
 * buttons, chains, bag...): the parts of buildBody() split out of char-body.ts to keep files under 400 lines.
 */
import * as THREE from 'three';
import { bevelBox, cone, lathe, lowSphere, part, xform } from './geom';
import { shade } from './palette';
import { type BuildCtx, bandProfile, clipTris, limb, slab } from './char-parts';

const A_POSE = (8 * Math.PI) / 180;
type Profile = Array<[number, number]>;

export function topKind(ctx: BuildCtx): NonNullable<BuildCtx['recipe']['parts']['top']> {
  return ctx.recipe.parts.top ?? (ctx.L.body.female ? 'dress' : 'tunic');
}

/** Sets z = z * f(y) on a geometry built around the hips (elliptical torso cross-sections). */
export function squashZ(g: THREE.BufferGeometry, f: (y: number) => number): THREE.BufferGeometry {
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) * f(p.getY(i)));
  p.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

/** Model-space point on the torso front at height y (relative to the hips), honouring the stoop. */
export function offsetOnChest(L: BuildCtx['L'], y: number, z: number): [number, number, number] {
  const st = L.body.stoop;
  const h = L.pos.hips!;
  return [h.x, h.y + y * Math.cos(st) - z * Math.sin(st), h.z + y * Math.sin(st) + z * Math.cos(st)];
}

export function buildArms(ctx: BuildCtx, sleeveC: string, sleeveTint: number, trimC: string): void {
  const { L, parts, seg } = ctx;
  const b = L.body;
  const skin = ctx.recipe.skin;
  const rolled = ctx.extras.has('sleeves');
  const s = b.scale;
  for (const [side, n] of [
    [1, 'L'],
    [-1, 'R'],
  ] as const) {
    const d = L.armDir(side);
    const rot: [number, number, number] = [0, 0, side * A_POSE];
    const sh = L.pos[`upperArm${n}`]!;
    const el = L.pos[`lowerArm${n}`]!;
    const wr = L.pos[`hand${n}`]!;
    const upLen = sh.distanceTo(el);
    const loLen = el.distanceTo(wr);
    const mid = (a: THREE.Vector3, t: number): [number, number, number] => {
      const p = a.clone().addScaledVector(d, t);
      return [p.x, p.y, p.z];
    };
    parts.add(
      part(limb(ctx.lod, b.armR, Math.max(0.01, upLen - b.armR * 0.6), seg.limb), sleeveC, {
        rot,
        pos: mid(sh, upLen * 0.5),
      }),
      `upperArm${n}`,
      { tint: sleeveTint },
    );
    parts.add(
      part(
        limb(ctx.lod, b.armR * 0.9, Math.max(0.01, loLen - b.armR * 0.7), seg.limb),
        rolled ? skin : sleeveC,
        { rot, pos: mid(el, loLen * 0.5) },
      ),
      `lowerArm${n}`,
      { tint: rolled ? 0 : sleeveTint },
    );
    if (rolled) {
      const cuff = lathe(bandProfile(b.armR * 1.02, 0.05 * s, 0.02 * s), seg.limb);
      parts.add(part(cuff, shade(sleeveC, -0.08), { rot, pos: mid(el, 0) }), `upperArm${n}`, {
        tint: sleeveTint,
      });
    } else if (ctx.extras.has('trim')) {
      const cuff = lathe(bandProfile(b.armR * 0.95, 0.04 * s, 0.014 * s), seg.limb);
      parts.add(part(cuff, trimC, { rot, pos: mid(el, loLen * 0.86) }), `lowerArm${n}`);
    }
    // Mitten hand + thumb.
    const hc = L.pos[`prop${n}`]!;
    const hand = part(lowSphere(b.handR, ctx.lod === 'hero' ? 1 : 0), skin, {
      scale: [0.8, 1.12, 0.92],
      rot,
      pos: [hc.x, hc.y, hc.z],
    });
    parts.add(hand, `hand${n}`);
    parts.add(
      part(lowSphere(b.handR * 0.42, 0), skin, {
        pos: [hc.x - side * b.handR * 0.3, hc.y + b.handR * 0.3, hc.z + b.handR * 0.6],
      }),
      `hand${n}`,
    );
    if (ctx.extras.has('chains')) {
      const shackle = lathe(bandProfile(b.armR * 1.05, 0.04 * s, 0.018 * s), seg.limb);
      parts.add(
        part(shackle, ctx.col('chains', '#8A8A8A'), { rot, pos: mid(el, loLen * 0.8) }),
        `lowerArm${n}`,
      );
    }
  }
}

export function buildLegs(ctx: BuildCtx, legC: string): void {
  const { L, parts, seg } = ctx;
  const b = L.body;
  const feetC = ctx.col('feet', '#4A3A2E');
  const thighLen = (b.legLen - b.footH) * 0.5;
  for (const n of ['L', 'R'] as const) {
    const th = L.pos[`thigh${n}`]!;
    const sh = L.pos[`shin${n}`]!;
    const ft = L.pos[`foot${n}`]!;
    parts.add(
      part(limb(ctx.lod, b.thighR, Math.max(0.01, thighLen - b.thighR * 0.4), seg.limb), legC, {
        pos: [th.x, th.y - thighLen * 0.5, th.z],
      }),
      `thigh${n}`,
    );
    parts.add(
      part(limb(ctx.lod, b.shinR, Math.max(0.01, thighLen - b.shinR * 0.6), seg.limb), legC, {
        pos: [sh.x, sh.y - thighLen * 0.5, sh.z],
      }),
      `shin${n}`,
    );
    const fh = b.footH * 1.35;
    const shoe = bevelBox(b.footW, fh, b.footLen, Math.min(fh * 0.45, b.footW * 0.42));
    parts.add(part(shoe, feetC, { pos: [ft.x, fh * 0.5, ft.z + b.footLen * 0.22] }), `foot${n}`);
    if (ctx.extras.has('chains')) {
      const shackle = lathe(bandProfile(b.shinR * 1.1, 0.04 * b.scale, 0.018 * b.scale), seg.limb);
      parts.add(
        part(shackle, ctx.col('chains', '#8A8A8A'), { pos: [ft.x, ft.y + b.footH * 0.9, ft.z] }),
        `shin${n}`,
      );
    }
  }
}

export function buildExtras(ctx: BuildCtx, trimC: string): void {
  const { L, parts, seg, extras } = ctx;
  const b = L.body;
  const T = b.torsoLen;
  const rx = b.torsoRX;
  const zs = b.torsoRZ / rx;
  const s = b.scale;
  const hips = L.pos.hips!;
  const chestRot: [number, number, number] = [b.stoop, 0, 0];
  const hipsPos: [number, number, number] = [hips.x, hips.y, hips.z];

  if (extras.has('ropeBelt') || extras.has('belt')) {
    const rope = extras.has('ropeBelt');
    const beltC = ctx.col('belt', ctx.col('accent', rope ? '#C9A66B' : '#5A3E2B'));
    const band = xform(
      lathe(bandProfile(rx * (1 + b.belly * 0.5), (rope ? 0.04 : 0.06) * s, 0.02 * s), seg.round),
      {
        scale: [1, 1, zs + 0.06],
      },
    );
    parts.add(part(band, beltC, { pos: [hips.x, hips.y + 0.24 * T, hips.z] }), 'hips');
    const knot: [number, number, number] = [hips.x - rx * 0.4, hips.y + 0.24 * T, hips.z + b.torsoRZ * 1.0];
    parts.add(part(lowSphere(0.035 * s, 0), beltC, { pos: knot }), 'hips');
    if (rope) {
      for (const dx of [-0.02, 0.025]) {
        parts.add(
          part(cone(0.016 * s, 0.11 * s, 4), beltC, {
            rot: [Math.PI - 0.15, 0, dx * 4],
            pos: [knot[0] + dx * s, knot[1] + 0.01 * s, knot[2] + 0.01 * s],
          }),
          'hips',
        );
      }
    }
  }
  if (extras.has('trim') || topKind(ctx) === 'judge') {
    const collarC = topKind(ctx) === 'judge' ? '#F4F1E8' : trimC;
    const collar = xform(lathe(bandProfile(rx * 0.55, 0.05 * s, 0.025 * s), seg.round), {
      scale: [1, 1, zs + 0.1],
    });
    parts.add(part(collar, collarC, { rot: chestRot, pos: offsetOnChest(L, 0.99 * T, 0) }), 'chest');
    if (topKind(ctx) === 'judge') {
      for (const dx of [-0.035, 0.035]) {
        const outline: Array<[number, number]> = [
          [-0.03, 0],
          [0.03, 0],
          [0.035, -0.12],
          [-0.035, -0.12],
        ];
        const tab = slab(
          outline.map(([x, y]) => [(x + dx) * s, y * s]),
          0.01 * s,
        );
        parts.add(
          part(tab, '#FFFFFF', { rot: chestRot, pos: offsetOnChest(L, 0.95 * T, b.torsoRZ * 0.75) }),
          'chest',
        );
      }
    }
  }
  if (extras.has('buttons')) {
    const buttonC = ctx.col('buttons', ctx.col('trim', '#E8C25A'));
    const cols = topKind(ctx) === 'coat' ? [-0.14, 0.14] : [0];
    const n = topKind(ctx) === 'coat' ? 5 : 4;
    for (const cx of cols) {
      for (let i = 0; i < n; i++) {
        const y = (0.3 + (0.55 * i) / (n - 1)) * T;
        const p = offsetOnChest(L, y, b.torsoRZ * (1 + b.belly * 0.6) + 0.005 * s);
        parts.add(
          part(lowSphere(0.022 * s, 0), buttonC, { scale: [1, 1, 0.6], pos: [p[0] + cx * rx, p[1], p[2]] }),
          'chest',
        );
      }
    }
  }
  if (extras.has('cape')) {
    const capeHem = -(b.legLen - b.footH) * 0.5;
    const cape: Profile = [
      [1.3, capeHem],
      [1.18, 0],
      [1.08, 0.5 * T],
      [1.0, 0.9 * T],
      [0.6, 1.0 * T],
      [0, 1.02 * T],
    ];
    const g = clipTris(
      squashZ(
        lathe(
          cape.map(([r, y]) => [r * rx, y]),
          seg.round,
        ),
        (y) => zs + (y < 0 ? 0.25 : 0.1),
      ),
      (_x, _y, z) => z < -b.torsoRZ * 0.15,
    );
    parts.add(
      part(g, ctx.col('cape', ctx.col('accent', '#7A3B2E')), { rot: chestRot, pos: hipsPos }),
      'chest',
    );
  }
  if (extras.has('bag')) {
    const bagC = ctx.col('bag', ctx.col('accent', '#8A6A45'));
    const strap = xform(lathe(bandProfile(rx * 1.04, 0.04 * s, 0.012 * s), seg.round), {
      scale: [1, 1, zs + 0.12],
    });
    parts.add(
      part(strap, shade(bagC, -0.12), { rot: [b.stoop, 0, -0.62], pos: offsetOnChest(L, 0.6 * T, 0) }),
      'chest',
    );
    const bag = bevelBox(0.07 * s, 0.15 * s, 0.17 * s, 0.025 * s);
    parts.add(
      part(bag, bagC, { pos: [hips.x - rx * 1.08, hips.y + 0.05 * T, hips.z + b.torsoRZ * 0.15] }),
      'hips',
    );
  }
  if (extras.has('chains')) {
    const chainC = ctx.col('chains', '#8A8A8A');
    for (let i = 0; i < 7; i++) {
      const t = i / 6;
      const xf = 0.7 - 1.4 * t;
      const zf = Math.sqrt(1 - xf * xf) * (1 + b.belly * 0.5);
      const p = offsetOnChest(L, (0.85 - 0.5 * t) * T, b.torsoRZ * zf + 0.012 * s);
      parts.add(
        part(lowSphere(0.026 * s, 0), chainC, { scale: [1, 0.7, 0.6], pos: [p[0] + xf * rx, p[1], p[2]] }),
        'chest',
      );
    }
  }
}
