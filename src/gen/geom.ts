/**
 * Low-poly geometry helpers. Every builder returns a NON-INDEXED BufferGeometry with exactly three attributes:
 * `position`, `normal` (flat, per face) and `color` (linear RGB, white until painted). That uniform layout lets
 * any two pieces be merged into one draw call.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Rng } from './rng';

export type Vec3 = [number, number, number];

const tmpColor = new THREE.Color();
const colorCache = new Map<string, THREE.Color>();

/** Cached hex → linear-space THREE.Color (three's ColorManagement converts sRGB hex to linear). Do not mutate. */
export function colorOf(hex: string): THREE.Color {
  let c = colorCache.get(hex);
  if (!c) {
    c = new THREE.Color(hex);
    colorCache.set(hex, c);
  }
  return c;
}

/** Strip a three.js primitive down to position/normal/color, non-indexed, with flat normals. */
export function finalize(g: THREE.BufferGeometry): THREE.BufferGeometry {
  let out = g.index ? g.toNonIndexed() : g;
  if (out !== g) g.dispose();
  for (const name of Object.keys(out.attributes)) {
    if (name !== 'position' && name !== 'color') out.deleteAttribute(name);
  }
  out.morphAttributes = {};
  out.clearGroups();
  out.computeVertexNormals(); // non-indexed → one normal per face = flat shading
  if (!out.getAttribute('color')) {
    const n = out.getAttribute('position').count;
    out.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  }
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

export function lowSphere(radius: number, detail = 1): THREE.BufferGeometry {
  return finalize(new THREE.IcosahedronGeometry(radius, detail));
}

/** Capsule standing on Y, centred at the origin; `length` is the straight middle section. */
export function capsule(radius: number, length: number, radial = 7): THREE.BufferGeometry {
  return finalize(new THREE.CapsuleGeometry(radius, length, 2, radial));
}

/** Box centred at the origin with chamfered edges (bevel in metres, clamped to the smallest half-size). */
export function bevelBox(w: number, h: number, d: number, bevel = 0.04): THREE.BufferGeometry {
  const b = Math.max(0, Math.min(bevel, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));
  if (b <= 0) return finalize(new THREE.BoxGeometry(w, h, d));
  const hw = w / 2 - b;
  const hh = h / 2 - b;
  const shape = new THREE.Shape();
  shape.moveTo(-hw, -hh);
  shape.lineTo(hw, -hh);
  shape.lineTo(hw, hh);
  shape.lineTo(-hw, hh);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: d - 2 * b,
    bevelEnabled: true,
    bevelThickness: b,
    bevelSize: b,
    bevelSegments: 1,
    curveSegments: 1,
  });
  g.translate(0, 0, -(d - 2 * b) / 2);
  return finalize(g);
}

/** Cone with its base at y = 0 and tip at y = height. */
export function cone(radius: number, height: number, radial = 7): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(radius, height, radial, 1);
  g.translate(0, height / 2, 0);
  return finalize(g);
}

/** Cylinder with its base at y = 0. */
export function cylinder(rTop: number, rBottom: number, height: number, radial = 7): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBottom, height, radial, 1);
  g.translate(0, height / 2, 0);
  return finalize(g);
}

/** Revolve a profile of [radius, y] points around Y. */
export function lathe(profile: Array<[number, number]>, radial = 8): THREE.BufferGeometry {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y));
  return finalize(new THREE.LatheGeometry(pts, radial));
}

/** Extrude a 2D outline (XY plane) along +Z by `depth`, centred on Z. */
export function extrude(shape: Array<[number, number]>, depth: number, bevel = 0): THREE.BufferGeometry {
  const s = new THREE.Shape(shape.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(s, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    curveSegments: 4,
  });
  g.translate(0, 0, -depth / 2);
  return finalize(g);
}

/**
 * Randomly offset vertices for a hand-made feel. Vertices that share a position move together, so faces stay
 * closed. Recomputes flat normals.
 */
