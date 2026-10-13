/**
 * Character rig: bone names, body proportions per body type and the generated bone hierarchy.
 *
 * Proportions follow the GDD 2.11 style lock: about 2.5 heads tall, a big round head, a short torso, stubby legs and
 * mitten hands. Rest pose: arms hang ~8 degrees out from the body (A-pose), the character faces +Z and its feet are
 * on y = 0. Every bone's rest ROTATION is identity (the A-pose and the elder's stoop live in bone positions and the
 * geometry), so an animator can treat a pose as plain Euler offsets. Recipe `scale` is baked into the lengths, never
 * into a bone scale, so the root/hips scale stays free for squash and stretch.
 */
import * as THREE from 'three';

export const BODY_BONES = [
  'root',
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'upperArmL',
  'lowerArmL',
  'handL',
  'upperArmR',
  'lowerArmR',
  'handR',
  'thighL',
  'shinL',
  'footL',
  'thighR',
  'shinR',
  'footR',
  'propL',
  'propR',
  'back',
  'sack',
  'hat',
] as const;
export const FACE_BONES = [
  'eyeL',
  'eyeR',
  'browL',
  'browR',
  'mouth_neutral',
  'mouth_smile',
  'mouth_open',
  'mouth_frown',
  'mouth_o',
  'mouth_flat',
  'mouth_wavy',
  'mouth_grin',
] as const;
/** Optional per recipe (body 'beast'). */
export const BEAST_BONES = ['wingL', 'wingR', 'tail1', 'tail2', 'tail3', 'jaw'] as const;
export type BoneName =
  (typeof BODY_BONES)[number] | (typeof FACE_BONES)[number] | (typeof BEAST_BONES)[number];

/**
 * Internal, never animated: the Burden's shoulder ropes (child of chest). It is scaled to 0 together with the sack
 * so the straps vanish when the Burden does.
 */
export const ROPES_BONE = 'ropes';

const PARENT: Record<string, string> = {
  hips: 'root',
  spine: 'hips',
  chest: 'spine',
  neck: 'chest',
  head: 'neck',
  upperArmL: 'chest',
  lowerArmL: 'upperArmL',
  handL: 'lowerArmL',
  propL: 'handL',
  upperArmR: 'chest',
  lowerArmR: 'upperArmR',
  handR: 'lowerArmR',
  propR: 'handR',
  thighL: 'hips',
  shinL: 'thighL',
  footL: 'shinL',
  thighR: 'hips',
  shinR: 'thighR',
  footR: 'shinR',
  back: 'chest',
  sack: 'back',
  hat: 'head',
  ropes: 'chest',
  eyeL: 'head',
  eyeR: 'head',
  browL: 'head',
  browR: 'head',
  mouth_neutral: 'head',
  mouth_smile: 'head',
  mouth_open: 'head',
  mouth_frown: 'head',
  mouth_o: 'head',
  mouth_flat: 'head',
  mouth_wavy: 'head',
  mouth_grin: 'head',
  wingL: 'chest',
  wingR: 'chest',
  tail1: 'hips',
  tail2: 'tail1',
  tail3: 'tail2',
  jaw: 'head',
};

export { bodyFor, type Body } from './rig-bodies';
import type { Body } from './rig-bodies';

const A_POSE = (8 * Math.PI) / 180;

/** Bind-pose positions (model space) of every bone plus the landmarks the part builders need. */
export interface Layout {
  body: Body;
  beast: boolean;
  pos: Record<string, THREE.Vector3>;
  headC: THREE.Vector3;
  /** Arm direction (unit) for side +1 (L, +X) and -1 (R). */
  armDir: (side: number) => THREE.Vector3;
  /** Spine direction (unit, tilted forward by the stoop). */
  spineDir: THREE.Vector3;
  /** When a mask covers the face: z (relative to the head centre) of its front, where eyes and brows sit. */
  faceFrontZ: number | null;
  /** Top of the head (with a little hair) at rest. */
  height: number;
}

/** z of the head surface at (x, y) relative to the head centre, for a sphere of radius r. */
export function headSurfaceZ(r: number, x: number, y: number): number {
  return Math.sqrt(Math.max(0, r * r - x * x - y * y));
}

/** Face anchors relative to the head centre (shared by face.ts and the bone layout). */
export function faceAnchors(r: number): {
  eye: [number, number];
  brow: [number, number];
  mouth: [number, number];
  eyeR: number;
} {
  return { eye: [r * 0.36, -r * 0.03], brow: [r * 0.37, r * 0.29], mouth: [0, -r * 0.4], eyeR: r * 0.12 };
}

