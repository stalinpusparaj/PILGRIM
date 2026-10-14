/**
 * Prop registry (ARCHITECTURE "Props"): every nature and man-made builder by type name, `buildProp` to build
 * one, and `placeProps` / `placePropsAsync` to build many, move them into world space and merge them into one
 * lit mesh plus one glow mesh (2 draw calls for a whole area).
 */
import * as THREE from 'three';
import { merge, type Vec3 } from '../geom';
import { mat } from '../materials';
import type { Palette } from '../palette';
import type { Rng } from '../rng';
import type { Collider, PropBuilder, PropParams, PropResult } from '../types';
import type { Yielder } from '../yielder';
import { BUILT_PROPS } from './built';
import { NATURE_PROPS } from './nature';

export { BUILT_PROPS } from './built';
export { NATURE_PROPS } from './nature';

export const PROPS: Record<string, PropBuilder> = { ...NATURE_PROPS, ...BUILT_PROPS };

/**
 * Adds chapter-specific props (e.g. src/chapters/ch04-props.ts registers 'arrow' when imported). Chapter modules
 * register before their level is built. Re-registering the same builder is a no-op; a different one throws.
 */
export function registerProps(builders: Record<string, PropBuilder>): void {
  for (const [type, builder] of Object.entries(builders)) {
    const existing = PROPS[type];
    if (existing && existing !== builder) throw new Error(`registerProps: prop type "${type}" already exists`);
    PROPS[type] = builder;
  }
}

/** Build one prop at the origin (facing +Z, on y = 0). Throws for an unknown type. */
export function buildProp(type: string, rng: Rng, pal: Palette, params: PropParams = {}): PropResult {
  if (!Object.hasOwn(PROPS, type)) {
    throw new Error(
      `buildProp: unknown prop type "${type}". Known types: ${Object.keys(PROPS).sort().join(', ')}`,
    );
  }
  return PROPS[type]!(rng, pal, params);
}

export interface PropItem {
  type: string;
  /** World position of the prop's base. */
  at: Vec3;
  /** Radians about Y (three.js convention: +Z turns towards +X). */
  rotY?: number;
  /** Uniform scale (default 1, must be > 0). */
  scale?: number;
  params?: PropParams;
}

export interface MergedProps {
  /** Every prop's lit geometry, merged (shared 'lambert' material). */
  mesh: THREE.Mesh;
  /** Every prop's glow geometry, merged (shared 'glow' material), or null when nothing glows. */
  glow: THREE.Mesh | null;
  /** World-space colliders. */
  colliders: Collider[];
  dispose(): void;
}

/** A prop-local collider moved into world space by (at, rotY, scale). Box rotY adds the item's rotY. */
export function transformCollider(c: Collider, at: Vec3, rotY: number, scale: number): Collider {
  const cos = Math.cos(rotY);
  const sin = Math.sin(rotY);
  const [lx, ly, lz] = c.center;
  const center: Vec3 = [
    at[0] + (lx * cos + lz * sin) * scale,
    at[1] + ly * scale,
    at[2] + (-lx * sin + lz * cos) * scale,
  ];
  switch (c.kind) {
    case 'box':
      return {
        kind: 'box',
        center,
        half: [c.half[0] * scale, c.half[1] * scale, c.half[2] * scale],
        rotY: c.rotY + rotY,
      };
    case 'cylinder':
      return { kind: 'cylinder', center, radius: c.radius * scale, height: c.height * scale };
    case 'sphere':
      return { kind: 'sphere', center, radius: c.radius * scale };
  }
}

/** Accumulates placed props; `finish()` merges them into the two meshes. */
class Batch {
  private readonly lit: THREE.BufferGeometry[] = [];
  private readonly glow: THREE.BufferGeometry[] = [];
  readonly colliders: Collider[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private static readonly UP = new THREE.Vector3(0, 1, 0);

  constructor(
    private readonly rng: Rng,
    private readonly pal: Palette,
  ) {}

  add(item: PropItem): void {
    // Each item's stream depends on its type and place, not on list order.
    const [x, y, z] = item.at;
    const salt = `${item.type}@${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)}`;
    const res = buildProp(item.type, this.rng.fork(salt), this.pal, item.params ?? {});
    const rotY = item.rotY ?? 0;
    const scale = Math.max(1e-3, item.scale ?? 1); // positive only: a mirror would flip face winding
    this.m.compose(this.p.set(...item.at), this.q.setFromAxisAngle(Batch.UP, rotY), this.s.setScalar(scale));
    res.geometry.applyMatrix4(this.m);
    this.lit.push(res.geometry);
    if (res.glow) {
      res.glow.applyMatrix4(this.m);
      this.glow.push(res.glow);
    }
    for (const c of res.colliders) this.colliders.push(transformCollider(c, item.at, rotY, scale));
  }

  discard(): void {
    for (const g of [...this.lit, ...this.glow]) g.dispose();
    this.lit.length = 0;
    this.glow.length = 0;
  }

  finish(): MergedProps {
    const mesh = new THREE.Mesh(merge(this.lit.splice(0)), mat('lambert'));
    mesh.name = 'props';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    let glow: THREE.Mesh | null = null;
    if (this.glow.length > 0) {
      glow = new THREE.Mesh(merge(this.glow.splice(0)), mat('glow'));
      glow.name = 'props:glow';
    }
    const colliders = this.colliders;
    return {
      mesh,
      glow,
      colliders,
      dispose(): void {
        mesh.removeFromParent();
        mesh.geometry.dispose();
        if (glow) {
          glow.removeFromParent();
          glow.geometry.dispose();
        }
      },
    };
  }
}

/** Build and merge many props synchronously (small areas; use `placePropsAsync` behind a loading bar). */
export function placeProps(items: readonly PropItem[], rng: Rng, pal: Palette): MergedProps {
  const b = new Batch(rng, pal);
  try {
    for (const item of items) b.add(item);
  } catch (err) {
    b.discard();
    throw err;
  }
  return b.finish();
}

/** Same as `placeProps`, yielding to the browser between props so the page never freezes. */
export async function placePropsAsync(
  items: readonly PropItem[],
  rng: Rng,
  pal: Palette,
  y: Yielder,
  onProgress?: (p: number) => void,
): Promise<MergedProps> {
  const b = new Batch(rng, pal);
  try {
    for (let i = 0; i < items.length; i++) {
      b.add(items[i]!);
      onProgress?.((i + 1) / items.length);
      await y.tick();
    }
  } catch (err) {
    b.discard();
    throw err;
  }
  return b.finish();
}
