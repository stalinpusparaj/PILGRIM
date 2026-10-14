/**
 * The Burden's last trip (GDD 2.7.1): it falls off Christian's back, bounces, tumbles down the hill along the planned
 * path (rolling with its travel, speeding up downhill), bounces a second time, rolls into the open tomb and drops
 * in. Exactly two bounces: the first when it hits the ground, the second part way down ('arc' paths: the two big
 * hops). Fixed-step simulation with interpolated rendering; allocation-free after construction.
 *
 * The centre rides at the height of the lumpy ellipsoid's support along "up" for its current orientation, so the
 * sack bobs as it tumbles and never sinks into the ground.
 */
import * as THREE from 'three';
import type { SackBody } from './cross-sack';
import type { SackPath, TombInfo } from './cross-path';
import { clamp, easeOutCubic, hdist } from './cross-types';

export interface SackFx {
  /** n = 0 (hits the ground), 1 (part way down): 'sack_roll' + dust. */
  bounce(n: number, ground: THREE.Vector3): void;
  /** Soft touch-down after a bounce: a little dust. */
  land(ground: THREE.Vector3): void;
  /** Now and then while rolling: a wisp of dust. */
  rolling(ground: THREE.Vector3): void;
  /** In the tomb: the echoing "thoom" and a dust puff at the mouth. */
  thoom(mouth: THREE.Vector3): void;
}

export type RollPhase = 'fall' | 'path' | 'enter' | 'sink' | 'done';

/** Sack gravity (m/s²): a touch floaty, for the cartoon. */
const G = 18;
const FALL_UP = 0.8;
const FALL_TUMBLE = 4.5;
const BOUNCE_V: readonly [number, number] = [3.0, 2.5];
/** Rolling: slope pull, drag, speed limits (min also keeps the trip under ~`trip` seconds), dust spacing. */
const ROLL = { g: 6.5, drag: 0.15, min: 2.6, max: 8, trip: 3.2, dustEvery: 0.22 } as const;
const SOFT = 0.93;
const SINK = { seconds: 0.55, thoomAt: 0.3, inward: 0.38, shrink: 0.15 } as const;
const UP = new THREE.Vector3(0, 1, 0);

export class SackRoll {
  readonly pos = new THREE.Vector3();
  /** Horizontal direction of travel. */
  readonly travel = new THREE.Vector3(0, 0, 1);
  private phaseNow: RollPhase = 'fall';
  private readonly quat = new THREE.Quaternion();
  private readonly prevPos = new THREE.Vector3();
  private readonly prevQuat = new THREE.Quaternion();
  private scaleK = 1;
  private prevScaleK = 1;
  private readonly baseScale = new THREE.Vector3();
  private t = 0;
  // fall
  private fallDur = 0.3;
  private readonly fallFrom = new THREE.Vector3();
  private readonly fallTo = new THREE.Vector3();
  private fallVy: number = FALL_UP;
  // path
  private s = 0;
  private v: number = ROLL.min;
  private readonly vMin: number;
  private hopY = 0;
  private hopV = 0;
  private bounces = 0;
  private readonly bounce2At: number;
  private dustIn = 0;
  // arc hops
  private hop = 0;
  private readonly hopS: [number, number, number];
  private readonly hopH: [number, number] = [0, 0];
  private readonly hopD: [number, number] = [1, 1];
  // enter + sink
  private readonly enterFrom = new THREE.Vector3();
  private enterDur = 0.6;
  private thoomed = false;
  // scratch
  private readonly g = new THREE.Vector3();
  private readonly axis = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly qi = new THREE.Quaternion();
  private readonly u = new THREE.Vector3();

  constructor(
    private readonly body: SackBody,
    private readonly path: SackPath,
    private readonly tomb: TombInfo,
    private readonly fx: SackFx,
  ) {
    const m = body.mesh;
    this.pos.copy(m.position);
    this.quat.copy(m.quaternion);
    this.prevPos.copy(this.pos);
    this.prevQuat.copy(this.quat);
    this.baseScale.copy(m.scale);
    const L = path.length;
    this.vMin = clamp(L / ROLL.trip, ROLL.min, ROLL.max - 1);
    this.bounce2At = L > 4 ? clamp(L * 0.55, 1.6, L - 2) : L * 0.5;
    this.hopS = [0, L * 0.45, L];
    if (path.mode === 'arc') this.planHops();
    this.startFall();
  }

  get phase(): RollPhase {
    return this.phaseNow;
  }

  get done(): boolean {
    return this.phaseNow === 'done';
  }

  /** 0 at the fall, 1 at the end of the path (and in the tomb). */
  get progress(): number {
    if (this.phaseNow === 'fall') return 0;
    if (this.phaseNow !== 'path') return 1;
    return this.path.length > 0 ? clamp(this.s / this.path.length, 0, 1) : 1;
  }