export function layoutRig(body: Body, beast: boolean, faceFrontZ: number | null = null): Layout {
  const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
  const p: Record<string, THREE.Vector3> = {};
  const spineDir = v(0, Math.cos(body.stoop), Math.sin(body.stoop));
  const T = body.torsoLen;
  p.root = v(0, 0, 0);
  p.hips = v(0, body.legLen, 0);
  p.spine = p.hips.clone().addScaledVector(spineDir, T * 0.28);
  p.chest = p.hips.clone().addScaledVector(spineDir, T * 0.62);
  p.neck = p.hips.clone().addScaledVector(spineDir, T);
  p.head = p.neck.clone().add(v(0, body.neckLen, body.neckLen * Math.sin(body.stoop)));
  const headC = p.head.clone().add(v(0, body.headR * 0.8, body.headR * 0.12 * Math.sin(body.stoop)));
  p.back = p.chest
    .clone()
    .addScaledVector(spineDir, T * 0.14)
    .add(v(0, 0, -body.torsoRZ * 0.92));
  p.sack = p.back.clone().add(v(0, 0, -0.01 * body.scale));
  p.ropes = p.chest.clone();
  p.hat = headC.clone().add(v(0, body.headR * 0.92, 0));

  const armDir = (side: number): THREE.Vector3 => v(side * Math.sin(A_POSE), -Math.cos(A_POSE), 0);
  const thighLen = (body.legLen - body.footH) * 0.5;
  for (const [side, s] of [
    [1, 'L'],
    [-1, 'R'],
  ] as const) {
    const shoulder = p.neck.clone().add(v(side * body.shoulderHalf, -body.armR * 1.15, -body.torsoRZ * 0.05));
    const d = armDir(side);
    p[`upperArm${s}`] = shoulder;
    p[`lowerArm${s}`] = shoulder.clone().addScaledVector(d, body.armLen * 0.48);
    p[`hand${s}`] = shoulder.clone().addScaledVector(d, body.armLen * 0.9);
    p[`prop${s}`] = p[`hand${s}`]!.clone().addScaledVector(d, body.handR * 0.95);
    p[`thigh${s}`] = v(side * body.hipHalf, body.legLen, 0);
    p[`shin${s}`] = v(side * body.hipHalf, body.legLen - thighLen, 0);
    p[`foot${s}`] = v(side * body.hipHalf, body.footH, 0);
  }

  // Face bones sit on the head surface (eyes and brows on the mask front when a mask covers the face).
  const r = body.headR;
  const a = faceAnchors(r);
  const at = (x: number, y: number, front: number | null): THREE.Vector3 =>
    v(headC.x + x, headC.y + y, headC.z + (front ?? headSurfaceZ(r, x, y)));
  p.eyeL = at(a.eye[0], a.eye[1], faceFrontZ);
  p.eyeR = at(-a.eye[0], a.eye[1], faceFrontZ);
  p.browL = at(a.brow[0], a.brow[1], faceFrontZ);
  p.browR = at(-a.brow[0], a.brow[1], faceFrontZ);
  const mouth = at(a.mouth[0], a.mouth[1], null);
  for (const m of FACE_BONES) if (m.startsWith('mouth_')) p[m] = mouth.clone();

  if (beast) {
    p.wingL = p.back.clone().add(v(body.torsoRX * 0.45, T * 0.05, 0));
    p.wingR = p.back.clone().add(v(-body.torsoRX * 0.45, T * 0.05, 0));
    p.tail1 = p.hips.clone().add(v(0, -T * 0.05, -body.torsoRZ * 0.85));
    p.tail2 = p.tail1.clone().add(v(0, -T * 0.12, -T * 0.35));
    p.tail3 = p.tail2.clone().add(v(0, -T * 0.1, -T * 0.35));
    p.jaw = headC.clone().add(v(0, -r * 0.25, r * 0.35));
  }
  const height = headC.y + r * 1.04;
  return { body, beast, pos: p, headC, armDir, spineDir, faceFrontZ, height };
}

export interface Rig {
  rootBone: THREE.Bone;
  bones: Record<string, THREE.Bone>;
  /** Skeleton order; skinIndex values index into this. */
  list: THREE.Bone[];
  index: Record<string, number>;
}

/** Creates the bone hierarchy at the bind pose (identity rotations, local position = child - parent). */
export function buildRig(layout: Layout): Rig {
  const names: string[] = [...BODY_BONES, ...FACE_BONES, ROPES_BONE];
  if (layout.beast) names.push(...BEAST_BONES);
  const bones: Record<string, THREE.Bone> = {};
  const index: Record<string, number> = {};
  const list: THREE.Bone[] = [];
  for (const name of names) {
    const b = new THREE.Bone();
    b.name = name;
    const at = layout.pos[name] ?? new THREE.Vector3();
    const parentName = PARENT[name];
    if (parentName) {
      const parent = bones[parentName];
      if (!parent) throw new Error(`rig: parent "${parentName}" must come before "${name}"`);
      b.position.copy(at).sub(layout.pos[parentName] ?? new THREE.Vector3());
      parent.add(b);
    } else {
      b.position.copy(at);
    }
    index[name] = list.length;
    list.push(b);
    bones[name] = b;
  }
  return { rootBone: bones.root!, bones, list, index };
}
