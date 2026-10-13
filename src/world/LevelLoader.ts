/**
 * Level files → worlds (GDD 2.12 "World builder", 2.15 "Level file format").
 *
 * - `loadLevel(id)` lazy-imports `content/levels/<id>.json` (one chunk per level) and checks its shape.
 * - `buildWorld(level, quality, onProgress)` assembles the chapter behind the loading screen, time-sliced with
 *   one Yielder (8 ms slices) so neither the page nor the loading bar freezes: atmosphere and sky, the Way and
 *   its detours, terrain, path ribbons, scatter, landmarks and waystones (merged static props), water and mud,
 *   particles, NPCs and promises. Progress is reported 0..1 across the steps and only moves forward.
 *
 * Level `at` positions are [x, lift, z]: y is a height above the ground, which the builder samples. Water
 * `level` is an absolute height. Nothing here holds level coordinates; everything comes from the file.
 */
import * as THREE from 'three';
import { Rng } from '../gen/rng';
import { getPalette } from '../gen/palette';
import { Yielder } from '../gen/yielder';
import { Terrain } from '../gen/Terrain';
import { Way } from '../gen/Way';
import { scatter } from '../gen/Scatter';
import { Sky, applyAtmosphere } from '../gen/Sky';
import { createWater } from '../gen/Water';
import { Particles } from '../gen/Particles';
import { CharacterFactory, type Character } from '../gen/CharacterFactory';
import { BlobShadows } from '../gen/BlobShadows';
import type { Collider } from '../gen/types';
import type { QualityPreset } from '../core/Quality';
import { DEFAULT_WAY_WIDTH, parseLevel, type LevelData } from './LevelTypes';
import { WorldImpl, clearScene, disposeSceneGraph, runDisposers, type World } from './World';
import { PromiseMarkers, type PromiseEntry } from './PromiseMarkers';
import { placeProps } from './placeProps';
import { alongWay, isVec3, landmarkPlacements, waystonePlacements, type WaySet } from './levelPlacements';

export { placeProps } from './placeProps';
export type { Ground, PathLike, PlacedProps, PropPlacement } from './placeProps';

// ------------------------------------------------------------------------------------------------ loading

/** Lazy: each level file becomes its own chunk, fetched only when that chapter loads. */
const LEVEL_FILES = import.meta.glob<unknown>('/content/levels/*.json', { import: 'default' });

/** '1'..'13' → 'ch01'..'ch13'; anything else ('test', 'epilogue', 'ch05') already is the file name. */
export function levelFileId(id: string): string {
  return /^\d{1,2}$/.test(id) ? `ch${id.padStart(2, '0')}` : id;
}

/** Ids of every level file in the build. */
export function levelIds(): string[] {
  return Object.keys(LEVEL_FILES)
    .map((p) => /([^/]+)\.json$/.exec(p)?.[1] ?? '')
    .filter((id) => id !== '');
}

