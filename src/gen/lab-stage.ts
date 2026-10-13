/**
 * Character Lab stage: the 'test' palette atmosphere, the gradient sky, a faceted meadow and a round low-poly
 * turntable plinth. Everything uses the shared lit material; only geometry is owned (and disposed) here.
 *
 * Draw calls: sky + clouds (Sky), ground, plinth, blob shadows = a handful.
 */
import * as THREE from 'three';
import type { QualityPreset } from '../core/Quality';
import { Sky, applyAtmosphere, type Atmosphere } from './Sky';
import { getPalette, mix, shade, type Palette } from './palette';
import { cylinder, finalize, merge, paint, part } from './geom';
import { createNoise2D, fbm2 } from './noise';
import { mat } from './materials';
import { hashString } from './rng';
import { BlobShadows } from './BlobShadows';

/** Ring radii of the meadow (m): small facets near the plinth, big ones under the fog. */
const GROUND_RINGS = [0, 2.5, 5, 8, 12, 17, 24, 33, 45, 62, 85, 120, 170, 240, 330];
const GROUND_SEGMENTS = 36;
/** The meadow is flat where the cast stands and rolls into low hills further out. */
const FLAT_RADIUS = 26;
const HILL_RADIUS = 90;
const HILL_HEIGHT = 9;

const PLINTH = { radius: 1.05, height: 0.24, radial: 14 };
/** Shadow frustum padding around the area being looked at (m). */
const SHADOW_PAD = 3;
/** Blob-shadow slots: the turntable character, the lineup and the crowd of 100. */
const BLOB_SLOTS = 160;

export class LabStage {
  readonly scene = new THREE.Scene();
  readonly palette: Palette;
  /** Rotates with the turntable; the turntable character goes in here. */
  readonly turntable = new THREE.Group();
  /** Height of the plinth top (where the turntable character's feet go). */
  readonly plinthTop = PLINTH.height;
  /** Blob shadows under every Lab character and citizen (GDD 2.11, all qualities). */
  readonly blobs = new BlobShadows(BLOB_SLOTS);

  private readonly sky: Sky;
  private readonly atmosphere: Atmosphere;
  private readonly ground: THREE.Mesh;
  private readonly plinth: THREE.Mesh;

  constructor(quality: QualityPreset) {
    this.scene.name = 'character-lab';
    this.palette = getPalette('test');
    const pal = this.palette;

    // Fog, hemisphere light and the shadow-casting sun (the renderer's shadow setting decides if it draws).
    this.atmosphere = applyAtmosphere(this.scene, pal);
    this.fitShadow(new THREE.Vector3(0, 0, 0), 4);

    this.sky = new Sky(pal, quality);
    this.scene.add(this.sky.object);

    this.ground = new THREE.Mesh(buildGround(pal), mat('lambert'));
    this.ground.name = 'lab-ground';
    this.ground.receiveShadow = true;

    this.plinth = new THREE.Mesh(buildPlinth(pal), mat('lambert'));
    this.plinth.name = 'lab-plinth';
    this.plinth.castShadow = true;
    this.plinth.receiveShadow = true;
    this.turntable.name = 'lab-turntable';
    this.turntable.add(this.plinth);

    this.scene.add(this.ground, this.turntable, this.blobs.mesh);
  }

  /**
   * Shrinks the sun's shadow frustum to a square of `halfWidth` (+ padding) around `center`, so the small Lab
   * area gets crisp shadows from the same map size the chapters use.
   */
  fitShadow(center: THREE.Vector3, halfWidth: number): void {
    const cam = this.atmosphere.sun.shadow.camera;
    const r = halfWidth + SHADOW_PAD;
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.updateProjectionMatrix();
    this.atmosphere.focus(center); // moves sun.target, which carries the sun
  }

  /** The shadow-casting sun (crowd shadows draw into its shadow map). */
  get sun(): THREE.DirectionalLight {
    return this.atmosphere.sun;
  }

  /** Show or hide the plinth (the lineup stands on its own stage). */
  setPlinthVisible(v: boolean): void {
    this.plinth.visible = v;
  }

