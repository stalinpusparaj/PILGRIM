/**
 * Body parts: torso (pelvis on 'hips', chest on 'chest'), garments, arms with mitten hands, stubby legs with chunky
 * shoes, and the clothing extras (belt, apron, cape, buttons, trim, rolled sleeves, chains, bag).
 * Torso pieces are built upright around the hips joint, then tilted by the elder's stoop and moved into place.
 */
import * as THREE from 'three';
import { cylinder, lathe, part, xform } from './geom';
import { shade } from './palette';
import { type BuildCtx, bandProfile, clipTris, slab } from './char-parts';
import { buildArms, buildExtras, buildLegs, offsetOnChest, squashZ, topKind } from './char-limbs';

type Profile = Array<[number, number]>;

export function bottomKind(ctx: BuildCtx): NonNullable<BuildCtx['recipe']['parts']['bottom']> {
  return ctx.recipe.parts.bottom ?? (ctx.L.body.female ? 'skirt' : 'trousers');
}

interface Garment {
  hem: number;
  flare: number;
  color: string;
  tint: number;
  long: boolean;
  front?: string;
}

/** The lower garment hanging from the waist (hem y relative to the hips joint), or null for tucked-in tops. */
function garmentFor(ctx: BuildCtx): Garment | null {
  const b = ctx.L.body;
  const top = topKind(ctx);
  const bottom = bottomKind(ctx);
  const thighLen = (b.legLen - b.footH) * 0.5;
  const topC = ctx.col('top', '#8A6A4A');
  const botC = ctx.col('bottom', '#5B4636');
  const ankle = -b.legLen + b.footH * 0.9;
  if (top === 'robe' || top === 'judge') return { hem: ankle, flare: 1.32, color: topC, tint: 1, long: true };
  if (top === 'dress')
    return { hem: -b.legLen + b.footH * 1.6, flare: 1.5, color: topC, tint: 1, long: true };
  if (bottom === 'robe') return { hem: ankle, flare: 1.3, color: botC, tint: 0, long: true };
  if (bottom === 'skirt') return { hem: -thighLen * 1.5, flare: 1.34, color: botC, tint: 0, long: true };
  if (top === 'coat') {
    return { hem: -thighLen * 1.05, flare: 1.2, color: topC, tint: 1, long: false, front: shade(topC, -0.2) };
  }
  if (top === 'tunic') return { hem: -b.torsoLen * 0.32, flare: 1.12, color: topC, tint: 1, long: false };
  return null;
}

function garmentProfile(T: number, rx: number, gm: Garment, grow = 1): Profile {
  const top = 0.1 * T;
  const pts: Profile = [[gm.flare * 0.93, gm.hem]];
  const n = gm.long ? 4 : 2;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push([gm.flare + (1 - gm.flare) * Math.pow(t, 0.75), gm.hem + (top - gm.hem) * t]);
  }
  pts.push([0.98, 0.26 * T], [0.9, 0.33 * T], [0, 0.35 * T]);
  return pts.map(([r, y]) => [r * rx * grow, y]);
}

