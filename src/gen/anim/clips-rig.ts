/**
 * Rig measurement: the proportions clips need for ground contact and arm IK, read once from the skeleton's
 * rest pose. Without a skeleton (or for bones a rig lacks) standard 2.5-heads-tall toy proportions of the
 * height are used.
 */
import * as THREE from 'three';
import type { AnimParams, ArmRest, RigInfo } from './types';

/**
 * Standard toy proportions as fractions of height, matching the adult body in rig.ts (stubby legs, a head 0.4
 * h across, short arms). Contact radii are geometry the bones cannot tell: knee pad = shin capsule, seat =
 * pelvis bottom, belly = torso half-depth.
 */
const STD = {
  hipHeight: 0.297,
  hipJoint: 0,
  hipWidth: 0.068,
  thigh: 0.125,
  shin: 0.125,
  ankle: 0.047,
  kneeR: 0.053,
  seatR: 0.055,
  bodyR: 0.11,
  toe: 0.1,
  heel: 0.043,
  headR: 0.2,
  chestY: 0.49,
  shoulderX: 0.14,
  shoulderY: 0.07,
  upperArm: 0.133,
  lowerArm: 0.116,
  mitten: 0.05,
} as const;

const A_POSE = (8 * Math.PI) / 180;

function stdArm(side: 1 | -1, h: number, a: ArmRest): ArmRest {
  a.shoulder.set(STD.shoulderX * h * side, STD.shoulderY * h, 0);
  a.upperQ.identity();
  a.lowerQ.identity();
  a.upperDir.set(Math.sin(A_POSE) * side, -Math.cos(A_POSE), 0);
  a.lowerDir.set(0, -1, 0);
  return a;
}

function newArm(): ArmRest {
  return {
    shoulder: new THREE.Vector3(),
    upperQ: new THREE.Quaternion(),
    lowerQ: new THREE.Quaternion(),
    upperDir: new THREE.Vector3(0, -1, 0),
    lowerDir: new THREE.Vector3(0, -1, 0),
  };
}

/** Fill `r` with standard proportions for height h. */
function fillStd(r: RigInfo, h: number): RigInfo {
  r.h = h;
  r.hipHeight = STD.hipHeight * h;
  r.hipJoint = STD.hipJoint * h;
  r.hipWidth = STD.hipWidth * h;
  r.thigh = STD.thigh * h;
  r.shin = STD.shin * h;
  r.ankle = STD.ankle * h;
  r.kneeR = STD.kneeR * h;
  r.seatR = STD.seatR * h;
  r.bodyR = STD.bodyR * h;
  r.toe = STD.toe * h;
  r.heel = STD.heel * h;
  r.headR = STD.headR * h;
  r.headDist = h - r.headR - r.hipHeight;
  r.headAngle = 0;
  r.headC.set(0, h - r.headR - STD.chestY * h, 0);
  r.upperArm = STD.upperArm * h;
  r.lowerArm = STD.lowerArm * h + STD.mitten * h;
  stdArm(1, h, r.armL);
  stdArm(-1, h, r.armR);
  return r;
}

function blankRig(): RigInfo {
  return {
    h: 1,
    hipHeight: 0,
    hipJoint: 0,
    hipWidth: 0,
    thigh: 0,
    shin: 0,
    ankle: 0,
    kneeR: 0,
    seatR: 0,
    bodyR: 0,
    toe: 0,
    heel: 0,
    headR: 0,
    headDist: 0,
    headAngle: 0,
    headC: new THREE.Vector3(),
    upperArm: 0,
    lowerArm: 0,
    armL: newArm(),
    armR: newArm(),
  };
}

/** Standard rig for a height (new object). */
export function standardRig(height: number): RigInfo {
  return fillStd(blankRig(), Math.max(0.05, height));
}

const fallback = blankRig();
let fallbackH = -1;

/**
 * The params' measured rig, or a shared standard rig for p.height (refilled only when the height changes).
 */
export function rigOf(p: AnimParams): RigInfo {
  if (p.rig) return p.rig;
  const h = Number.isFinite(p.height) && p.height > 0.05 ? p.height : 1.6;
  if (h !== fallbackH) {
    fillStd(fallback, h);
    fallbackH = h;
  }
  return fallback;
}

// ------------------------------------------------------------------------------------------- measuring