  step(dt: number): void {
    this.prevPos.copy(this.pos);
    this.prevQuat.copy(this.quat);
    this.prevScaleK = this.scaleK;
    if (this.phaseNow === 'done') return;
    this.t += dt;
    switch (this.phaseNow) {
      case 'fall':
        this.stepFall(dt);
        break;
      case 'path':
        if (this.path.mode === 'arc') this.stepArc(dt);
        else this.stepRoll(dt);
        break;
      case 'enter':
        this.stepEnter(dt);
        break;
      case 'sink':
        this.stepSink();
        break;
    }
  }

  /** Per rendered frame. */
  render(alpha: number): void {
    const m = this.body.mesh;
    m.position.lerpVectors(this.prevPos, this.pos, alpha);
    m.quaternion.slerpQuaternions(this.prevQuat, this.quat, alpha);
    m.scale.copy(this.baseScale).multiplyScalar(this.prevScaleK + (this.scaleK - this.prevScaleK) * alpha);
    m.visible = this.phaseNow !== 'done';
  }

  // ------------------------------------------------------------------------------------------- phases

  private startFall(): void {
    this.path.sample(0, this.fallTo);
    this.path.tangent(0, this.travel);
    this.fallFrom.copy(this.pos);
    const land = this.fallTo.y + this.support() * SOFT;
    const drop = Math.max(0, this.pos.y - land);
    this.fallDur = clamp((FALL_UP + Math.sqrt(FALL_UP * FALL_UP + 2 * G * drop)) / G, 0.22, 0.8);
    this.fallVy = FALL_UP;
    this.t = 0;
  }

  private stepFall(dt: number): void {
    const k = clamp(this.t / this.fallDur, 0, 1);
    this.pos.x = this.fallFrom.x + (this.fallTo.x - this.fallFrom.x) * k;
    this.pos.z = this.fallFrom.z + (this.fallTo.z - this.fallFrom.z) * k;
    this.fallVy -= G * dt;
    this.pos.y += this.fallVy * dt;
    this.spin(FALL_TUMBLE * dt);
    const rest = this.groundY(this.pos.x, this.pos.z) + this.support() * SOFT;
    if (k >= 1 || (this.fallVy < 0 && this.pos.y <= rest)) {
      // First bounce: it hits the ground and springs up again.
      this.hopY = Math.max(0, this.pos.y - rest);
      this.pos.y = Math.max(this.pos.y, rest);
      this.v = Math.max(
        this.vMin,
        hdist(this.fallFrom.x, this.fallFrom.z, this.fallTo.x, this.fallTo.z) / this.fallDur,
      );
      this.bounces = 1;
      this.fx.bounce(0, this.groundPoint(0));
      this.hopV = BOUNCE_V[0];
      this.s = 0;
      this.t = 0;
      this.hop = 0;
      this.phaseNow = 'path';
    }
  }

  private stepRoll(dt: number): void {
    const p = this.path;
    const slope = (p.groundAt(this.s + 0.3) - p.groundAt(this.s - 0.3)) / 0.6;
    this.v = clamp(this.v + (-ROLL.g * slope - ROLL.drag * this.v) * dt, this.vMin, ROLL.max);
    const airborne = this.hopY > 0 || this.hopV > 0;
    if (airborne) {
      this.hopV -= G * dt;
      this.hopY += this.hopV * dt;
      if (this.hopY <= 0) {
        this.hopY = 0;
        this.hopV = 0;
        this.fx.land(this.groundPoint(this.s));
      }
    } else if (this.bounces < 2 && this.s >= this.bounce2At) {
      this.bounces = 2;
      this.hopV = BOUNCE_V[1];
      this.fx.bounce(1, this.groundPoint(this.s));
    } else {
      this.dustIn -= dt;
      if (this.dustIn <= 0) {
        this.dustIn = ROLL.dustEvery;
        this.fx.rolling(this.groundPoint(this.s));
      }
    }
    const ds = this.v * dt;
    this.s = Math.min(p.length, this.s + ds);
    p.tangent(this.s, this.travel);
    this.roll(ds);
    p.sample(this.s, this.g);
    this.pos.set(this.g.x, this.g.y + this.support() * SOFT + this.hopY, this.g.z);
    // Exactly two bounces, even on a very short path: the second one happens before it goes in.
    if (this.s >= p.length && this.hopY <= 0 && this.hopV <= 0 && this.bounces >= 2) this.startEnter();
  }

