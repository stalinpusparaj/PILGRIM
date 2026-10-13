/**
 * Head parts: the big round head, ears, nose, cheeks, the forehead glow dot, hair, beards and hats.
 * Things that should wobble (bun, long hair, tufts, caps, tall/droopy hats, plumes) go on the 'hat' bone, whose
 * pivot is the top of the head; everything that hugs the skull stays on 'head'.
 */
import type * as THREE from 'three';
import { capsule, cone, jitter, lowSphere, part, xform } from './geom';
import { mix, shade } from './palette';
import { type BuildCtx, clipTris, ellipse, skirt, slab, surfaceRot } from './char-parts';
import { headSurfaceZ } from './rig';
import { SCARF as SCARF_FRINGE, buildHat, zRing } from './char-hats';

type V3 = [number, number, number];

export { maskFrontZ } from './char-hats';

export function buildHead(ctx: BuildCtx): void {
  const { L, parts, seg } = ctx;
  const r = L.body.headR;
  const c = L.headC;
  const skin = ctx.recipe.skin;
  const hat = ctx.recipe.parts.hat ?? 'none';
  const at = (x: number, y: number, z: number): V3 => [c.x + x, c.y + y, c.z + z];
  const onFace = (x: number, y: number, out = 0): V3 => at(x, y, headSurfaceZ(r, x, y) + out);

  parts.add(part(lowSphere(r, seg.sphere), skin, { pos: at(0, 0, 0) }), 'head');

  const covered = hat === 'hood' || hat === 'scarf' || hat === 'helmet' || hat === 'wig';
  if (!covered) {
    for (const side of [1, -1]) {
      parts.add(
        part(lowSphere(r * 0.17, 0), shade(skin, -0.04), {
          scale: [0.5, 1, 0.8],
          pos: at(side * r * 0.97, -r * 0.1, -r * 0.02),
        }),
        'head',
      );
    }
  }
  if (hat !== 'mirrorMask') {
    const noseY = -r * 0.18;
    if (L.body.type === 'giantess') {
      parts.add(
        part(cone(r * 0.09, r * 0.36, 5), shade(skin, -0.05), {
          rot: [Math.PI / 2, 0, 0],
          pos: onFace(0, noseY, -r * 0.02),
        }),
        'head',
      );
    } else {
      parts.add(
        part(lowSphere(r * 0.1, 0), shade(skin, -0.06), { scale: [1.05, 0.85, 0.9], pos: onFace(0, noseY) }),
        'head',
      );
    }
  }
  const blush = ctx.extras.has('blush') || ['child', 'adultF', 'youngAdult'].includes(L.body.type);
  if (blush && ctx.lod === 'hero' && hat !== 'mirrorMask') {
    for (const side of [1, -1]) {
      const x = side * r * 0.5;
      const y = -r * 0.22;
      parts.add(
        part(slab(ellipse(r * 0.1, r * 0.065, 7), r * 0.012), mix(skin, '#E36F6F', 0.32), {
          rot: surfaceRot(r, x, y),
          pos: onFace(x, y, -r * 0.004),
        }),
        'head',
      );
    }
  }
  if (ctx.extras.has('glowDot')) {
    // Between the brows and the hairline, so no fringe covers it.
    parts.add(
      part(lowSphere(r * 0.07, 1), ctx.col('glow', '#FFF3B0'), {
        scale: [1, 1, 0.6],
        pos: onFace(0, r * 0.385),
      }),
      'head',
      { glow: true },
    );
  }
  buildHair(ctx, covered);
  buildBeard(ctx);
  buildHat(ctx);
}

/** Height (head radii above the centre) where each hat's crown starts; hair above it is hidden. */
const HAT_LINE: Partial<Record<string, number>> = { cap: 0.2, tall: 0.55, droopy: 0.45 };
/**
 * Front hairline (head radii above the centre). Heroes keep a higher fringe so raised brows (surprised, scared:
 * see face.ts BROW_LIFT_MAX) always stay on skin, under the fringe, never behind it.
 */
