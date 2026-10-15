/**
 * Waystones (GDD 2.7.4): the save points along the Way. Every `level.waystones` entry gets an interactable at
 * its stone (the stone itself is a merged landmark prop built by the World).
 *
 * - Verb: "Read the Roll" once Christian has the Roll (also while it is lost under the arbour bench); before the
 *   Cross "Read" (Evangelist's note is the only page) and reading still saves.
 * - While the Roll is lost (GameState.rollLost): using a waystone only shows "You need the Roll".
 * - Reading: the 'read' overlay on Christian, 'roll_unroll' then the 'waystone_save' chime, a sparkle over the
 *   stone, `GameState.setWaystone(id)`, Hope raised to at least 60, autosave (`Save.write('auto', snapshot)`),
 *   toast "The Roll is updated" and `waystone:read` {id}.
 * - `lastWaystone()` is where I SHALL ARISE wakes the player: a standing spot just in front of the last stone
 *   read, facing the Way.
 *
 *   const waystones = new Waystones({ world, player });   // finds 'interactables' and 'state' services
 *   loop: waystones.update(dt) each fixed step
 */
import * as THREE from 'three';
import '../audio/events';
import { events } from '../core/Events';
import { services } from '../core/Services';
import { HOPE_WAYSTONE_FLOOR, type GameState } from '../core/GameState';
import type { Save } from '../core/Save';
import type { Vec3 } from '../audio/types';
import type { Particles } from '../gen/Particles';
import type { Terrain } from '../gen/Terrain';
import type { Way } from '../gen/Way';
import type { LevelData } from '../world/LevelTypes';
import { faceWay, isVec3 } from '../world/levelPlacements';
import type { Interactables, PlayerLike } from '../world/Interactables';

declare module '../core/Services' {
  interface ServiceMap {
    waystones: Waystones;
  }
}

export interface WaystoneWorld {
  readonly level: LevelData;
  readonly terrain: Pick<Terrain, 'heightAt'>;
  readonly ways: { readonly main: Way; readonly detours: readonly Way[] };
  readonly particles: Particles;
}

export interface WaystonesOptions {
  world: WaystoneWorld;
  player: PlayerLike;
  /** Default: the 'interactables' service. */
  interactables?: Interactables;
  /** Default: the 'state' service. */
  state?: GameState;
  /** Default: the 'save' service. */
  save?: Pick<Save, 'write'>;
}

/** Where a waystone stands and where a player waking there stands. */
export interface WaystoneSpot {
  id: string;
  /** Respawn spot: on the ground in front of the stone (m), clear of its collider. */
  pos: THREE.Vector3;
  /** rotation.y that faces away from the stone, towards the Way. */
  facing: number;
}

interface Stone {
  id: string;
  /** The stone's foot (ground level). */
  at: THREE.Vector3;
  spot: WaystoneSpot;
  remove: () => void;
  entry: { verb: string };
}

const USE = { radius: 2.1, height: 1.75 };
/** Respawn spot distance in front of the stone (m): past its 0.62 m deep base and the player's radius. */
const SPOT_AHEAD = 1.4;
/** Seconds the 'read' overlay plays; chime delay after the unroll sound; re-read cooldown. */
const READ_SECONDS = 1.8;
const CHIME_DELAY = 0.45;
const REREAD_COOLDOWN = 1.5;
const SPARKLE = { count: 16, height: 1.45, spread: 0.45 };
const VERB_READ = 'ui.verb.read';
const VERB_READ_ROLL = 'ui.verb.readRoll';

export class Waystones {
  private readonly stones: Stone[] = [];
  private readonly player: PlayerLike;
  private readonly state: GameState;
  private readonly save: Pick<Save, 'write'> | null;
  private readonly particles: Particles;
  private readonly sparkleOpts = { spread: SPARKLE.spread };
  private readonly tmp = new THREE.Vector3();
  private readTimer = 0;
  private reader: PlayerLike['character'] | null = null;
  private chimeTimer = 0;
  private chimeAt: Vec3 = [0, 0, 0];
  private cooldown = 0;
  private disposed = false;

