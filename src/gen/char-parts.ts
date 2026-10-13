/**
 * Character part plumbing: the build context handed to every part builder, the part list (each piece rigidly bound
 * to ONE bone), recipe colour lookup, small geometry helpers, and the bakers that merge all parts into the single
 * skinned geometry (characters) or the static tinted geometry (crowds).
 */
import * as THREE from 'three';
import { capsule, colorOf, finalize, lathe } from './geom';
import { shade } from './palette';
import type { Rng } from './rng';
import type { CharacterRecipe } from './char-types';
import type { Layout } from './rig';

export type Lod = 'hero' | 'crowd';

export interface Part {
  g: THREE.BufferGeometry;
  bone: string;
  /** Emissive bit (flame, lantern glass, forehead dot): goes to the glow mesh. */
  glow: boolean;
  /** Crowd tint mask: 1 = takes the instance colour (main clothing), 0 = keeps its own colour. */
  tint: number;
}

export class PartList {
  readonly items: Part[] = [];
  add(g: THREE.BufferGeometry, bone: string, o: { glow?: boolean; tint?: number } = {}): void {
    this.items.push({ g, bone, glow: o.glow ?? false, tint: o.tint ?? 0 });
  }
}

export interface BuildCtx {
  recipe: CharacterRecipe;
  L: Layout;
  rng: Rng;
  parts: PartList;
  lod: Lod;
  /** Recipe colour by key, with a fallback (validated hex). */
  col: (key: string, fallback: string) => string;
  /** Segment counts for the current LOD. */
  seg: { limb: number; round: number; sphere: number };
  extras: ReadonlySet<string>;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

export function makeCtx(recipe: CharacterRecipe, L: Layout, rng: Rng, lod: Lod): BuildCtx {
  const colors = recipe.colors as Record<string, string | undefined>;
  return {
    recipe,
    L,
    rng,
    lod,
    parts: new PartList(),
    col: (key, fallback) => {
      const c = colors[key];
      return c && HEX.test(c) ? c : fallback;
    },
    seg: lod === 'hero' ? { limb: 6, round: 9, sphere: 2 } : { limb: 5, round: 7, sphere: 1 },
    extras: new Set(recipe.parts.extras ?? []),
  };
}

/** Relative luminance-ish of a hex colour (0..1), for picking readable brow colours etc. */
export function lightness(hex: string): number {
  const c = colorOf(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/** Painter that varies each face slightly (hand-painted toy look). */
export function mottled(hex: string, rng: Rng, amount = 0.035): () => string {
  const tones = [shade(hex, -amount), hex, shade(hex, amount * 0.6)];
  return () => tones[Math.floor(rng.next() * tones.length)] ?? hex;
}

/**
 * Closes the open edges of a clipped head shell (hair, helmet guard) with a skirt running in under the skull, to
 * `innerR` from the shell's centre (the head centre, before placing), so wherever an edge is seen side-on there is
 * a solid rim, never a gap with sky between the shell and the head.
 */
export function skirt(g: THREE.BufferGeometry, innerR: number): THREE.BufferGeometry {
  const pos = g.getAttribute('position').array as ArrayLike<number>;
  const key = (i: number): string =>
    `${Math.round(pos[i]! * 1e4)},${Math.round(pos[i + 1]! * 1e4)},${Math.round(pos[i + 2]! * 1e4)}`;
  const uses = new Map<string, number>();
  const edgeKey = (a: number, b: number): string => {
    const ka = key(a);
    const kb = key(b);
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
  };
  for (let t = 0; t + 8 < pos.length; t += 9) {
    for (let e = 0; e < 3; e++) {
      const k = edgeKey(t + e * 3, t + ((e + 1) % 3) * 3);
      uses.set(k, (uses.get(k) ?? 0) + 1);
    }
  }
  const out: number[] = Array.from(pos);
  const v = (i: number, inward: boolean): [number, number, number] => {
    const k = inward ? innerR / Math.max(1e-6, Math.hypot(pos[i]!, pos[i + 1]!, pos[i + 2]!)) : 1;
    return [pos[i]! * k, pos[i + 1]! * k, pos[i + 2]! * k];
  };
  for (let t = 0; t + 8 < pos.length; t += 9) {
    for (let e = 0; e < 3; e++) {
      const a = t + e * 3;
      const b = t + ((e + 1) % 3) * 3;
      if (uses.get(edgeKey(a, b)) !== 1) continue;
      // Wound so the skirt faces away from the shell it closes.
      const A = v(a, false);
      const B = v(b, false);
      const Ai = v(a, true);
      const Bi = v(b, true);
      out.push(...A, ...Ai, ...B, ...B, ...Ai, ...Bi);
    }
  }
  g.dispose();
  const res = new THREE.BufferGeometry();
  res.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  return finalize(res);
}

/** Keeps only the triangles whose centroid passes `keep` (cuts hair caps, hoods and beards out of spheres). */
export function clipTris(
  g: THREE.BufferGeometry,
  keep: (x: number, y: number, z: number) => boolean,
): THREE.BufferGeometry {
  const pos = g.getAttribute('position').array as ArrayLike<number>;
  const col = g.getAttribute('color').array as ArrayLike<number>;
  const outP: number[] = [];
  const outC: number[] = [];
  for (let i = 0; i + 8 < pos.length; i += 9) {
    const cx = (pos[i]! + pos[i + 3]! + pos[i + 6]!) / 3;
    const cy = (pos[i + 1]! + pos[i + 4]! + pos[i + 7]!) / 3;
    const cz = (pos[i + 2]! + pos[i + 5]! + pos[i + 8]!) / 3;
    if (!keep(cx, cy, cz)) continue;
    for (let k = 0; k < 9; k++) {
      outP.push(pos[i + k]!);
      outC.push(col[i + k]!);
    }
  }
  g.dispose();
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(outP, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(outC, 3));
  return finalize(out);
}

/**
 * A flat outline (XY, any winding) raised by `depth` toward +Z: front cap plus side walls, no back face (it always
 * sits on a surface). Used for mouths, cheeks, patches and emblems.
 */
export function slab(outline: Array<[number, number]>, depth: number): THREE.BufferGeometry {
  let pts = outline.map(([x, y]) => new THREE.Vector2(x, y));
  if (THREE.ShapeUtils.isClockWise(pts)) pts = pts.reverse();
  const tris = THREE.ShapeUtils.triangulateShape(pts, []);
  const out: number[] = [];
  for (const [a, b, c] of tris) {
    const A = pts[a!]!;
    let B = pts[b!]!;
    let C = pts[c!]!;
    // Front faces must wind counter-clockwise seen from +Z.
    if ((B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x) < 0) [B, C] = [C, B];
    out.push(A.x, A.y, depth, B.x, B.y, depth, C.x, C.y, depth);
  }
  for (let i = 0; i < pts.length; i++) {
    const p0 = pts[i]!;
    const p1 = pts[(i + 1) % pts.length]!;
    out.push(
      p0.x,
      p0.y,
      0,
      p1.x,
      p1.y,
      0,
      p1.x,
      p1.y,
      depth,
      p0.x,
      p0.y,
      0,
      p1.x,
      p1.y,
      depth,
      p0.x,
      p0.y,
      depth,
    );
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  return finalize(g);
}

/**
 * A limb segment standing on Y, centred at the origin (total length `length + 2 * radius`). Heroes get the rounded
 * capsule; crowds a 3-band lathe with pointed ends (a third of the triangles).
 */
export function limb(lod: Lod, radius: number, length: number, radial: number): THREE.BufferGeometry {
  if (lod === 'hero') return capsule(radius, length, radial);
  const h = length / 2;
  return lathe(
    [
      [0, -h - radius * 0.8],
      [radius, -h],
      [radius, h],
      [0, h + radius * 0.8],
    ],
    radial,
  );
}

/** Points of an ellipse (for slabs). */
export function ellipse(rx: number, ry: number, n: number, cx = 0, cy = 0): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return pts;
}

/** Profile for a closed ring band (lathe) of radius r, height h and thickness t, centred on y = 0. */
export function bandProfile(r: number, h: number, t: number): Array<[number, number]> {
  return [
    [r - t * 0.2, -h / 2],
    [r + t, -h * 0.3],
    [r + t, h * 0.3],
    [r - t * 0.2, h / 2],
  ];
}

/** Euler that turns a +Z-facing feature to face along the head-surface normal at (x, y) on a sphere of radius r. */
export function surfaceRot(r: number, x: number, y: number): [number, number, number] {
  return [-Math.asin(Math.max(-1, Math.min(1, y / r))), Math.asin(Math.max(-1, Math.min(1, x / r))), 0];
}

// ---------------------------------------------------------------- baking

/**
 * Marks the triangles worth keeping: lathes and capsules make zero-area triangles at their poles, which still cost
 * vertex work and count as triangles, so they are dropped while baking.
 */
function solidTris(g: THREE.BufferGeometry): Uint8Array {
  const a = g.getAttribute('position').array as ArrayLike<number>;
  const n = Math.floor(a.length / 9);
  const keep = new Uint8Array(n);
  for (let t = 0; t < n; t++) {
    const o = t * 9;
    const ux = a[o + 3]! - a[o]!,
      uy = a[o + 4]! - a[o + 1]!,
      uz = a[o + 5]! - a[o + 2]!;
    const vx = a[o + 6]! - a[o]!,
      vy = a[o + 7]! - a[o + 1]!,
      vz = a[o + 8]! - a[o + 2]!;
    const cx = uy * vz - uz * vy,
      cy = uz * vx - ux * vz,
      cz = ux * vy - uy * vx;
    keep[t] = cx * cx + cy * cy + cz * cz > 1e-16 ? 1 : 0;
  }
  return keep;
}

function countKept(masks: readonly Uint8Array[]): number {
  let n = 0;
  for (const m of masks) for (let i = 0; i < m.length; i++) n += m[i]!;
  return n * 3;
}

/** Copies the kept triangles' vec3 attribute into dst at vertex offset `o`; returns the vertices written. */
function copyKept(
  dst: Float32Array,
  src: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  keep: Uint8Array,
  o: number,
): number {
  const a = src.array as ArrayLike<number>;
  let w = o * 3;
  for (let t = 0; t < keep.length; t++) {
    if (!keep[t]) continue;
    for (let k = t * 9; k < t * 9 + 9; k++) dst[w++] = a[k]!;
  }
  return w / 3 - o;
}

/** Merges skinned parts: every vertex is weighted 100% to its part's bone (rigid skinning). */
function bakeSkinnedSet(items: readonly Part[], boneIndex: Record<string, number>): THREE.BufferGeometry {
  const masks = items.map((p) => solidTris(p.g));
  const n = countKept(masks);
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const si = new Uint16Array(n * 4);
  const sw = new Float32Array(n * 4);
  let o = 0;
  for (let i = 0; i < items.length; i++) {
    const p = items[i]!;
    const keep = masks[i]!;
    const count = copyKept(pos, p.g.getAttribute('position'), keep, o);
    copyKept(nor, p.g.getAttribute('normal'), keep, o);
    copyKept(col, p.g.getAttribute('color'), keep, o);
    const bi = boneIndex[p.bone];
    if (bi === undefined) throw new Error(`CharacterFactory: part bound to unknown bone "${p.bone}"`);
    for (let v = 0; v < count; v++) {
      si[(o + v) * 4] = bi;
      sw[(o + v) * 4] = 1;
    }
    o += count;
    p.g.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/**
 * Bakes the character: `main` holds every non-glow part (or all parts when `allGlow`), `glow` the emissive bits.
 * Glow recipes get soft lighting baked into their vertex colours, since the glow material is unlit.
 */
export function bakeSkinned(
  items: readonly Part[],
  boneIndex: Record<string, number>,
  allGlow: boolean,
): { main: THREE.BufferGeometry; glow: THREE.BufferGeometry | null } {
  if (allGlow) for (const p of items) bakeLight(p.g);
  const main = items.filter((p) => allGlow || !p.glow);
  const glow = allGlow ? [] : items.filter((p) => p.glow);
  return {
    main: bakeSkinnedSet(main, boneIndex),
    glow: glow.length > 0 ? bakeSkinnedSet(glow, boneIndex) : null,
  };
}

const LIGHT_DIR = new THREE.Vector3(0.35, 0.85, 0.4).normalize();

/** Multiplies vertex colours by a soft key light from the face normal (for the unlit glow material). */
function bakeLight(g: THREE.BufferGeometry): void {
  const nor = g.getAttribute('normal');
  const col = g.getAttribute('color');
  for (let i = 0; i < col.count; i++) {
    const d = nor.getX(i) * LIGHT_DIR.x + nor.getY(i) * LIGHT_DIR.y + nor.getZ(i) * LIGHT_DIR.z;
    const k = 0.72 + 0.28 * Math.max(0, d);
    col.setXYZ(i, col.getX(i) * k, col.getY(i) * k, col.getZ(i) * k);
  }
}

/** Static merge for crowds: position, normal, colour and the `tint` mask; parts on `skip` bones are dropped. */
export function bakeStatic(items: readonly Part[], skip: (bone: string) => boolean): THREE.BufferGeometry {
  const kept = items.filter((p) => {
    if (!skip(p.bone)) return true;
    p.g.dispose();
    return false;
  });
  const masks = kept.map((p) => solidTris(p.g));
  const n = countKept(masks);
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const tint = new Float32Array(n);
  let o = 0;
  for (let i = 0; i < kept.length; i++) {
    const p = kept[i]!;
    const keep = masks[i]!;
    const count = copyKept(pos, p.g.getAttribute('position'), keep, o);
    copyKept(nor, p.g.getAttribute('normal'), keep, o);
    copyKept(col, p.g.getAttribute('color'), keep, o);
    tint.fill(p.tint, o, o + count);
    o += count;
    p.g.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('tint', new THREE.BufferAttribute(tint, 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}
