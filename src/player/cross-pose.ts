/**
 * Small additive bone tweaks on top of the playing clip for the Cross (GDD 2.7.1): Christian looks up from his
 * kneel, his head follows the rolling sack, the sack wobbles as each rope snaps, and he straightens up into a big
 * stretch (arms high, chest arched, face up). Applied per rendered frame after the character has animated; the
 * Character rewrites these bones on its next update, and a frame with no update in between (pause, uneven frame
 * pacing) restores the clean pose first, so a tweak never accumulates.
 */
import * as THREE from 'three';
import type { Character } from '../gen/CharacterFactory';
import { clamp, smoothstep } from './cross-types';

const BONES = ['head', 'neck', 'chest', 'upperArmL', 'upperArmR', 'lowerArmL', 'lowerArmR', 'sack'] as const;
type TweakBone = (typeof BONES)[number];
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
/** Stretch: upper arms swing up overhead (rad about the forward axis), elbows nearly straight. */
const STRETCH = { arm: 2.55, elbow: 0.25, chest: -0.24, neck: -0.12, head: -0.32 } as const;
const LOOK_UP = { neck: -0.32, head: -0.62 } as const;
const WATCH_MAX = 1.1;
const WOBBLE = { decay: 3.6, freqX: 17, freqZ: 13 } as const;

/** A 0..1 weight that eases towards a target over a set time. */
class Ramp {
  value = 0;
  private target = 0;
  private rate = 1;
  set(target: number, seconds: number): void {
    this.target = clamp(target, 0, 1);
    this.rate = 1 / Math.max(0.01, seconds);
    if (seconds <= 0) this.value = this.target;
  }
  step(dt: number): void {
    const d = this.target - this.value;
    const s = this.rate * dt;
    this.value = Math.abs(d) <= s ? this.target : this.value + Math.sign(d) * s;
  }
  get eased(): number {
    return smoothstep(0, 1, this.value);
  }
}

export class PoseTweaks {
  private readonly lookUp = new Ramp();
  private readonly stretch = new Ramp();
  private readonly watchW = new Ramp();
  private readonly watchAt = new THREE.Vector3();
  private watchYaw = 0;
  private wobbleT = -1;
  private wobbleAmp = 0;
  private readonly base: THREE.Quaternion[] = BONES.map(() => new THREE.Quaternion());
  private readonly written: THREE.Quaternion[] = BONES.map(() => new THREE.Quaternion(NaN, NaN, NaN, NaN));
  private readonly q = new THREE.Quaternion();
  private readonly tmp = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();

  setLookUp(on: boolean, seconds: number): void {
    this.lookUp.set(on ? 1 : 0, seconds);
  }

  setStretch(on: boolean, seconds: number): void {
    this.stretch.set(on ? 1 : 0, seconds);
  }

  /** Turn the head towards a world point (null lets go). The vector is copied each call. */
  watch(p: THREE.Vector3 | null, seconds = 0.5): void {
    if (p) this.watchAt.copy(p);
    this.watchW.set(p ? 1 : 0, seconds);
  }

  /** A rope snapped: the sack swings on its pivot. */
  wobble(amp: number): void {
    this.wobbleT = 0;
    this.wobbleAmp = amp;
  }

  /** Fixed step. */
  step(dt: number): void {
    this.lookUp.step(dt);
    this.stretch.step(dt);
    this.watchW.step(dt);
    if (this.wobbleT >= 0) {
      this.wobbleT += dt;
      if (this.wobbleAmp * Math.exp(-WOBBLE.decay * this.wobbleT) < 0.003) this.wobbleT = -1;
    }
  }

  /** Per rendered frame, after the character animated this frame. */
  apply(c: Character): void {
    const look = this.lookUp.eased;
    const st = this.stretch.eased;
    const watch = this.watchW.eased;
    if (watch > 0) this.watchYaw = this.yawTo(c);
    const w = this.wobbleT >= 0 ? this.wobbleAmp * Math.exp(-WOBBLE.decay * this.wobbleT) : 0;
    for (let i = 0; i < BONES.length; i++) {
      const name = BONES[i]!;
      const bone = c.bones[name];
      if (!bone) continue;
      const b = this.base[i]!;
      const wr = this.written[i]!;
      // No character update since we wrote this bone: start again from the clean pose.
      if (bone.quaternion.equals(wr)) bone.quaternion.copy(b);
      else b.copy(bone.quaternion);
      this.tweak(name, bone.quaternion, look, st, watch, w);
      wr.copy(bone.quaternion);
    }
  }

  /** Puts every tweaked bone back to its clean pose and clears all weights. */
  reset(c: Character): void {
    for (let i = 0; i < BONES.length; i++) {
      const bone = c.bones[BONES[i]!];
      if (bone && bone.quaternion.equals(this.written[i]!)) bone.quaternion.copy(this.base[i]!);
      this.written[i]!.set(NaN, NaN, NaN, NaN);
    }
    this.lookUp.set(0, 0);
    this.stretch.set(0, 0);
    this.watchW.set(0, 0);
    this.wobbleT = -1;
  }

  private tweak(
    name: TweakBone,
    q: THREE.Quaternion,
    look: number,
    st: number,
    watch: number,
    w: number,
  ): void {
    switch (name) {
      case 'head':
        this.rot(q, Y, this.watchYaw * watch * (1 - st));
        this.rot(q, X, LOOK_UP.head * look + STRETCH.head * st);
        break;
      case 'neck':
        this.rot(q, X, LOOK_UP.neck * look + STRETCH.neck * st);
        break;
      case 'chest':
        this.rot(q, X, STRETCH.chest * st);
        break;
      case 'upperArmL':
        this.rot(q, Z, STRETCH.arm * st);
        break;
      case 'upperArmR':
        this.rot(q, Z, -STRETCH.arm * st);
        break;
      case 'lowerArmL':
      case 'lowerArmR':
        this.rot(q, X, -STRETCH.elbow * st);
        break;
      case 'sack':
        if (w !== 0) {
          this.rot(q, X, w * Math.sin(WOBBLE.freqX * this.wobbleT));
          this.rot(q, Z, 0.6 * w * Math.sin(WOBBLE.freqZ * this.wobbleT + 1));
        }
        break;
    }
  }

  private rot(q: THREE.Quaternion, axis: THREE.Vector3, angle: number): void {
    if (angle !== 0) q.multiply(this.q.setFromAxisAngle(axis, angle));
  }

  /** Head yaw (rad, clamped) from the character's facing to the watched point. */
  private yawTo(c: Character): number {
    this.fwd.set(0, 0, 1).applyQuaternion(c.root.quaternion);
    this.tmp.copy(this.watchAt).sub(c.root.position);
    const a = Math.atan2(this.tmp.x, this.tmp.z) - Math.atan2(this.fwd.x, this.fwd.z);
    const d = Math.atan2(Math.sin(a), Math.cos(a));
    return clamp(d, -WATCH_MAX, WATCH_MAX);
  }
}
