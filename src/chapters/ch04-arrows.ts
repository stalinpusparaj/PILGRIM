/**
 * The dark arrows of Chapter IV (GDD 2.10 Ch IV: "arrows come in volleys with a whistle and a red line on the
 * ground 1 s before landing"). Rendering and flight only; who is aimed at and when is ch04-volleys.ts.
 *
 * - One InstancedMesh of the 'arrow' prop (src/gen/props/built-chapter.ts, built once; shared 'lambert' material)
 *   and one InstancedMesh of a red target mark (a ring with four spokes: colour AND shape, GDD 2.15 "colour is
 *   never the only signal") on the shared 'decal' material.
 * - `fire(targets, origin, flight)`: every target gets its mark at once (it closes in over the flight) and an arrow
 *   that flies a parabola from `origin` and lands after `flight` seconds with 'arrow_thunk', a dust puff and the
 *   `onLand` callback. Landed arrows stay stuck for ~4 s, then sink away and free their slot.
 * - Allocation-free per step: slots are reused, matrices are composed into scratch objects.
 */
import * as THREE from 'three';
import '../audio/events';
import { events } from '../core/Events';
import { mat } from '../gen/materials';
import { buildProp } from '../gen/props/index';
import { Rng } from '../gen/rng';
import type { PlaySession } from '../world/PlaySession';

export const ARROW = {
  /** Slots (arrows in flight or stuck at once). Two volleys of 7 can overlap, plus the gate volley. */
  capacity: 24,
  /** Extra height of the flight arc above the straight line (m). */
  arc: 6,
  /** Seconds an arrow stays stuck in the ground, then sinks away over `fade` s. */
  stuck: 4,
  fade: 0.6,
  /** How deep the tip goes into the ground (m). */
  bite: 0.12,
  /** The target mark: inner / outer ring radius, spoke length (m); scale it starts at before closing to 1. */
  mark: { inner: 0.5, outer: 0.68, spoke: 0.42, open: 1.8, lift: 0.04, color: '#E0352B' },
  dust: 5,
} as const;

type Phase = 'fly' | 'stuck' | 'fade';

interface Slot {
  active: boolean;
  phase: Phase;
  t: number;
  flight: number;
  readonly origin: THREE.Vector3;
  readonly target: THREE.Vector3;
}

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, 1);
const pos = new THREE.Vector3();
const dir = new THREE.Vector3();
const quat = new THREE.Quaternion();
const scale = new THREE.Vector3();
const m4 = new THREE.Matrix4();
const IDENTITY = new THREE.Quaternion();

/** A flat ring with four spokes on y = 0 (faces up, like BlobShadows' disc), RGBA vertex colours for 'decal'. */
function targetMarkGeometry(): THREE.BufferGeometry {
  const { inner, outer, spoke } = ARROW.mark;
  const c = new THREE.Color(ARROW.mark.color);
  const positions: number[] = [];
  const colors: number[] = [];
  // (x, y) on the plane → (x, 0, -y): counter-clockwise seen from above, so the faces point up.
  const push = (x: number, y: number): void => {
    positions.push(x, 0, -y);
    colors.push(c.r, c.g, c.b, 0.95);
  };
  const quad = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number) => {
    // a → d → c and a → c → b: counter-clockwise on the plane (the quads are given tangent-first).
    push(ax, ay);
    push(dx, dy);
    push(cx, cy);
    push(ax, ay);
    push(cx, cy);
    push(bx, by);
  };
  const segs = 24;
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2;
    const a1 = ((i + 1) / segs) * Math.PI * 2;
    quad(
      Math.cos(a0) * inner,
      Math.sin(a0) * inner,
      Math.cos(a1) * inner,
      Math.sin(a1) * inner,
      Math.cos(a1) * outer,
      Math.sin(a1) * outer,
      Math.cos(a0) * outer,
      Math.sin(a0) * outer,
    );
  }
  const w = 0.07;
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const vx = -uy * w;
    const vy = ux * w;
    const r0 = outer + 0.1;
    const r1 = r0 + spoke;
    quad(ux * r0 + vx, uy * r0 + vy, ux * r1 + vx, uy * r1 + vy, ux * r1 - vx, uy * r1 - vy, ux * r0 - vx, uy * r0 - vy);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < normals.length; i += 3) normals[i + 1] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  return g;
}

export class ArrowVolleys {
  readonly arrows: THREE.InstancedMesh;
  readonly marks: THREE.InstancedMesh;
  /** Called the step an arrow lands, with its landing point (ground). */
  onLand: ((at: THREE.Vector3) => void) | null = null;
  /** Arrows launched so far (tests, debug). */
  fired = 0;
  private readonly slots: Slot[] = [];
  private readonly arrowGeometry: THREE.BufferGeometry;
  private readonly markGeometry: THREE.BufferGeometry;
  private readonly halfLength: number;
  private disposed = false;

