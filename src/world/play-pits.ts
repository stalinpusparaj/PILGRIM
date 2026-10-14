/**
 * Gameplay landmarks that have no prop builder (yet): 'pit' and 'steps' (GDD 2.7.3 bonk holes, 2.7.5 Slough
 * steps). The prop registry skips unknown landmark types with a console warning, so the play session hands
 * buildWorld() a copy of the level without them and puts them back on `world.level` afterwards, where the
 * gameplay systems (Slough, Zones) read them. As soon as a prop builder exists for a type, it is built like any
 * other landmark and nothing here touches it.
 *
 * `PitMarks` draws what a 'pit' landmark looks like when no prop builds it: a dark hole laid on the terrain
 * (decal, RGBA vertex colours) with a ring of small rim stones. All pits share 2 draw calls. The hazard itself
 * is the level's 'pit' zone (src/world/Zones.ts); this is only the look. Params: `r` (hole radius, 1.5 m).
 */
import * as THREE from 'three';
import { colorOf, lowSphere, merge, part, jitter } from '../gen/geom';
import { mat } from '../gen/materials';
import { shade, vary, type Palette } from '../gen/palette';
import { Rng, hashString } from '../gen/rng';
import { isKnownProp } from './placeProps';
import type { LevelData, LevelLandmark } from './LevelTypes';
import type { World } from './World';

/** Landmark types the gameplay systems build themselves when the prop registry has no builder for them. */
export const GAMEPLAY_LANDMARKS: readonly string[] = ['pit', 'steps'];

const PIT = {
  radius: 1.5,
  segments: 22,
  lift: 0.06,
  /** Ring radii (× r) and alphas: a solid dark hole, a short dark-to-earth lip, a soft earth fade. */
  hole: 0.74,
  lip: 0.9,
  fade: 1.18,
  holeColour: '#1A1216',
  stones: { count: 9, size: 0.2, ring: 1.02 },
};

function isGameplayOnly(lm: LevelLandmark): boolean {
  return GAMEPLAY_LANDMARKS.includes(lm.type) && !isKnownProp(lm.type);
}

/** The level as buildWorld() should see it: gameplay-only landmarks left out (no warnings, no stand-ins). */
export function buildableLevel(level: LevelData): LevelData {
  if (!level.landmarks.some(isGameplayOnly)) return level;
  return { ...level, landmarks: level.landmarks.filter((lm) => !isGameplayOnly(lm)) };
}

/** Puts the full landmark list back on the built world, in file order. */
export function restoreLandmarks(world: World, level: LevelData): void {
  if (world.level === level) return;
  const list = world.level.landmarks;
  list.length = 0;
  for (const lm of level.landmarks) list.push(lm);
}

/** The look of every 'pit' landmark the prop registry cannot build. */
export class PitMarks {
  readonly object = new THREE.Group();
  readonly count: number;
  private readonly geometries: THREE.BufferGeometry[] = [];

  constructor(world: World) {
    this.object.name = 'play:pits';
    const pits = world.level.landmarks.filter((lm) => lm.type === 'pit' && !isKnownProp(lm.type) && lm.at);
    this.count = pits.length;
    if (pits.length === 0) return;
    const decal: THREE.BufferGeometry[] = [];
    const stones: THREE.BufferGeometry[] = [];
    for (const lm of pits) {
      const [x, , z] = lm.at!;
      const r = typeof lm.params?.r === 'number' && lm.params.r > 0 ? lm.params.r : PIT.radius;
      const rng = new Rng((hashString(`pit:${lm.id}`) ^ world.level.seed) >>> 0);
      decal.push(holeDecal(world, x, z, r, rng));
      stones.push(rimStones(world, x, z, r, rng, world.palette));
    }
    const decalGeo = merge(decal);
    const stoneGeo = merge(stones);
    this.geometries.push(decalGeo, stoneGeo);
    const hole = new THREE.Mesh(decalGeo, mat('decal'));
    hole.name = 'pit:hole';
    hole.renderOrder = 1; // after the opaque ground, like the blob shadows
    const rim = new THREE.Mesh(stoneGeo, mat('lambert'));
    rim.name = 'pit:rim';
    rim.castShadow = true;
    rim.receiveShadow = true;
    this.object.add(hole, rim);
  }

  dispose(): void {
    this.object.removeFromParent();
    this.object.clear();
    for (const g of this.geometries) g.dispose();
    this.geometries.length = 0;
  }
}

/** A disc on the terrain: dark centre, a lip, then the earth colour fading out (faces point up). */
function holeDecal(world: World, cx: number, cz: number, r: number, rng: Rng): THREE.BufferGeometry {
  const terrain = world.terrain;
  const n = PIT.segments;
  const dark = colorOf(PIT.holeColour);
  const earth = colorOf(shade(world.palette.ground.slope, -0.28));
  // Slightly irregular outline, so it reads as a dug hole rather than a perfect disc.
  const wobble = new Float32Array(n + 1);
  for (let k = 0; k < n; k++) wobble[k] = 1 + rng.range(-0.07, 0.07);
  wobble[n] = wobble[0]!;
  const pos: number[] = [];
  const col: number[] = [];
  const v = (ring: number, k: number, c: THREE.Color, a: number): void => {
    const t = (k / n) * Math.PI * 2;
    const rr = r * ring * (ring > 0 ? wobble[k]! : 1);
    const x = cx + Math.cos(t) * rr;
    const z = cz - Math.sin(t) * rr;
    pos.push(x, terrain.heightAt(x, z) + PIT.lift, z);
    col.push(c.r, c.g, c.b, a);
  };
  const quad = (
    r0: number,
    c0: THREE.Color,
    a0: number,
    r1: number,
    c1: THREE.Color,
    a1: number,
    k: number,
  ): void => {
    v(r0, k, c0, a0);
    v(r1, k, c1, a1);
    v(r1, k + 1, c1, a1);
    v(r0, k, c0, a0);
    v(r1, k + 1, c1, a1);
    v(r0, k + 1, c0, a0);
  };
  for (let k = 0; k < n; k++) {
    v(0, k, dark, 0.97);
    v(PIT.hole, k, dark, 0.97);
    v(PIT.hole, k + 1, dark, 0.97);
    quad(PIT.hole, dark, 0.97, PIT.lip, earth, 0.9, k);
    quad(PIT.lip, earth, 0.9, PIT.fade, earth, 0, k);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.computeBoundingSphere();
  return g;
}

/** Small flattened stones round the rim, sitting on the ground (one merged geometry). */
function rimStones(
  world: World,
  cx: number,
  cz: number,
  r: number,
  rng: Rng,
  pal: Palette,
): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const { count, size, ring } = PIT.stones;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rng.range(-0.25, 0.25);
    const d = r * ring + rng.range(-0.08, 0.12);
    const x = cx + Math.cos(a) * d;
    const z = cz + Math.sin(a) * d;
    const s = size * rng.range(0.7, 1.35);
    const hex = vary(shade(pal.ground.slope, -0.08), 0.08, rng.next());
    const stone = jitter(lowSphere(1, 0), 0.18, rng);
    parts.push(
      part(stone, hex, {
        pos: [x, world.terrain.heightAt(x, z) + s * 0.25, z],
        rot: [rng.range(-0.3, 0.3), rng.range(0, Math.PI * 2), rng.range(-0.3, 0.3)],
        scale: [s * 1.3, s * 0.7, s],
      }),
    );
  }
  return merge(parts);
}