export const FRINGE = { hero: 0.5, crowd: 0.42 } as const;
/** Side hair comes forward to this |x| (head radii) beside the face. */
const SIDE_X = 0.85;
/** Back hair: down to the nape, tapering in to just off the skull (head radii). */
const NAPE = { top: -0.02, bottom: -0.5, radius: 1.015 };

/**
 * The hair bowl: crown above the fringe, the sides down to the ears, the back down to the nape. The back starts
 * only where its lower rim hides behind the skull's silhouette seen from the front (z < -sqrt(k² - 1) for a
 * shell of radius k), and the nape tapers in towards the skull, so no edge-on rim ever stands out beside the
 * face with sky showing between hair and cheek.
 */
function hairBowl(grow: number, fringe: number, hatLine: number) {
  const radiusAt = (yn: number): number =>
    yn >= NAPE.top
      ? grow
      : grow + (NAPE.radius - grow) * Math.min(1, (NAPE.top - yn) / (NAPE.top - NAPE.bottom));
  // The sides come forward to x ≈ SIDE_X: their front edge then lies over the skull (seen from the front), not
  // beyond its silhouette, and still clears the eyes, cheeks and brows.
  const faceZ = Math.sqrt(Math.max(0, grow * grow - SIDE_X * SIDE_X));
  const keep = (xn: number, yn: number, zn: number): boolean => {
    if (yn >= hatLine) return false;
    // Outside the brows the fringe slopes down into the side hair (no notch at the temples).
    if (yn > fringe - Math.max(0, Math.abs(xn) - 0.58) * 1.2) return true;
    if (zn >= faceZ) return false; // the face
    if (yn > NAPE.top) return true; // sides, above the ears
    if (yn <= NAPE.bottom) return false;
    const k = radiusAt(yn);
    return zn * (k / grow) < -(Math.sqrt(Math.max(0, k * k - 1)) + 0.03);
  };
  return { keep, radiusAt };
}

/** Pulls each vertex of a hair shell (radius grow·r, centred at 0) in to radiusAt(y) (head radii). */
function taper(g: THREE.BufferGeometry, r: number, grow: number, radiusAt: (yn: number) => number): void {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const s = radiusAt(pos.getY(i) / r) / grow;
    pos.setXYZ(i, pos.getX(i) * s, pos.getY(i) * s, pos.getZ(i) * s);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
}