  constructor(o: WaystonesOptions) {
    this.player = o.player;
    this.state = o.state ?? services.get('state');
    this.save = o.save ?? services.tryGet('save') ?? null;
    this.particles = o.world.particles;
    const interactables = o.interactables ?? services.get('interactables');
    const ways = [o.world.ways.main, ...o.world.ways.detours];
    for (const w of o.world.level.waystones) {
      if (typeof w.id !== 'string' || !isVec3(w.at)) continue;
      const [x, lift, z] = w.at;
      const at = new THREE.Vector3(x, o.world.terrain.heightAt(x, z) + lift, z);
      // The prop is placed facing the Way the same way (levelPlacements.waystonePlacements).
      const rot = faceWay(ways, x, z);
      const sx = x + Math.sin(rot) * SPOT_AHEAD;
      const sz = z + Math.cos(rot) * SPOT_AHEAD;
      const spot: WaystoneSpot = {
        id: w.id,
        pos: new THREE.Vector3(sx, o.world.terrain.heightAt(sx, sz), sz),
        facing: rot,
      };
      const entry = {
        id: w.id,
        pos: at,
        radius: USE.radius,
        height: USE.height,
        verb: this.verb(),
        enabled: true,
        onUse: () => this.read(w.id),
      };
      this.stones.push({ id: w.id, at, spot, entry, remove: interactables.add(entry) });
    }
    services.register('waystones', this);
  }

  /** The waystone read last (GameState.waystone) if it is in this level, else null. A fresh copy. */
  lastWaystone(): WaystoneSpot | null {
    const s = this.find(this.state.waystone);
    return s ? { id: s.id, pos: s.spot.pos.clone(), facing: s.spot.facing } : null;
  }

  /** Any waystone of this level by id (a `?waystone=` start), or null. A fresh copy. */
  spot(id: string): WaystoneSpot | null {
    const s = this.find(id);
    return s ? { id: s.id, pos: s.spot.pos.clone(), facing: s.spot.facing } : null;
  }

  get ids(): string[] {
    return this.stones.map((s) => s.id);
  }

  /** What [E] does at a waystone (public for chapter scripts and tests). */
  read(id: string): void {
    const s = this.find(id);
    if (!s || this.disposed) return;
    if (this.state.rollLost) {
      events.emit('hud:toast', { key: 'ui.toast.needRoll' });
      return;
    }
    if (this.cooldown > 0) return;
    this.cooldown = REREAD_COOLDOWN;

    const c = this.player.character;
    c.animator.overlay('read');
    this.reader = c;
    this.readTimer = READ_SECONDS;
    events.emit('sfx', { id: 'roll_unroll', at: [s.at.x, s.at.y + 1, s.at.z] });
    this.chimeAt = [s.at.x, s.at.y + 1, s.at.z];
    this.chimeTimer = CHIME_DELAY;
    this.tmp.set(s.at.x, s.at.y + SPARKLE.height, s.at.z);
    this.particles.emit('sparkle', this.tmp, SPARKLE.count, this.sparkleOpts);

    this.state.setWaystone(id);
    if (this.state.hope < HOPE_WAYSTONE_FLOOR) this.state.setHope(HOPE_WAYSTONE_FLOOR);
    events.emit('waystone:read', { id }); // Include discovery rewards in this checkpoint snapshot.
    this.save?.write('auto', this.state.snapshot()).catch((err: unknown) => {
      console.warn('[waystones] autosave failed', err);
    });
    events.emit('hud:toast', { key: 'ui.toast.rollUpdated' });
  }

  update(dt: number): void {
    if (this.disposed) return;
    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.chimeTimer > 0) {
      this.chimeTimer -= dt;
      if (this.chimeTimer <= 0) events.emit('sfx', { id: 'waystone_save', at: this.chimeAt });
    }
    if (this.readTimer > 0) {
      this.readTimer -= dt;
      if (this.readTimer <= 0) {
        const c = this.reader;
        // Only stop our own overlay, on the same character (an outfit swap builds a new one).
        if (c && c === this.player.character && c.animator.overlayName === 'read') c.animator.overlay(null);
        this.reader = null;
      }
    }
    const verb = this.verb();
    for (let i = 0; i < this.stones.length; i++) this.stones[i]!.entry.verb = verb;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const s of this.stones) s.remove();
    this.stones.length = 0;
    this.reader = null;
    if (services.tryGet('waystones') === this) services.unregister('waystones');
  }

  private verb(): string {
    return this.state.hasRoll || this.state.rollLost ? VERB_READ_ROLL : VERB_READ;
  }

  private find(id: string): Stone | null {
    if (!id) return null;
    for (const s of this.stones) if (s.id === id) return s;
    return null;
  }
}
