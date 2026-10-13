/**
 * Low-poly geometry helpers (GDD 2.11 style lock, GDD 2.12 "Core utilities"): flat-shaded triangles with one
 * vertex colour per face, a hand-made "jitter", and merging many parts into one geometry (one draw call).
 *
 * Every helper works on non-indexed geometry with a `position` attribute, so each triangle owns its three
 * vertices and can carry its own colour. Only the start of the toolbox; later phases add lathe, extrude,
 * capsule and the rest.
 */
import * as THREE from 'three';
import { hash3 } from './rng';

/** Non-indexed copy of `geometry` holding only `position`. The input is disposed. */
export function flatten(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  geometry.dispose();
  for (const name of Object.keys(flat.attributes)) if (name !== 'position') flat.deleteAttribute(name);
  return flat;
}

/**
 * Moves every vertex by up to `amount` on each axis. The offset depends only on the vertex position (and the
 * seed), so corners shared by several triangles move together and the surface never cracks.
 */
export function jitter(geometry: THREE.BufferGeometry, amount: number, seed: number): void {
  const pos = geometry.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const kx = Math.round(x * 1e4);
    const ky = Math.round(y * 1e4);
    const kz = Math.round(z * 1e4);
    pos.setXYZ(
      i,
      x + (hash3(kx, ky, kz, seed) * 2 - 1) * amount,
      y + (hash3(kx, ky, kz, seed + 1) * 2 - 1) * amount,
      z + (hash3(kx, ky, kz, seed + 2) * 2 - 1) * amount,
    );
  }
  pos.needsUpdate = true;
}

/**
 * Gives every triangle a single colour. `colorAt` receives the face centre (in the geometry's current space)
 * and the face index, and writes the colour into `out` (linear working colour space, like THREE.Color).
 */
export function paintFaces(
  geometry: THREE.BufferGeometry,
  colorAt: (center: THREE.Vector3, face: number, out: THREE.Color) => void,
): void {
  const pos = geometry.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const center = new THREE.Vector3();
  const color = new THREE.Color();
  for (let face = 0; face * 3 + 2 < pos.count; face++) {
    const i = face * 3;
    center.set(
      (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3,
      (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3,
      (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3,
    );
    colorAt(center, face, color);
    for (let k = 0; k < 3; k++) {
      const o = (i + k) * 3;
      colors[o] = color.r;
      colors[o + 1] = color.g;
      colors[o + 2] = color.b;
    }
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

/**
 * Concatenates non-indexed geometries that all have `position` and `color` into one, with flat (face)
 * normals. The inputs are disposed.
 */
export function mergeFlat(parts: readonly THREE.BufferGeometry[]): THREE.BufferGeometry {
  let count = 0;
  for (const part of parts) count += part.getAttribute('position').count;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  let offset = 0;
  for (const part of parts) {
    const pos = part.getAttribute('position');
    const col = part.getAttribute('color');
    if (part.index || !col || col.count !== pos.count) {
      throw new Error('[geom] mergeFlat needs non-indexed parts with a colour per vertex');
    }
    for (let i = 0; i < pos.count; i++) {
      const o = (offset + i) * 3;
      positions[o] = pos.getX(i);
      positions[o + 1] = pos.getY(i);
      positions[o + 2] = pos.getZ(i);
      colors[o] = col.getX(i);
      colors[o + 1] = col.getY(i);
      colors[o + 2] = col.getZ(i);
    }
    offset += pos.count;
    part.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  merged.computeVertexNormals(); // non-indexed: one normal per face
  merged.computeBoundingSphere();
  return merged;
}