function buildHair(ctx: BuildCtx, covered: boolean): void {
  const { L, parts, seg, rng } = ctx;
  const r = L.body.headR;
  const c = L.headC;
  const hairC = ctx.col('hair', '#4A3426');
  const style = ctx.recipe.parts.hair ?? 'short';
  const hat = ctx.recipe.parts.hat ?? 'none';
  const at = (x: number, y: number, z: number): V3 => [c.x + x, c.y + y, c.z + z];
  const grow = seg.sphere >= 2 ? 1.07 : 1.13;
  const cap = (keep: (xn: number, yn: number, zn: number) => boolean, k = grow) =>
    clipTris(lowSphere(r * k, seg.sphere), (x, y, z) => keep(x / r, y / r, z / r));
  // Under a cap or brimmed hat the hair stops at the hat line so it never pokes through the crown.
  const hatLine = HAT_LINE[hat] ?? 9;
  const fringe = ctx.lod === 'hero' ? FRINGE.hero : FRINGE.crowd;

  if (hat === 'scarf' && style !== 'none' && style !== 'bald') {
    // A headscarf shows a little fringe above the brows (char-hats.ts frames the face around it).
    const band = zRing(r, SCARF_FRINGE.tilt, seg.round + 7, [
      [1.035, SCARF_FRINGE.open + 0.06],
      [1.035, SCARF_FRINGE.open - 0.17],
    ]);
    parts.add(
      part(
        clipTris(band, (_x, y) => y > 0.3 * r),
        hairC,
        { pos: at(0, 0, 0) },
      ),
      'head',
    );
    return;
  }
  if (covered || style === 'none') return; // hoods, helmets and wigs hide the hair
  if (style === 'bald') {
    const ring = cap((_x, yn, zn) => yn > -0.3 && yn < 0.25 && zn < 0.2, grow - 0.01);
    parts.add(part(jitter(ring, r * 0.02, rng), hairC, { pos: at(0, 0, 0) }), 'head');
    return;
  }
  const bowl = hairBowl(grow, fringe, hatLine);
  const shell = cap(bowl.keep);
  taper(shell, r, grow, bowl.radiusAt);
  parts.add(part(jitter(skirt(shell, 0.9 * r), r * 0.025, rng), hairC, { pos: at(0, 0, 0) }), 'head');
  if (style === 'curls') {
    // Round bumps over the crown; heroes get smoother ones (outer half only, the rest is inside the hair cap).
    const hero = ctx.lod === 'hero';
    const n = hero ? 11 : 6;
    for (let i = 0; i < n; i++) {
      const th = Math.acos(1 - ((i + 0.5) / n) * 1.25);
      const ph = i * 2.39996;
      const x = Math.sin(th) * Math.sin(ph);
      const y = Math.cos(th);
      const z = Math.sin(th) * Math.cos(ph);
      if ((z > 0.3 && y < 0.55) || y > hatLine) continue; // keep the face clear and the hat on top
      const k = r * (grow + 0.02);
      const cr = r * 0.25;
      const curl = hero
        ? clipTris(lowSphere(cr, 1), (px, py, pz) => px * x + py * y + pz * z > -cr * 0.25)
        : lowSphere(cr, 0);
      parts.add(part(jitter(curl, r * 0.012, rng), hairC, { pos: at(x * k, y * k, z * k) }), 'head');
    }
  } else if (style === 'bun' && hatLine > 1) {
    parts.add(part(lowSphere(r * 0.34, 1), hairC, { pos: at(0, r * 0.55, -r * 0.8) }), 'hat');
  } else if (style === 'long') {
    const back = xform(capsule(r * 0.55, r * 0.75, seg.limb + 1), { scale: [1.45, 1, 0.5] });
    parts.add(part(jitter(back, r * 0.02, rng), hairC, { pos: at(0, -r * 0.3, -r * 0.72) }), 'head');
  } else if (style === 'tuft' && hatLine > 1) {
    for (const [dx, tilt] of [
      [-0.1, -0.35],
      [0.05, 0.1],
      [0.18, 0.5],
    ] as const) {
      parts.add(
        part(cone(r * 0.12, r * 0.4, 5), hairC, { rot: [0.35, 0, tilt], pos: at(dx * r, r * 0.95, r * 0.2) }),
        'hat',
      );
    }
  }
}

function buildBeard(ctx: BuildCtx): void {
  const { L, parts, seg, rng } = ctx;
  const style = ctx.recipe.parts.beard ?? 'none';
  if (style === 'none') return;
  const r = L.body.headR;
  const c = L.headC;
  const beardC = ctx.col('beard', ctx.col('hair', '#4A3426'));
  const at = (x: number, y: number, z: number): V3 => [c.x + x, c.y + y, c.z + z];
  const k = style === 'short' ? 1.05 : 1.1;
  const shell = clipTris(lowSphere(r * k, seg.sphere), (x, y, z) => {
    const xn = x / r;
    const yn = y / r;
    const zn = z / r;
    const chin = yn < -0.54 && yn > -1.05 && zn > -0.3;
    const burns = Math.abs(xn) > 0.72 && yn < 0.05 && zn > -0.35 && zn < 0.55;
    return chin || burns;
  });
  parts.add(part(jitter(shell, r * 0.02, rng), beardC, { pos: at(0, 0, 0) }), 'head');
  if (style === 'short') return;
  for (const side of [1, -1]) {
    const y = -r * 0.29;
    parts.add(
      part(capsule(r * 0.065, r * 0.2, 5), beardC, {
        rot: [0, 0, side * (Math.PI / 2 - 0.3)],
        pos: at(side * r * 0.15, y, headSurfaceZ(r, side * r * 0.15, y) + r * 0.03),
      }),
      'head',
    );
  }
  if (style === 'long') {
    const wedge = jitter(xform(cone(r * 0.5, r * 1.0, 6), { scale: [1, 1, 0.55] }), r * 0.04, rng);
    parts.add(part(wedge, beardC, { rot: [Math.PI - 0.25, 0, 0], pos: at(0, -r * 0.62, r * 0.6) }), 'head');
  }
}
