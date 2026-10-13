/**
 * Assembles every part of a character from its recipe (shared by CharacterFactory and CrowdMesh), plus the extra
 * parts of the 'beast' body (wings, tail, jaw, horns, belly glow) bound to BEAST_BONES.
 */
import { cone, extrude, lowSphere, part, xform } from './geom';
import { shade } from './palette';
import type { Rng } from './rng';
import type { CharacterRecipe, MouthShape } from './char-types';
import { type BuildCtx, type Lod, type PartList, ellipse, makeCtx, slab } from './char-parts';
import { bodyFor, layoutRig, type Layout } from './rig';
import { buildBody } from './char-body';
import { buildHead, maskFrontZ } from './char-head';
import { buildFace } from './face';
import { buildBurden, buildProps } from './char-props';

export function assemble(
  recipe: CharacterRecipe,
  rng: Rng,
  lod: Lod,
  mouths: readonly MouthShape[],
): { parts: PartList; layout: Layout } {
  const body = bodyFor(recipe);
  const beast = recipe.body === 'beast';
  const front = recipe.parts.hat === 'mirrorMask' ? maskFrontZ(body.headR) : null;
  const layout = layoutRig(body, beast, front);
  const ctx = makeCtx(recipe, layout, rng, lod);
  buildBody(ctx);
  buildHead(ctx);
  buildFace(ctx, mouths);
  buildProps(ctx);
  if (lod === 'hero') buildBurden(ctx);
  if (beast) buildBeast(ctx);
  return { parts: ctx.parts, layout };
}

/** First pass of the beast body (Apollyon is refined with its chapter): bat wings, a three-bone tail, a jaw. */
function buildBeast(ctx: BuildCtx): void {
  const { L, parts } = ctx;
  const b = L.body;
  const s = b.scale;
  const r = b.headR;
  const scales = ctx.col('top', '#3F6F78');
  const wingC = ctx.col('wings', '#8C2F39');
  const span = b.torsoLen * 1.6;
  const wing: Array<[number, number]> = [
    [0, 0],
    [0.55, 0.45],
    [1, 0.62],
    [1.12, 0.2],
    [0.85, 0.05],
    [0.72, -0.32],
    [0.48, -0.1],
    [0.28, -0.42],
    [0.12, -0.12],
  ];
  for (const [side, n] of [
    [1, 'L'],
    [-1, 'R'],
  ] as const) {
    const at = L.pos[`wing${n}`]!;
    let g = extrude(
      wing.map(([x, y]) => [x * span, y * span]),
      0.03 * s,
    );
    if (side < 0) g = xform(g, { scale: [-1, 1, 1] });
    parts.add(part(g, wingC, { rot: [0.25, side * 0.6, 0], pos: [at.x, at.y, at.z] }), `wing${n}`);
  }
  const segs = ['tail1', 'tail2', 'tail3'] as const;
  for (let i = 0; i < segs.length; i++) {
    const a = L.pos[segs[i]!]!;
    const next =
      i + 1 < segs.length ? L.pos[segs[i + 1]!]! : a.clone().add(a.clone().sub(L.pos[segs[i - 1]!]!));
    const len = a.distanceTo(next);
    const rad = b.torsoRX * (0.32 - i * 0.08);
    const dir = next.clone().sub(a).normalize();
    const pitch = Math.atan2(-dir.z, dir.y);
    parts.add(
      part(cone(rad, len * 1.1, 6), shade(scales, -0.05 * i), { rot: [-pitch, 0, 0], pos: [a.x, a.y, a.z] }),
      segs[i]!,
    );
  }
  const jaw = L.pos.jaw!;
  parts.add(
    part(lowSphere(r * 0.42, 1), shade(scales, 0.05), {
      scale: [1.15, 0.5, 0.95],
      pos: [jaw.x, jaw.y, jaw.z],
    }),
    'jaw',
  );
  const c = L.headC;
  for (const side of [1, -1]) {
    parts.add(
      part(cone(r * 0.14, r * 0.6, 5), ctx.col('horns', '#E8D8B0'), {
        rot: [-0.5, 0, -side * 0.5],
        pos: [c.x + side * r * 0.55, c.y + r * 0.7, c.z - r * 0.1],
      }),
      'head',
    );
  }
  const hips = L.pos.hips!;
  parts.add(
    part(slab(ellipse(b.torsoRX * 0.55, b.torsoLen * 0.25, 9), 0.02 * s), ctx.col('glow', '#FF7A2F'), {
      pos: [hips.x, hips.y + b.torsoLen * 0.42, hips.z + b.torsoRZ * (1 + b.belly) + 0.004 * s],
    }),
    'chest',
    { glow: true },
  );
}
