/**
 * Hope, the lantern (GDD 2.7.2): drains in sad and dark places, greys the world when low, and at 0 asks the
 * session for I SHALL ARISE.
 *
 * - Drains: every level zone with a `hopeDrain` (Hope per second; GDD 2.15 level format: the Slough, the Valley of
 *   the Shadow, Doubting Castle, the River, the Danger/Destruction fog...). Overlapping zones do not stack: the
 *   strongest one counts. With the GameState flag `alone` set (Pliable has gone home; the Valley), those zones
 *   drain extra: the zone's `aloneDrain` (Hope/s) or half its `hopeDrain`. The Helmet halves 'shadow' zones
 *   (GDD 2.7.6 "whispers in dark places drain half as much Hope").
 * - On Easy, drains stop at EASY_DRAIN_FLOOR: slow walking alone never ends in I SHALL ARISE.
 * - No drain while a cutscene or dialogue owns the camera (the 'cameraRig' is suspended), during I SHALL ARISE,
 *   with `?god=1`, or while `enabled` is false.
 * - Restoring is other systems calling `GameState.addHope` / `setHope` (waystones, Promises, prayer, companions).
 * - Low Hope (< 30): the world look desaturates smoothly from 1 to 0.35 as Hope goes 30 → 0 (src/gen/fx/WorldFX),
 *   music goes 'sad' once when Hope drops below 30 and back to 'calm' above 40 (hysteresis); `hope:low` tells
 *   companions and the HUD.
 * - Hope 0: `player:arise` once (deferred while a cutscene runs). The session then calls `runArise()`
 *   (src/ui/Arise.ts) and respawns the player at the last waystone with Hope 60; this system re-arms once Hope is
 *   above 0 again.
 *
 * Where the player is: `opts.position` if given, else the follow camera's focus (CameraRig.focus, the player's
 * head), so this system needs no import from the player module. Only x/z are used.
 */
import * as THREE from 'three';
import '../audio/events';
import { events } from '../core/Events';
import { services } from '../core/Services';
import { urlParams } from '../core/Flags';
import type { GameState } from '../core/GameState';
import type { World } from '../world/World';
import type { LevelZone } from '../world/LevelTypes';
import type { Way } from '../gen/Way';
import { WAY_ZONE_RADIUS, zoneCentre, zoneWay } from '../gen/terrain/zones';
import { SATURATION_LOW, applyWorldFx, bindWorldFx, worldFx } from '../gen/fx/WorldFX';

declare module '../core/Events' {
  interface EventMap {
    /** Hope reached 0: the session runs I SHALL ARISE (`runArise`, src/ui/Arise.ts) and respawns the player. */
    'player:arise': void;
    /** Hope fell below HOPE_LOW (low: true) or climbed back above HOPE_RECOVER (low: false). */
    'hope:low': { low: boolean };
  }
}

/** GDD 2.7.2 "Low Hope (<30)". */
export const HOPE_LOW = 30;
/** Hope must climb back above this before the low state ends (music back to 'calm'). */
export const HOPE_RECOVER = 40;
/** Extra drain when alone, as a share of the zone's hopeDrain (unless the zone sets `aloneDrain`). */
export const ALONE_EXTRA = 0.5;
/** Helmet: 'shadow' zones drain this share (GDD 2.7.6). */
const HELMET_SHARE = 0.5;
/**
 * Easy (the default for kids): walking through sad places never puts the lantern out by itself; zone and shadow
 * drains stop at this much Hope. Detours, bonks and sleep can still empty it, and the low-Hope look still shows.
 */
export const EASY_DRAIN_FLOOR = 10;

/** The Hope that drains stop at right now (EASY_DRAIN_FLOOR on Easy, 0 on Normal). */
export function drainFloor(): number {
  return services.tryGet('settings')?.data.difficulty === 'normal' ? 0 : EASY_DRAIN_FLOOR;
}

/** Drains are applied to GameState in steps of this much Hope (fewer hope:changed events). */
const HOPE_STEP = 0.5;