const _m = new THREE.Matrix4();
const _local = new THREE.Matrix4();

/** Rest-pose position of `bone` in the space of `frame` (an ancestor, or null for the chain's top). */
function restPos(bone: THREE.Object3D, frame: THREE.Object3D | null, out: THREE.Vector3): THREE.Vector3 {
  _m.identity();
  let b: THREE.Object3D | null = bone;
  while (b && b !== frame && b instanceof THREE.Bone) {
    _local.compose(b.position, b.quaternion, b.scale);
    _m.premultiply(_local);
    b = b.parent;
  }
  return out.setFromMatrixPosition(_m);
}

/**
 * Measure a skeleton (bone names per rig.ts, rest pose = current pose). Character space is the `root` bone's
 * frame (feet on y = 0); missing bones fall back to standard proportions.
 */
export function measureRig(bones: Record<string, THREE.Bone>, height: number): RigInfo {
  const h = Number.isFinite(height) && height > 0.05 ? height : 1.6;
  const r = standardRig(h);
  const frame = bones['root'] ?? null;
  const P = (name: string): THREE.Vector3 | null => {
    const b = bones[name];
    return b ? restPos(b, frame, new THREE.Vector3()) : null;
  };
  const hips = P('hips');
  const thigh = P('thighL');
  const shin = P('shinL');
  const foot = P('footL');
  if (hips && hips.y > 0.05 * h) r.hipHeight = hips.y;
  if (hips && thigh) {
    r.hipJoint = Math.max(0, hips.y - thigh.y);
    r.hipWidth = Math.abs(thigh.x - hips.x);
  }
  if (thigh && shin) r.thigh = Math.max(0.02 * h, thigh.distanceTo(shin));
  if (shin && foot) r.shin = Math.max(0.02 * h, shin.distanceTo(foot));
  if (foot) r.ankle = Math.max(0, foot.y);

  // Head: the head bone sits at the base of the head (rig.ts), whose centre is ~0.8 r above it and whose top
  // (with hair) is the character height, ~1.84 r above it.
  const head = P('head');
  const chest = P('chest');
  if (head && head.y < h) {
    r.headR = Math.min(0.3 * h, Math.max(0.12 * h, (h - head.y) / 1.84));
    const cy = head.y + 0.8 * r.headR;
    if (chest) r.headC.set(0, cy - chest.y, head.z - chest.z);
    if (hips) {
      const dy = cy - hips.y;
      const dz = head.z - hips.z;
      r.headDist = Math.max(0.1 * h, Math.sqrt(dy * dy + dz * dz));
      r.headAngle = Math.atan2(dz, dy);
    }
  } else {
    r.headDist = Math.max(0.1 * h, h - r.headR - r.hipHeight);
    if (chest) r.headC.set(0, h - r.headR - chest.y, 0);
  }
  measureArm(bones, 'L', r.armL, r, h);
  measureArm(bones, 'R', r.armR, r, h);

  const ratio = r.hipHeight / h;
  if (ratio < 0.12 || ratio > 0.75) {
    console.warn(
      `[anim] hip height is ${ratio.toFixed(2)} x AnimParams.height; height should be in skeleton units`,
    );
  }
  return r;
}

function measureArm(
  bones: Record<string, THREE.Bone>,
  s: 'L' | 'R',
  a: ArmRest,
  r: RigInfo,
  h: number,
): void {
  const upper = bones[`upperArm${s}`];
  const lower = bones[`lowerArm${s}`];
  const hand = bones[`hand${s}`];
  if (!upper || !lower) return;
  a.shoulder.copy(upper.position);
  a.upperQ.copy(upper.quaternion);
  a.lowerQ.copy(lower.quaternion);
  const ul = lower.position.length();
  if (ul > 1e-4) {
    a.upperDir.copy(lower.position).divideScalar(ul);
    if (s === 'L') r.upperArm = ul;
  }
  if (hand) {
    const ll = hand.position.length();
    if (ll > 1e-4) {
      a.lowerDir.copy(hand.position).divideScalar(ll);
      // Elbow to mitten centre: the prop bone sits in the middle of the mitten.
      const prop = bones[`prop${s}`];
      const mitten = prop && prop.parent === hand ? prop.position.length() : STD.mitten * h;
      if (s === 'L') r.lowerArm = ll + mitten;
    }
  }
}
