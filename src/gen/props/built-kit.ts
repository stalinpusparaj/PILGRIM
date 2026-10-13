/**
 * Shared kit for the man-made prop builders (`built-*.ts`): palette-derived material colours, typed param
 * readers, geometry shortcuts and `Parts`, an accumulator that merges one prop into a single PropResult.
 *
 * Conventions: a prop stands on y = 0 at the origin and faces +Z. Collider `center` is the centre of the volume
 * for every kind (a cylinder spans center.y ± height / 2). Everything random comes from the Rng passed in.
 */
import * as THREE from 'three';
import {
  bevelBox,
  cone,
  cylinder,
  extrude,
  finalize,
  lathe,
  lowSphere,
  merge,
  paint,
  xform,
  type Vec3,
} from '../geom';
import { mix, shade, type Palette } from '../palette';
import type { Rng } from '../rng';
import type { Collider, PropParams, PropResult } from '../types';

export type Geo = THREE.BufferGeometry;
export type Hex = string | ((p: THREE.Vector3, n: THREE.Vector3) => string);
export interface Xf {
  pos?: Vec3;
  rot?: Vec3;
  scale?: number | Vec3;
}
export type Pt = [number, number];

// ------------------------------------------------------------------------------------------------ params

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Numeric param (numbers or numeric strings), clamped; `def` when missing or invalid. */
export function num(p: PropParams, key: string, def: number, min = -Infinity, max = Infinity): number {
  const v = p[key];
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number.parseFloat(v) : Number.NaN;
  return clamp(Number.isFinite(n) ? n : def, min, max);
}

export function bool(p: PropParams, key: string, def: boolean): boolean {
  const v = p[key];
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v === 'true' || v === '1';
  return def;
}

export function str(p: PropParams, key: string, def: string): string {
  const v = p[key];
  return typeof v === 'string' && v.length > 0 ? v : def;
}

/** A '#RRGGBB' colour param, or null when missing / malformed. */
export function hexParam(p: PropParams, key: string): string | null {
  const v = p[key];
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : null;
}

// ------------------------------------------------------------------------------------------------ colours

/** Material colours for built props, derived once per palette from GDD 2.10 accents with neutral fallbacks. */
export interface Kit {
  wood: string;
  woodDark: string;
  woodLight: string;
  stone: string;
  stoneDark: string;
  stoneLight: string;
  wall: string;
  plaster: readonly string[];
  roof: readonly string[];
  straw: string;
  iron: string;
  brass: string;
  gold: string;
  windowGlow: string;
  flame: string;
  flameCore: string;
  wax: string;
  gate: string;
  castle: string;
  cross: string;
  tomb: string;
  palace: string;
  palaceRoof: string;
  mountain: string;
  leaf: string;
  leafDark: string;
  grass: string;
  earth: string;
  path: string;
  cloth: readonly string[];
  blossom: readonly string[];
  hollow: string;
  glass: string;
  water: string;
}

const kits = new WeakMap<Palette, Kit>();

function first(...xs: Array<string | undefined>): string | undefined {
  for (const x of xs) if (x) return x;
  return undefined;
}

