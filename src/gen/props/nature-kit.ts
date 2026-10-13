/**
 * Shared kit for the nature prop builders (nature-*.ts): param parsing, palette-derived nature colours, the
 * per-face "painted wooden toy" speckle, limb orientation, base flattening and collider helpers.
 *
 * Determinism: builders read their params, then fork two child streams (`jitter`, `paint`) BEFORE any layout
 * draws. Layout uses the main stream, so a low-LOD build (`lod: 1`, fewer vertices) keeps the exact same
 * silhouette, placement and colours as the full one.
 */
import * as THREE from 'three';
import { xform, type Vec3 } from '../geom';
import { mix, vary, type Palette } from '../palette';
import type { Rng } from '../rng';
import type { Collider, PropParams } from '../types';

export const TAU = Math.PI * 2;
/** Trunks, stems and roots start this far below y = 0 so nothing floats on sloped terrain. */
export const SINK = 0.1;

export type Painter = (p: THREE.Vector3, n: THREE.Vector3) => string;
/** [dark, base, light] flat tones of one colour. */
export type Tones = readonly [string, string, string];

// ---------------------------------------------------------------------------------------------- params

export interface NatureOpts {
  /** Shape variant 0..3. */
  variant: number;
  /** Overall height in metres (log: thickness, lily: pad radius). */
  height: number;
  /** Main colour override (foliage, petals, stone, cap, wood...), or null for the palette colour. */
  colour: string | null;
  /** 0 = full detail, 1 = fewer segments for distant instances (same silhouette and layout). */
  lod: 0 | 1;
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** A numeric param (numbers or numeric strings from level JSON), or null. */
export function num(params: PropParams, key: string): number | null {
  const v = params[key];
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Common params: `variant` (0..3), `height` (> 0), `colour`/`color` (#hex), `lod` (0|1). Missing values are
 * drawn from `rng` (variant first, then height from `range`, which may depend on the variant).
 */
export function readOpts(
  rng: Rng,
  params: PropParams,
  range: readonly [number, number] | ((variant: number) => readonly [number, number]),
): NatureOpts {
  const v = num(params, 'variant');
  const variant = v === null ? rng.int(0, 3) : Math.min(3, Math.max(0, Math.floor(v)));
  const [lo, hi] = typeof range === 'function' ? range(variant) : range;
  const h = num(params, 'height');
  const height = h !== null && h > 0 ? h : rng.range(lo, hi);
  const c = params.colour ?? params.color;
  const colour = typeof c === 'string' && HEX.test(c) ? c : null;
  const lod = num(params, 'lod') === 1 || params.lod === true ? 1 : 0;
  return { variant, height, colour, lod };
}

// --------------------------------------------------------------------------------------------- colours

const tmpC = new THREE.Color();
const tmpHsl = { h: 0, s: 0, l: 0 };
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** Shift hue / saturation / lightness in sRGB HSL (perceptual), returning a new hex. */
export function hsl(hex: string, dh: number, ds: number, dl: number): string {
  tmpC.set(hex).getHSL(tmpHsl, THREE.SRGBColorSpace);
  tmpC.setHSL((tmpHsl.h + dh + 1) % 1, clamp01(tmpHsl.s + ds), clamp01(tmpHsl.l + dl), THREE.SRGBColorSpace);
  return `#${tmpC.getHexString(THREE.SRGBColorSpace)}`;
}

export function tones(hex: string, step = 0.06): Tones {
  return [hsl(hex, 0, 0, -step), hex, hsl(hex, 0, 0, step)];
}

/** A per-build variation of a base colour (the "small rng variation" every prop gets). */
export function jiggle(hex: string, rng: Rng, amount = 0.035): string {
  return vary(hex, amount, rng.next());
}

/**
 * Per-face painter: mostly the base tone with a few darker and lighter facets, like hand-painted wood.
 * Up-facing faces lean light (`top`), faces pointing down get `under` if given.
 */
export function speckle(t: Tones, rng: Rng, o: { top?: number; under?: string } = {}): Painter {
  const top = o.top ?? 0.2;
  const under = o.under;
  return (_p, n) => {
    if (under !== undefined && n.y < -0.55) return under;
    const r = rng.next() + n.y * top;
    return r < 0.2 ? t[0] : r > 0.88 ? t[2] : t[1];
  };
}

/**
 * Fallback toy hues for fruit, flowers, grapes and caps, used only when a chapter palette has no fitting accent
 * (GDD 2.10 lists accents per chapter, not fruit colours). Always mixed toward the chapter's sun colour.
 */
const TOY = {
  red: '#E0553F',
  orange: '#F08A3C',
  gold: '#F2BE45',
  pink: '#F2A3BC',
  lilac: '#B7A2E6',
  cream: '#F7F1E1',
  grape: '#6E4A8E',
  capRed: '#C9563E',
} as const;

const FLOWER_KEYS = [
  'flowersPink',
  'flowersBlue',
  'flowersYellow',
  'pink',
  'violet',
  'mustard',
  'teal',
  'sheep',
  'haze',
  'dawnA',
  'keyGold',
] as const;
const FRUIT_KEYS = ['warmRed', 'fire', 'embers', 'dusk'] as const;

export interface NatureColours {
  leaf: string;
  leafLight: string;
  pine: string;
  fruitLeaf: string;
  grass: string;
  grassTip: string;
  reed: string;
  cattail: string;
  bark: string;
  barkDead: string;
  woodCut: string;
  stone: string;
  moss: string;
  lilyPad: string;
  lilyFlower: string;
  petals: readonly string[];
  centre: string;
  fruit: readonly string[];
  grape: string;
  caps: readonly string[];
  stem: string;
  wire: string;
}

const colourCache = new WeakMap<Palette, NatureColours>();

function accentList(pal: Palette, keys: readonly string[]): string[] {
  const out: string[] = [];
  for (const k of keys) {
    const v = pal.accents[k];
    if (v !== undefined && !out.includes(v)) out.push(v);
  }
  return out;
}

/** Every nature colour of a chapter, derived from its palette (ground bands + GDD 2.10 accents). Cached. */
export function natureColours(pal: Palette): NatureColours {
  const hit = colourCache.get(pal);
  if (hit) return hit;
  const g = pal.ground;
  const a = pal.accents;
  const sunMix = (hex: string): string => mix(hex, pal.light.sun, 0.1);

  const bark = a.timber ?? a.wood ?? hsl(g.slope, -0.02, 0.12, -0.14);
  const petals = accentList(pal, FLOWER_KEYS);
  for (const f of [TOY.pink, TOY.gold, TOY.cream, TOY.lilac]) if (petals.length < 3) petals.push(sunMix(f));
  const fruit = accentList(pal, FRUIT_KEYS);
  for (const f of [TOY.red, TOY.orange]) if (fruit.length < 2) fruit.push(sunMix(f));

  const c: NatureColours = {
    leaf: hsl(g.mid, 0.01, 0.08, -0.08),
    leafLight: hsl(g.high, 0, 0.06, -0.03),
    pine: hsl(g.mid, 0.05, -0.02, -0.17),
    fruitLeaf: hsl(g.low, -0.01, 0.08, -0.05),
    grass: hsl(g.low, 0.01, 0.1, -0.02),
    grassTip: hsl(g.low, 0.02, 0.12, 0.07),
    reed: a.reeds ?? hsl(g.mid, -0.02, 0, 0.02),
    cattail: hsl(bark, 0, 0.05, -0.03),
    bark,
    barkDead: hsl(bark, 0, -0.12, 0.12),
    woodCut: hsl(g.path, 0, 0, -0.03),
    stone: a.stone ?? a.tomb ?? hsl(mix(g.slope, g.pathEdge, 0.5), 0, -0.06, 0.02),
    moss: hsl(g.mid, 0.02, 0.06, -0.04),
    lilyPad: hsl(g.low, 0.03, 0.05, -0.1),
    lilyFlower: a.flowersPink ?? a.pink ?? sunMix(mix(TOY.pink, TOY.cream, 0.4)),
    petals,
    centre: a.flowersYellow ?? a.mustard ?? a.keyGold ?? a.cityGold ?? sunMix(TOY.gold),
    fruit,
    grape: a.violet ?? a.plum ?? sunMix(TOY.grape),
    caps: [a.warmRed ?? a.embers ?? sunMix(TOY.capRed), hsl(bark, 0, 0.04, 0.14), sunMix(TOY.cream)],
    stem: hsl(g.path, 0, -0.1, 0.05),
    wire: hsl(g.slope, 0, -0.1, -0.15),
  };
  colourCache.set(pal, c);
  return c;
}

// -------------------------------------------------------------------------------------------- geometry

/**
 * Lean a +Y-pointing primitive (cone/cylinder with its base at y = 0) by `tilt` radians from vertical toward
 * the horizontal direction (cos az, 0, sin az), then move its base to `base`.
 */
export function lean(
  g: THREE.BufferGeometry,
  base: Vec3,
  az: number,
  tilt: number,
  scale?: number | Vec3,
): THREE.BufferGeometry {
  // Euler XYZ [0, yaw, tilt] maps +Y to (-cos(yaw) sin(tilt), cos(tilt), sin(yaw) sin(tilt)); yaw = PI - az.
  return xform(g, { pos: base, rot: [0, Math.PI - az, tilt], scale: scale ?? 1 });
}

/** Tip of a limb of length `len` leaned with `lean()`. */
export function leanTip(base: Vec3, az: number, tilt: number, len: number): Vec3 {
  const s = Math.sin(tilt) * len;
  return [base[0] + Math.cos(az) * s, base[1] + Math.cos(tilt) * len, base[2] + Math.sin(az) * s];
}

/** Clamp every vertex below `y0` up to it: a flat base that sits on the ground. Recomputes flat normals. */
export function flattenBase(g: THREE.BufferGeometry, y0: number): THREE.BufferGeometry {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) if (pos.getY(i) < y0) pos.setY(i, y0);
  pos.needsUpdate = true;
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** Number of triangles in a non-indexed geometry (used to respect the per-prop budgets). */
export function tris(g: THREE.BufferGeometry): number {
  return g.getAttribute('position').count / 3;
}

// ------------------------------------------------------------------------------------------- colliders

/** Upright cylinder standing on `y0`; `center` is the mid-height point (same convention as box.center). */
export function cylCollider(radius: number, height: number, x = 0, z = 0, y0 = 0): Collider {
  return { kind: 'cylinder', center: [x, y0 + height / 2, z], radius, height };
}

export function sphereCollider(center: Vec3, radius: number): Collider {
  return { kind: 'sphere', center, radius };
}

export function boxCollider(center: Vec3, half: Vec3, rotY = 0): Collider {
  return { kind: 'box', center, half, rotY };
}

/** Uniformly scale a built prop and its colliders (about the origin). */
export function scaleProp(g: THREE.BufferGeometry, colliders: Collider[], s: number): void {
  if (Math.abs(s - 1) < 1e-6) return;
  xform(g, { scale: s });
  g.computeBoundingBox();
  g.computeBoundingSphere();
  for (const c of colliders) {
    c.center = [c.center[0] * s, c.center[1] * s, c.center[2] * s];
    if (c.kind === 'box') c.half = [c.half[0] * s, c.half[1] * s, c.half[2] * s];
    else if (c.kind === 'cylinder') {
      c.radius *= s;
      c.height *= s;
    } else c.radius *= s;
  }
}