export async function loadLevel(id: string): Promise<LevelData> {
  const fileId = levelFileId(id);
  const load = LEVEL_FILES[`/content/levels/${fileId}.json`];
  if (!load) throw new Error(`[level] there is no content/levels/${fileId}.json`);
  const raw = await load();
  try {
    return parseLevel(raw);
  } catch (err) {
    throw new Error(
      `[level] content/levels/${fileId}.json: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ----------------------------------------------------------------------------------------------- building

const SLICE_MS = 8;
const PARTICLE_SALT = 0x51a7e;
/** Blob-shadow slots beyond the level's NPCs: the player, companions, walkers added after the build. */
const BLOB_SPARE = 32;
/** NPCs with no `at` (companions) wait just ahead of the Way's start, alternating sides (m). */
const NPC_START = { gap: 3, spacing: 1.6, side: 1.1 };

/** Build steps and their share of the bar (terrain and scatter are the heavy ones). */
const STEPS = {
  scene: 3,
  ways: 1,
  terrain: 38,
  paths: 6,
  scatter: 24,
  landmarks: 12,
  water: 3,
  particles: 1,
  npcs: 9,
  promises: 3,
} as const;
type Step = keyof typeof STEPS;

/** Maps per-step progress onto 0..1 and only ever moves forward. */
class Progress {
  private readonly ranges = new Map<Step, [number, number]>();
  private value = 0;

  constructor(private readonly report: (p: number) => void) {
    const total = Object.values(STEPS).reduce((a, b) => a + b, 0);
    let acc = 0;
    for (const [step, weight] of Object.entries(STEPS) as Array<[Step, number]>) {
      this.ranges.set(step, [acc / total, (acc + weight) / total]);
      acc += weight;
    }
  }

  at(step: Step, p: number): void {
    const [a, b] = this.ranges.get(step)!;
    this.set(a + (b - a) * Math.min(1, Math.max(0, p)));
  }

  sub(step: Step): (p: number) => void {
    return (p) => this.at(step, p);
  }

  set(v: number): void {
    if (!(v > this.value)) return;
    this.value = Math.min(1, v);
    try {
      this.report(this.value);
    } catch (err) {
      console.error('[world] onProgress threw', err);
    }
  }
}

export async function buildWorld(
  level: LevelData,
  quality: QualityPreset,
  onProgress: (p: number) => void,
): Promise<World> {
  const wallStart = performance.now();
  const y = new Yielder(SLICE_MS);
  const progress = new Progress(onProgress);
  const pal = getPalette(level.palette);
  // Forks never advance the root, so every part's stream depends only on its salt, not on build order.
  const root = new Rng(level.seed);
  const scene = new THREE.Scene();
  scene.name = `level:${level.id}`;
  const disposers: Array<() => void> = [];
  const colliders: Collider[] = [];

  try {
    // 1. Light, fog and sky.
    const atmosphere = applyAtmosphere(scene, pal);
    disposers.push(() => atmosphere.dispose());
    const sky = new Sky(pal, quality);
    disposers.push(() => sky.dispose());
    scene.add(sky.object);
    progress.at('scene', 1);
    await y.tick();

    // 2. The Way and its detours.
    const width = level.wayWidth ?? DEFAULT_WAY_WIDTH;
    const main = new Way(level.way, width, 'way', 'way');
    const detours = level.detours.map((d) => new Way(d.points, d.width ?? width, 'detour', d.id));
    const set: WaySet = { ways: [main, ...detours], ids: ['way', ...level.detours.map((d) => d.id)] };
    for (const way of set.ways) disposers.push(() => way.dispose()); // frees the ribbon built in step 4
    progress.at('ways', 1);
    await y.tick();

    // 3. Terrain, flattened under every Way (which it then drapes onto the ground).
    const terrain = await Terrain.build(level, [...set.ways], pal, y, progress.sub('terrain'));
    disposers.push(() => terrain.dispose());
    scene.add(terrain.mesh);

    // 4. Path ribbons with edge stones.
    for (let i = 0; i < set.ways.length; i++) {
      const obj = set.ways[i]!.buildMesh(terrain, pal, root.fork(`way:${set.ids[i]}`));
      scene.add(obj);
      progress.at('paths', (i + 1) / set.ways.length);
      await y.tick();
    }

    // 5. Scatter (trees, bushes, grass, rocks... by the level's zone rules).
    const scattered = await scatter(level, terrain, [...set.ways], pal, root.fork('scatter'), quality, y);
    disposers.push(() => scattered.dispose());
    scene.add(scattered.object);
    colliders.push(...scattered.colliders);
    progress.at('scatter', 1);

    // 6. Landmarks and waystones, merged per area and material.
    const placements = [...landmarkPlacements(level, root, set), ...waystonePlacements(level, root, set)];
    const statics = await placeProps(placements, pal, terrain, y, { name: 'landmarks' });
    disposers.push(() => statics.dispose());
    scene.add(statics.object);
    colliders.push(...statics.colliders);
    progress.at('landmarks', 1);

    // 7. Water and mud.
    const waters: Array<ReturnType<typeof createWater>> = [];
    const waterDefs = level.water ?? [];
    for (let i = 0; i < waterDefs.length; i++) {
      const w = waterDefs[i]!;
      const water = createWater({ kind: w.kind, pal, shape: w.shape, r: w.r, size: w.size });
      disposers.push(() => water.dispose());
      water.mesh.position.set(w.x, w.level, w.z);
      scene.add(water.mesh);
      waters.push(water);
      progress.at('water', (i + 1) / waterDefs.length);
      await y.tick();
    }

    // 8. One particle pool for the chapter (1 draw call).
    const particles = new Particles(quality.particlesMax, (level.seed ^ PARTICLE_SALT) >>> 0);
    disposers.push(() => particles.dispose());
    scene.add(particles.object);
    progress.at('particles', 1);

    // 9. NPCs, standing on the ground and looking along the nearest Way.
    const npcs = await spawnNpcs(level, terrain, set, root, y, scene, particles, disposers, progress);
    // Blob shadows under every character on every quality (GDD 2.11): one InstancedMesh, 1 draw call.
    const blobs = new BlobShadows(level.npcs.length + BLOB_SPARE, terrain);
    disposers.push(() => blobs.dispose());
    scene.add(blobs.mesh);
    for (const c of npcs.values()) blobs.follow(c);

    // 10. Promise scrolls (one InstancedMesh).
    const entries: PromiseEntry[] = [];
    for (const p of level.promises) {
      if (!isVec3(p.at)) continue;
      const [x, lift, z] = p.at;
      entries.push({ id: p.id, pos: new THREE.Vector3(x, terrain.heightAt(x, z) + lift, z) });
    }
    const promises = new PromiseMarkers(entries, pal);
    disposers.push(() => promises.dispose());
    scene.add(promises.mesh);
    progress.at('promises', 1);

    const buildWorkMs = y.finish();
    const world = new WorldImpl({
      scene,
      level,
      palette: pal,
      terrain,
      ways: { main, detours },
      colliders,
      particles,
      npcs,
      sky,
      atmosphere,
      waters,
      promises,
      blobs,
      drawDistance: quality.drawDistance,
      disposers,
      buildMs: performance.now() - wallStart,
      buildWorkMs,
    });
    progress.set(1);
    return world;
  } catch (err) {
    // Free whatever was built before the failure, then let the caller report it.
    runDisposers(disposers);
    disposeSceneGraph(scene);
    clearScene(scene);
    throw err;
  }
}

async function spawnNpcs(
  level: LevelData,
  terrain: Terrain,
  set: WaySet,
  root: Rng,
  y: Yielder,
  scene: THREE.Scene,
  particles: Particles,
  disposers: Array<() => void>,
  progress: Progress,
): Promise<Map<string, Character>> {
  const npcs = new Map<string, Character>();
  const main = set.ways[0]!;
  const p = new THREE.Vector3();
  const tan = new THREE.Vector3();
  let waiting = 0;
  for (let i = 0; i < level.npcs.length; i++) {
    const n = level.npcs[i]!;
    let c: Character;
    try {
      c = CharacterFactory.build(n.recipe, root.fork(`npc:${n.id}`));
    } catch (err) {
      console.warn(`[world] NPC "${n.id}": could not build recipe "${n.recipe}"; skipped`, err);
      continue;
    }
    disposers.push(() => c.dispose());

    let x: number;
    let z: number;
    let lift = 0;
    if (isVec3(n.at)) {
      [x, lift, z] = n.at;
    } else {
      // Companions and other NPCs without a spot wait near the start of the Way, on alternate sides.
      const t =
        main.length > 0 ? Math.min(1, (NPC_START.gap + waiting * NPC_START.spacing) / main.length) : 0;
      main.sample(t, p);
      main.tangent(t, tan);
      const side = (waiting % 2 === 0 ? 1 : -1) * NPC_START.side;
      const tl = Math.hypot(tan.x, tan.z) || 1;
      x = p.x - (tan.z / tl) * side;
      z = p.z + (tan.x / tl) * side;
      waiting++;
    }
    c.root.position.set(x, terrain.heightAt(x, z) + lift, z);
    c.root.rotation.y = n.rotY ?? alongWay(set.ways, x, z);
    c.root.name = `npc:${n.id}`;
    c.onSparkle = (at) => particles.emit('sparkle', at, 1); // glowing recipes (Shining Ones)
    scene.add(c.root);
    npcs.set(n.id, c);
    progress.at('npcs', (i + 1) / level.npcs.length);
    await y.tick();
  }
  progress.at('npcs', 1);
  return npcs;
}
