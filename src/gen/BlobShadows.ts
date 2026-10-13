/**
 * Blob shadows (GDD 2.11 STYLE LOCK: "cheap blob shadows under every character on all qualities"): one
 * InstancedMesh of soft dark discs laid on the ground under every character and crowd citizen of a scene, so the
 * whole cast costs ONE draw call for its ground contact, with or without the sun's shadow map (Low has none).
 *
 * - Characters are followed every frame (under the hips, so a lean or a sit moves the blob with the body); a
 *   character whose root or mesh is hidden (scripts, World distance culling) loses its blob too.
 * - Crowds are static: their citizens' blobs are recomputed only when the CrowdMesh's instances change, and hidden
 *   with the CrowdMesh.
 * - With a `ground` sampler (a chapter's Terrain) blobs lie on the terrain, tilted to its normal; a character up
 *   to `AIR_MAX` above it (a hop, a step) keeps its blob on the ground, shrinking with height. Higher than that it
 *   is standing on something (a bridge, a cart) and the blob sits at its feet. Without a sampler (the Lab) the
 *   blob sits at the feet.
 *
 *   const blobs = new BlobShadows(64, terrain);
 *   scene.add(blobs.mesh);
 *   blobs.follow(character);           // blobs.addCrowd(crowdMesh)
 *   blobs.update();                    // per rendered frame, after characters moved
 */
import * as THREE from 'three';
import type { Character } from './char-types';
import type { CrowdMesh } from './CrowdMesh';
import { mat } from './materials';

/** What blobs lie on (Terrain fits). */
export interface BlobGround {
  heightAt(x: number, z: number): number;
  normalAt(x: number, z: number, out?: THREE.Vector3): THREE.Vector3;
}

/** Blob radius as a fraction of the character's height (a little wider than the stance). */
export const BLOB_RADIUS = 0.27;
/** Darkness at the centre (alpha) and the shadow tint (a cool violet-brown, never pure black). */
const BLOB = { alpha: 0.42, mid: 0.6, midAlpha: 0.75, segments: 12, colour: [0.12, 0.1, 0.16] as const };
/** Height above the ground (m): clears the Way ribbon (lifted 0.035) and terrain interpolation. */
const LIFT = 0.05;
/** Above the ground by more than this (m), a character stands on something and the blob goes to its feet. */
const AIR_MAX = 1.5;

interface Follower {
  c: Character;
  radius: number;
}

interface CrowdSource {
  crowd: CrowdMesh;
  radius: number;
  /** Cached blob matrices (16 floats each) and what they were built from. */
  cache: Float32Array;
  version: number;
  count: number;
}

const tmpV = new THREE.Vector3();
const tmpF = new THREE.Vector3();
const tmpN = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpM = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