export function buildBody(ctx: BuildCtx): void {
  const { L, parts, seg } = ctx;
  const b = L.body;
  const T = b.torsoLen;
  const rx = b.torsoRX;
  const zs = b.torsoRZ / b.torsoRX;
  const hips = L.pos.hips!;
  const hipsPos: [number, number, number] = [hips.x, hips.y, hips.z];
  const chestRot: [number, number, number] = [b.stoop, 0, 0];
  const top = topKind(ctx);
  const skin = ctx.recipe.skin;
  const topC = ctx.col('top', '#8A6A4A');
  const botC = ctx.col('bottom', '#5B4636');
  const shirtC = ctx.col('shirt', '#F1E9D6');
  const trimC = ctx.col('trim', ctx.col('accent', '#E8C25A'));
  const gm = garmentFor(ctx);
  const s = b.scale;

  // --- pelvis (always there, in trouser colour; hidden under long garments)
  const hipW = b.female ? 1.06 : 1;
  const bel = b.belly;
  const pelvis: Profile = [
    [0, -0.17 * T],
    [0.55, -0.16 * T],
    [0.86 * hipW, -0.08 * T],
    [0.95 * hipW, 0.06 * T],
    [(0.95 + bel * 0.5) * hipW, 0.18 * T],
    [0.9, 0.32 * T],
    [0, 0.34 * T],
  ];
  const pelvisG = squashZ(
    lathe(
      pelvis.map(([r, y]) => [r * rx, y]),
      seg.round,
    ),
    () => zs,
  );
  parts.add(part(pelvisG, botC, { pos: hipsPos }), 'hips');

  // --- upper torso on the chest bone (its bottom tucks into the pelvis so spine bends never open a gap)
  const upper: Profile = b.female
    ? [
        [0, 0.14 * T],
        [0.78, 0.16 * T],
        [0.84, 0.32 * T],
        [0.95 + bel * 0.6, 0.52 * T],
        [1, 0.7 * T],
        [0.92, 0.88 * T],
        [0.62, 0.99 * T],
        [0.28, 1.03 * T],
        [0, 1.04 * T],
      ]
    : [
        [0, 0.14 * T],
        [0.8, 0.16 * T],
        [0.92, 0.3 * T],
        [1 + bel, 0.48 * T],
        [1.02, 0.7 * T],
        [0.95, 0.88 * T],
        [0.66, 0.99 * T],
        [0.3, 1.04 * T],
        [0, 1.05 * T],
      ];
  const upperG = (turn = 0, grow = 1) =>
    xform(
      squashZ(
        xform(
          lathe(
            upper.map(([r, y]) => [r * rx, y]),
            seg.round,
          ),
          { rot: [0, turn, 0] },
        ),
        () => zs,
      ),
      {
        scale: [grow, 1 + (grow - 1) * 0.3, grow],
      },
    );
  if (top === 'vest') {
    parts.add(part(upperG(), shirtC, { rot: chestRot, pos: hipsPos }), 'chest');
    // Vest shell: turned half a column so one lathe column faces front, then exactly that column is cut (whole quads,
    // tested by unsquashed angle) for a clean straight opening. Its flat faces must clear the torso's corners.
    const half = Math.PI / seg.round;
    const vest = clipTris(
      upperG(half, 1.03 / Math.cos(half)),
      (x, y, z) => (Math.abs(Math.atan2(x, z / zs)) > half * 1.02 || y > 0.97 * T) && y > 0.29 * T, // hem at the waistband
    );
    parts.add(part(vest, topC, { rot: chestRot, pos: hipsPos }), 'chest', { tint: 1 });
  } else {
    parts.add(part(upperG(), topC, { rot: chestRot, pos: hipsPos }), 'chest', { tint: 1 });
  }

  // --- lower garment (tunic hem, coat tails, robe, dress or skirt) on the hips
  if (gm) {
    const zsB = gm.long ? 0.92 : zs + 0.12;
    const zf = (y: number): number =>
      zs + (zsB - zs) * Math.min(1, Math.max(0, (0.1 * T - y) / (0.1 * T - gm.hem)));
    const front = gm.front;
    // Coat opening: the triangles touching the front centre line (by centroid angle, so it follows the facets).
    const slit = (Math.PI / seg.round) * 0.55;
    const painter = front
      ? (p: THREE.Vector3): string =>
          Math.abs(Math.atan2(p.x, p.z)) < slit && p.y < 0.12 * T ? front : gm.color
      : gm.color;
    const g = squashZ(lathe(garmentProfile(T, rx, gm), seg.round), zf);
    parts.add(part(g, painter, { pos: hipsPos }), 'hips', { tint: gm.tint });
    if (ctx.extras.has('trim')) {
      const band = squashZ(lathe(bandProfile(gm.flare * rx, 0.045 * s, 0.012 * s), seg.round), () =>
        zf(gm.hem),
      );
      parts.add(part(band, trimC, { pos: [hips.x, hips.y + gm.hem + 0.03 * s, hips.z] }), 'hips');
    }
    if (ctx.extras.has('apron')) {
      const apronHem = Math.max(gm.hem * 0.85, -b.legLen * 0.8);
      const apron = clipTris(
        squashZ(lathe(garmentProfile(T, rx, { ...gm, hem: apronHem }, 1.04), seg.round), zf),
        (x, y, z) => z > 0 && Math.abs(Math.atan2(x, z)) < 0.8 && y < 0.2 * T,
      );
      parts.add(part(apron, ctx.col('apron', '#F4EBD8'), { pos: hipsPos }), 'hips');
    }
  } else if (ctx.extras.has('apron')) {
    const thighLen = (b.legLen - b.footH) * 0.5;
    const ap: Garment = { hem: -thighLen * 1.2, flare: 1.12, color: '', tint: 0, long: false };
    const apron = clipTris(
      squashZ(lathe(garmentProfile(T, rx, ap, 1.06), seg.round), () => zs + 0.08),
      (x, y, z) => z > 0 && Math.abs(Math.atan2(x, z)) < 0.8 && y < 0.2 * T,
    );
    parts.add(part(apron, ctx.col('apron', '#F4EBD8'), { pos: hipsPos }), 'hips');
  }
  if (ctx.extras.has('apron')) {
    const bib = slab(
      [
        [-0.36 * rx, 0],
        [0.36 * rx, 0],
        [0.3 * rx, 0.3 * T],
        [-0.3 * rx, 0.3 * T],
      ],
      0.012 * s,
    );
    parts.add(
      part(bib, ctx.col('apron', '#F4EBD8'), {
        rot: chestRot,
        pos: offsetOnChest(L, 0.36 * T, b.torsoRZ * (1.02 + b.belly) + 0.004 * s),
      }),
      'chest',
    );
  }

  // --- neck
  const neckR = b.headR * 0.3;
  parts.add(
    part(cylinder(neckR, neckR * 1.1, b.neckLen + 0.09 * s, seg.limb), skin, {
      pos: [L.pos.neck!.x, L.pos.neck!.y - 0.05 * s, L.pos.neck!.z],
    }),
    'neck',
  );

  buildArms(ctx, top === 'vest' ? shirtC : topC, top === 'vest' ? 0 : 1, trimC);
  buildLegs(ctx, botC);
  buildExtras(ctx, trimC);
}
