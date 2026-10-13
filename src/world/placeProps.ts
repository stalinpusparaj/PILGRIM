/**
 * Static prop placement (ARCHITECTURE "Props": static landmark props in an area are merged into one mesh per
 * material). Builds props from the registry, sits each one on the ground under its footprint, and merges the
 * lit geometry of each CELL × CELL metre area (origin-aligned, so a 300 m chapter is at most 2 × 2 areas) into
 * one mesh, plus a single mesh for every glowing part (small: windows, flames). A chapter's landmarks,
 * waystones and fence runs therefore cost about five draw calls, with coarse frustum culling per area.
 *
 * Two kinds of placement:
 * - point: one prop at (x, z), turned by rotY.
 * - path:  a run of props along part of the Way or a detour (fences, walls, lamps), spaced by the prop's own
 *          width unless `spacing` is given, optionally on both sides.
 */
import * as THREE from 'three';
import { PROPS, buildProp, transformCollider } from '../gen/props';
import { merge, xform } from '../gen/geom';
import { mat } from '../gen/materials';
import type { Rng } from '../gen/rng';
import type { Palette } from '../gen/palette';
import type { Collider, PropParams, PropResult, Vec3 } from '../gen/types';
import type { Yielder } from '../gen/yielder';

/** Anything with a height field (the Terrain). */
export interface Ground {
  heightAt(x: number, z: number): number;
}

/** The parts of a Way that a path placement needs. */
export interface PathLike {
  readonly length: number;
  sample(t: number, out?: THREE.Vector3): THREE.Vector3;
  tangent(t: number, out?: THREE.Vector3): THREE.Vector3;
}

interface PlacementBase {
  type: string;
  /** Per-placement stream; path runs fork one child per piece. */
  rng: Rng;
  params?: PropParams;
  /** Uniform scale (default 1). */
  scale?: number;
  /** Height above the ground (m, default 0). */
  lift?: number;
}

export interface PointPlacement extends PlacementBase {
  kind: 'point';
  x: number;
  z: number;
  /** Radians about Y (three's convention: +Z turns towards +X). */
  rotY: number;
}

export interface PathPlacement extends PlacementBase {
  kind: 'path';
  path: PathLike;
  /** Range along the path, 0..1 (arc length). */
  from: number;
  to: number;
  /** Signed sideways offset from the centre line (m); + is to the right when walking the Way forward. */
  offset?: number;
  /** Also place a mirrored run on the other side. */
  both?: boolean;
  /** Distance between pieces (m). Default: the prop's own length along the run. */
  spacing?: number;
  /** 'along' (default): the prop's local X runs along the path (fences, walls). 'face': its +Z faces forward. */
  align?: 'along' | 'face';
  /** Extra turn added to every piece (radians). */
  rotY?: number;
}

export type PropPlacement = PointPlacement | PathPlacement;

export interface PlacedProps {
  readonly object: THREE.Group;
  /** World-space colliders. */
  readonly colliders: Collider[];
  /** Number of props built. */
  readonly placed: number;
  dispose(): void;
}

/** Merge area (m): the 300 m chapters split into four quadrants about the origin. */
const CELL = 160;
/** A prop on a slope sinks to its lowest footprint corner, but never more than this below its centre (m). */
const MAX_SINK = 0.6;
/** Safety cap on the pieces of one path run. */
const MAX_PIECES = 400;
const MIN_SPACING = 0.5;

const warnedTypes = new Set<string>();

export function isKnownProp(type: string): boolean {
  return Object.hasOwn(PROPS, type);
}

/** Warns once per type: the level uses a prop the registry does not have (yet). */
export function warnUnknownProp(type: string, where: string): void {
  if (warnedTypes.has(type)) return;
  warnedTypes.add(type);
  console.warn(`[world] no prop builder for "${type}" (first used by ${where}); skipped`);
}