export function kit(pal: Palette): Kit {
  const cached = kits.get(pal);
  if (cached) return cached;
  const a = pal.accents;
  const g = pal.ground;
  const wood = first(a.timber, a.wood, a.gate, a.cross) ?? mix('#8A6446', g.slope, 0.2);
  const stone = first(a.stone, a.tomb, a.wall) ?? mix('#9C958A', g.slope, 0.3);
  const sky = pal.sky.top;
  const glowBase =
    first(a.horizonLight, a.candle, a.safeLight, a.lantern, a.stepsGlow, a.cityGold) ?? '#FFE3A0';
  const leaf = first(a.grass, a.hillGreen, a.green, a.meadow, a.hills) ?? shade(g.low, -0.06);
  const roofs = a.roofs;
  const cloth = [a.pink, a.mustard, a.violet, a.teal, a.warmRed].filter((c): c is string => !!c);
  const k: Kit = {
    wood,
    woodDark: shade(wood, -0.08),
    woodLight: shade(wood, 0.1),
    stone,
    stoneDark: shade(stone, -0.08),
    stoneLight: shade(stone, 0.08),
    wall: a.wall ?? stone,
    plaster: [
      mix('#F0E3C8', g.path, 0.3),
      mix('#EBD3A6', g.path, 0.3),
      mix('#EDCDBE', g.path, 0.3),
      mix('#DCD8C8', g.path, 0.3),
    ],
    roof: roofs
      ? [roofs, shade(roofs, -0.08), mix(roofs, '#7E6A86', 0.3)]
      : [mix('#9A5444', sky, 0.18), mix('#6E6878', sky, 0.2), mix(wood, '#B07A50', 0.5)],
    straw: mix('#D6B466', g.path, 0.3),
    iron: mix('#45434C', sky, 0.12),
    brass: '#C9A44E',
    gold: first(a.keyGold, a.cityGold, a.mustard) ?? '#E8C25A',
    windowGlow: mix(glowBase, '#FFC46A', 0.4),
    flame: mix(first(a.candle, a.lantern) ?? '#FFC86A', '#FFA63D', 0.35),
    flameCore: '#FFF4D0',
    wax: '#F4ECD8',
    gate: a.gate ?? shade(wood, -0.04),
    castle: first(a.castle, a.storm) ?? mix('#4A4552', sky, 0.2),
    cross: a.cross ?? wood,
    tomb: a.tomb ?? stone,
    palace: a.palace ?? mix('#F2EBDD', g.path, 0.15),
    palaceRoof: roofs ?? '#6C8FB3',
    mountain: a.mountain ?? mix(g.slope, sky, 0.4),
    leaf,
    leafDark: shade(leaf, -0.1),
    grass: g.mid,
    earth: g.slope,
    path: g.path,
    cloth: cloth.length >= 3 ? cloth : ['#B5523B', '#E8C25A', '#4F7FA6', '#7A9A5A', '#E7D3B0'],
    blossom: [a.flowersPink ?? '#F2A0C0', a.flowersYellow ?? '#FFE07A', a.flowersBlue ?? '#FFFFFF'],
    hollow: '#1E1A1C',
    glass: mix('#3A4252', sky, 0.3),
    water: pal.water.deep,
  };
  kits.set(pal, k);
  return k;
}

const toneCache = new Map<string, string>();

