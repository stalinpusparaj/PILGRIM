/**
 * Turns a level's landmarks and waystones into prop placements, and answers "which way does this face" for
 * props and NPCs. Pure data → data; the building happens in placeProps.ts.
 *
 * Facing rules (GDD is silent; see the module report):
 * - a landmark or waystone with no rotY turns its front (+Z) towards the nearest Way, or along it when it
 *   stands on the path itself;
 * - an NPC with no rotY looks along the nearest Way, in its forward direction.
 */
import * as THREE from 'three';
import type { Rng } from '../gen/rng';
import type { Vec3 } from '../gen/types';
import type { Way } from '../gen/Way';
import type { LevelData } from './LevelTypes';
import { isKnownProp, warnUnknownProp, type PropPlacement } from './placeProps';

/** Closer than this to a Way's centre line counts as standing on it (m). */
const ON_PATH = 0.75;

const tan = new THREE.Vector3();

export function isVec3(v: unknown): v is Vec3 {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
}

/** The Ways of a world with the ids level files use for them ('way' = the main Way, else detour ids). */
export interface WaySet {
  readonly ways: readonly Way[];
  readonly ids: readonly string[];
}

export function wayFor(set: WaySet, id: string): Way | null {
  const i = set.ids.indexOf(id === 'main' ? 'way' : id);
  return i >= 0 ? (set.ways[i] ?? null) : null;
}

interface Nearest {
  way: Way;
  t: number;
  dist: number;
  px: number;
  pz: number;
}

function nearestWay(ways: readonly Way[], x: number, z: number): Nearest | null {
  let best: Nearest | null = null;
  for (const way of ways) {
    const c = way.closest(x, z);
    if (!best || c.dist < best.dist) best = { way, t: c.t, dist: c.dist, px: c.point.x, pz: c.point.z };
  }
  return best;
}

/** rotation.y that looks along the nearest Way in its forward direction. */
export function alongWay(ways: readonly Way[], x: number, z: number): number {
  const n = nearestWay(ways, x, z);
  if (!n) return 0;
  n.way.tangent(n.t, tan);
  return Math.atan2(tan.x, tan.z);
}

/** rotation.y that turns a front (+Z) towards the nearest Way; on the path itself, along it. */
export function faceWay(ways: readonly Way[], x: number, z: number): number {
  const n = nearestWay(ways, x, z);
  if (!n) return 0;
  if (n.dist < ON_PATH) {
    n.way.tangent(n.t, tan);
    return Math.atan2(tan.x, tan.z);
  }
  return Math.atan2(n.px - x, n.pz - z);
}

function numParam(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/**
 * Landmarks → placements. `at` landmarks are single props; `path` landmarks are runs along a Way range, tuned
 * by params `offset` (m, + = right of travel), `both`, `spacing` (m), `align` ('along' | 'face') and `lift`.
 * The remaining params go to the prop builder. Unknown types (e.g. 'steps' until its builder exists) are
 * skipped with one warning per type.
 */
export function landmarkPlacements(level: LevelData, root: Rng, set: WaySet): PropPlacement[] {
  const out: PropPlacement[] = [];
  for (const lm of level.landmarks) {
    const where = `landmark "${lm.id}"`;
    if (!isKnownProp(lm.type)) {
      warnUnknownProp(lm.type, where);
      continue;
    }
    const rng = root.fork(`landmark:${lm.id}`);
    const params = lm.params ?? {};
    if (lm.path !== undefined) {
      const path = wayFor(set, lm.path);
      if (!path) {
        console.warn(`[world] ${where}: no Way or detour "${lm.path}"; skipped`);
        continue;
      }
      out.push({
        kind: 'path',
        type: lm.type,
        rng,
        params,
        path,
        from: lm.from ?? 0,
        to: lm.to ?? 1,
        offset: numParam(params.offset, 0),
        both: params.both === true,
        spacing: typeof params.spacing === 'number' ? params.spacing : undefined,
        align: params.align === 'face' ? 'face' : 'along',
        rotY: lm.rotY ?? 0,
        lift: numParam(params.lift, 0),
      });
    } else if (isVec3(lm.at)) {
      const [x, lift, z] = lm.at;
      const rotY = lm.rotY ?? faceWay(set.ways, x, z);
      out.push({ kind: 'point', type: lm.type, rng, params, x, z, lift, rotY });
    } else {
      console.warn(`[world] ${where} has neither "at" nor "path"; skipped`);
    }
  }
  return out;
}

/** Waystones are 'waystone' props facing the Way (they merge with the landmarks: no extra draw calls). */
export function waystonePlacements(level: LevelData, root: Rng, set: WaySet): PropPlacement[] {
  const out: PropPlacement[] = [];
  for (const w of level.waystones) {
    if (!isVec3(w.at)) continue;
    const [x, lift, z] = w.at;
    const rng = root.fork(`waystone:${w.id}`);
    out.push({ kind: 'point', type: 'waystone', rng, x, z, lift, rotY: faceWay(set.ways, x, z) });
  }
  return out;
}
