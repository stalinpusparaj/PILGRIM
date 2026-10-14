/**
 * Zone membership (ARCHITECTURE "Gameplay (Phase 2)"): which of the level's `zones` the player stands in,
 * refreshed every fixed step. Shapes: 'circle' (x/z or `at`, r), 'box' (size, optional rotY) and 'way' (a band
 * `r` metres either side of the main Way or the detour named by `path`, between `from` and `to`). The geometry
 * is the same signed distance the terrain painter and the scatter use (`src/gen/terrain/zones.ts`), so what the
 * player feels matches what they see.
 *
 * - `zone:enter` / `zone:exit` {id, type} fire on change (exits first). A zone is entered at its outline and
 *   left 0.35 m past it, so standing on a border never flickers.
 * - Hazards (GDD 2.7.3: types 'pit', 'ditch', 'bogHole', plus a generic 'hazard'): `zone:hazard` {id, type} fires
 *   once per visit, the first step the player is inside AND on the ground (jumping over a ditch is fine). The
 *   Bonk system (src/player/Bonk.ts) answers it.
 * - Others ask `inZone(type)`, `zoneOf(type)`, `hopeDrain()` or the point query `isTypeAt(type, x, z)`.
 *
 *   const zones = new Zones(world, player);   // or player.controller: anything with a position
 *   loop: zones.update(dt) each fixed step, after the player moved
 *   zones.dispose();
 *
 * Registered as the 'zones' service. F1 adds a readout and a "Show zones" outline toggle (dev only).
 */
import * as THREE from 'three';
import { events } from '../core/Events';
import { services } from '../core/Services';
import { zoneCentre, zoneDistance, zoneWay, WAY_ZONE_RADIUS } from '../gen/terrain/zones';
import type { Way } from '../gen/Way';
import type { LevelData, LevelZone } from './LevelTypes';

declare module '../core/Events' {
  interface EventMap {
    'zone:enter': { id: string; type: string };
    'zone:exit': { id: string; type: string };
    /** The player is on the ground inside a hazard zone (pit, ditch, bog hole): bonk them back (GDD 2.7.3). */
    'zone:hazard': { id: string; type: string };
  }
}

declare module '../core/Services' {
  interface ServiceMap {
    zones: Zones;
  }
}

/** Zone types that bonk the player (GDD 2.7.3). */
export const HAZARD_ZONE_TYPES: readonly string[] = ['pit', 'ditch', 'bogHole', 'hazard'];

/** Metres past the outline before a zone counts as left (hysteresis). */
const EXIT_MARGIN = 0.35;
/** Debug outlines: lift above the ground (m) and spacing of the samples along curves (m). */
const OUTLINE = { lift: 0.25, step: 2, circleSegments: 48 };

/** Whatever the zones follow: a KinematicController, the Player (its controller is read) or a bare position. */
export type ZoneTarget =
  | { readonly position: THREE.Vector3; readonly grounded?: boolean }
  | { readonly controller: { readonly position: THREE.Vector3; readonly grounded: boolean } };

/** The parts of a World the zones read. `scene`/`terrain` are only needed for the debug outlines. */
export interface ZoneWorld {
  readonly level: LevelData;
  readonly ways: { readonly main: Way; readonly detours: readonly Way[] };
  readonly scene?: THREE.Scene;
  readonly terrain?: { heightAt(x: number, z: number): number };
}

export interface ActiveZone {
  readonly id: string;
  readonly type: string;
  /** The zone entry from the level file (hopeDrain, tint and any custom fields). */
  readonly def: LevelZone;
}

export class Zones {
  /** False: membership freezes (cutscenes may switch it off); no events fire. */
  enabled = true;

  private readonly zones: ActiveZone[];
  private readonly ways: Way[];
  private readonly inside: Uint8Array;
  private readonly dist: Float32Array;
  private readonly hazard: Uint8Array;
  private readonly hazardFired: Uint8Array;
  private readonly typeCount = new Map<string, number>();
  /** Zones the target is in, in level order; rebuilt only when membership changes. */
  private readonly activeList: ActiveZone[] = [];
  private readonly world: ZoneWorld;
  private target: ZoneTarget | null;
  private outlines: THREE.LineSegments | null = null;
  private readonly offs: Array<() => void> = [];
  private disposed = false;