/** A soft disc of radius 1 on y = 0: dark centre, a mid ring, transparent rim (RGBA vertex colours). */
function discGeometry(): THREE.BufferGeometry {
  const { segments: n, mid, alpha, midAlpha, colour } = BLOB;
  const pos: number[] = [];
  const col: number[] = [];
  const v = (r: number, k: number, a: number): void => {
    const t = (k / n) * Math.PI * 2;
    pos.push(Math.cos(t) * r, 0, -Math.sin(t) * r);
    col.push(colour[0], colour[1], colour[2], a);
  };
  for (let k = 0; k < n; k++) {
    // Centre fan (counter-clockwise seen from above, so the faces point up).
    pos.push(0, 0, 0);
    col.push(colour[0], colour[1], colour[2], alpha);
    v(mid, k, alpha * midAlpha);
    v(mid, k + 1, alpha * midAlpha);
    // Fading band out to the rim.
    v(mid, k, alpha * midAlpha);
    v(1, k, 0);
    v(1, k + 1, 0);
    v(mid, k, alpha * midAlpha);
    v(1, k + 1, 0);
    v(mid, k + 1, alpha * midAlpha);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  return g;
}

/** True when `o` and every parent are visible. */
function shown(o: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

export class BlobShadows {
  readonly mesh: THREE.InstancedMesh;
  readonly max: number;
  private readonly followers: Follower[] = [];
  private readonly crowds: CrowdSource[] = [];
  private warned = false;
  private disposed = false;

  constructor(
    max: number,
    private readonly ground: BlobGround | null = null,
  ) {
    this.max = Math.max(1, Math.floor(max));
    this.mesh = new THREE.InstancedMesh(discGeometry(), mat('decal'), this.max);
    this.mesh.name = 'blob-shadows';
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    // Blobs are spread over the whole scene and cost one tiny call: no per-frame bounds.
    this.mesh.frustumCulled = false;
    // Drawn first among the transparent things (particles, water), like a mark painted on the ground.
    this.mesh.renderOrder = -1;
  }

  /** Puts a blob under `c` from now on (radius defaults to BLOB_RADIUS × its height). */
  follow(c: Character, radius = c.height * BLOB_RADIUS): void {
    if (this.disposed || this.followers.some((f) => f.c === c)) return;
    this.followers.push({ c, radius: Math.max(0.05, radius) });
  }

  unfollow(c: Character): void {
    const i = this.followers.findIndex((f) => f.c === c);
    if (i >= 0) this.followers.splice(i, 1);
  }

  /** Blobs under every citizen of a (static) crowd. */
  addCrowd(crowd: CrowdMesh, radius = crowd.height * BLOB_RADIUS): void {
    if (this.disposed || this.crowds.some((s) => s.crowd === crowd)) return;
    this.crowds.push({
      crowd,
      radius: Math.max(0.05, radius),
      cache: new Float32Array(crowd.max * 16),
      version: -1,
      count: -1,
    });
  }

  removeCrowd(crowd: CrowdMesh): void {
    const i = this.crowds.findIndex((s) => s.crowd === crowd);
    if (i >= 0) this.crowds.splice(i, 1);
  }

  /** Places every blob. Call once per rendered frame, after characters have moved and animated. */
  update(): void {
    if (this.disposed) return;
    const out = this.mesh.instanceMatrix.array as Float32Array;
    let n = 0;
    for (const s of this.crowds) {
      const mesh = s.crowd.mesh;
      if (!shown(mesh) || mesh.count === 0) continue;
      if (s.version !== mesh.instanceMatrix.version || s.count !== mesh.count) this.bakeCrowd(s);
      const take = Math.min(s.count, this.max - n);
      out.set(s.cache.subarray(0, take * 16), n * 16);
      n += take;
      if (take < s.count) this.overflow();
    }
    for (const f of this.followers) {
      const c = f.c;
      if (!c.mesh.visible || !shown(c.root)) continue;
      if (n >= this.max) {
        this.overflow();
        break;
      }
      c.root.updateWorldMatrix(true, false);
      // Under the hips (the root never moves with the animation; the hips do).
      const hips = c.bones.hips;
      tmpF.set(hips ? hips.position.x : 0, 0, hips ? hips.position.z : 0).applyMatrix4(c.root.matrixWorld);
      this.place(tmpF, f.radius).toArray(out, n * 16);
      n++;
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    if (n > 0) this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.followers.length = 0;
    this.crowds.length = 0;
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.dispose();
  }

  private bakeCrowd(s: CrowdSource): void {
    const mesh = s.crowd.mesh;
    mesh.updateWorldMatrix(true, false);
    const src = mesh.instanceMatrix.array as Float32Array;
    s.count = Math.min(mesh.count, s.cache.length / 16);
    for (let i = 0; i < s.count; i++) {
      tmpF.set(src[i * 16 + 12]!, src[i * 16 + 13]!, src[i * 16 + 14]!).applyMatrix4(mesh.matrixWorld);
      this.place(tmpF, s.radius).toArray(s.cache, i * 16);
    }
    s.version = mesh.instanceMatrix.version;
  }

  /** The blob matrix for feet at `feet` (world): on the ground under them, tilted to it, shrunk when airborne. */
  private place(feet: THREE.Vector3, radius: number): THREE.Matrix4 {
    let y = feet.y;
    let r = radius;
    tmpQ.identity();
    const g = this.ground;
    if (g) {
      const gy = g.heightAt(feet.x, feet.z);
      const air = feet.y - gy;
      if (air < AIR_MAX) {
        y = gy;
        const h = Math.max(0, air);
        r = radius * (1 - Math.min(0.45, h * 0.4));
        tmpQ.setFromUnitVectors(UP, g.normalAt(feet.x, feet.z, tmpN));
      }
    }
    tmpV.set(feet.x, y + LIFT, feet.z);
    return tmpM.compose(tmpV, tmpQ, tmpS.set(r, 1, r));
  }

  private overflow(): void {
    if (this.warned) return;
    this.warned = true;
    console.warn(`[blob shadows] more than ${this.max} blobs; the rest are skipped`);
  }
}