/** World saturation for a Hope value: 1 from 30 up, easing linearly to 0.35 at 0. */
export function saturationForHope(hope: number): number {
  if (hope >= HOPE_LOW) return 1;
  const k = Math.max(0, hope) / HOPE_LOW;
  return SATURATION_LOW + (1 - SATURATION_LOW) * k;
}

export interface HopeOptions {
  /** Writes the player's position into `out` (only x/z are used); null = unknown (no drain this step). */
  position?: (out: THREE.Vector3) => THREE.Vector3 | null;
}

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** A draining zone, pre-solved so the per-step test allocates nothing. */
interface DrainZone {
  readonly id: string;
  readonly type: string;
  readonly drain: number;
  readonly alone: number;
  readonly shape: 'circle' | 'box' | 'way';
  readonly cx: number;
  readonly cz: number;
  readonly r: number;
  readonly hx: number;
  readonly hz: number;
  readonly cos: number;
  readonly sin: number;
  readonly way: Way | null;
  readonly from: number;
  readonly to: number;
}

function drainZone(zone: LevelZone, ways: readonly Way[]): DrainZone | null {
  const drain = num(zone.hopeDrain, 0);
  if (!(drain > 0)) return null;
  const [cx, cz] = zoneCentre(zone);
  const size = zone.size ?? [0, 0];
  const rot = num(zone.rotY, 0);
  const way = zone.shape === 'way' ? zoneWay(zone, ways) : null;
  if (zone.shape === 'way' && !way) return null;
  return {
    id: zone.id,
    type: zone.type,
    drain,
    alone: Math.max(0, num(zone['aloneDrain'], drain * ALONE_EXTRA)),
    shape: zone.shape,
    cx,
    cz,
    r: num(zone.r, zone.shape === 'way' ? WAY_ZONE_RADIUS : 0),
    hx: size[0] / 2,
    hz: size[1] / 2,
    cos: Math.cos(rot),
    sin: Math.sin(rot),
    way,
    from: num(zone.from, 0),
    to: num(zone.to, 1),
  };
}

const wayHit = { t: 0, dist: 0, point: new THREE.Vector3() };

/** Same outline rules as src/gen/terrain/zones.ts zoneDistance() <= 0, without allocating. */
function inside(z: DrainZone, x: number, zz: number): boolean {
  if (z.shape === 'circle') {
    const dx = x - z.cx;
    const dz = zz - z.cz;
    return dx * dx + dz * dz <= z.r * z.r;
  }
  if (z.shape === 'box') {
    const dx = x - z.cx;
    const dz = zz - z.cz;
    return Math.abs(z.cos * dx - z.sin * dz) <= z.hx && Math.abs(z.sin * dx + z.cos * dz) <= z.hz;
  }
  if (!z.way || !z.way.closestWithin(x, zz, z.r, wayHit)) return false;
  return wayHit.t >= z.from && wayHit.t <= z.to;
}

export class HopeSystem {
  /** False stops drains (scripted scenes that keep the camera). Low-Hope look and I SHALL ARISE still run. */
  enabled = true;

  private readonly state: GameState;
  private readonly zones: DrainZone[];
  private readonly position: (out: THREE.Vector3) => THREE.Vector3 | null;
  private readonly pos = new THREE.Vector3();
  private readonly offs: Array<() => void> = [];
  private pending = 0;
  private rate = 0;
  private zone: DrainZone | null = null;
  private low = false;
  private arising = false;
  private disposed = false;

  constructor(state: GameState, world: World, opts: HopeOptions = {}) {
    this.state = state;
    const ways = [world.ways.main, ...world.ways.detours];
    this.zones = [];
    for (const z of world.level.zones) {
      const d = drainZone(z, ways);
      if (d) this.zones.push(d);
    }
    this.position =
      opts.position ??
      ((out) => {
        const rig = services.tryGet('cameraRig');
        return rig ? rig.focus(out) : null;
      });

    // The particles were built before any Hope system: hand them the shared look uniforms. Anything else in the
    // world that is not on the shared materials (e.g. a crowd's own material) is patched too.
    const pm = world.particles.object.material;
    if (pm instanceof THREE.ShaderMaterial) bindWorldFx(pm);
    applyWorldFx(world.scene);

    this.sync(true);
    this.offs.push(events.on('state:reset', () => this.sync(true)));
    this.installDebug();
  }