  constructor(world: ZoneWorld, target: ZoneTarget | null = null) {
    this.world = world;
    this.target = target;
    this.ways = [world.ways.main, ...world.ways.detours];
    this.zones = world.level.zones
      .filter((z) => typeof z.id === 'string' && typeof z.type === 'string')
      .map((def) => ({ id: def.id, type: def.type, def }));
    const n = this.zones.length;
    this.inside = new Uint8Array(n);
    this.dist = new Float32Array(n);
    this.hazardFired = new Uint8Array(n);
    this.hazard = new Uint8Array(n);
    for (let i = 0; i < n; i++) this.hazard[i] = HAZARD_ZONE_TYPES.includes(this.zones[i]!.type) ? 1 : 0;
    services.register('zones', this);
    this.installDebug();
  }

  setTarget(target: ZoneTarget | null): void {
    this.target = target;
  }

  /** Zones the player is in right now (level order). Do not keep the array: it is reused. */
  get active(): readonly ActiveZone[] {
    return this.activeList;
  }

  inZone(type: string): boolean {
    return (this.typeCount.get(type) ?? 0) > 0;
  }

  inZoneId(id: string): boolean {
    for (let i = 0; i < this.activeList.length; i++) if (this.activeList[i]!.id === id) return true;
    return false;
  }

  /** The first zone of `type` the player is in, or null. */
  zoneOf(type: string): ActiveZone | null {
    for (let i = 0; i < this.activeList.length; i++)
      if (this.activeList[i]!.type === type) return this.activeList[i]!;
    return null;
  }

  /** The strongest `hopeDrain` (Hope per second) among the zones the player is in; 0 when none drains. */
  hopeDrain(): number {
    let best = 0;
    for (let i = 0; i < this.activeList.length; i++) {
      const d = this.activeList[i]!.def.hopeDrain;
      if (typeof d === 'number' && Number.isFinite(d) && d > best) best = d;
    }
    return best;
  }

  /** Point query for any position (NPCs, stepping stones): is (x, z) inside a zone of `type`? */
  isTypeAt(type: string, x: number, z: number): boolean {
    for (let i = 0; i < this.zones.length; i++) {
      const zone = this.zones[i]!;
      if (zone.type === type && zoneDistance(zone.def, x, z, this.ways) <= 0) return true;
    }
    return false;
  }

  /** Fixed step: refresh membership for the target and fire enter / exit / hazard events. */
  update(_dt: number): void {
    if (this.disposed || !this.enabled || !this.target) return;
    const t = this.target;
    const pos = 'controller' in t ? t.controller.position : t.position;
    const grounded = 'controller' in t ? t.controller.grounded : t.grounded !== false;
    const n = this.zones.length;
    for (let i = 0; i < n; i++) this.dist[i] = zoneDistance(this.zones[i]!.def, pos.x, pos.z, this.ways);
    let changed = false;
    // Exits first, so a step that crosses from one zone into a touching one reads exit → enter.
    for (let i = 0; i < n; i++) {
      if (this.inside[i] === 1 && this.dist[i]! > EXIT_MARGIN) {
        this.setInside(i, false);
        changed = true;
      }
    }
    for (let i = 0; i < n; i++) {
      if (this.inside[i] === 0 && this.dist[i]! <= 0) {
        this.setInside(i, true);
        changed = true;
      }
    }
    if (changed) this.rebuildActive();
    for (let i = 0; i < this.zones.length; i++) {
      if (this.hazard[i] === 1 && this.inside[i] === 1 && this.hazardFired[i] === 0 && grounded) {
        this.hazardFired[i] = 1;
        const z = this.zones[i]!;
        events.emit('zone:hazard', { id: z.id, type: z.type });
      }
    }
  }

