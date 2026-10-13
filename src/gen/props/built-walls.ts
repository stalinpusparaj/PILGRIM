/**
 * Boundaries and crossings: dry-stone walls (with the shared `wallRun` used by gates and stiles), rail fences,
 * the stile (GDD Ch XI) and a plank footbridge. Walls and fences run along X, centred on the origin, facing +Z.
 */
import { cone, jitter, paint, xform, type Vec3 } from '../geom';
import { shade, type Palette } from '../palette';
import type { Rng } from '../rng';
import type { PropParams, PropResult } from '../types';
import { beam, bool, box, clamp, kit, num, Parts, rod, tone, type Kit } from './built-kit';

export interface WallRunOpts {
  x0: number;
  x1: number;
  z?: number;
  /** Base height (for wall above a doorway). */
  y0?: number;
  height: number;
  thick: number;
  color: string;
  cap?: string;
  /** Longest segment; one box collider per segment. */
  maxSeg?: number;
}

/**
 * A run of staggered, jittered stone blocks over a mortar core, with a chamfered cap per segment.
 * Budget: at most 4 rows × 3 blocks + core + cap = 184 triangles per segment.
 */
export function wallRun(P: Parts, rng: Rng, o: WallRunOpts): void {
  const len = o.x1 - o.x0;
  if (len < 0.1 || o.height < 0.1) return;
  const z = o.z ?? 0;
  const y0 = o.y0 ?? 0;
  const segs = Math.max(1, Math.round(len / (o.maxSeg ?? 2.6)));
  const segLen = len / segs;
  const capH = Math.min(0.2, o.height * 0.15);
  const bodyH = o.height - capH;
  const rows = clamp(Math.round(bodyH / 0.5), 1, 4);
  const rowH = bodyH / rows;
  const perRow = segLen < 1.3 ? 2 : 3;
  const u = segLen / perRow;
  const mortar = shade(o.color, -0.14); // shows in the gaps between blocks
  for (let s = 0; s < segs; s++) {
    const sx = o.x0 + s * segLen;
    P.add(box(segLen, bodyH, o.thick - 0.1, mortar, { pos: [sx + segLen / 2, y0 + bodyH / 2, z] }));
    for (let r = 0; r < rows; r++) {
      // Running bond: odd rows start with a half block.
      const cuts = [0];
      for (let i = 1; i < perRow; i++) cuts.push((i - (r % 2) * 0.5 + rng.range(-0.12, 0.12)) * u);
      cuts.push(segLen);
      for (let i = 0; i + 1 < cuts.length; i++) {
        const a = cuts[i]!;
        const l = cuts[i + 1]! - a;
        const g = box(l - 0.045, rowH - 0.04, o.thick + rng.range(-0.02, 0.06), tone(o.color, 0.07, rng), {
          pos: [sx + a + l / 2, y0 + r * rowH + rowH / 2, z + rng.range(-0.025, 0.025)],
          rot: [0, rng.range(-0.025, 0.025), rng.range(-0.02, 0.02)],
        });
        P.add(jitter(g, Math.min(0.035, rowH * 0.07), rng));
      }
    }
    const cap = box(
      segLen + 0.04,
      capH,
      o.thick + 0.14,
      tone(o.cap ?? o.color, 0.03, rng),
      {
        pos: [sx + segLen / 2, y0 + bodyH + capH / 2, z],
        rot: [rng.range(-0.01, 0.01), 0, rng.range(-0.012, 0.012)],
      },
      0.04,
    );
    P.add(cap);
    P.boxCol(sx + segLen / 2, z, segLen, o.height, o.thick + 0.14, 0, y0);
  }
}

/** A chunky square pillar with a cap and a little pyramid top (wall ends, gate piers). */
export function pillar(
  P: Parts,
  rng: Rng,
  k: Kit,
  x: number,
  z: number,
  h: number,
  size: number,
  color: string,
): void {
  P.add(jitter(box(size, h, size, tone(color, 0.04, rng), { pos: [x, h / 2, z] }, 0.05), 0.03, rng));
  P.add(box(size + 0.16, 0.18, size + 0.16, tone(k.stoneLight, 0.03, rng), { pos: [x, h + 0.09, z] }, 0.04));
  P.add(
    xform(paint(cone(size * 0.55, size * 0.45, 4), tone(k.stoneDark, 0.03, rng)), {
      pos: [x, h + 0.18, z],
      rot: [0, Math.PI / 4, 0],
    }),
  );
  P.boxCol(x, z, size + 0.16, h + 0.2, size + 0.16);
}

