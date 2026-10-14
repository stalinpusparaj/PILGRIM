/**
 * The look of one Slough stepping stone (slough-steps.ts): a flat rounded stone and its glowing top disc, and the
 * springy ease the stones rise with.
 */
import type * as THREE from 'three';
import { cylinder, jitter, part } from '../gen/geom';
import { mix, shade, type Palette } from '../gen/palette';
import { Rng, hashString } from '../gen/rng';

/** Glowing top disc: radius, thickness (m), and how much bigger it pops while rising. */
export const GLOW = { radius: 0.4, height: 0.03, pop: 0.8 };

/** Ease out with a little overshoot: the stone bobs up past the surface and settles. */
export function easeOutBack(t: number): number {
  const u = t - 1;
  return 1 + 2.4 * u * u * u + 1.4 * u * u;
}

/** One flat rounded stone (top at y = 0) and its glowing top disc. */
export function stoneGeometry(
  pal: Palette,
  glowHex: string,
  dims: { readonly topR: number; readonly bottomR: number; readonly depth: number },
): { body: THREE.BufferGeometry; glow: THREE.BufferGeometry } {
  const rng = new Rng(hashString('slough:stone'));
  const base = mix(pal.ground.pathEdge, '#9C978C', 0.55);
  const topHex = mix(base, glowHex, 0.35);
  const sideHex = shade(base, -0.12);
  const body = part(
    jitter(cylinder(dims.topR, dims.bottomR, dims.depth, 9), 0.03, rng),
    (_p, n) => (n.y > 0.5 ? topHex : sideHex),
    { pos: [0, -dims.depth, 0] },
  );
  const glow = part(cylinder(GLOW.radius, GLOW.radius + 0.03, GLOW.height, 9), glowHex, {
    pos: [0, 0.006, 0],
  });
  return { body, glow };
}
