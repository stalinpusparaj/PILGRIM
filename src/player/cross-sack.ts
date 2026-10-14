/**
 * The Burden as a loose object for the Cross (GDD 2.7.1). The sack is cut out of the character's own baked mesh
 * (every vertex is rigidly bound to one bone, so the 'sack' bone's triangles ARE the sack the player has been
 * carrying: same lumps, same colours, same rope bands) and placed exactly where the skinned copy was, so hiding
 * the character's sack and showing this one is seamless. A recipe without a sack gets an equivalent lumpy sack
 * built with the geom.ts helpers.
 */
import * as THREE from 'three';
import type { Character } from '../gen/CharacterFactory';
import { cylinder, jitter, lowSphere, merge, part, xform } from '../gen/geom';
import { mat } from '../gen/materials';
import { shade } from '../gen/palette';
import { Rng, hashString } from '../gen/rng';

export interface SackBody {
  readonly mesh: THREE.Mesh;
  /** Half extents of the sack in its local frame, scaled (m). */
  readonly semi: THREE.Vector3;
  /** Mean radius, for rolling (m). */
  readonly radius: number;
  /** Rope colour of the recipe (for the fibre particles). */
  readonly ropeColor: string;
  dispose(): void;
}

const MIN_TRIANGLES = 12;
const tmpM = new THREE.Matrix4();
const tmpT = new THREE.Matrix4();

/** Builds the loose sack at the character's sack transform and adds it to `scene`. */
export function detachSack(c: Character, scene: THREE.Object3D): SackBody {
  const sackBone = c.bones['sack'];
  const ropeColor = c.recipe.colors['sackRope'] ?? c.recipe.colors['belt'] ?? '#C9A66B';
  c.root.updateMatrixWorld(true);
  const cut = sackBone ? cutBoneTriangles(c, sackBone) : null;
  const geometry = cut ?? buildSackGeometry(c);
  geometry.computeBoundingBox();
  const box =
    geometry.boundingBox ??
    new THREE.Box3(new THREE.Vector3(-0.3, -0.45, -0.25), new THREE.Vector3(0.3, 0.45, 0.25));
  const center = box.getCenter(new THREE.Vector3());
  geometry.translate(-center.x, -center.y, -center.z);
  geometry.computeBoundingSphere();

  const mesh = new THREE.Mesh(geometry, mat('lambert'));
  mesh.name = 'cross:sack';
  mesh.castShadow = true;
  mesh.matrixAutoUpdate = true;

  // World transform: what skinning did to these vertices (bone world × bone inverse), then the recentring.
  if (cut && sackBone) {
    const idx = c.skeleton.bones.indexOf(sackBone);
    const inv = c.skeleton.boneInverses[idx];
    tmpM.copy(sackBone.matrixWorld);
    if (inv) tmpM.multiply(inv);
  } else {
    // Fallback sack hangs behind the upper back.
    tmpM.copy(c.root.matrixWorld);
    tmpM.multiply(tmpT.makeTranslation(0, c.height * 0.55, -c.height * 0.16));
  }
  tmpM.multiply(tmpT.makeTranslation(center.x, center.y, center.z));
  tmpM.decompose(mesh.position, mesh.quaternion, mesh.scale);
  // A collapsed spring (scale ~0) would hide the loose sack too: never smaller than a normal sack.
  if (mesh.scale.x < 0.5) mesh.scale.setScalar(1);
  scene.add(mesh);

  const size = box.getSize(new THREE.Vector3()).multiply(mesh.scale).multiplyScalar(0.5);
  const radius = (size.x + size.y + size.z) / 3;
  return {
    mesh,
    semi: size,
    radius,
    ropeColor,
    dispose(): void {
      mesh.removeFromParent();
      geometry.dispose();
    },
  };
}

/** Copies the triangles rigidly bound to `bone` (bind space: position, normal, colour). */
function cutBoneTriangles(c: Character, bone: THREE.Bone): THREE.BufferGeometry | null {
  const idx = c.skeleton.bones.indexOf(bone);
  if (idx < 0) return null;
  const g = c.mesh.geometry;
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const col = g.getAttribute('color');
  const si = g.getAttribute('skinIndex');
  if (!pos || !nor || !col || !si || g.index) return null;
  const tris = Math.floor(pos.count / 3);
  let kept = 0;
  for (let t = 0; t < tris; t++) if (onBone(si, t, idx)) kept++;
  if (kept < MIN_TRIANGLES) return null;
  const p = new Float32Array(kept * 9);
  const n = new Float32Array(kept * 9);
  const k = new Float32Array(kept * 9);
  let w = 0;
  for (let t = 0; t < tris; t++) {
    if (!onBone(si, t, idx)) continue;
    for (let v = t * 3; v < t * 3 + 3; v++) {
      p[w] = pos.getX(v);
      p[w + 1] = pos.getY(v);
      p[w + 2] = pos.getZ(v);
      n[w] = nor.getX(v);
      n[w + 1] = nor.getY(v);
      n[w + 2] = nor.getZ(v);
      k[w] = col.getX(v);
      k[w + 1] = col.getY(v);
      k[w + 2] = col.getZ(v);
      w += 3;
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(p, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  out.setAttribute('color', new THREE.BufferAttribute(k, 3));
  return out;
}

function onBone(
  si: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  t: number,
  idx: number,
): boolean {
  const v = t * 3;
  return si.getX(v) === idx && si.getX(v + 1) === idx && si.getX(v + 2) === idx;
}

/** An equivalent lumpy, rope-tied sack (char-props.ts proportions) for a character that carries none. */
function buildSackGeometry(c: Character): THREE.BufferGeometry {
  const rng = new Rng(hashString(`cross-sack:${c.recipe.id}`));
  const s = c.height / 1.5;
  const H = 0.95 * s;
  const W = H * 0.64;
  const D = H * 0.52;
  const cloth = c.recipe.colors['sack'] ?? '#A38A62';
  const rope = c.recipe.colors['sackRope'] ?? c.recipe.colors['belt'] ?? '#C9A66B';
  const parts: THREE.BufferGeometry[] = [
    part(jitter(xform(lowSphere(1, 1), { scale: [W / 2, H / 2, D / 2] }), H * 0.035, rng), cloth),
    part(jitter(lowSphere(H * 0.17, 0), H * 0.02, rng), shade(cloth, -0.03), {
      pos: [0.3 * W, -0.26 * H, -0.1 * D],
    }),
    part(jitter(lowSphere(H * 0.16, 0), H * 0.02, rng), shade(cloth, -0.03), {
      pos: [-0.32 * W, -0.2 * H, 0],
    }),
    part(cylinder(W * 0.12, W * 0.22, H * 0.14, 7), shade(cloth, -0.05), { pos: [0, H * 0.4, 0] }),
    part(jitter(lowSphere(W * 0.17, 0), W * 0.03, rng), cloth, {
      scale: [1.3, 0.75, 1.1],
      pos: [0, H * 0.58, 0],
    }),
    part(cylinder(W * 0.15, W * 0.15, 0.035 * s, 7), rope, { pos: [0, H * 0.5, 0] }),
    part(cylinder(W * 0.47, W * 0.47, 0.04 * s, 10), rope, { scale: [1, 1, D / W], pos: [0, H * 0.17, 0] }),
    part(cylinder(W * 0.44, W * 0.44, 0.04 * s, 10), rope, { scale: [1, 1, D / W], pos: [0, -H * 0.2, 0] }),
  ];
  return merge(parts);
}