  update(frameDt: number, camera: THREE.Camera): void {
    this.sky.update(frameDt, camera);
    this.blobs.update();
  }

  dispose(): void {
    this.scene.remove(this.ground, this.turntable, this.sky.object);
    this.ground.geometry.dispose();
    this.plinth.geometry.dispose();
    this.sky.dispose();
    this.blobs.dispose();
    this.atmosphere.dispose();
    this.scene.clear();
  }
}

/** Flat-shaded meadow of concentric rings; faces painted from the palette's ground bands. */
function buildGround(pal: Palette): THREE.BufferGeometry {
  const noise = createNoise2D(hashString('lab-ground'));
  const heightAt = (x: number, z: number): number => {
    const r = Math.hypot(x, z);
    const t = THREE.MathUtils.smoothstep(r, FLAT_RADIUS, HILL_RADIUS);
    if (t <= 0) return 0;
    return t * HILL_HEIGHT * (0.55 + 0.45 * fbm2(noise, x * 0.018, z * 0.018, 3));
  };

  // Rings share their boundary vertices; odd rings are turned half a segment so the facets interlock without
  // spokes. Every vertex is displaced by the same heightAt(x, z), so the surface stays closed (no cracks).
  const step = (Math.PI * 2) / GROUND_SEGMENTS;
  const point = (ring: number, k: number): THREE.Vector3 => {
    const r = GROUND_RINGS[ring]!;
    const a = (k + (ring % 2) * 0.5) * step;
    const x = r * Math.cos(a);
    const z = r * Math.sin(a);
    return new THREE.Vector3(x, heightAt(x, z), z);
  };
  const out: number[] = [];
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): void => {
    // Wind every face upwards (normal +Y) whatever order the caller gave.
    const up = e1.subVectors(b, a).cross(e2.subVectors(c, a)).y >= 0;
    const [q, r] = up ? [b, c] : [c, b];
    out.push(a.x, a.y, a.z, q.x, q.y, q.z, r.x, r.y, r.z);
  };
  for (let i = 1; i < GROUND_RINGS.length; i++) {
    for (let k = 0; k < GROUND_SEGMENTS; k++) {
      const b0 = point(i, k);
      const b1 = point(i, k + 1);
      if (GROUND_RINGS[i - 1] === 0) {
        tri(new THREE.Vector3(0, heightAt(0, 0), 0), b0, b1);
        continue;
      }
      const a0 = point(i - 1, k);
      const a1 = point(i - 1, k + 1);
      if (i % 2 === 1) {
        // Outer vertex k sits between inner k and k+1.
        tri(a0, a1, b0);
        tri(b0, a1, b1);
      } else {
        // Inner vertex k sits between outer k and k+1.
        tri(b0, b1, a0);
        tri(a0, b1, a1);
      }
    }
  }
  const raw = new THREE.BufferGeometry();
  raw.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  const ground = finalize(raw);

  const g = pal.ground;
  return paint(ground, (p, n) => {
    const v = noise(p.x * 0.11 + 7.3, p.z * 0.11 - 2.1); // per-face patchiness
    const base = v > 0.35 ? g.mid : v < -0.4 ? shade(g.low, 0.04) : g.low;
    if (p.y > HILL_HEIGHT * 0.55) return mix(base, g.high, 0.6);
    if (n.y < 0.9) return mix(base, g.slope, 0.35);
    return base;
  });
}

/** A chunky round turntable: wooden drum, gold rim band and a sandy top. */
function buildPlinth(pal: Palette): THREE.BufferGeometry {
  const { radius, height, radial } = PLINTH;
  const wood = shade(pal.ground.pathEdge, -0.12);
  return merge([
    part(cylinder(radius * 0.97, radius * 1.06, height * 0.7, radial), wood),
    part(cylinder(radius, radius * 0.97, height * 0.18, radial), shade(pal.ground.pathEdge, 0.05), {
      pos: [0, height * 0.7, 0],
    }),
    part(cylinder(radius * 0.95, radius, height * 0.12, radial), pal.ground.path, {
      pos: [0, height * 0.88, 0],
    }),
  ]);
}
