/**
 * Chunky held props (staff, candle, lantern, keys, book, gavel, crook, sword, shield, cane, letter, toy, club, pole)
 * merged rigidly onto propL / propR / back, and the Burden sack (GDD 2.7.1) on the 'sack' bone with its shoulder
 * ropes on the internal 'ropes' bone. Props are built in a grip frame: origin at the hand centre, Y up, +Z forward,
 * outward = +X for the left hand.
 */
import * as THREE from 'three';
import { cylinder, jitter, lathe, lowSphere, part, xform, type Vec3 } from './geom';
import { shade } from './palette';
import { type BuildCtx, bandProfile, mottled } from './char-parts';
import { propPieces } from './char-prop-shapes';

export function buildProps(ctx: BuildCtx): void {
  const { L, parts } = ctx;
  const props = ctx.recipe.props ?? [];
  for (const pr of props) {
    const onBack = pr.bone === 'back';
    const side = pr.bone === 'propR' ? -1 : 1;
    const grip = L.pos[pr.bone]!;
    const pieces = propPieces(ctx, pr.type, side, grip.y, L.height, onBack);
    let rot: Vec3 = [0, 0, 0];
    let pos: Vec3 = [grip.x, grip.y, grip.z];
    if (onBack) {
      // Long things go diagonally across the back, flat things hang flat against it.
      const box = new THREE.Box3();
      for (const p of pieces) {
        p.g.computeBoundingBox();
        box.union(p.g.boundingBox!);
      }
      const ctr = box.getCenter(new THREE.Vector3());
      for (const p of pieces) xform(p.g, { pos: [-ctr.x, -ctr.y, -ctr.z] });
      const size = box.getSize(new THREE.Vector3());
      const long = size.y > L.body.torsoLen * 1.2;
      rot = long ? [0, 0, 0.7] : [0, 0, 0];
      pos = [
        grip.x,
        grip.y - (long ? 0 : L.body.torsoLen * 0.1),
        grip.z - size.z * 0.5 - 0.02 * L.body.scale,
      ];
    }
    for (const p of pieces) parts.add(part(p.g, p.hex, { rot, pos }), pr.bone, { glow: p.glow ?? false });
  }
}

/** The Burden: a big lumpy cloth sack tied with rope, almost as tall as torso + head (GDD 2.7.1). */
export function buildBurden(ctx: BuildCtx): void {
  if (!ctx.recipe.burden) return;
  const { L, parts, rng } = ctx;
  const b = L.body;
  const s = b.scale;
  const P = L.pos.sack!;
  const H = (L.height - b.legLen) * 0.92;
  const W = Math.max(b.torsoRX * 2 * 1.45, H * 0.62);
  const D = H * 0.52;
  const sackC = ctx.col('sack', '#A38A62');
  const ropeC = ctx.col('sackRope', ctx.col('belt', '#C9A66B'));
  const cy = P.y + H * 0.08;
  const cz = P.z - D * 0.5 - 0.01 * s;
  const detail = ctx.lod === 'hero' ? 1 : 0;

  const body = jitter(xform(lowSphere(1, detail), { scale: [W / 2, H / 2, D / 2] }), H * 0.035, rng);
  parts.add(part(body, mottled(sackC, rng, 0.04), { pos: [P.x, cy, cz] }), 'sack');
  for (const [dx, dy, dz, k] of [
    [0.3, -0.26, -0.1, 0.17],
    [-0.32, -0.2, -0.05, 0.16],
    [0.08, 0.06, -0.42, 0.15],
  ] as const) {
    const lump = jitter(lowSphere(H * k, 0), H * 0.02, rng);
    parts.add(
      part(lump, mottled(shade(sackC, -0.03), rng, 0.04), { pos: [P.x + dx * W, cy + dy * H, cz + dz * D] }),
      'sack',
    );
  }
  // Gathered neck, top knot and the rope that ties it.
  parts.add(
    part(cylinder(W * 0.12, W * 0.22, H * 0.14, 7), shade(sackC, -0.05), { pos: [P.x, cy + H * 0.4, cz] }),
    'sack',
  );
  parts.add(
    part(jitter(lowSphere(W * 0.17, 0), W * 0.03, rng), sackC, {
      scale: [1.3, 0.75, 1.1],
      pos: [P.x, cy + H * 0.58, cz],
    }),
    'sack',
  );
  parts.add(
    part(lathe(bandProfile(W * 0.13, 0.035 * s, 0.018 * s), 7), ropeC, { pos: [P.x, cy + H * 0.5, cz] }),
    'sack',
  );
  // Two rope bands around the sack.
  for (const dy of [-0.2, 0.17]) {
    const k = Math.sqrt(1 - (dy * 2) ** 2) * 1.01;
    const band = xform(lathe(bandProfile((W / 2) * k, 0.04 * s, 0.018 * s), 10), { scale: [1, 1, D / W] });
    parts.add(part(band, ropeC, { pos: [P.x, cy + dy * H, cz] }), 'sack');
  }
  // Shoulder straps on the ropes bone (hidden with the sack).
  for (const n of ['L', 'R'] as const) {
    const sh = L.pos[`upperArm${n}`]!;
    const strap = lathe(bandProfile(b.armR * 1.6, 0.035 * s, 0.016 * s), 7);
    parts.add(
      part(strap, ropeC, {
        rot: [0, 0, Math.PI / 2],
        pos: [sh.x * 0.82, sh.y + b.armR * 0.3, sh.z - 0.01 * s],
      }),
      'ropes',
    );
  }
}