/** params: length (6), height (1.3), thick (0.6), pillars (true). */
export function buildWall(rng: Rng, pal: Palette, p: PropParams): PropResult {
  const k = kit(pal);
  const P = new Parts();
  const L = num(p, 'length', 6, 1, 80);
  const h = num(p, 'height', 1.3, 0.4, 7);
  const t = num(p, 'thick', 0.6, 0.3, 1.5);
  const pillars = bool(p, 'pillars', true) && L >= 2.5;
  const ps = t + 0.25;
  const inset = pillars ? ps / 2 : 0;
  wallRun(P, rng, {
    x0: -L / 2 + inset,
    x1: L / 2 - inset,
    height: h,
    thick: t,
    color: k.wall,
    cap: k.stoneLight,
  });
  if (pillars) {
    pillar(P, rng, k, -L / 2 + ps / 2, 0, h + 0.2, ps, k.wall);
    pillar(P, rng, k, L / 2 - ps / 2, 0, h + 0.2, ps, k.wall);
  }
  return P.done();
}

/**
 * params: length (6), posts (length / 2 + 1), height (1.1), endPost (true; false leaves the +X end open so
 * pieces laid end to end in a run share one post at each joint). Rail fence with leaning posts.
 */
export function buildFence(rng: Rng, pal: Palette, p: PropParams): PropResult {
  const k = kit(pal);
  const P = new Parts();
  const L = num(p, 'length', 6, 1, 60);
  const n = Math.round(num(p, 'posts', Math.round(L / 2) + 1, 2, 41));
  const h = num(p, 'height', 1.1, 0.5, 2);
  const endPost = bool(p, 'endPost', true);
  const tops: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const x = -L / 2 + (L * i) / (n - 1);
    const ph = h + rng.range(0.05, 0.2);
    const lx = rng.range(-0.06, 0.06);
    const lz = rng.range(-0.05, 0.05);
    const col = tone(k.wood, 0.06, rng);
    if (i === n - 1 && !endPost) {
      tops.push([x, ph, 0]);
      continue;
    }
    P.add(rod(0.085, 0.11, ph, col, { pos: [x, 0, 0], rot: [lz, 0, lx] }, 6));
    P.add(
      xform(paint(cone(0.1, 0.13, 6), tone(k.woodDark, 0.03, rng)), {
        pos: [x - Math.sin(lx) * ph, Math.cos(lx) * ph - 0.01, Math.sin(lz) * ph],
        rot: [lz, 0, lx],
      }),
    );
    tops.push([x - Math.sin(lx) * ph, ph, Math.sin(lz) * ph]);
  }
  for (let i = 0; i + 1 < n; i++) {
    const a = tops[i]!;
    const b = tops[i + 1]!;
    for (const fy of [0.38, 0.8]) {
      // A rail occasionally slips at one end for the hand-made look.
      const slip = rng.chance(0.12) ? rng.range(-0.18, -0.08) : rng.range(-0.03, 0.03);
      const ya = h * fy + rng.range(-0.03, 0.03);
      const yb = h * fy + slip;
      const col = tone(k.woodLight, 0.05, rng);
      P.add(beam([a[0], ya, a[2] * fy + 0.06], [b[0], yb, b[2] * fy + 0.06], 0.07, col, 0.12));
    }
    P.boxCol((a[0] + b[0]) / 2, 0, Math.abs(b[0] - a[0]), h, 0.26);
  }
  return P.done();
}

/**
 * params: length (5), height (1.2). A stone wall with wooden steps over it. Steps rise 0.28 m at a time so the
 * controller's 0.3 m step-up carries the player over (each step has its own box collider).
 */
