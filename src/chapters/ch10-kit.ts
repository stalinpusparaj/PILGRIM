/**
 * Chapter X helpers: level-zone lookups (spots, crowd and jury boxes, watchman patrols) and the instanced crowds
 * of Vanity Fair. Every position comes from content/levels/ch10.json; nothing here knows a coordinate.
 *
 * Crowds: each zone of type 'crowd' (or 'jury') is a box; `count` citizens stand in it (in rows along its length)
 * facing `face` (rad), drawn as one CrowdMesh per body recipe with fair-coloured tints and a blob shadow each.
 */
import * as THREE from 'three';
import { CrowdMesh } from '../gen/CrowdMesh';
import { Rng } from '../gen/rng';
import type { LevelZone } from '../world/LevelTypes';
import type { ChapterContext } from './types';

/** Fair tints (GDD 2.10 Ch X palette) and the plainer ones for the jury. */
const FAIR_TINTS = ['#E64B8B', '#F2C230', '#7B4FD6', '#2EC4B6', '#E8E0D0', '#D9822B'];
const JURY_TINTS = ['#4A4652', '#5A4A3E', '#3E4A5A', '#6A5A4A'];
const CROWD_RECIPES = ['crowd_1', 'crowd_2', 'crowd_4', 'crowd_7'];
const JURY_RECIPES = ['crowd_3', 'crowd_8'];

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export function zone(ctx: ChapterContext, id: string): LevelZone | null {
  return ctx.level.zones.find((z) => z.id === id) ?? null;
}

/** The ground point at the centre of a zone (spots), or null. */
export function spot(ctx: ChapterContext, id: string): THREE.Vector3 | null {
  const z = zone(ctx, id);
  if (!z || z.x === undefined || z.z === undefined) return null;
  return new THREE.Vector3(z.x, ctx.session.world.terrain.heightAt(z.x, z.z), z.z);
}

/** Points spread along a box zone's long axis (its size[0] along local X, or size[1] when longer), on the ground. */
export function lineIn(ctx: ChapterContext, z: LevelZone, count: number, rows = 1): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const [sx, sz] = z.size ?? [1, 1];
  const alongX = sx >= sz;
  const len = alongX ? sx : sz;
  const depth = alongX ? sz : sx;
  const rot = num(z['rotY'], 0);
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const perRow = Math.ceil(count / rows);
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / perRow);
    const k = (i % perRow) + (row % 2) * 0.5;
    const u = -len / 2 + ((k + 0.5) / perRow) * len;
    const v = rows > 1 ? -depth / 2 + ((row + 0.5) / rows) * depth : 0;
    const lx = alongX ? u : v;
    const lz = alongX ? v : u;
    const x = (z.x ?? 0) + c * lx + s * lz;
    const zz = (z.z ?? 0) - s * lx + c * lz;
    out.push(new THREE.Vector3(x, ctx.session.world.terrain.heightAt(x, zz), zz));
  }
  return out;
}

/** The two ends of a patrol box along its long axis, on the ground. */
export function patrolEnds(ctx: ChapterContext, z: LevelZone): [THREE.Vector3, THREE.Vector3] {
  const [a, b] = lineIn(ctx, z, 2);
  const [sx, sz] = z.size ?? [1, 1];
  const half = Math.max(sx, sz) / 2;
  // lineIn puts the two points at the quarter marks; push them out to the ends.
  const mid = a!.clone().add(b!).multiplyScalar(0.5);
  const dir = b!.clone().sub(a!).setY(0).normalize();
  const end = (sign: number): THREE.Vector3 => {
    const p = mid.clone().addScaledVector(dir, sign * half);
    p.y = ctx.session.world.terrain.heightAt(p.x, p.z);
    return p;
  };
  return [end(-1), end(1)];
}

export interface CrowdSet {
  readonly zoneId: string;
  readonly object: THREE.Group;
  readonly meshes: CrowdMesh[];
  readonly positions: THREE.Vector3[];
  setVisible(on: boolean): void;
  update(t: number): void;
  dispose(): void;
}

/**
 * Builds the citizens of one crowd / jury zone (hidden until `setVisible(true)` when `hidden`). `blobs`: a blob
 * shadow each (the scene's blob budget is shared with every character, so the jury and the square go without).
 */
export function buildCrowd(ctx: ChapterContext, z: LevelZone, hidden = false, blobs = true): CrowdSet {
  const world = ctx.session.world;
  const jury = z.type === 'jury';
  const count = Math.max(0, Math.floor(num(z['count'], 8)));
  const rows = jury || count <= 8 ? 1 : 2;
  const positions = lineIn(ctx, z, count, rows);
  const face = num(z['face'], 0);
  const rng = new Rng(ctx.level.seed + count * 7 + z.id.length);
  const recipes = jury ? JURY_RECIPES : CROWD_RECIPES;
  const tints = jury ? JURY_TINTS : FAIR_TINTS;
  const meshes = recipes.map((r) => new CrowdMesh(r, Math.ceil(count / recipes.length)));
  const used = meshes.map(() => 0);
  const object = new THREE.Group();
  object.name = `crowd:${z.id}`;
  positions.forEach((p, i) => {
    const m = i % meshes.length;
    meshes[m]!.set(used[m]!++, p, face + rng.range(-0.25, 0.25), rng.pick(tints), rng.next());
  });
  for (const m of meshes) {
    object.add(m.mesh);
    if (blobs) world.blobs.addCrowd(m);
  }
  world.scene.add(object);
  let visible = true;
  const set: CrowdSet = {
    zoneId: z.id,
    object,
    meshes,
    positions,
    setVisible(on) {
      if (on === visible) return;
      visible = on;
      object.visible = on;
      if (blobs)
        for (const m of meshes) {
          if (on) world.blobs.addCrowd(m);
          else world.blobs.removeCrowd(m);
        }
    },
    update(t) {
      if (visible) for (const m of meshes) m.update(t);
    },
    dispose() {
      for (const m of meshes) {
        if (blobs) world.blobs.removeCrowd(m);
        m.dispose();
      }
      object.removeFromParent();
    },
  };
  if (hidden) set.setVisible(false);
  return set;
}