  constructor(private readonly session: PlaySession) {
    const world = session.world;
    const built = buildProp('arrow', new Rng(world.level.seed ^ 0x4a44), world.palette);
    this.arrowGeometry = built.geometry;
    built.glow?.dispose();
    this.arrowGeometry.computeBoundingBox();
    this.halfLength = this.arrowGeometry.boundingBox?.max.z ?? 0.45;
    this.arrows = new THREE.InstancedMesh(this.arrowGeometry, mat('lambert'), ARROW.capacity);
    this.arrows.name = 'ch04:arrows';
    this.arrows.castShadow = true;
    this.arrows.frustumCulled = false;
    this.arrows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.markGeometry = targetMarkGeometry();
    this.marks = new THREE.InstancedMesh(this.markGeometry, mat('decal'), ARROW.capacity);
    this.marks.name = 'ch04:arrow-marks';
    this.marks.frustumCulled = false;
    this.marks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < ARROW.capacity; i++) {
      this.slots.push({ active: false, phase: 'fly', t: 0, flight: 1, origin: new THREE.Vector3(), target: new THREE.Vector3() });
      this.arrows.setMatrixAt(i, ZERO);
      this.marks.setMatrixAt(i, ZERO);
    }
    this.arrows.instanceMatrix.needsUpdate = true;
    this.marks.instanceMatrix.needsUpdate = true;
    world.scene.add(this.arrows, this.marks);
  }

  /** Arrows still in the air. */
  get flying(): number {
    let n = 0;
    for (const s of this.slots) if (s.active && s.phase === 'fly') n++;
    return n;
  }

  /** Arrows in the air or stuck in the ground. */
  get live(): number {
    let n = 0;
    for (const s of this.slots) if (s.active) n++;
    return n;
  }

  /**
   * Launches one arrow per target (ground points) from `origin`, all landing after `flight` seconds, with the
   * warning marks on the ground from now and one whistle. Returns how many flew (free slots permitting).
   */
  fire(targets: readonly THREE.Vector3[], origin: THREE.Vector3, flight: number): number {
    if (this.disposed || targets.length === 0) return 0;
    let launched = 0;
    for (const target of targets) {
      const slot = this.slots.find((s) => !s.active);
      if (!slot) break;
      slot.active = true;
      slot.phase = 'fly';
      slot.t = 0;
      slot.flight = Math.max(0.3, flight);
      slot.origin.copy(origin);
      slot.target.copy(target);
      launched++;
    }
    if (launched > 0) {
      const t = targets[0]!;
      events.emit('sfx', { id: 'arrow_whistle', at: [t.x, t.y + 1, t.z] });
      this.fired += launched;
    }
    return launched;
  }

  /** Fixed step: flight, landings, stuck timers, instance matrices. */
  update(dt: number): void {
    if (this.disposed) return;
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i]!;
      if (!s.active) continue;
      s.t += dt;
      if (s.phase === 'fly') {
        if (s.t >= s.flight) this.land(s, i);
        else this.placeFlying(s, i);
      } else if (s.phase === 'stuck') {
        if (s.t >= ARROW.stuck) {
          s.phase = 'fade';
          s.t = 0;
        }
      } else if (s.t >= ARROW.fade) {
        s.active = false;
        this.arrows.setMatrixAt(i, ZERO);
      } else {
        this.placeStuck(s, i, (s.t / ARROW.fade) * 0.9);
      }
    }
    this.arrows.instanceMatrix.needsUpdate = true;
    this.marks.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.arrows.removeFromParent();
    this.marks.removeFromParent();
    this.arrows.dispose();
    this.marks.dispose();
    this.arrowGeometry.dispose();
    this.markGeometry.dispose();
    this.onLand = null;
  }

  // ------------------------------------------------------------------------------------------- inside

  /** Parabola from origin to target: p(u) = lerp + up · arc · 4u(1 − u); the arrow points along its velocity. */
  private placeFlying(s: Slot, i: number): void {
    const u = s.t / s.flight;
    pos.lerpVectors(s.origin, s.target, u);
    pos.y += ARROW.arc * 4 * u * (1 - u);
    dir.subVectors(s.target, s.origin);
    dir.y += ARROW.arc * 4 * (1 - 2 * u);
    if (dir.lengthSq() < 1e-6) dir.copy(UP).negate();
    dir.normalize();
    quat.setFromUnitVectors(FORWARD, dir);
    scale.setScalar(1);
    m4.compose(pos, quat, scale);
    this.arrows.setMatrixAt(i, m4);
    // The mark closes in on the landing spot as the arrow comes down.
    const k = ARROW.mark.open - (ARROW.mark.open - 1) * u;
    pos.copy(s.target);
    pos.y += ARROW.mark.lift;
    scale.setScalar(k);
    m4.compose(pos, IDENTITY, scale);
    this.marks.setMatrixAt(i, m4);
  }

  /** Stuck in the ground along its final direction, tip `bite` under the surface; `sink` lowers it (the fade). */
  private placeStuck(s: Slot, i: number, sink: number): void {
    dir.subVectors(s.target, s.origin);
    dir.y -= ARROW.arc * 4;
    dir.normalize();
    pos.copy(s.target).addScaledVector(dir, -(this.halfLength - ARROW.bite));
    pos.y -= sink;
    quat.setFromUnitVectors(FORWARD, dir);
    scale.setScalar(1);
    m4.compose(pos, quat, scale);
    this.arrows.setMatrixAt(i, m4);
  }

  private land(s: Slot, i: number): void {
    s.phase = 'stuck';
    s.t = 0;
    this.placeStuck(s, i, 0);
    this.marks.setMatrixAt(i, ZERO);
    const t = s.target;
    events.emit('sfx', { id: 'arrow_thunk', at: [t.x, t.y, t.z] });
    this.session.world.particles.emit('dust', t, ARROW.dust);
    this.onLand?.(t);
  }
}