export function buildStile(rng: Rng, pal: Palette, p: PropParams): PropResult {
  const k = kit(pal);
  const P = new Parts();
  const L = num(p, 'length', 5, 2.4, 30);
  const h = num(p, 'height', 1.2, 0.9, 2);
  const gap = 0.6;
  wallRun(P, rng, { x0: -L / 2, x1: -gap, height: h, thick: 0.6, color: k.wall, cap: k.stoneLight });
  wallRun(P, rng, { x0: gap, x1: L / 2, height: h, thick: 0.6, color: k.wall, cap: k.stoneLight });
  wallRun(P, rng, { x0: -gap, x1: gap, height: 0.62, thick: 0.6, color: k.wall, cap: k.stoneLight });
  // Upright posts either side of the crossing.
  for (const sx of [-1, 1]) {
    P.add(
      rod(
        0.08,
        0.1,
        h + 0.45,
        tone(k.wood, 0.05, rng),
        { pos: [sx * (gap + 0.05), 0, 0.36], rot: [0, 0, sx * 0.04] },
        6,
      ),
    );
    P.add(
      rod(
        0.08,
        0.1,
        h + 0.45,
        tone(k.wood, 0.05, rng),
        { pos: [sx * (gap + 0.05), 0, -0.36], rot: [0, 0, sx * 0.04] },
        6,
      ),
    );
  }
  const steps: Array<[number, number, number]> = [
    [0.28, 0.82, 0.34],
    [0.56, 0.5, 0.32],
    [0.84, 0, 0.66],
    [0.56, -0.5, 0.32],
    [0.28, -0.82, 0.34],
  ];
  for (const [top, z, depth] of steps) {
    const w = 1.08 + rng.range(-0.04, 0.04);
    P.add(
      box(
        w,
        0.08,
        depth,
        tone(k.woodLight, 0.05, rng),
        { pos: [0, top - 0.04, z], rot: [0, rng.range(-0.04, 0.04), 0] },
        0.02,
      ),
    );
    if (top < 0.8) {
      for (const sx of [-1, 1])
        P.add(box(0.08, top - 0.08, 0.08, k.woodDark, { pos: [sx * 0.42, (top - 0.08) / 2, z] }));
    }
    P.boxCol(0, z, 1.1, top, depth);
  }
  return P.done();
}

/** params: length (4, along Z), width (1.6), rails (true). Plank footbridge; deck top at 0.22 m. */
export function buildBridgePlank(rng: Rng, pal: Palette, p: PropParams): PropResult {
  const k = kit(pal);
  const P = new Parts();
  const L = num(p, 'length', 4, 1.5, 16);
  const w = num(p, 'width', 1.6, 0.8, 4);
  const rails = bool(p, 'rails', true);
  const deck = 0.22;
  for (const sx of [-1, 1]) P.add(box(0.16, 0.16, L, k.woodDark, { pos: [sx * (w / 2 - 0.18), 0.08, 0] }));
  const planks = Math.max(3, Math.round(L / 0.33));
  const pitch = L / planks;
  for (let i = 0; i < planks; i++) {
    const z = -L / 2 + pitch * (i + 0.5);
    const g = box(w + rng.range(-0.06, 0.12), 0.07, pitch - 0.04, tone(k.woodLight, 0.07, rng), {
      pos: [rng.range(-0.05, 0.05), deck - 0.035 + rng.range(-0.012, 0.012), z],
      rot: [0, rng.range(-0.05, 0.05), rng.range(-0.02, 0.02)],
    });
    P.add(g);
  }
  P.boxCol(0, 0, w, deck, L);
  if (rails) {
    const posts = Math.max(2, Math.round(L / 2.2) + 1);
    for (const sx of [-1, 1]) {
      const tops: Vec3[] = [];
      for (let i = 0; i < posts; i++) {
        const z = -L / 2 + 0.15 + ((L - 0.3) * i) / (posts - 1);
        const x = sx * (w / 2 + 0.02);
        P.add(
          rod(
            0.06,
            0.075,
            1.1,
            tone(k.wood, 0.05, rng),
            { pos: [x, 0, z], rot: [rng.range(-0.04, 0.04), 0, sx * 0.05] },
            6,
          ),
        );
        tops.push([x + sx * 0.05, 1.0, z]);
      }
      // Rope rail sagging between posts.
      for (let i = 0; i + 1 < tops.length; i++) {
        const a = tops[i]!;
        const b = tops[i + 1]!;
        const m: Vec3 = [(a[0] + b[0]) / 2, a[1] - 0.12, (a[2] + b[2]) / 2];
        P.add(beam(a, m, 0.04, k.straw), beam(m, b, 0.04, k.straw));
      }
      P.boxCol(sx * (w / 2 + 0.02), 0, 0.12, 1.1, L, 0, deck);
    }
  }
  return P.done();
}
