/**
 * Secondary motion for a character (GDD 2.12 "secondary bounce on hats, hair and the Burden"): damped springs on
 * the sack and hat bones driven by the root's acceleration and the walk bob (hips height), plus the Burden size
 * spring that gives the sack its cartoon "boing" when it grows. Allocation-free per frame.
 */
import * as THREE from 'three';

interface Spring {
  x: number;
  v: number;
}
export interface MotionBones {
  hips: THREE.Bone;
  sack: THREE.Bone;
  hat: THREE.Bone;
  ropes: THREE.Bone;
}

const MAX_STEP = 1 / 60;
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

function step(s: Spring, k: number, c: number, force: number, dt: number, min: number, max: number): void {
  s.v += (-k * s.x - c * s.v + force) * dt;
  s.x += s.v * dt;
  if (s.x < min) {
    s.x = min;
    s.v = Math.max(0, s.v);
  }
  if (s.x > max) {
    s.x = max;
    s.v = Math.min(0, s.v);
  }
}

export class SecondaryMotion {
  /** Target sack scale (setBurdenSize). */
  burdenTarget: number;
  private burden: Spring;
  private readonly sackPitch: Spring = { x: 0, v: 0 };
  private readonly sackRoll: Spring = { x: 0, v: 0 };
  private readonly hatPitch: Spring = { x: 0, v: 0 };
  private readonly hatRoll: Spring = { x: 0, v: 0 };
  private readonly hatSquash: Spring = { x: 0, v: 0 };
  private readonly prevPos = new THREE.Vector3();
  private readonly prevVel = new THREE.Vector3();
  private readonly acc = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private prevHipY = 0;
  private prevHipV = 0;
  private hipAcc = 0;
  private primed = false;
  private readonly slow: number;
  private readonly root: THREE.Object3D;
  private readonly bones: MotionBones;

  constructor(root: THREE.Object3D, bones: MotionBones, scale: number, burden: number) {
    this.root = root;
    this.bones = bones;
    this.slow = 1 / Math.sqrt(Math.max(0.3, scale)); // bigger characters swing slower
    this.burdenTarget = burden;
    this.burden = { x: burden, v: 0 };
    this.applyBurden();
  }

  get burdenSize(): number {
    return Math.max(0, this.burden.x);
  }

  update(dt: number): void {
    if (dt <= 0) return;
    this.sampleMotion(dt);
    let left = Math.min(dt, 0.25);
    while (left > 1e-6) {
      const h = Math.min(MAX_STEP, left);
      left -= h;
      this.integrate(h);
    }
    this.apply();
  }

  /** Root acceleration in the character's frame (forward / left) and the hips' vertical acceleration. */
  private sampleMotion(dt: number): void {
    const p = this.root.position;
    const hipY = this.bones.hips.position.y;
    if (!this.primed) {
      this.prevPos.copy(p);
      this.prevVel.set(0, 0, 0);
      this.prevHipY = hipY;
      this.prevHipV = 0;
      this.primed = true;
      return;
    }
    const vel = this.tmp.copy(p).sub(this.prevPos).divideScalar(dt);
    const k = 1 - Math.exp(-dt / 0.05);
    this.acc.lerp(this.fwd.copy(vel).sub(this.prevVel).divideScalar(dt), k);
    if (this.acc.lengthSq() > 900) this.acc.setLength(30);
    this.prevVel.copy(vel);
    this.prevPos.copy(p);
    const hv = (hipY - this.prevHipY) / dt;
    const ha = Math.max(-40, Math.min(40, (hv - this.prevHipV) / dt));
    this.hipAcc += (ha - this.hipAcc) * (1 - Math.exp(-dt / 0.03));
    this.prevHipY = hipY;
    this.prevHipV = hv;
  }

  private integrate(h: number): void {
    const fwd = this.fwd.copy(Z_AXIS).applyQuaternion(this.root.quaternion);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, 1);
    fwd.normalize();
    const aF = this.acc.x * fwd.x + this.acc.z * fwd.z;
    const aL = this.acc.x * fwd.z - this.acc.z * fwd.x; // along the character's left (+X when facing +Z)
    const w = this.slow;
    // Sack: hangs behind its pivot, so it lags back when speeding up and drops when the body rises.
    const ks = 89 * w * w;
    const cs = 4.2 * w;
    step(this.sackPitch, ks, cs, 3 * aF - 1.2 * this.hipAcc, h, -0.4, 0.55);
    step(this.sackRoll, ks, cs, -2.4 * aL, h, -0.35, 0.35);
    // Hat / bun / plume: sits above its pivot, so it tips back when speeding up; squashes on the bob.
    const kh = 267 * w * w;
    const ch = 5.9 * w;
    step(this.hatPitch, kh, ch, -2 * aF + 0.35 * this.hipAcc, h, -0.25, 0.25);
    step(this.hatRoll, kh, ch, 1.6 * aL, h, -0.25, 0.25);
    step(this.hatSquash, 400 * w * w, 10 * w, -1.5 * this.hipAcc, h, -0.14, 0.14);
    // Burden size: under-damped so growing goes "boing".
    this.burden.v += (-160 * (this.burden.x - this.burdenTarget) - 9 * this.burden.v) * h;
    this.burden.x += this.burden.v * h;
    if (this.burden.x < 0) {
      this.burden.x = 0;
      this.burden.v = Math.max(0, this.burden.v);
    }
  }

  private apply(): void {
    const { sack, hat } = this.bones;
    sack.quaternion.multiply(this.q.setFromAxisAngle(X_AXIS, this.sackPitch.x));
    sack.quaternion.multiply(this.q.setFromAxisAngle(Z_AXIS, this.sackRoll.x));
    hat.quaternion.multiply(this.q.setFromAxisAngle(X_AXIS, this.hatPitch.x));
    hat.quaternion.multiply(this.q.setFromAxisAngle(Z_AXIS, this.hatRoll.x));
    const sq = this.hatSquash.x;
    hat.scale.set(1 - sq * 0.5, 1 + sq, 1 - sq * 0.5);
    this.applyBurden();
  }

  private applyBurden(): void {
    const s = Math.max(0, this.burden.x);
    this.bones.sack.scale.setScalar(s < 0.002 ? 0 : s);
    this.bones.ropes.scale.setScalar(Math.min(1, s / 0.3));
  }
}