/** Builds, grounds and merges the placements. Unknown types are skipped with one warning per type. */
export async function placeProps(
  items: readonly PropPlacement[],
  pal: Palette,
  ground: Ground,
  y: Yielder,
  opts: { name?: string } = {},
): Promise<PlacedProps> {
  const name = opts.name ?? 'props';
  const batch = new Batch();
  try {
    for (const item of items) {
      if (!isKnownProp(item.type)) {
        warnUnknownProp(item.type, name);
        continue;
      }
      if (item.kind === 'point') {
        const res = buildProp(item.type, item.rng, pal, item.params ?? {});
        batch.add(res, item.x, item.z, item.rotY, item.scale ?? 1, item.lift ?? 0, ground);
      } else {
        await placeRun(item, pal, ground, batch, y);
      }
      await y.tick();
    }
    const object = await batch.flush(name, y);
    return {
      object,
      colliders: batch.colliders,
      placed: batch.placed,
      dispose: () => {
        object.traverse((o) => {
          if (o instanceof THREE.Mesh) (o.geometry as THREE.BufferGeometry).dispose();
        });
        object.removeFromParent();
        object.clear();
      },
    };
  } catch (err) {
    batch.discard();
    throw err;
  }
}

// ------------------------------------------------------------------------------------------- path runs

const tmpP = new THREE.Vector3();
const tmpT = new THREE.Vector3();

async function placeRun(
  item: PathPlacement,
  pal: Palette,
  ground: Ground,
  batch: Batch,
  y: Yielder,
): Promise<void> {
  const len = item.path.length;
  const from = clamp01(Math.min(item.from, item.to));
  const to = clamp01(Math.max(item.from, item.to));
  const scale = item.scale ?? 1;
  const align = item.align ?? 'along';
  const offset = item.offset ?? 0;
  const sides = item.both && offset !== 0 ? [offset, -offset] : [offset];

  // The first piece is built up front: its footprint gives the default spacing.
  const head: PropResult = buildProp(item.type, item.rng.fork(0), pal, item.params ?? {});
  let first: PropResult | null = head;
  const bb = boundsOf(head.geometry);
  const own = align === 'along' ? bb.max.x - bb.min.x : bb.max.z - bb.min.z;
  const spacing = Math.max(MIN_SPACING, item.spacing ?? own * scale);

  const runLen = (to - from) * len;
  const count = Math.min(MAX_PIECES, Math.max(1, Math.floor(runLen / spacing)));
  if (Math.floor(runLen / spacing) > MAX_PIECES) {
    console.warn(`[world] a "${item.type}" run was capped at ${MAX_PIECES} pieces`);
  }
  // Centre the pieces inside the range.
  const start = from * len + (runLen - count * spacing) / 2 + spacing / 2;

  for (let i = 0; i < count; i++) {
    const t = len > 0 ? clamp01((start + i * spacing) / len) : 0;
    item.path.sample(t, tmpP);
    item.path.tangent(t, tmpT);
    const tx = tmpT.x;
    const tz = tmpT.z;
    const tl = Math.hypot(tx, tz) || 1;
    const fx = tx / tl;
    const fz = tz / tl;
    const heading = align === 'along' ? Math.atan2(-fz, fx) : Math.atan2(fx, fz);
    for (let s = 0; s < sides.length; s++) {
      const off = sides[s]!;
      // Right of the walking direction is (-fz, fx); the mirrored run is turned round so the two sides are
      // symmetric about the path.
      const x = tmpP.x - fz * off;
      const z = tmpP.z + fx * off;
      const rot = heading + (item.rotY ?? 0) + (s === 1 ? Math.PI : 0);
      const res = first ?? buildProp(item.type, item.rng.fork(i * 2 + s), pal, item.params ?? {});
      first = null;
      batch.add(res, x, z, rot, scale, item.lift ?? 0, ground);
    }
    await y.tick();
  }
  if (first) disposeResult(first);
}

// ---------------------------------------------------------------------------------------------- batch

