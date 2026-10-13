/**
 * Chapter terrain (GDD 2.12 World builder): a heightfield from seeded fbm noise plus shape stamps, flattened
 * along the Way and detours, built time-sliced so the loading bar keeps moving. One flat-shaded, vertex-coloured
 * mesh (1 draw call) that casts and receives shadows. Height queries use the exact triangles the mesh draws.
 */
import * as THREE from 'three';
import { mat } from './materials';
import type { Palette } from './palette';
import type { Yielder } from './yielder';
import type { Way } from './Way';
import type { LevelData } from '../world/LevelTypes';
import { fillHeights, flattenWays, makeGrid, sampleGrid, type Grid } from './terrain/heightfield';
import { buildTerrainGeometry } from './terrain/terrainMesh';

const tmpN = new THREE.Vector3();

export class Terrain {
  readonly mesh: THREE.Mesh;
  /** Map width and depth in metres (centred on the origin). */
  readonly size: number;
  /** Cells per side; vertices per side = segments + 1. */
  readonly segments: number;
  readonly cellSize: number;
  readonly minHeight: number;
  readonly maxHeight: number;
  /** The ways this terrain was flattened for (the Way first). Ribbons read them to keep junctions clean. */
  readonly ways: readonly Way[];
  /** Grid heights, row-major by z then x. Read-only by convention. */
  readonly heights: Float32Array;
  /** Per-vertex 0..1 weight of the main Way's flat band (1 = on the path). */
  readonly wayMask: Float32Array;
  private readonly grid: Grid;

  private constructor(o: {
    mesh: THREE.Mesh;
    grid: Grid;
    heights: Float32Array;
    wayMask: Float32Array;
    ways: readonly Way[];
    minHeight: number;
    maxHeight: number;
  }) {
    this.mesh = o.mesh;
    this.grid = o.grid;
    this.size = o.grid.size;
    this.segments = o.grid.seg;
    this.cellSize = o.grid.cell;
    this.heights = o.heights;
    this.wayMask = o.wayMask;
    this.ways = o.ways;
    this.minHeight = o.minHeight;
    this.maxHeight = o.maxHeight;
  }

  /**
   * Build the terrain for a level. `ways` are the Way and detours (already constructed from the level); they are
   * flattened into the ground and then draped onto it (their `sample().y` becomes the ground height).
   * Progress runs 0 → 1: heights 0-0.45, flattening 0.45-0.65, mesh 0.65-1.
   */
  static async build(
    level: LevelData,
    ways: Way[],
    pal: Palette,
    y: Yielder,
    onProgress?: (p: number) => void,
  ): Promise<Terrain> {
    const report = onProgress ?? ((): void => undefined);
    const grid = makeGrid(level.size);
    const count = (grid.seg + 1) * (grid.seg + 1);
    const heights = new Float32Array(count);
    const wayMask = new Float32Array(count);
    const detourMask = new Float32Array(count);

    await fillHeights(heights, grid, level, y, (p) => report(0.45 * p));
    await flattenWays(heights, grid, ways, wayMask, detourMask, y, (p) => report(0.45 + 0.2 * p));
    const built = await buildTerrainGeometry(
      { h: heights, g: grid, level, pal, ways, wayMask, detourMask },
      y,
      (p) => report(0.65 + 0.35 * p),
    );

    const mesh = new THREE.Mesh(built.geometry, mat('lambert'));
    mesh.name = 'terrain';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();

    const terrain = new Terrain({
      mesh,
      grid,
      heights,
      wayMask,
      ways: [...ways.filter((w) => w.kind === 'way'), ...ways.filter((w) => w.kind !== 'way')],
      minHeight: built.minHeight,
      maxHeight: built.maxHeight,
    });
    const at = (x: number, z: number): number => terrain.heightAt(x, z);
    for (const w of ways) w.drape(at);
    report(1);
    return terrain;
  }

  /** Ground height at (x, z), interpolated on the drawn triangles; clamped to the map edge outside it. */
  heightAt(x: number, z: number): number {
    return sampleGrid(this.heights, this.grid, x, z);
  }

  /** Smoothed ground normal (central differences over half a cell). */
  normalAt(x: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    const e = this.grid.cell * 0.5;
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return out.set(-hx, 2 * e, -hz).normalize();
  }

  /** Ground slope in degrees (0 = flat). */
  slopeAt(x: number, z: number): number {
    const n = this.normalAt(x, z, tmpN);
    return (Math.acos(Math.min(1, n.y)) * 180) / Math.PI;
  }

  /** True when (x, z) lies on the map (with an optional inset margin in metres). */
  contains(x: number, z: number, margin = 0): boolean {
    const h = this.grid.half - margin;
    return x >= -h && x <= h && z >= -h && z <= h;
  }

  /** Frees the geometry (the material is shared). Ways are owned and disposed by whoever built them. */
  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
  }
}
