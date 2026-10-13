/**
 * Level file format (GDD 2.15, `content/levels/*.json`). Mirrors ARCHITECTURE.md "Level data" exactly; the named
 * aliases below are conveniences for code that handles one section at a time. Worlds come only from these files
 * (CLAUDE.md rule 5): no level coordinates in TypeScript.
 */
import type { Vec3 } from '../gen/geom';
import { PALETTES, type PaletteId } from '../gen/palette';

export type { Vec3 } from '../gen/geom';

export type StampType = 'hill' | 'valley' | 'plateau' | 'basin' | 'cliff' | 'ridge';

export interface LevelData {
  id: string;
  seed: number;
  palette: PaletteId;
  size: number;
  terrain: {
    base: number;
    noise: { scale: number; height: number; octaves?: number };
    stamps: Array<{
      type: StampType;
      x: number;
      z: number;
      r: number;
      height?: number;
      depth?: number;
      dir?: number;
    }>;
  };
  way: Vec3[];
  wayWidth?: number; // default 3 m
  detours: Array<{ id: string; points: Vec3[]; width?: number }>;
  zones: Array<{
    id: string;
    type: string;
    shape: 'circle' | 'box' | 'way';
    x?: number;
    z?: number;
    r?: number;
    size?: [number, number];
    from?: number;
    to?: number;
    hopeDrain?: number;
    [k: string]: unknown;
  }>;
  scatter: Array<{
    type: string;
    zone?: string;
    density: number;
    minDist?: number;
    slopeMax?: number;
    keepClear?: number;
    scale?: [number, number];
    area?: { x: number; z: number; r: number };
  }>;
  landmarks: Array<{
    type: string;
    id: string;
    at?: Vec3;
    rotY?: number;
    path?: string;
    from?: number;
    to?: number;
    params?: Record<string, number | string | boolean>;
  }>;
  npcs: Array<{ id: string; recipe: string; role?: string; at?: Vec3; rotY?: number }>;
  triggers: Array<{
    id: string;
    shape: 'box' | 'circle';
    at: Vec3;
    size?: Vec3;
    r?: number;
    script: string;
    once?: boolean;
  }>;
  waystones: Array<{ id: string; at: Vec3 }>;
  promises: Array<{ id: string; at: Vec3 }>;
  water?: Array<{
    kind: 'water' | 'mud';
    shape: 'circle' | 'box';
    x: number;
    z: number;
    r?: number;
    size?: [number, number];
    level: number;
  }>;
  ambience: string;
  music: string;
}

export type TerrainStamp = LevelData['terrain']['stamps'][number];
export type DetourDef = LevelData['detours'][number];
export type LevelZone = LevelData['zones'][number];
export type ScatterRule = LevelData['scatter'][number];
export type LevelLandmark = LevelData['landmarks'][number];
export type LevelNpc = LevelData['npcs'][number];
export type LevelTrigger = LevelData['triggers'][number];
export type LevelWaystone = LevelData['waystones'][number];
export type LevelPromise = LevelData['promises'][number];
export type LevelWater = NonNullable<LevelData['water']>[number];

/** Default width of the Way ribbon in metres (ARCHITECTURE: `wayWidth?: number; // default 3 m`). */
export const DEFAULT_WAY_WIDTH = 3;

// ------------------------------------------------------------------------------------------- runtime check

const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isVec3 = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every(isNum);

function list(raw: Record<string, unknown>, key: string, id: string): unknown[] {
  const v = raw[key];
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new Error(`level "${id}": "${key}" must be an array`);
  return v;
}

/**
 * Light runtime check for a level JSON (the deep check is `tools/validate-levels.mjs` at build time). Verifies
 * the fields generation cannot run without, fills missing optional sections with empty lists and returns the
 * value typed as LevelData. Throws a readable Error on anything structurally wrong.
 */
export function parseLevel(raw: unknown): LevelData {
  if (!isObj(raw)) throw new Error('level: not a JSON object');
  const id = typeof raw.id === 'string' ? raw.id : '?';
  const fail = (msg: string): never => {
    throw new Error(`level "${id}": ${msg}`);
  };
  if (id === '?') fail('missing "id"');
  if (!isNum(raw.seed)) fail('"seed" must be a number');
  if (typeof raw.palette !== 'string' || !(raw.palette in PALETTES))
    fail(`unknown palette "${String(raw.palette)}"`);
  if (!isNum(raw.size) || raw.size <= 0) fail('"size" must be > 0');
  const terrain = raw.terrain;
  if (!isObj(terrain)) return fail('"terrain" must be an object');
  const noise = isObj(terrain.noise) ? terrain.noise : { scale: 0.02, height: 0 };
  if (!isNum(noise.scale) || noise.scale <= 0 || !isNum(noise.height))
    fail('"terrain.noise" needs scale > 0 and height');
  const way = raw.way;
  if (!Array.isArray(way) || way.length < 2 || !way.every(isVec3))
    fail('"way" needs at least 2 [x, y, z] points');
  const detours = list(raw, 'detours', id);
  detours.forEach((d, i) => {
    if (!isObj(d) || typeof d.id !== 'string') fail(`detours[${i}] needs an id`);
    const pts = (d as Record<string, unknown>).points;
    if (!Array.isArray(pts) || pts.length < 2 || !pts.every(isVec3))
      fail(`detours[${i}] needs >= 2 [x, y, z] points`);
  });
  return {
    ...(raw as unknown as LevelData),
    terrain: {
      base: isNum(terrain.base) ? terrain.base : 0,
      noise: noise as LevelData['terrain']['noise'],
      stamps: list(terrain, 'stamps', id) as LevelData['terrain']['stamps'],
    },
    detours: detours as LevelData['detours'],
    zones: list(raw, 'zones', id) as LevelData['zones'],
    scatter: list(raw, 'scatter', id) as LevelData['scatter'],
    landmarks: list(raw, 'landmarks', id) as LevelData['landmarks'],
    npcs: list(raw, 'npcs', id) as LevelData['npcs'],
    triggers: list(raw, 'triggers', id) as LevelData['triggers'],
    waystones: list(raw, 'waystones', id) as LevelData['waystones'],
    promises: list(raw, 'promises', id) as LevelData['promises'],
    water: list(raw, 'water', id) as NonNullable<LevelData['water']>,
    ambience: typeof raw.ambience === 'string' ? raw.ambience : '',
    music: typeof raw.music === 'string' ? raw.music : '',
  };
}