export function jitter(g: THREE.BufferGeometry, amount: number, rng: Rng): THREE.BufferGeometry {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const offsets = new Map<string, Vec3>();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const key = `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
    let o = offsets.get(key);
    if (!o) {
      o = [rng.range(-amount, amount), rng.range(-amount, amount), rng.range(-amount, amount)];
      offsets.set(key, o);
    }
    pos.setXYZ(i, x + o[0], y + o[1], z + o[2]);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/**
 * Paint vertex colours. A function is evaluated once per triangle at its centroid with the face normal, so each
 * face gets one flat colour (the toy-diorama look).
 */
export function paint(
  g: THREE.BufferGeometry,
  hex: string | ((p: THREE.Vector3, n: THREE.Vector3) => string),
): THREE.BufferGeometry {
  const col = g.getAttribute('color') as THREE.BufferAttribute;
  if (typeof hex === 'string') {
    const c = colorOf(hex);
    for (let i = 0; i < col.count; i++) col.setXYZ(i, c.r, c.g, c.b);
  } else {
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const nor = g.getAttribute('normal') as THREE.BufferAttribute;
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (let i = 0; i + 2 < pos.count; i += 3) {
      p.set(
        (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3,
        (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3,
        (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3,
      );
      n.set(nor.getX(i), nor.getY(i), nor.getZ(i));
      tmpColor.copy(colorOf(hex(p, n)));
      for (let k = 0; k < 3; k++) col.setXYZ(i + k, tmpColor.r, tmpColor.g, tmpColor.b);
    }
  }
  col.needsUpdate = true;
  return g;
}

const tmpMatrix = new THREE.Matrix4();
const tmpQuat = new THREE.Quaternion();
const tmpEuler = new THREE.Euler();
const tmpPos = new THREE.Vector3();
const tmpScale = new THREE.Vector3();

/** Translate / rotate (Euler XYZ, radians) / scale in place. Order: scale, rotate, translate. */
export function xform(
  g: THREE.BufferGeometry,
  o: { pos?: Vec3; rot?: Vec3; scale?: number | Vec3 },
): THREE.BufferGeometry {
  const s = o.scale ?? 1;
  tmpScale.set(...(typeof s === 'number' ? ([s, s, s] as Vec3) : s));
  tmpQuat.setFromEuler(tmpEuler.set(...(o.rot ?? ([0, 0, 0] as Vec3))));
  tmpPos.set(...(o.pos ?? ([0, 0, 0] as Vec3)));
  g.applyMatrix4(tmpMatrix.compose(tmpPos, tmpQuat, tmpScale));
  // Mirroring flips winding; recompute so faces still point outwards.
  if (tmpScale.x * tmpScale.y * tmpScale.z < 0) flipWinding(g);
  g.computeVertexNormals();
  return g;
}

function flipWinding(g: THREE.BufferGeometry): void {
  for (const name of ['position', 'color'] as const) {
    const a = g.getAttribute(name) as THREE.BufferAttribute;
    const arr = a.array as Float32Array;
    for (let i = 0; i + 2 < a.count; i += 3) {
      for (let c = 0; c < 3; c++) {
        const t = arr[(i + 1) * 3 + c]!;
        arr[(i + 1) * 3 + c] = arr[(i + 2) * 3 + c]!;
        arr[(i + 2) * 3 + c] = t;
      }
    }
    a.needsUpdate = true;
  }
}

/** Merge pieces built with these helpers into one geometry (one draw call). Disposes the inputs. */
export function merge(gs: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (gs.length === 0)
    return finalize(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([], 3)),
    );
  if (gs.length === 1) return gs[0]!;
  const merged = mergeGeometries(gs, false);
  if (!merged) throw new Error('geom.merge: incompatible attributes (build pieces with geom.ts helpers)');
  for (const g of gs) g.dispose();
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

/** Convenience: build, paint and place in one call. */
export function part(
  g: THREE.BufferGeometry,
  hex: string | ((p: THREE.Vector3, n: THREE.Vector3) => string),
  o: { pos?: Vec3; rot?: Vec3; scale?: number | Vec3 } = {},
): THREE.BufferGeometry {
  return xform(paint(g, hex), o);
}
