/**
 * Apollyon's body language for the fight (GDD 2.9 "big readable shapes, glowing tells"): the scripted pose laid
 * over his animator each rendered frame (paw raised and slammed, lean, wings flapping, jaw), the red glow on the
 * slamming paw, the furnace glow in his belly, and the red ring on the ground where the paw will land.
 *
 * The animator rewrites the arm, chest and spine bones every frame from rest, so the offsets here never add up;
 * the wing and jaw bones are not animated by any clip and are set from their own rest pose. Call `apply()` after
 * the World animated him (a render system after PLAY_ORDER.world). Three small meshes with their own materials
 * (paw, belly, ring: at most 3 extra draw calls while they glow), all freed by dispose().
 */
import * as THREE from 'three';
import type { Character } from '../gen/CharacterFactory';

const Z = new THREE.Vector3(0, 0, 1);
const X = new THREE.Vector3(1, 0, 0);
const q = new THREE.Quaternion();
const tmp = new THREE.Vector3();

function glowMesh(geo: THREE.BufferGeometry, hex: string, name: string): THREE.Mesh {
  const m = new THREE.MeshBasicMaterial({
    color: new THREE.Color(hex),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const mesh = new THREE.Mesh(geo, m);
  mesh.name = name;
  mesh.visible = false;
  mesh.renderOrder = 4;
  return mesh;
}

export class ApollyonBody {
  /** 0 = arm at rest, 1 = paw raised high (the telegraph). */
  paw = 0;
  /** 0..1: the paw comes down (overrides the raise). */
  slam = 0;
  /** Red glow on the paw, 0..1. */
  pawGlow = 0;
  /** Belly furnace, 0..1 (brightens before darts; wide open after a blocked slam). */
  belly = 0;
  /** Wing beats per second (0 = folded and still). */
  flap = 0.3;
  /** Forward lean of the body (rad; negative leans back, stunned). */
  lean = 0;
  /** Jaw open 0..1 (roars). */
  jaw = 0;

  private readonly c: Character;
  private readonly pawMesh: THREE.Mesh;
  private readonly bellyMesh: THREE.Mesh;
  private readonly ring: THREE.Mesh;
  private readonly wingRest: [THREE.Quaternion, THREE.Quaternion];
  private readonly jawRest: THREE.Quaternion;
  private phase = 0;
  private ringK = 0;

  constructor(character: Character, scene: THREE.Object3D) {
    this.c = character;
    const h = character.height;
    this.pawMesh = glowMesh(new THREE.IcosahedronGeometry(0.16 * h, 1), '#FF3B2F', 'apollyon:paw');
    this.bellyMesh = glowMesh(new THREE.IcosahedronGeometry(0.17 * h, 1), '#FF7A2F', 'apollyon:belly');
    const ring = new THREE.RingGeometry(0.85, 1, 40, 1);
    ring.rotateX(-Math.PI / 2);
    this.ring = glowMesh(ring, '#FF3B2F', 'apollyon:ring');
    scene.add(this.pawMesh, this.bellyMesh, this.ring);
    const b = character.bones;
    this.wingRest = [
      (b['wingL']?.quaternion ?? new THREE.Quaternion()).clone(),
      (b['wingR']?.quaternion ?? new THREE.Quaternion()).clone(),
    ];
    this.jawRest = (b['jaw']?.quaternion ?? new THREE.Quaternion()).clone();
  }

  /** The paw that slams (world). */
  pawPos(out: THREE.Vector3): THREE.Vector3 {
    const hand = this.c.bones['handR'];
    return hand ? hand.getWorldPosition(out) : out.copy(this.c.root.position);
  }

  /** The belly glow, the sword's target (world). */
  bellyPos(out: THREE.Vector3): THREE.Vector3 {
    const chest = this.c.bones['spine'] ?? this.c.bones['chest'];
    if (chest) chest.getWorldPosition(out);
    else out.copy(this.c.root.position).setY(out.y + this.c.height * 0.45);
    const yaw = this.c.root.rotation.y;
    const fwd = 0.16 * this.c.height;
    out.x += Math.sin(yaw) * fwd;
    out.z += Math.cos(yaw) * fwd;
    return out;
  }

  /** Shows the red landing ring at `at` (ground) growing to `radius` as k goes 0 → 1; k < 0 hides it. */
  setRing(at: THREE.Vector3 | null, radius: number, k: number): void {
    this.ringK = at ? k : -1;
    if (!at || k < 0) {
      this.ring.visible = false;
      return;
    }
    this.ring.visible = true;
    this.ring.position.set(at.x, at.y + 0.08, at.z);
    const r = radius * (0.35 + 0.65 * k);
    this.ring.scale.set(r, 1, r);
  }

  /** Per rendered frame, after the World animated the character. */
  apply(frameDt: number, time: number): void {
    if (!this.c.root.visible) {
      this.pawMesh.visible = this.bellyMesh.visible = this.ring.visible = false;
      return; // not animated this frame: offsets would pile up on last frame's pose
    }
    const b = this.c.bones;
    const raise = this.paw * (1 - this.slam);
    const upper = b['upperArmR'];
    if (upper) upper.quaternion.multiply(q.setFromAxisAngle(X, -2.6 * raise - 0.9 * this.slam));
    const lower = b['lowerArmR'];
    if (lower) lower.quaternion.multiply(q.setFromAxisAngle(X, -0.7 * raise));
    const spine = b['spine'];
    if (spine) spine.quaternion.multiply(q.setFromAxisAngle(X, this.lean + 0.35 * this.slam - 0.12 * raise));

    this.phase += frameDt * this.flap * Math.PI * 2;
    const amp = this.flap > 0.5 ? 0.7 : 0.12;
    const beat = amp * Math.sin(this.phase);
    const wl = b['wingL'];
    const wr = b['wingR'];
    if (wl) wl.quaternion.copy(this.wingRest[0]).multiply(q.setFromAxisAngle(Z, beat));
    if (wr) wr.quaternion.copy(this.wingRest[1]).multiply(q.setFromAxisAngle(Z, -beat));
    const jaw = b['jaw'];
    if (jaw) jaw.quaternion.copy(this.jawRest).multiply(q.setFromAxisAngle(X, 0.5 * this.jaw));
    this.c.root.updateMatrixWorld(true);

    const pulse = 0.85 + 0.15 * Math.sin(time * 14);
    this.glow(this.pawMesh, this.pawGlow * pulse, this.pawPos(tmp));
    this.glow(this.bellyMesh, this.belly * (0.8 + 0.2 * Math.sin(time * 9)), this.bellyPos(tmp));
    if (this.ringK >= 0) (this.ring.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.5 * this.ringK * pulse;
  }

  /** Everything off (between phases, leaving). */
  calm(): void {
    this.paw = this.slam = this.pawGlow = this.belly = this.lean = this.jaw = 0;
    this.setRing(null, 0, -1);
  }

  dispose(): void {
    for (const m of [this.pawMesh, this.bellyMesh, this.ring]) {
      m.removeFromParent();
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  }

  private glow(mesh: THREE.Mesh, k: number, at: THREE.Vector3): void {
    mesh.visible = k > 0.02 && this.c.root.visible;
    if (!mesh.visible) return;
    mesh.position.copy(at);
    mesh.scale.setScalar(0.6 + 0.6 * k);
    (mesh.material as THREE.MeshBasicMaterial).opacity = Math.min(1, k);
  }
}
