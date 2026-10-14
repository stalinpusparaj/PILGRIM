/**
 * Head look for NPCs (GDD 2.8 "Look at the player when talking, look at points of interest"): the chest, neck and
 * head turn toward a point or a moving target, eased, within a natural range; null eases back to straight ahead.
 *
 * The Animator writes absolute bone quaternions every Character.update() (rest × clip offsets), so the turn is
 * applied on top of the animated pose once per rendered frame, after the character was animated (NPC runs it right
 * after the World's per-frame update). When nothing re-posed the character this frame (World distance culling,
 * paused game) the last animated pose is reused, so the turn never accumulates. Allocation-free per frame.
 */
import * as THREE from 'three';
import type { Character } from '../gen/CharacterFactory';
import { wrapAngle } from '../player/player-move';

/** A world point, a function giving one each frame (a moving head), or null (straight ahead). */
export type LookTarget = THREE.Vector3 | (() => THREE.Vector3) | null;

/** Turn limits (rad) relative to the body. */
export const LOOK_LIMIT = { yaw: 1.25, pitch: 0.45 } as const;
/** How the turn is shared down the spine (sums to 1). */
const SHARE = [0.2, 0.35, 0.45] as const;
const BONES = ['chest', 'neck', 'head'] as const;
/** Easing rate (1/s) toward the wanted angles. */
const EASE = 7;
/** Eye height as a fraction of the character's height. */
const EYE = 0.88;

export class HeadLook {
  /** Current eased angles (rad), relative to the body. */
  yaw = 0;
  pitch = 0;
  private target: LookTarget = null;
  private wantYaw = 0;
  private wantPitch = 0;
  /** Unclamped relative yaw to the target (rad), NaN without one: the NPC turns its body past the limit. */
  private rel = Number.NaN;
  private readonly c: Character;
  private readonly bones: Array<THREE.Bone | null>;
  private readonly base: THREE.Quaternion[];
  private readonly written: THREE.Quaternion[];
  private wrote = false;
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly eye = new THREE.Vector3();

  constructor(c: Character) {
    this.c = c;
    this.bones = BONES.map((n) => c.bones[n] ?? null);
    this.base = BONES.map(() => new THREE.Quaternion());
    this.written = BONES.map(() => new THREE.Quaternion());
  }

  set(target: LookTarget): void {
    this.target = target;
    if (!target) this.rel = Number.NaN;
  }

  get current(): LookTarget {
    return this.target;
  }

  /** Relative yaw (rad) from the body to the target as last measured; NaN when there is none. */
  get relativeYaw(): number {
    return this.rel;
  }

  /** Measures the wanted turn from the character's root (call before apply, once per frame). */
  measure(bodyYaw: number): void {
    const t = this.target;
    if (!t) {
      this.wantYaw = 0;
      this.wantPitch = 0;
      return;
    }
    const p = typeof t === 'function' ? t() : t;
    const root = this.c.root.position;
    this.eye.set(root.x, root.y + this.c.height * EYE, root.z);
    const dx = p.x - this.eye.x;
    const dy = p.y - this.eye.y;
    const dz = p.z - this.eye.z;
    const flat = Math.sqrt(dx * dx + dz * dz);
    if (!(flat > 0.05) || !Number.isFinite(flat)) {
      this.rel = Number.NaN;
      this.wantYaw = 0;
      this.wantPitch = 0;
      return;
    }
    this.rel = wrapAngle(Math.atan2(dx, dz) - bodyYaw);
    this.wantYaw = clamp(this.rel, -LOOK_LIMIT.yaw, LOOK_LIMIT.yaw);
    // Positive X rotation tips a +Z-facing head down; look up at things above the eyes.
    this.wantPitch = clamp(-Math.atan2(dy, flat), -LOOK_LIMIT.pitch, LOOK_LIMIT.pitch);
  }

  /** Eases toward the wanted angles and writes the bones on top of the animated pose. */
  apply(dt: number): void {
    const k = 1 - Math.exp(-EASE * Math.max(0, dt));
    this.yaw += (this.wantYaw - this.yaw) * k;
    this.pitch += (this.wantPitch - this.pitch) * k;
    const idle = Math.abs(this.yaw) < 1e-3 && Math.abs(this.pitch) < 1e-3 && !this.target;
    if (idle) {
      this.yaw = 0;
      this.pitch = 0;
      this.restore();
      return;
    }
    for (let i = 0; i < this.bones.length; i++) {
      const b = this.bones[i];
      if (!b) continue;
      // Not re-posed since our last write: start again from the pose we turned last time.
      if (!(this.wrote && b.quaternion.equals(this.written[i]!))) this.base[i]!.copy(b.quaternion);
      this.e.set(this.pitch * SHARE[i]!, this.yaw * SHARE[i]!, 0, 'YXZ');
      this.q.setFromEuler(this.e);
      b.quaternion.copy(this.base[i]!).multiply(this.q);
      this.written[i]!.copy(b.quaternion);
    }
    this.wrote = true;
  }

  /** Puts back the animated pose if nothing re-posed the bones since the last write (dispose, look ended). */
  restore(): void {
    if (!this.wrote) return;
    for (let i = 0; i < this.bones.length; i++) {
      const b = this.bones[i];
      if (b && b.quaternion.equals(this.written[i]!)) b.quaternion.copy(this.base[i]!);
    }
    this.wrote = false;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
