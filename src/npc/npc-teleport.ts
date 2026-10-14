/**
 * Catch-up teleports (GDD 2.8: "teleport behind the player out of view if more than 25 m away"): a spot behind
 * the player, first back along their breadcrumb trail, then back along the main Way, that is on the ground, not
 * inside a collider, not in a hazard zone (pits, bog holes) and outside the camera's view. Allocation-free.
 */
import * as THREE from 'three';
import type { ClosestResult } from '../gen/Way';
import type { PlaySession } from '../world/PlaySession';
import { HAZARD_ZONE_TYPES } from '../world/Zones';
import type { Trail } from './npc-trail';

/** Catch up beyond this distance (m) from the player. */
export const CATCH_UP_DIST = 25;
/** Spots this far from the player (m). */
const MIN_BACK = 6;
const MAX_BACK = 18;
/** Way samples behind the player (m). */
const WAY_BACK = [8, 11, 14, 17, 6] as const;
/** Clearance (m) of the body sphere tested against the view frustum. */
const VIEW_PAD = 0.4;

const frustum = new THREE.Frustum();
const viewProj = new THREE.Matrix4();
const sphere = new THREE.Sphere();
const cand = new THREE.Vector3();
const near: ClosestResult = { t: 0, dist: 0, point: new THREE.Vector3() };
const tan = new THREE.Vector3();

export interface Body {
  radius: number;
  height: number;
}

/**
 * Finds a catch-up spot (feet) into `out`. `hidden`: it must be outside the camera's view (false = any free spot,
 * the fallback when nothing hidden turns up for a while). `heading` is the player's travel direction on XZ.
 */
export function catchUpSpot(
  s: PlaySession,
  trail: Trail,
  body: Body,
  heading: { x: number; z: number },
  hidden: boolean,
  out: THREE.Vector3,
): boolean {
  const cam = s.view;
  cam.updateMatrixWorld();
  viewProj.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  frustum.setFromProjectionMatrix(viewProj);
  const p = s.player.controller.position;

  for (let i = 0; i < trail.count; i++) {
    const c = trail.at(i);
    const d = Math.hypot(c.x - p.x, c.z - p.z);
    if (d < MIN_BACK || d > MAX_BACK) continue;
    cand.copy(c);
    if (fits(s, body, hidden, cand.y)) return done(out);
  }

  const way = s.world.ways.main;
  way.closest(p.x, p.z, near);
  way.tangent(near.t, tan);
  // "Behind" along the Way is against the player's travel; standing still, toward the Way's start.
  const dir = tan.x * heading.x + tan.z * heading.z >= 0 ? -1 : 1;
  const len = Math.max(1, way.length);
  for (let i = 0; i < WAY_BACK.length; i++) {
    const t = near.t + (dir * WAY_BACK[i]!) / len;
    if (t < 0 || t > 1) continue;
    way.sample(t, cand);
    if (fits(s, body, hidden, cand.y)) return done(out);
  }
  return false;
}

function done(out: THREE.Vector3): boolean {
  out.copy(cand);
  return true;
}

/** `cand` (x, z; y from the ground near `fromY`) is free, safe and, when asked, out of view. */
function fits(s: PlaySession, body: Body, hidden: boolean, fromY: number): boolean {
  const col = s.col;
  const y = col.groundAt(cand.x, cand.z, fromY + 0.5);
  if (!Number.isFinite(y)) return false;
  cand.y = y;
  if (col.overlaps(cand.x, y, cand.z, body.radius, body.height)) return false;
  for (let i = 0; i < HAZARD_ZONE_TYPES.length; i++) {
    if (s.zones.isTypeAt(HAZARD_ZONE_TYPES[i]!, cand.x, cand.z)) return false;
  }
  if (!hidden) return true;
  sphere.center.set(cand.x, y + body.height * 0.5, cand.z);
  sphere.radius = body.height * 0.5 + VIEW_PAD;
  return !frustum.intersectsSphere(sphere);
}

/** True when a body standing at `feet` is inside the camera's view (tests, debug). */
export function inView(s: PlaySession, feet: THREE.Vector3, height: number): boolean {
  const cam = s.view;
  viewProj.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  frustum.setFromProjectionMatrix(viewProj);
  sphere.center.set(feet.x, feet.y + height * 0.5, feet.z);
  sphere.radius = height * 0.5;
  return frustum.intersectsSphere(sphere);
}