  private stepArc(dt: number): void {
    const k = this.hop as 0 | 1;
    const s0 = this.hopS[k];
    const s1 = this.hopS[k + 1]!;
    const u = clamp(this.t / this.hopD[k], 0, 1);
    const prevS = this.s;
    this.s = s0 + (s1 - s0) * u;
    const p = this.path;
    p.tangent(this.s, this.travel);
    const base = p.groundAt(s0) + (p.groundAt(s1) - p.groundAt(s0)) * u;
    // Lift off from the bounce height, land on the ground: blend the support in with the arc.
    p.sample(this.s, this.g);
    this.pos.set(this.g.x, base + this.support() * SOFT + 4 * this.hopH[k] * u * (1 - u), this.g.z);
    this.roll((this.s - prevS) * 1.4);
    if (u < 1) return;
    this.t = 0;
    if (k === 0) {
      this.hop = 1;
      this.bounces = 2;
      this.fx.bounce(1, this.groundPoint(this.s));
    } else {
      this.fx.land(this.groundPoint(this.s));
      this.startEnter();
    }
  }

  private startEnter(): void {
    this.enterFrom.copy(this.pos);
    const d = hdist(this.pos.x, this.pos.z, this.tomb.mouth.x, this.tomb.mouth.z);
    this.enterDur = clamp(d / Math.max(1.4, this.v * 0.8), 0.45, 1.3);
    this.travel.copy(this.tomb.inward);
    this.t = 0;
    this.phaseNow = 'enter';
  }

  private stepEnter(_dt: number): void {
    const m = this.tomb.mouth;
    const k = easeOutCubic(this.t / this.enterDur);
    const x = this.enterFrom.x + (m.x - this.enterFrom.x) * k;
    const z = this.enterFrom.z + (m.z - this.enterFrom.z) * k;
    this.roll(hdist(this.pos.x, this.pos.z, x, z));
    this.pos.set(x, this.groundY(x, z) + this.support() * SOFT, z);
    if (this.t >= this.enterDur) {
      this.enterFrom.copy(this.pos);
      this.t = 0;
      this.phaseNow = 'sink';
    }
  }

  /** Drops through the dark opening (or into the ground at a bare point) and is gone. */
  private stepSink(): void {
    const k = clamp(this.t / SINK.seconds, 0, 1);
    const e = k * k;
    const deep = 2.2 * Math.max(this.body.semi.x, this.body.semi.y, this.body.semi.z);
    const inward = this.tomb.opening ? SINK.inward : 0;
    this.pos.set(
      this.enterFrom.x + this.tomb.inward.x * inward * k,
      this.enterFrom.y - deep * e,
      this.enterFrom.z + this.tomb.inward.z * inward * k,
    );
    this.scaleK = 1 - SINK.shrink * k;
    this.roll(0.02);
    if (!this.thoomed && k >= SINK.thoomAt) {
      this.thoomed = true;
      this.g.copy(this.tomb.mouth);
      this.fx.thoom(this.g);
    }
    if (k >= 1) this.phaseNow = 'done';
  }

  // ------------------------------------------------------------------------------------------ helpers

  /** Two big eased hops ('arc'): apexes clear the terrain and every collider under them. */
  private planHops(): void {
    const p = this.path;
    const r = this.body.radius;
    for (let k = 0; k < 2; k++) {
      const s0 = this.hopS[k]!;
      const s1 = this.hopS[k + 1]!;
      const len = s1 - s0;
      const g0 = p.groundAt(s0);
      const g1 = p.groundAt(s1);
      let h = 0.55 + 0.06 * len;
      for (let i = 1; i < 16; i++) {
        const u = i / 16;
        const need = p.topAt(s0 + len * u) + r + 0.3 - (g0 + (g1 - g0) * u + r);
        h = Math.max(h, need / Math.max(0.3, 4 * u * (1 - u)));
      }
      this.hopH[k] = Math.min(30, h);
      this.hopD[k] = clamp(0.45 + 0.28 * Math.sqrt(this.hopH[k]) + 0.035 * len, 0.55, 2.6);
    }
  }

  /** Rolls by `dist` metres along the travel direction (about up × travel). */
  private roll(dist: number): void {
    if (dist === 0) return;
    this.spin(dist / Math.max(0.15, this.body.radius));
  }

  private spin(angle: number): void {
    this.axis.crossVectors(UP, this.travel);
    if (this.axis.lengthSq() < 1e-8) this.axis.set(1, 0, 0);
    this.axis.normalize();
    this.q.setFromAxisAngle(this.axis, angle);
    this.quat.premultiply(this.q).normalize();
  }

  /** Height of the sack's lowest point below its centre for the current orientation (ellipsoid support). */
  private support(): number {
    this.qi.copy(this.quat).invert();
    const u = this.u.copy(UP).applyQuaternion(this.qi);
    const s = this.body.semi;
    return Math.sqrt((s.x * u.x) ** 2 + (s.y * u.y) ** 2 + (s.z * u.z) ** 2);
  }

  private groundY(x: number, z: number): number {
    return this.path.groundAtXZ(x, z);
  }

  private groundPoint(s: number): THREE.Vector3 {
    this.path.sample(s, this.g);
    return this.g;
  }
}