/** Per-piece colour jitter, quantised so the shared colour cache stays small. */
export function tone(hex: string, amount: number, rng: Rng): string {
  const steps = Math.round(rng.range(-amount, amount) / 0.025);
  if (steps === 0) return hex;
  const key = `${hex}|${steps}`;
  let out = toneCache.get(key);
  if (!out) {
    out = shade(hex, steps * 0.025);
    toneCache.set(key, out);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ geometry

const UP = new THREE.Vector3(0, 1, 0);
const tmpDir = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpEuler = new THREE.Euler();
const tmpShear = new THREE.Matrix4();

/** Box centred on `pos`; a plain 12-triangle box when bevel = 0, chamfered (28 triangles) otherwise. */
export function box(w: number, h: number, d: number, hex: Hex, o: Xf = {}, bevel = 0): Geo {
  return xform(paint(bevelBox(w, h, d, bevel), hex), o);
}

/** Upright (tapered) cylinder with its base at `pos`. */
export function rod(rTop: number, rBot: number, h: number, hex: Hex, o: Xf = {}, radial = 6): Geo {
  return xform(paint(cylinder(rTop, rBot, h, radial), hex), o);
}

/** A square-section beam from point a to point b (braces, rails, arms, bars). */
export function beam(a: Vec3, b: Vec3, t: number, hex: Hex, depth = t): Geo {
  tmpDir.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = tmpDir.length();
  tmpQuat.setFromUnitVectors(UP, tmpDir.normalize());
  tmpEuler.setFromQuaternion(tmpQuat);
  const mid: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  return box(t, len, depth, hex, { pos: mid, rot: [tmpEuler.x, tmpEuler.y, tmpEuler.z] });
}

/** A round bar between two points (cage bars, poles lying down, axles). */
export function bar(a: Vec3, b: Vec3, r: number, hex: Hex, radial = 5): Geo {
  tmpDir.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = tmpDir.length();
  tmpQuat.setFromUnitVectors(UP, tmpDir.normalize());
  tmpEuler.setFromQuaternion(tmpQuat);
  return rod(r, r, len, hex, { pos: a, rot: [tmpEuler.x, tmpEuler.y, tmpEuler.z] }, radial);
}

/** Extrude a 2D outline (XY plane) along Z by `depth` (centred), then paint and place it. */
export function slab(outline: Pt[], depth: number, hex: Hex, o: Xf = {}, bevel = 0): Geo {
  return xform(paint(extrude(outline, depth, bevel), hex), o);
}

/** Shear in place so the piece leans: x += kx·y, z += kz·y (about its own y = 0). */
export function lean(g: Geo, kx: number, kz: number): Geo {
  if (kx === 0 && kz === 0) return g;
  tmpShear.set(1, kx, 0, 0, 0, 1, 0, 0, 0, kz, 1, 0, 0, 0, 0, 1);
  g.applyMatrix4(tmpShear);
  g.computeVertexNormals();
  return g;
}

/** Points along an elliptical arc (radians, counter-clockwise from +X), endpoints included. */
export function arc(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  a0: number,
  a1: number,
  steps: number,
): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return out;
}

/** Unit dome (radius 1, height 1, base sunk 0.1) from a lathe: banks and mounds without a buried half. */
export function dome(radial = 8): Geo {
  return lathe(
    [
      [1, -0.1],
      [0.93, 0.38],
      [0.72, 0.74],
      [0.4, 0.95],
      [0, 1],
    ],
    radial,
  );
}

/** Octahedron (8 triangles): flowers, studs, finials, tiny gems. */
export function gem(r: number, hex: Hex, o: Xf = {}): Geo {
  return xform(paint(finalize(new THREE.OctahedronGeometry(r, 0)), hex), o);
}

/**
 * A teardrop flame (round bulb + pointed tip, 30 triangles) for the glow mesh; (x, y, z) is the base of the bulb
 * and `r` the bulb radius.
 */
export function flame(P: Parts, k: Kit, x: number, y: number, z: number, r: number): void {
  P.glow(xform(paint(lowSphere(r, 0), k.flameCore), { pos: [x, y + r, z], scale: [1, 1.1, 1] }));
  P.glow(xform(paint(cone(r * 0.82, r * 2.2, 5), k.flame), { pos: [x, y + r * 1.1, z] }));
}

/** Deterministic per-face tint (hash of the face centroid), so big surfaces get a hand-painted patchiness. */
export function speckle(hexes: readonly string[]): (p: THREE.Vector3) => string {
  return (p) => {
    const h =
      Math.imul(Math.round(p.x * 37) ^ Math.imul(Math.round(p.y * 53), 0x45d9f3b), 0x27d4eb2d) ^
      Math.round(p.z * 71);
    return hexes[(h >>> 0) % hexes.length]!;
  };
}

/** Paint function: faces whose normal points up (n.y > limit) get `top`, the rest `side`. */
export function topSide(top: string, side: string, limit = 0.55): Hex {
  return (_p, n) => (n.y > limit ? top : side);
}

// ------------------------------------------------------------------------------------------------ parts

/**
 * Accumulates a prop's pieces: lit geometry, glow geometry and colliders. `done()` merges each list into one
 * geometry (one draw call per material).
 */
export class Parts {
  private readonly solid: Geo[] = [];
  private readonly lit: Geo[] = [];
  readonly colliders: Collider[] = [];

  add(...gs: Geo[]): this {
    for (const g of gs) this.solid.push(g);
    return this;
  }

  glow(...gs: Geo[]): this {
    for (const g of gs) this.lit.push(g);
    return this;
  }

  /** Box collider standing on `y0`, centred on (x, z). */
  boxCol(x: number, z: number, w: number, h: number, d: number, rotY = 0, y0 = 0): this {
    this.colliders.push({ kind: 'box', center: [x, y0 + h / 2, z], half: [w / 2, h / 2, d / 2], rotY });
    return this;
  }

  /** Upright cylinder collider standing on `y0`. */
  cylCol(x: number, z: number, r: number, h: number, y0 = 0): this {
    this.colliders.push({ kind: 'cylinder', center: [x, y0 + h / 2, z], radius: r, height: h });
    return this;
  }

  ballCol(x: number, y: number, z: number, r: number): this {
    this.colliders.push({ kind: 'sphere', center: [x, y, z], radius: r });
    return this;
  }

  /**
   * Merge a sub-assembly built around its own origin: shear (lean), then rotate about Y, then translate.
   * Colliders are not copied (add them in this prop's space).
   */
  absorb(sub: Parts, o: { pos?: Vec3; rotY?: number; lean?: [number, number] }): this {
    const place = (gs: Geo[]): Geo | null => {
      if (gs.length === 0) return null;
      const g = merge(gs.splice(0));
      if (o.lean) lean(g, o.lean[0], o.lean[1]);
      return xform(g, { pos: o.pos, rot: [0, o.rotY ?? 0, 0] });
    };
    const s = place(sub.solid);
    const l = place(sub.lit);
    if (s) this.solid.push(s);
    if (l) this.lit.push(l);
    return this;
  }

  done(): PropResult {
    const result: PropResult = { geometry: merge(this.solid.splice(0)), colliders: this.colliders };
    if (this.lit.length > 0) result.glow = merge(this.lit.splice(0));
    return result;
  }
}
