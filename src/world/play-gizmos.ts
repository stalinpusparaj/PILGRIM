/**
 * Debug wireframes for the play session (GDD 2.15 F1 "show triggers/zones/Way spline"): every collider (yellow)
 * and the Way + detours (magenta, at their draped height). Zone outlines come from Zones' own "Show zones". Each
 * layer is one LineSegments built when switched on and freed when switched off, so nothing is kept while hidden.
 * Drawn on top of everything (no depth test). Dev-only: no i18n.
 */
import * as THREE from 'three';
import type { Collider } from '../gen/types';
import type { Way } from '../gen/Way';
import type { World } from './World';

export type GizmoLayer = 'colliders' | 'way';

const COLOURS: Record<GizmoLayer, number> = { colliders: 0xffd84a, way: 0xff4ad8 };
const LIFT = 0.25;
const CIRCLE_SEGMENTS = 32;
const WAY_STEP = 1.5; // m between Way samples

export class PlayGizmos {
  readonly object = new THREE.Group();
  private readonly layers = new Map<GizmoLayer, THREE.LineSegments>();

  constructor(
    private readonly world: World,
    /** Live collider list (static world colliders plus anything added later), read when a layer is built. */
    private readonly colliders: () => readonly Collider[] = () => world.colliders,
  ) {
    this.object.name = 'play:gizmos';
    this.object.renderOrder = 10;
  }

  shown(layer: GizmoLayer): boolean {
    return this.layers.has(layer);
  }

  set(layer: GizmoLayer, on: boolean): void {
    if (on === this.layers.has(layer)) return;
    if (!on) {
      const lines = this.layers.get(layer)!;
      this.layers.delete(layer);
      freeLines(lines);
      return;
    }
    const b = new LineBuilder();
    if (layer === 'colliders') for (const c of this.colliders()) b.collider(c);
    else for (const w of [this.world.ways.main, ...this.world.ways.detours]) b.way(w);
    const lines = b.build(COLOURS[layer]);
    lines.name = `gizmo:${layer}`;
    this.layers.set(layer, lines);
    this.object.add(lines);
  }

  dispose(): void {
    for (const lines of this.layers.values()) freeLines(lines);
    this.layers.clear();
    this.object.removeFromParent();
  }
}

function freeLines(lines: THREE.LineSegments): void {
  lines.removeFromParent();
  lines.geometry.dispose();
  (lines.material as THREE.Material).dispose();
}

/** Accumulates line segments (pairs of points) with per-vertex colours. */
class LineBuilder {
  private readonly pos: number[] = [];
  private readonly col: number[] = [];
  private readonly c = new THREE.Color();
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();

  private seg(ax: number, ay: number, az: number, bx: number, by: number, bz: number): void {
    this.pos.push(ax, ay, az, bx, by, bz);
    this.col.push(this.c.r, this.c.g, this.c.b, this.c.r, this.c.g, this.c.b);
  }

  way(way: Way): void {
    this.c.set(COLOURS.way);
    const n = Math.max(2, Math.ceil(way.length / WAY_STEP));
    for (let i = 0; i < n; i++) {
      way.sample(i / n, this.a);
      way.sample((i + 1) / n, this.b);
      this.seg(this.a.x, this.a.y + LIFT, this.a.z, this.b.x, this.b.y + LIFT, this.b.z);
    }
  }

  collider(c: Collider): void {
    this.c.set(COLOURS.colliders);
    const [cx, cy, cz] = c.center;
    if (c.kind === 'box') {
      const [hx, hy, hz] = c.half;
      const cs = Math.cos(c.rotY);
      const sn = Math.sin(c.rotY);
      const p = (sx: number, sy: number, sz: number, out: THREE.Vector3): THREE.Vector3 =>
        out.set(cx + sx * hx * cs + sz * hz * sn, cy + sy * hy, cz - sx * hx * sn + sz * hz * cs);
      const edges: Array<[number, number, number, number, number, number]> = [
        [-1, -1, -1, 1, -1, -1],
        [1, -1, -1, 1, -1, 1],
        [1, -1, 1, -1, -1, 1],
        [-1, -1, 1, -1, -1, -1],
        [-1, 1, -1, 1, 1, -1],
        [1, 1, -1, 1, 1, 1],
        [1, 1, 1, -1, 1, 1],
        [-1, 1, 1, -1, 1, -1],
        [-1, -1, -1, -1, 1, -1],
        [1, -1, -1, 1, 1, -1],
        [1, -1, 1, 1, 1, 1],
        [-1, -1, 1, -1, 1, 1],
      ];
      for (const e of edges) {
        p(e[0], e[1], e[2], this.a);
        p(e[3], e[4], e[5], this.b);
        this.seg(this.a.x, this.a.y, this.a.z, this.b.x, this.b.y, this.b.z);
      }
    } else if (c.kind === 'cylinder') {
      const y0 = cy - c.height / 2;
      const y1 = cy + c.height / 2;
      for (let i = 0; i < CIRCLE_SEGMENTS; i++) {
        const a0 = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
        const a1 = ((i + 1) / CIRCLE_SEGMENTS) * Math.PI * 2;
        const x0 = cx + Math.cos(a0) * c.radius;
        const z0 = cz + Math.sin(a0) * c.radius;
        const x1 = cx + Math.cos(a1) * c.radius;
        const z1 = cz + Math.sin(a1) * c.radius;
        this.seg(x0, y0, z0, x1, y0, z1);
        this.seg(x0, y1, z0, x1, y1, z1);
        if (i % 8 === 0) this.seg(x0, y0, z0, x0, y1, z0);
      }
    } else {
      for (let i = 0; i < CIRCLE_SEGMENTS; i++) {
        const a0 = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
        const a1 = ((i + 1) / CIRCLE_SEGMENTS) * Math.PI * 2;
        const r = c.radius;
        this.seg(
          cx + Math.cos(a0) * r,
          cy,
          cz + Math.sin(a0) * r,
          cx + Math.cos(a1) * r,
          cy,
          cz + Math.sin(a1) * r,
        );
        this.seg(
          cx + Math.cos(a0) * r,
          cy + Math.sin(a0) * r,
          cz,
          cx + Math.cos(a1) * r,
          cy + Math.sin(a1) * r,
          cz,
        );
        this.seg(
          cx,
          cy + Math.cos(a0) * r,
          cz + Math.sin(a0) * r,
          cx,
          cy + Math.cos(a1) * r,
          cz + Math.sin(a1) * r,
        );
      }
    }
  }

  build(fallback: number): THREE.LineSegments {
    const g = new THREE.BufferGeometry();
    if (this.pos.length === 0) {
      this.pos.push(0, 0, 0, 0, 0, 0);
      this.col.push(0, 0, 0, 0, 0, 0);
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    const m = new THREE.LineBasicMaterial({
      color: 0xffffff,
      vertexColors: true,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.85,
      fog: false,
    });
    m.name = `gizmo:${fallback.toString(16)}`;
    const lines = new THREE.LineSegments(g, m);
    lines.renderOrder = 10;
    lines.frustumCulled = false;
    return lines;
  }
}
