/**
 * A low-poly lamb (GDD 2.11 animals: sheep), built in code: a lumpy woolly body, a dark face with ears, four
 * stubby legs. Stands on y = 0 facing +Z, about 0.75 m tall. One geometry is shared by a whole flock drawn as an
 * InstancedMesh (1 draw call); see src/chapters/ch12-sheep.ts.
 */
import type * as THREE from 'three';
import { bevelBox, cylinder, jitter, lowSphere, merge, part } from './geom';
import { Rng } from './rng';

export const SHEEP_HEIGHT = 0.75;

export function buildSheepGeometry(wool: string, face: string, seed = 12): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const parts: THREE.BufferGeometry[] = [];
  parts.push(part(jitter(lowSphere(0.36, 1), 0.04, rng), wool, { pos: [0, 0.42, 0], scale: [1, 0.85, 1.3] }));
  parts.push(part(jitter(lowSphere(0.17, 1), 0.02, rng), wool, { pos: [0, 0.62, 0.3] })); // woolly top-knot
  parts.push(part(bevelBox(0.2, 0.22, 0.24, 0.05), face, { pos: [0, 0.55, 0.46] }));
  for (const s of [-1, 1]) {
    parts.push(part(bevelBox(0.13, 0.05, 0.07, 0.015), face, { pos: [s * 0.15, 0.6, 0.42], rot: [0, 0, s * 0.4] }));
    parts.push(part(lowSphere(0.025, 0), '#1E1A18', { pos: [s * 0.06, 0.6, 0.585] })); // eyes
    for (const z of [-0.22, 0.22]) {
      parts.push(part(cylinder(0.045, 0.04, 0.3, 5), face, { pos: [s * 0.15, 0.15, z] }));
    }
  }
  return merge(parts);
}