  /** Hope per second being drained right now (0 when none). */
  get drainPerSecond(): number {
    return this.rate;
  }

  /** True between falling below HOPE_LOW and recovering above HOPE_RECOVER. */
  get lowHope(): boolean {
    return this.low;
  }

  /** True from `player:arise` until Hope is above 0 again. */
  get arisePending(): boolean {
    return this.arising;
  }

  update(dt: number): void {
    if (this.disposed) return;
    const s = this.state;
    const cutscene = services.tryGet('cameraRig')?.suspended === true;

    // Hope 0 → I SHALL ARISE (once; re-armed when the session gives Hope back).
    if (this.arising) {
      if (s.hope > 0) this.arising = false;
    } else if (s.hope <= 0 && !cutscene) {
      this.arising = true;
      this.pending = 0;
      events.emit('player:arise');
    }

    this.zone = null;
    this.rate = this.enabled && !this.arising && !cutscene && !urlParams.god ? this.currentDrain() : 0;
    if (this.rate > 0) {
      this.pending += this.rate * dt;
      if (this.pending >= HOPE_STEP) {
        const room = s.hope - drainFloor();
        if (room > 0) s.addHope(-Math.min(this.pending, room));
        this.pending = 0;
      }
    } else {
      this.pending = 0;
    }

    this.sync(false);
    worldFx.update(dt);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const off of this.offs.splice(0)) off();
    worldFx.reset();
  }

  /** F1 panel (dev / ?debug=1): GDD 2.15 "set Hope", plus the alone flag and a readout. English is fine here. */
  private installDebug(): void {
    const debug = services.tryGet('debug');
    if (!debug) return;
    const s = this.state;
    this.offs.push(
      debug.addReadout('Hope', () => {
        const zone = this.zone ? ` ${this.zone.id} -${this.rate.toFixed(2)}/s` : '';
        return `${s.hope.toFixed(1)}${zone} sat ${worldFx.saturation.toFixed(2)}`;
      }),
      debug.addSlider(
        'Hope',
        'Hope',
        0,
        100,
        1,
        () => s.hope,
        (v) => s.setHope(v),
      ),
      debug.addToggle(
        'Hope',
        'Alone (extra drain)',
        () => s.flag('alone') === true,
        (on) => s.setFlag('alone', on ? true : undefined),
      ),
      debug.addButton('Hope', 'Hope 0 (I SHALL ARISE)', () => s.setHope(0)),
    );
  }

  /** Drain for where the player stands: the strongest zone, plus the alone extra, Helmet halving shadows. */
  private currentDrain(): number {
    if (this.zones.length === 0) return 0;
    const p = this.position(this.pos);
    if (!p) return 0;
    const alone = this.state.flag('alone') === true;
    const helmet = this.state.hasGift('helmet');
    let best = 0;
    for (let i = 0; i < this.zones.length; i++) {
      const z = this.zones[i]!;
      if (!inside(z, p.x, p.z)) continue;
      let d = z.drain + (alone ? z.alone : 0);
      if (helmet && z.type === 'shadow') d *= HELMET_SHARE;
      if (d > best) {
        best = d;
        this.zone = z;
      }
    }
    return best;
  }

  /** Look and music for the current Hope. `snap` jumps the look (new session, loaded save). */
  private sync(snap: boolean): void {
    const hope = this.state.hope;
    worldFx.setSaturation(saturationForHope(hope), snap);
    if (snap && hope > 0) this.arising = false;
    const wasLow = this.low;
    if (!this.low && hope < HOPE_LOW) this.low = true;
    else if (this.low && hope > HOPE_RECOVER) this.low = false;
    if (this.low === wasLow) return;
    events.emit('music:state', { state: this.low ? 'sad' : 'calm' });
    events.emit('hope:low', { low: this.low });
  }
}