  /** Forget membership without events (a new level, a teleport the caller handles itself). */
  clear(): void {
    this.inside.fill(0);
    this.hazardFired.fill(0);
    this.typeCount.clear();
    this.activeList.length = 0;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const off of this.offs.splice(0)) off();
    this.showOutlines(false);
    this.clear();
    this.target = null;
    if (services.tryGet('zones') === this) services.unregister('zones');
  }

  // --------------------------------------------------------------------------------------------- private

  private setInside(i: number, on: boolean): void {
    const z = this.zones[i]!;
    this.inside[i] = on ? 1 : 0;
    this.typeCount.set(z.type, Math.max(0, (this.typeCount.get(z.type) ?? 0) + (on ? 1 : -1)));
    if (!on) this.hazardFired[i] = 0;
    events.emit(on ? 'zone:enter' : 'zone:exit', { id: z.id, type: z.type });
  }

  private rebuildActive(): void {
    this.activeList.length = 0;
    for (let i = 0; i < this.zones.length; i++)
      if (this.inside[i] === 1) this.activeList.push(this.zones[i]!);
  }

  private installDebug(): void {
    const debug = services.tryGet('debug');
    if (!debug) return;
    this.offs.push(
      debug.addReadout('Zones', () =>
        this.activeList.length === 0 ? '-' : this.activeList.map((z) => `${z.id} (${z.type})`).join(', '),
      ),
    );
    if (this.world.scene && this.world.terrain) {
      this.offs.push(
        debug.addToggle(
          'Gameplay',
          'Show zones',
          () => this.outlines !== null,
          (v) => this.showOutlines(v),
        ),
      );
    }
  }

  /** Dev only: every zone's outline as lines on the ground (one draw call, built on demand). */
  private showOutlines(on: boolean): void {
    if (!on) {
      if (this.outlines) {
        this.outlines.removeFromParent();
        this.outlines.geometry.dispose();
        (this.outlines.material as THREE.Material).dispose();
        this.outlines = null;
      }
      return;
    }
    const scene = this.world.scene;
    const terrain = this.world.terrain;
    if (this.outlines || !scene || !terrain) return;
    const pos: number[] = [];
    const col: number[] = [];
    const c = new THREE.Color();
    for (const zone of this.zones) {
      c.setHSL(hashHue(zone.type), 0.85, zone.type === 'slough' ? 0.45 : 0.6);
      const loop = outlinePoints(zone.def, this.ways);
      for (let i = 0; i < loop.length; i++) {
        const a = loop[i]!;
        const b = loop[(i + 1) % loop.length]!;
        pos.push(a[0], terrain.heightAt(a[0], a[1]) + OUTLINE.lift, a[1]);
        pos.push(b[0], terrain.heightAt(b[0], b[1]) + OUTLINE.lift, b[1]);
        col.push(c.r, c.g, c.b, c.r, c.g, c.b);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const m = new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true });
    this.outlines = new THREE.LineSegments(g, m);
    this.outlines.name = 'debug:zones';
    this.outlines.renderOrder = 999;
    this.outlines.frustumCulled = false;
    scene.add(this.outlines);
  }
}

function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return (h % 360) / 360;
}

/** A closed outline of a zone in (x, z) for the debug view. */
function outlinePoints(zone: LevelZone, ways: readonly Way[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  if (zone.shape === 'circle') {
    const [cx, cz] = zoneCentre(zone);
    const r = typeof zone.r === 'number' ? zone.r : 0;
    for (let i = 0; i < OUTLINE.circleSegments; i++) {
      const a = (i / OUTLINE.circleSegments) * Math.PI * 2;
      out.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
    }
    return out;
  }
  if (zone.shape === 'box') {
    const [cx, cz] = zoneCentre(zone);
    const hw = (zone.size?.[0] ?? 0) / 2;
    const hd = (zone.size?.[1] ?? 0) / 2;
    const rot = typeof zone.rotY === 'number' ? zone.rotY : 0;
    const co = Math.cos(rot);
    const si = Math.sin(rot);
    // zoneDistance maps world → local with (c·dx − s·dz, s·dx + c·dz); this is its inverse.
    for (const [lx, lz] of [
      [-hw, -hd],
      [hw, -hd],
      [hw, hd],
      [-hw, hd],
    ] as const) {
      out.push([cx + co * lx + si * lz, cz - si * lx + co * lz]);
    }
    return out;
  }
  const way = zoneWay(zone, ways);
  if (!way) return out;
  const r = typeof zone.r === 'number' ? zone.r : WAY_ZONE_RADIUS;
  const from = typeof zone.from === 'number' ? zone.from : 0;
  const to = typeof zone.to === 'number' ? zone.to : 1;
  const n = Math.max(2, Math.ceil((way.length * Math.max(0, to - from)) / OUTLINE.step));
  const p = new THREE.Vector3();
  const tan = new THREE.Vector3();
  const left: Array<[number, number]> = [];
  for (let i = 0; i <= n; i++) {
    const t = from + ((to - from) * i) / n;
    way.sample(t, p);
    way.tangent(t, tan);
    const len = Math.hypot(tan.x, tan.z) || 1;
    const sx = tan.z / len;
    const sz = -tan.x / len;
    out.push([p.x + sx * r, p.z + sz * r]);
    left.push([p.x - sx * r, p.z - sz * r]);
  }
  for (let i = left.length - 1; i >= 0; i--) out.push(left[i]!);
  return out;
}
