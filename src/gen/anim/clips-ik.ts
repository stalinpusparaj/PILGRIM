/**
 * Two-bone arm IK for contact poses (hands together, holding a book, hands over ears). Works from the
 * measured rig, so mittens meet on every body type. Angles go straight into twist-free 'YXZ' offsets
 * (y = 0) on the branch that keeps them small, so they crossfade cleanly with hand-written poses.
 */
import * as THREE from 'three';
import type { BoneName } from '../rig';
import type { AnimParams, Pose } from './types';
import { rigOf } from './clips-rig';
import { clamp, limbBone, type Side } from './clips-util';

const _t = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _u = new THREE.Vector3();
const _f = new THREE.Vector3();
const _e = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q1 = new THREE.Quaternion();
const _eul = new THREE.Euler(0, 0, 0, 'YXZ');
const out2 = { x: 0, z: 0 };

/**
 * Offsets (x, z with y = 0) that turn rest direction d0 into direction e (both unit, bone-local). 'pitch'
 * keeps the swing in x (arm in front, forearm flexion); 'roll' keeps it in z (arm raised to the side).
 */
function dirToEuler(e: THREE.Vector3, d0: THREE.Vector3, branch: 'pitch' | 'roll'): typeof out2 {
  const rho = Math.sqrt(e.y * e.y + e.z * e.z);
  const theta0 = Math.atan2(d0.x, -d0.y);
  let theta: number;
  if (branch === 'pitch') {
    out2.x = Math.atan2(-e.z, -e.y);
    theta = Math.atan2(e.x, rho);
  } else {
    out2.x = Math.atan2(e.z, e.y);
    theta = Math.atan2(e.x, -rho);
  }
  let z = theta - theta0;
  if (z > Math.PI) z -= 2 * Math.PI;
  else if (z < -Math.PI) z += 2 * Math.PI;
  out2.z = z;
  return out2;
}

function blendInto(out: Pose, bone: BoneName, x: number, z: number, w: number): void {
  const b = out.bones.get(bone);
  if (!b) {
    out.bones.set(bone, { x: x * w, y: 0, z: z * w });
    return;
  }
  b.x += (x - b.x) * w;
  b.y += (0 - b.y) * w;
  b.z += (z - b.z) * w;
}

/**
 * Put the mitten of `side` at (tx, ty, tz) in chest space (the upper arm's parent, character axes), with the
 * elbow bending toward the pole direction (px, py, pz). Blends into `out` by weight w (0..1). upper = 'pitch'
 * for hands in front of the body, 'roll' for hands raised beside the head.
 */
export function reachArm(
  out: Pose,
  p: AnimParams,
  side: Side,
  tx: number,
  ty: number,
  tz: number,
  px: number,
  py: number,
  pz: number,
  w: number,
  upper: 'pitch' | 'roll' = 'pitch',
): void {
  if (w <= 0) return;
  const r = rigOf(p);
  const a = side === 1 ? r.armL : r.armR;
  const l1 = r.upperArm;
  const l2 = r.lowerArm;
  _t.set(tx, ty, tz).sub(a.shoulder);
  const d0 = _t.length();
  if (d0 < 1e-6) _t.set(0, -1, 0);
  else _t.divideScalar(d0);
  const d = clamp(d0, Math.abs(l1 - l2) + 1e-4, (l1 + l2) * 0.999);

  // Elbow direction: pole made perpendicular to the reach line.
  _pole.set(px, py, pz).addScaledVector(_t, -(px * _t.x + py * _t.y + pz * _t.z));
  if (_pole.lengthSq() < 1e-8) _pole.set(0, 0, -1).addScaledVector(_t, -_t.z);
  _pole.normalize();
  const cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  _u.copy(_t).multiplyScalar(cosA).addScaledVector(_pole, sinA); // shoulder → elbow (unit)
  _f.copy(_t).multiplyScalar(d).addScaledVector(_u, -l1).normalize(); // elbow → mitten (unit)

  // Upper arm: upperQ * off1 * upperDir = u.
  _q.copy(a.upperQ).invert();
  _e.copy(_u).applyQuaternion(_q);
  const o1 = dirToEuler(_e, a.upperDir, upper);
  const x1 = o1.x;
  const z1 = o1.z;
  blendInto(out, limbBone('upperArm', side), x1, z1, w);

  // Lower arm: (upperQ * off1 * lowerQ) * off2 * lowerDir = f.
  _q1.setFromEuler(_eul.set(x1, 0, z1, 'YXZ'));
  _q.copy(a.upperQ).multiply(_q1).multiply(a.lowerQ).invert();
  _e.copy(_f).applyQuaternion(_q);
  const o2 = dirToEuler(_e, a.lowerDir, 'pitch');
  blendInto(out, limbBone('lowerArm', side), o2.x, o2.z, w);
}
