/**
 * Ground surface lookup for CollisionWorld.surfaceAt (footstep sounds, dust colour) below collider tops: water /
 * mud areas, then mud or water zones (or any zone with its own `surface` field), then the Way band 'dirt', else
 * 'grass'. Built once per level.
 */
import type { Way } from '../gen/Way';
import { waterAt, zoneDistance } from '../gen/terrain/zones';
import type { LevelData, LevelZone } from './LevelTypes';
import { isSurface, type SurfaceKind } from './collision-shapes';

const MUD_TYPES = new Set(['mud', 'slough', 'bog', 'bogHole', 'marsh']);
const WATER_TYPES = new Set(['water', 'river', 'stream', 'pond']);
/** The ribbon counts as 'dirt' a little past its drawn edge (edge stones). */
const WAY_EDGE = 0.25;

export class SurfaceMap {
  private readonly level: Pick<LevelData, 'water'>;
  private readonly ways: readonly Way[];
  private readonly zones: Array<{ zone: LevelZone; kind: SurfaceKind }> = [];

  constructor(level: Pick<LevelData, 'zones' | 'water'>, ways: readonly Way[]) {
    this.level = level;
    this.ways = ways;
    for (const zone of level.zones) {
      const own = typeof zone.surface === 'string' && isSurface(zone.surface) ? zone.surface : null;
      const kind = own ?? (MUD_TYPES.has(zone.type) ? 'mud' : WATER_TYPES.has(zone.type) ? 'water' : null);
      if (kind) this.zones.push({ zone, kind });
    }
  }

  /** Surface of the ground itself at (x, z) for feet at height `feet`. */
  at(x: number, z: number, feet: number): SurfaceKind {
    const w = waterAt(this.level as LevelData, x, z);
    if (w && feet <= w.level + 0.05) return w.kind === 'mud' ? 'mud' : 'water';
    for (let i = 0; i < this.zones.length; i++) {
      const s = this.zones[i]!;
      if (zoneDistance(s.zone, x, z, this.ways) <= 0) return s.kind;
    }
    for (let i = 0; i < this.ways.length; i++) {
      const way = this.ways[i]!;
      if (way.distanceWithin(x, z, way.halfWidth + WAY_EDGE) < Infinity) return 'dirt';
    }
    return 'grass';
  }

  dispose(): void {
    this.zones.length = 0;
  }
}