class Batch {
  readonly colliders: Collider[] = [];
  placed = 0;
  private readonly cells = new Map<string, THREE.BufferGeometry[]>();
  private glow: THREE.BufferGeometry[] = [];

  add(
    res: PropResult,
    x: number,
    z: number,
    rotY: number,
    scale: number,
    lift: number,
    ground: Ground,
  ): void {
    const geometry = conform(res.geometry);
    const base = groundBase(boundsOf(geometry), x, z, rotY, scale, ground) + lift;
    const at: Vec3 = [x, base, z];
    const o = { pos: at, rot: [0, rotY, 0] as Vec3, scale };
    this.cell(x, z).push(xform(geometry, o));
    if (res.glow) this.glow.push(xform(conform(res.glow), o));
    for (const c of res.colliders) this.colliders.push(transformCollider(c, at, rotY, scale));
    this.placed++;
  }

  async flush(name: string, y: Yielder): Promise<THREE.Group> {
    const group = new THREE.Group();
    group.name = name;
    for (const [key, lit] of this.cells) {
      this.cells.delete(key); // merge() disposes the pieces; never discard them twice
      group.add(staticMesh(merge(lit), mat('lambert'), `${name}:${key}`, true));
      await y.tick();
    }
    if (this.glow.length > 0)
      group.add(staticMesh(merge(this.glow.splice(0)), mat('glow'), `${name}:glow`, false));
    return group;
  }

  /** Frees geometry that was built but never merged (a failed build). */
  discard(): void {
    for (const lit of this.cells.values()) for (const g of lit) g.dispose();
    for (const g of this.glow) g.dispose();
    this.cells.clear();
    this.glow = [];
  }

  private cell(x: number, z: number): THREE.BufferGeometry[] {
    const key = `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
    let lit = this.cells.get(key);
    if (!lit) {
      lit = [];
      this.cells.set(key, lit);
    }
    return lit;
  }
}

function staticMesh(g: THREE.BufferGeometry, m: THREE.Material, name: string, shadows: boolean): THREE.Mesh {
  // merge() passes a single piece through untouched, with the bounds of its local (pre-xform) shape.
  g.computeBoundingBox();
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, m);
  mesh.name = name;
  mesh.castShadow = shadows;
  mesh.receiveShadow = shadows;
  mesh.matrixAutoUpdate = false; // identity forever: the geometry is already in world space
  return mesh;
}

/** Lowest ground under the footprint corners, but no deeper than MAX_SINK below the centre. */
function groundBase(
  bb: THREE.Box3,
  x: number,
  z: number,
  rotY: number,
  scale: number,
  ground: Ground,
): number {
  const c = Math.cos(rotY);
  const s = Math.sin(rotY);
  const centre = ground.heightAt(x, z);
  let min = centre;
  for (const bx of [bb.min.x, bb.max.x]) {
    for (const bz of [bb.min.z, bb.max.z]) {
      const wx = x + (bx * c + bz * s) * scale;
      const wz = z + (-bx * s + bz * c) * scale;
      min = Math.min(min, ground.heightAt(wx, wz));
    }
  }
  return Math.max(min, centre - MAX_SINK);
}

/**
 * Brings a prop geometry to the merge layout (non-indexed position/normal/color). Props built with geom.ts
 * already match; this only protects the merge from a stray uv or index.
 */
function conform(src: THREE.BufferGeometry): THREE.BufferGeometry {
  let g = src;
  if (g.index) {
    const flat = g.toNonIndexed();
    g.dispose();
    g = flat;
  }
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'color') g.deleteAttribute(name);
  }
  g.morphAttributes = {};
  g.clearGroups();
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  if (!g.getAttribute('color')) {
    const n = g.getAttribute('position').count;
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  }
  return g;
}

function boundsOf(g: THREE.BufferGeometry): THREE.Box3 {
  if (!g.boundingBox) g.computeBoundingBox();
  return g.boundingBox!;
}

function disposeResult(res: PropResult): void {
  res.geometry.dispose();
  res.glow?.dispose();
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
