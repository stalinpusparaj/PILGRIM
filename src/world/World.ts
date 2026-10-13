/**
 * A built chapter world: everything `buildWorld()` (LevelLoader.ts) made from one level file, animated by
 * `update()` and freed by `dispose()`.
 *
 * Ownership: modules with their own `dispose()` (sky, atmosphere, terrain, Way ribbons, scatter, static props,
 * water, particles, characters, promises) are disposed first, newest first; then a sweep over the scene graph
 * frees anything left (shadow maps, skeleton bone textures, stray geometry). Shared app-lifetime materials from
 * `src/gen/materials.ts` (named `shared:<kind>`) are never freed.
 */
import * as THREE from 'three';
import type { LevelData } from './LevelTypes';
import type { Palette } from '../gen/palette';
import type { Terrain } from '../gen/Terrain';
import type { Way } from '../gen/Way';
import type { Collider } from '../gen/types';
import type { Particles } from '../gen/Particles';
import type { Atmosphere, Sky } from '../gen/Sky';
import type { Character } from '../gen/CharacterFactory';
import type { BlobShadows } from '../gen/BlobShadows';
import type { PromiseMarkers } from './PromiseMarkers';

export interface World {
  scene: THREE.Scene;
  level: LevelData;
  palette: Palette;
  terrain: Terrain;
  ways: { main: Way; detours: Way[] };
  /** World-space colliders of everything static (scatter, landmarks, waystones). */
  colliders: Collider[];
  particles: Particles;
  npcs: Map<string, Character>;
  /** Per rendered frame: sky, water waves, NPC animation, promise bob and sparkles, particles. */
  update(dt: number, camera: THREE.Camera): void;
  /** Frees everything the build created (geometries, custom materials, shadow maps, bone textures). */
  dispose(): void;
  /** Wall-clock build time in ms (what the player waits behind the loading screen). */
  buildMs: number;

  // ---- additions to the pinned contract (listed in the module report)
  /** Build time spent working (excludes time yielded to the browser), from `Yielder.finish()`. */
  readonly buildWorkMs: number;
  readonly sky: Sky;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  /** The glowing promise scrolls (one InstancedMesh). */
  readonly promises: PromiseMarkers;
  /**
   * Blob shadows under every NPC (GDD 2.11, all qualities; 1 draw call). Characters added later (the player, a
   * walker, companions, crowds) call `blobs.follow(c)` / `blobs.addCrowd(m)`; update() places them each frame.
   */
  readonly blobs: BlobShadows;
  /** Centre the sun's shadow frustum on `p` (player / camera focus), snapped to shadow texels. */
  setShadowFocus(p: THREE.Vector3): void;
  /** 'way' (or 'main') for the main Way, else a detour id. */
  wayById(id: string): Way | null;
}

/** What `buildWorld()` hands over. */
export interface WorldParts {
  scene: THREE.Scene;
  level: LevelData;
  palette: Palette;
  terrain: Terrain;
  ways: { main: Way; detours: Way[] };
  colliders: Collider[];
  particles: Particles;
  npcs: Map<string, Character>;
  sky: Sky;
  atmosphere: Atmosphere;
  waters: ReadonlyArray<{ update(t: number): void }>;
  promises: PromiseMarkers;
  blobs: BlobShadows;
  /** NPCs farther than this from the camera (m) are hidden and not animated. */
  drawDistance: number;
  /** Module dispose functions in creation order. */
  disposers: Array<() => void>;
  buildMs: number;
  buildWorkMs: number;
}

export class WorldImpl implements World {
  readonly scene: THREE.Scene;
  readonly level: LevelData;
  readonly palette: Palette;
  readonly terrain: Terrain;
  readonly ways: { main: Way; detours: Way[] };
  readonly colliders: Collider[];
  readonly particles: Particles;
  readonly npcs: Map<string, Character>;
  readonly sky: Sky;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly promises: PromiseMarkers;
  readonly blobs: BlobShadows;
  readonly buildMs: number;
  readonly buildWorkMs: number;

  private readonly atmosphere: Atmosphere;
  private readonly waters: ReadonlyArray<{ update(t: number): void }>;
  /** Flat list for allocation-free iteration every frame. */
  private readonly npcList: Character[];
  private readonly drawDistance2: number;
  private readonly disposers: Array<() => void>;
  private readonly camPos = new THREE.Vector3();
  private time = 0;
  private disposed = false;

