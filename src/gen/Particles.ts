/**
 * In-house instanced particles (GDD 2.12): dust, sparkles, smoke, embers, rain, Zzz, fire, light motes, bonk
 * stars and splashes.
 *
 * - ONE InstancedMesh of camera-facing quads = 1 draw call for every particle on screen. Billboarding happens
 *   in the vertex shader from per-instance attributes (position, rotation, size, shape, colour, alpha and
 *   velocity for streaks). Shapes (soft puff, star, sparkle, 'Z', streak) are drawn with math in the fragment
 *   shader: no textures.
 * - Alpha-blended and additive particles share that draw call through premultiplied alpha
 *   (ONE, ONE_MINUS_SRC_ALPHA): an additive particle writes its colour with alpha 0.
 * - Pool of `max` slots with a free-slot stack: emitting takes a free slot; only when none is free does it recycle
 *   the live particle closest to the end of its life. Live particles sit in a persistent draw list kept
 *   back-to-front by an insertion sort (nearly sorted frame to frame, so cheap).
 * - update() allocates nothing. Positions are world space: add `object` to the scene root.
 * Presets live in fx/particlePresets.ts, GLSL in fx/particleShaders.ts.
 */
import * as THREE from 'three';
import { PRESET_DEFS, PRESET_INDEX, SHAPE, type ParticlePreset } from './fx/particlePresets';
import { PARTICLE_FRAGMENT, PARTICLE_VERTEX } from './fx/particleShaders';
import { colorOf } from './geom';
import type { Palette } from './palette';
import { Rng } from './rng';

export type { ParticlePreset } from './fx/particlePresets';

export interface EmitOptions {
  dir?: THREE.Vector3;
  color?: string;
  spread?: number;
}

const TAU = Math.PI * 2;

const camPos = new THREE.Vector3();
const camFwd = new THREE.Vector3();
const tmpDir = new THREE.Vector3();

export class Particles {
  readonly object: THREE.InstancedMesh;
  readonly max: number;
  private readonly rng: Rng;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly attrs: THREE.InstancedBufferAttribute[];
  private readonly ranges: Array<{ start: number; count: number }>;
  // Instance attribute arrays (aOffset, aSize, aColor, aVel).
  private readonly iOff: Float32Array;
  private readonly iSize: Float32Array;
  private readonly iCol: Float32Array;
  private readonly iVel: Float32Array;
  // Pool (struct of arrays, indexed by slot).
  private readonly pos: Float32Array;
  private readonly vel: Float32Array; // orbiting stars: x angle, y angular speed, z radius
  private readonly col0: Float32Array;
  private readonly col1: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly size: Float32Array;
  private readonly rot: Float32Array;
  private readonly spin: Float32Array;
  private readonly seed: Float32Array;
  private readonly depth: Float32Array;
  private readonly kind: Uint8Array;
  private readonly inList: Uint8Array;
  private readonly order: Int32Array; // draw list, back to front
  private orderLen = 0;
  /** Free slots (a stack); a slot goes back when its particle dies or the pool is cleared. */
  private readonly free: Int32Array;
  private freeLen = 0;
  private disposed = false;
  /** Light level applied to `lit` presets (linear RGB, 0..1); white until setLight() is called. */
  private readonly tint = new THREE.Color(1, 1, 1);