  constructor(parts: WorldParts) {
    this.scene = parts.scene;
    this.level = parts.level;
    this.palette = parts.palette;
    this.terrain = parts.terrain;
    this.ways = parts.ways;
    this.colliders = parts.colliders;
    this.particles = parts.particles;
    this.npcs = parts.npcs;
    this.sky = parts.sky;
    this.atmosphere = parts.atmosphere;
    this.sun = parts.atmosphere.sun;
    this.hemi = parts.atmosphere.hemi;
    this.promises = parts.promises;
    this.blobs = parts.blobs;
    this.waters = parts.waters;
    this.disposers = parts.disposers;
    this.buildMs = parts.buildMs;
    this.buildWorkMs = parts.buildWorkMs;
    this.npcList = [...parts.npcs.values()];
    this.drawDistance2 = parts.drawDistance * parts.drawDistance;
    // Shadows start where the Way starts (the Way is draped, so sample().y is the ground height).
    this.setShadowFocus(this.ways.main.sample(0, this.camPos));
  }

  update(dt: number, camera: THREE.Camera): void {
    if (this.disposed) return;
    this.time += dt;
    this.sky.update(dt, camera);
    for (let i = 0; i < this.waters.length; i++) this.waters[i]!.update(this.time);

    camera.getWorldPosition(this.camPos);
    for (let i = 0; i < this.npcList.length; i++) {
      const c = this.npcList[i]!;
      // Distance culling on the mesh only: scripts hide NPCs through `root.visible`, which is left alone.
      const near = c.root.position.distanceToSquared(this.camPos) <= this.drawDistance2;
      if (c.mesh.visible !== near) {
        c.mesh.visible = near;
        if (c.glowMesh) c.glowMesh.visible = near;
      }
      if (near && c.root.visible) c.update(dt);
    }
    this.blobs.update();

    this.promises.update(this.time, dt, this.camPos, this.particles);
    this.particles.update(dt, camera);
  }

  setShadowFocus(p: THREE.Vector3): void {
    if (!this.disposed) this.atmosphere.focus(p);
  }

  wayById(id: string): Way | null {
    if (id === 'way' || id === 'main') return this.ways.main;
    const index = this.level.detours.findIndex((d) => d.id === id);
    return index >= 0 ? (this.ways.detours[index] ?? null) : null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    runDisposers(this.disposers);
    disposeSceneGraph(this.scene);
    clearScene(this.scene);
    this.npcs.clear();
    this.npcList.length = 0;
    this.colliders.length = 0;
  }
}

// --------------------------------------------------------------------------------------------- disposal

/** Runs dispose functions newest first; one failing never stops the rest. */
export function runDisposers(disposers: Array<() => void>): void {
  for (let i = disposers.length - 1; i >= 0; i--) {
    try {
      disposers[i]!();
    } catch (err) {
      console.error('[world] dispose failed', err);
    }
  }
  disposers.length = 0;
}

/** Materials from src/gen/materials.ts live for the whole app; it names every one `shared:<kind>`. */
export function isSharedMaterial(m: THREE.Material): boolean {
  return m.name.startsWith('shared:');
}

/**
 * Frees every GPU resource reachable from `root`: geometries, non-shared materials (and their textures, also
 * in shader uniforms), instanced-mesh buffers, skeleton bone textures and shadow maps. Safe to run after the
 * owning modules already disposed their parts (three ignores a second dispose).
 */
export function disposeSceneGraph(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.Points || o instanceof THREE.Line) {
      geometries.add(o.geometry as THREE.BufferGeometry);
      const m = o.material as THREE.Material | THREE.Material[];
      if (Array.isArray(m)) for (const x of m) materials.add(x);
      else materials.add(m);
    }
    if (o instanceof THREE.InstancedMesh) o.dispose();
    if (o instanceof THREE.SkinnedMesh) o.skeleton.dispose();
    if (o instanceof THREE.Light) o.dispose(); // DirectionalLight / SpotLight free their shadow maps
  });
  for (const g of geometries) g.dispose();
  for (const m of materials) if (!isSharedMaterial(m)) disposeMaterial(m);
}

function disposeMaterial(m: THREE.Material): void {
  for (const value of Object.values(m)) if (value instanceof THREE.Texture) value.dispose();
  if (m instanceof THREE.ShaderMaterial) {
    for (const u of Object.values(m.uniforms)) {
      const v: unknown = u.value;
      if (v instanceof THREE.Texture) v.dispose();
    }
  }
  m.dispose();
}

/** Empties a scene and drops its fog/background/environment references. */
export function clearScene(scene: THREE.Scene): void {
  scene.clear();
  scene.fog = null;
  scene.background = null;
  scene.environment = null;
}