  constructor(max: number, seed = 0x51a7e) {
    this.max = Math.max(1, Math.min(65535, Math.floor(max)));
    const n = this.max;
    this.rng = new Rng(seed);
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.col0 = new Float32Array(n * 3);
    this.col1 = new Float32Array(n * 3);
    this.age = new Float32Array(n);
    this.life = new Float32Array(n);
    this.size = new Float32Array(n);
    this.rot = new Float32Array(n);
    this.spin = new Float32Array(n);
    this.seed = new Float32Array(n);
    this.depth = new Float32Array(n);
    this.kind = new Uint8Array(n);
    this.inList = new Uint8Array(n);
    this.order = new Int32Array(n);
    this.free = new Int32Array(n);
    for (let i = 0; i < n; i++) this.free[i] = n - 1 - i; // slot 0 is taken first
    this.freeLen = n;

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3),
    );
    this.geometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.iOff = new Float32Array(n * 4);
    this.iSize = new Float32Array(n * 4);
    this.iCol = new Float32Array(n * 4);
    this.iVel = new Float32Array(n * 4);
    const arrays: Array<[string, Float32Array]> = [
      ['aOffset', this.iOff],
      ['aSize', this.iSize],
      ['aColor', this.iCol],
      ['aVel', this.iVel],
    ];
    this.attrs = arrays.map(([name, array]) => {
      const a = new THREE.InstancedBufferAttribute(array, 4);
      a.setUsage(THREE.DynamicDrawUsage);
      this.geometry.setAttribute(name, a);
      return a;
    });
    this.ranges = this.attrs.map(() => ({ start: 0, count: 0 }));

    this.material = new THREE.ShaderMaterial({
      name: 'particles',
      uniforms: THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      vertexShader: PARTICLE_VERTEX,
      fragmentShader: PARTICLE_FRAGMENT,
      transparent: true,
      depthWrite: false,
      fog: true,
      toneMapped: false,
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.object = new THREE.InstancedMesh(this.geometry, this.material, n);
    this.object.name = 'particles';
    this.object.count = 0;
    this.object.visible = false;
    this.object.frustumCulled = false; // world-space positions live in attributes
    this.object.renderOrder = 10; // after other transparent surfaces (water), which it sits on or in front of
  }

  /** Spawn a burst. `count` defaults per preset; `spread` is the spawn radius (orbit radius for 'stars',
   *  field radius for 'rain'); `dir` steers the velocity; `color` replaces the preset colours. */
  emit(preset: ParticlePreset, pos: THREE.Vector3, count?: number, opts?: EmitOptions): void {
    if (this.disposed) return;
    const k = PRESET_INDEX[preset];
    const d = PRESET_DEFS[k]!;
    const total = Math.max(0, Math.min(this.max, Math.floor(count ?? d.count)));
    const spread = opts?.spread ?? d.spread;
    const dir = tmpDir.fromArray(d.dir);
    if (opts?.dir && opts.dir.lengthSq() > 1e-8) dir.copy(opts.dir);
    dir.normalize();
    const fixed = opts?.color ? colorOf(opts.color) : null;
    const lr = d.lit ? this.tint.r : 1;
    const lg = d.lit ? this.tint.g : 1;
    const lb = d.lit ? this.tint.b : 1;
    const r = this.rng;
    for (let e = 0; e < total; e++) {
      const i = this.freeLen > 0 ? this.free[--this.freeLen]! : this.mostSpent();
      if (!this.inList[i]) {
        this.inList[i] = 1;
        this.order[this.orderLen++] = i;
      }
      const i3 = i * 3;
      this.kind[i] = k;
      this.age[i] = 0;
      this.life[i] = r.range(d.life[0], d.life[1]);
      this.size[i] = r.range(d.size[0], d.size[1]);
      this.seed[i] = r.next();
      this.rot[i] = d.spin > 0 ? r.range(0, TAU) : r.range(-0.25, 0.25);
      this.spin[i] = d.spin * r.range(0.5, 1) * r.sign();
      const c = fixed ?? colorOf(r.pick(d.colors));
      const j = r.range(0.93, 1.07);
      this.col0[i3] = c.r * j * lr;
      this.col0[i3 + 1] = c.g * j * lg;
      this.col0[i3 + 2] = c.b * j * lb;
      const end = !fixed && d.end ? colorOf(d.end) : null;
      this.col1[i3] = end ? end.r * lr : this.col0[i3]!;
      this.col1[i3 + 1] = end ? end.g * lg : this.col0[i3 + 1]!;
      this.col1[i3 + 2] = end ? end.b * lb : this.col0[i3 + 2]!;
      if (d.orbit) {
        this.pos[i3] = pos.x;
        this.pos[i3 + 1] = pos.y;
        this.pos[i3 + 2] = pos.z;
        this.vel[i3] = (e / Math.max(1, total)) * TAU + r.range(-0.2, 0.2);
        this.vel[i3 + 1] = r.range(d.speed[0], d.speed[1]);
        this.vel[i3 + 2] = spread * r.range(0.85, 1.1);
        continue;
      }
      const a = r.range(0, TAU);
      const rad = Math.sqrt(r.next()) * spread;
      this.pos[i3] = pos.x + Math.cos(a) * rad;
      this.pos[i3 + 1] = pos.y + d.lift + r.range(-1, 1) * d.ySpread;
      this.pos[i3 + 2] = pos.z + Math.sin(a) * rad;
      // Direction: blend the main direction with a random unit vector by `cone`.
      const z = r.range(-1, 1);
      const t = r.range(0, TAU);
      const s = Math.sqrt(1 - z * z);
      let vx = dir.x * (1 - d.cone) + s * Math.cos(t) * d.cone;
      let vy = dir.y * (1 - d.cone) + z * d.cone;
      let vz = dir.z * (1 - d.cone) + s * Math.sin(t) * d.cone;
      const len = Math.hypot(vx, vy, vz) || 1;
      const speed = r.range(d.speed[0], d.speed[1]) / len;
      vx *= speed;
      vy *= speed * (1 - d.flat);
      vz *= speed;
      this.vel[i3] = vx;
      this.vel[i3 + 1] = vy + d.up;
      this.vel[i3 + 2] = vz;
    }
  }

  /** Full pool: the live particle furthest through its life (only scanned when no slot is free). */
  private mostSpent(): number {
    let best = this.order[0] ?? 0;
    let most = -1;
    for (let k = 0; k < this.orderLen; k++) {
      const i = this.order[k]!;
      const spent = this.age[i]! / Math.max(1e-6, this.life[i]!);
      if (spent > most) {
        most = spent;
        best = i;
      }
    }
    return best;
  }

  /** Integrate, fade, sort back to front and write the instance attributes. Call once per rendered frame. */
  update(dt: number, camera: THREE.Camera): void {
    if (this.disposed) return;
    const step = Math.min(Math.max(dt, 0), 0.1);
    camera.getWorldPosition(camPos);
    camera.getWorldDirection(camFwd);
    const { pos, vel, order, depth } = this;
    let n = 0;
    for (let k = 0; k < this.orderLen; k++) {
      const i = order[k]!;
      const age = this.age[i]! + step;
      if (age >= this.life[i]!) {
        this.inList[i] = 0;
        this.life[i] = 0;
        this.free[this.freeLen++] = i;
        continue;
      }
      this.age[i] = age;
      const d = PRESET_DEFS[this.kind[i]!]!;
      const i3 = i * 3;
      if (!d.orbit) {
        const damp = 1 / (1 + d.drag * step);
        const sw = this.seed[i]! * TAU;
        vel[i3] = (vel[i3]! + Math.cos(age * 2.3 + sw) * d.wobble * step) * damp;
        vel[i3 + 1] = (vel[i3 + 1]! - d.gravity * step) * damp;
        vel[i3 + 2] = (vel[i3 + 2]! + Math.sin(age * 1.9 + sw) * d.wobble * step) * damp;
        pos[i3] = pos[i3]! + vel[i3]! * step;
        pos[i3 + 1] = pos[i3 + 1]! + vel[i3 + 1]! * step;
        pos[i3 + 2] = pos[i3 + 2]! + vel[i3 + 2]! * step;
      }
      depth[i] =
        (pos[i3]! - camPos.x) * camFwd.x +
        (pos[i3 + 1]! - camPos.y) * camFwd.y +
        (pos[i3 + 2]! - camPos.z) * camFwd.z;
      order[n++] = i;
    }
    this.orderLen = n;
    // Insertion sort, far to near. The list is nearly sorted from the last frame, so this is close to O(n).
    for (let a = 1; a < n; a++) {
      const i = order[a]!;
      const di = depth[i]!;
      let b = a - 1;
      while (b >= 0 && depth[order[b]!]! < di) {
        order[b + 1] = order[b]!;
        b--;
      }
      order[b + 1] = i;
    }
    for (let k = 0; k < n; k++) this.write(k, order[k]!);
    this.object.count = n;
    this.object.visible = n > 0;
    if (n === 0) return;
    for (let a = 0; a < this.attrs.length; a++) {
      const attr = this.attrs[a]!;
      const range = this.ranges[a]!;
      range.count = n * 4;
      attr.updateRanges.length = 0; // reuse one range object: no garbage
      attr.updateRanges.push(range);
      attr.needsUpdate = true;
    }
  }

  /** Write slot `i` into instance `k`. */
  private write(k: number, i: number): void {
    const d = PRESET_DEFS[this.kind[i]!]!;
    const i3 = i * 3;
    const k4 = k * 4;
    const age = this.age[i]!;
    const t = age / this.life[i]!;
    const seed = this.seed[i]!;
    const o = this.iOff;
    const s = this.iSize;
    const c = this.iCol;
    const v = this.iVel;
    let rot = this.rot[i]! + this.spin[i]! * age;
    if (d.shape === SHAPE.zed) rot += Math.sin(age * 2.5 + seed * TAU) * 0.2; // lazy rocking Z
    if (d.orbit) {
      const ang = this.vel[i3]! + this.vel[i3 + 1]! * age;
      const rad = this.vel[i3 + 2]!;
      o[k4] = this.pos[i3]! + Math.cos(ang) * rad;
      o[k4 + 1] = this.pos[i3 + 1]! + Math.sin(ang * 2 + seed * TAU) * 0.06;
      o[k4 + 2] = this.pos[i3 + 2]! + Math.sin(ang) * rad;
      v[k4] = v[k4 + 1] = v[k4 + 2] = v[k4 + 3] = 0;
    } else {
      o[k4] = this.pos[i3]!;
      o[k4 + 1] = this.pos[i3 + 1]!;
      o[k4 + 2] = this.pos[i3 + 2]!;
      v[k4] = this.vel[i3]!;
      v[k4 + 1] = this.vel[i3 + 1]!;
      v[k4 + 2] = this.vel[i3 + 2]!;
      v[k4 + 3] = d.stretch;
    }
    o[k4 + 3] = rot;
    const ease = 1 - (1 - t) * (1 - t);
    const w = this.size[i]! * (1 + (d.grow - 1) * ease);
    s[k4] = w;
    s[k4 + 1] = w * d.aspect;
    s[k4 + 2] = d.shape;
    s[k4 + 3] = d.add;
    let alpha = d.alpha * (d.fadeIn > 0 ? Math.min(1, t / d.fadeIn) : 1);
    const out = Math.min(1, Math.max(0, (t - 0.6) / 0.4));
    alpha *= 1 - out * out * (3 - 2 * out);
    if (d.twinkle > 0) alpha *= 1 - d.twinkle * 0.8 * (0.5 + 0.5 * Math.sin(age * 14 + seed * TAU));
    c[k4] = this.col0[i3]! + (this.col1[i3]! - this.col0[i3]!) * t;
    c[k4 + 1] = this.col0[i3 + 1]! + (this.col1[i3 + 1]! - this.col0[i3 + 1]!) * t;
    c[k4 + 2] = this.col0[i3 + 2]! + (this.col1[i3 + 2]! - this.col0[i3 + 2]!) * t;
    c[k4 + 3] = alpha;
  }

  /**
   * Match the chapter light: dust, smoke, rain and splashes are unlit quads, so without this they would glow in
   * a dark valley. Glows (sparkle, fire, embers, motes) and signals (Zzz, bonk stars) stay full brightness.
   * Applies to particles emitted afterwards.
   */
  setLight(pal: Palette): void {
    const l = pal.light;
    const sky = colorOf(l.hemiSky);
    const sun = colorOf(l.sun);
    const k = 1.5 / Math.PI; // ~1 under a normal daylight palette
    const f = (a: number, b: number): number =>
      Math.min(1, Math.max(0.08, (a * l.hemiIntensity + b * l.sunIntensity * 0.6) * k));
    this.tint.setRGB(f(sky.r, sun.r), f(sky.g, sun.g), f(sky.b, sun.b));
  }

  /** Remove every live particle (chapter reset, cutscene cut). */
  clear(): void {
    for (let k = 0; k < this.orderLen; k++) {
      const i = this.order[k]!;
      this.inList[i] = 0;
      this.life[i] = 0;
      this.free[this.freeLen++] = i;
    }
    this.orderLen = 0;
    this.object.count = 0;
    this.object.visible = false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.object.removeFromParent();
    this.object.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** Continuous emission (a chimney, a campfire, a rain field around the camera): `rate` particles per second
 *  with the fractional remainder carried between frames. */
export class ParticleEmitter {
  private carry = 0;

  constructor(
    private readonly particles: Particles,
    public preset: ParticlePreset,
    public rate: number,
    public opts?: EmitOptions,
  ) {}

  update(dt: number, pos: THREE.Vector3): void {
    this.carry += Math.max(0, this.rate) * Math.min(Math.max(dt, 0), 0.25);
    const n = Math.floor(this.carry);
    if (n <= 0) return;
    this.carry -= n;
    this.particles.emit(this.preset, pos, n, this.opts);
  }
}
