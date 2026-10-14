/**
 * Bonks (GDD 2.7.3, "no deaths"): falling into a bog hole, a ditch or a pit, dropping below the terrain floor,
 * leaving the map or being hit by an arrow is a cartoon bonk: a puff of dust, the player pops back to the last
 * safe spot on the Way (no screen fade; the camera snaps), sits down dazed with stars circling the head, Hope -5,
 * and the toast "Oops! Back on the Way." Input is locked for about 1.2 s. Emits 'player:bonk' { reason }.
 *
 * Safe spots: every 0.5 s the player's position is remembered when they have stood on the ground for a moment,
 * on the main Way's band (the ribbon and its edge stones), outside every hazard zone. A short history is kept so
 * the pop-back never lands on the lip of the hole just fallen into (the newest spot at least 2.5 m away wins).
 *
 * Hazard zones come from Zones (src/world/Zones.ts): 'zone:hazard' fires the first step the player is on the ground
 * inside a pit, ditch or bog hole, so jumping over a ditch works. 'zone:enter' / 'zone:exit' are tracked too: no
 * safe spot is taken inside a hazard, and standing in one after an ignored bonk (a cutscene, the grace time)
 * still bonks once the feet are down.
 */
import * as THREE from 'three';
import '../audio/events';
import { events } from '../core/Events';
import { services } from '../core/Services';
import type { CameraRig } from '../core/CameraRig';
import type { GameState } from '../core/GameState';
import type { World } from '../world/World';
import type { Player } from './Player';
import type { PlayerAnim } from './player-anim';
import { yawOf } from './player-move';

export type BonkReason = 'pit' | 'ditch' | 'bogHole' | 'hazard' | 'fall' | 'arrow' | 'trip' | 'hit';

/** Zone types that bonk (GDD 2.7.3). 'hazard' is a generic one for chapter scripts. */
export const BONK_ZONE_TYPES: readonly BonkReason[] = ['pit', 'ditch', 'bogHole', 'hazard'];

declare module '../core/Events' {
  interface EventMap {
    /** The player bonked (GDD 2.7.3) and pops back to the last safe spot on the Way. */
    'player:bonk': { reason: BonkReason };
  }
}

export const BONK = {
  hope: -5,
  /** Input locked for this long from the bonk (s). */
  lock: 1.2,
  /** The player vanishes in a dust puff for this long before popping back (s). */
  poof: 0.2,
  /** After a bonk ends, ignore new ones for this long (s). */
  grace: 0.4,
  /** Safe-spot sampling period (s), ground time needed before a spot counts (s), spots remembered. */
  sample: 0.5,
  settle: 0.25,
  history: 8,
  /** The Way's band for safe spots: its half width plus a little of the edge (m). */
  bandPad: 0.25,
  /** Prefer a pop-back spot at least this far (m, horizontal) from where the bonk happened. */
  clearance: 2.5,
  /** Below the terrain by this much (m) = fell through the floor. */
  floorDrop: 3,
  /** Inside a hazard zone and this close to (or below) the ground there = in the hole (m). */
  hazardFeet: 0.25,
  /** 'fall' / 'trip' clip playback speeds, so the sit-down fits the lock. */
  fallSpeed: 1.8,
  tripSpeed: 2.3,
  /** Stars appear this long after the pop (the bump on the bottom), and ring the head this far (× height) above
   *  its bone, following it for `starsLife` s (the 'stars' preset lives at most 1.9 s). */
  starsAt: 0.24,
  starsAbove: 0.36,
  starsLife: 2,
  dust: { at: 20, pop: 10 },
} as const;

const tmp = new THREE.Vector3();
const spot = new THREE.Vector3();

type Phase = 'idle' | 'poof' | 'pop';

function isHazard(type: string): type is BonkReason {
  return (BONK_ZONE_TYPES as readonly string[]).includes(type);
}

export class Bonk {
  /** False (god mode, F1): hazards and arrows do nothing; only falling out of the world still pops back. */
  enabled = true;
  /** Bonks so far (tests / debug). */
  count = 0;
  /** Last reason, for debug readouts. */
  lastReason: BonkReason | null = null;

  private phase: Phase = 'idle';
  private t = 0;
  private grace = 0;
  private reason: BonkReason = 'fall';
  private restoreMode = false;
  private starsDone = false;
  private sampleT = 0;
  private groundedFor = 0;
  /** Ring of safe spots: x, y, z, yaw. */
  private readonly ring = new Float32Array(BONK.history * 4);
  private ringCount = 0;
  private ringHead = 0;
  private readonly hazards = new Map<string, BonkReason>();
  /** Live centre of the bonk stars (the particles follow it), kept over the head while they live. */
  private readonly starsCentre = new THREE.Vector3();
  private starsLeft = 0;
  private readonly offs: Array<() => void> = [];

  constructor(
    private readonly player: Player,
    private readonly anim: PlayerAnim,
    private readonly world: World,
    private readonly state: GameState,
  ) {
    this.offs.push(
      events.on('zone:enter', (z) => {
        if (isHazard(z.type)) this.hazards.set(z.id, z.type);
      }),
      events.on('zone:exit', (z) => {
        this.hazards.delete(z.id);
      }),
      events.on('zone:hazard', (z) => {
        if (!isHazard(z.type)) return;
        this.hazards.set(z.id, z.type);
        this.bonk(z.type);
      }),
    );
  }

  /** True while the player has vanished in the dust puff (the Player freezes physics). */
  get frozen(): boolean {
    return this.phase === 'poof';
  }

  /** True from the bonk until input comes back. */
  get active(): boolean {
    return this.phase !== 'idle';
  }

  /**
   * Someone else takes over the input lock this bonk holds (I SHALL ARISE when the bonk's Hope -5 emptied Hope): the
   * bonk will not give control back when it ends. True when there was a lock to hand over.
   */
  handOverLock(): boolean {
    const had = this.phase !== 'idle' && this.restoreMode && this.player.mode === 'locked';
    this.restoreMode = false;
    return had;
  }

  /** Remembered safe spots (debug). */
  get safeSpots(): number {
    return this.ringCount;
  }

  /** The newest safe spot (or null), written to `out`. */
  lastSafe(out: THREE.Vector3): THREE.Vector3 | null {
    if (this.ringCount === 0) return null;
    const i = ((this.ringHead - 1 + BONK.history) % BONK.history) * 4;
    return out.set(this.ring[i]!, this.ring[i + 1]!, this.ring[i + 2]!);
  }

  /** First safe spot: the spawn if it is on the Way, else the closest point of the Way to it. */
  seed(p: THREE.Vector3, facing: number): void {
    this.ringCount = 0;
    this.ringHead = 0;
    const way = this.world.ways.main;
    if (way.closestWithin(p.x, p.z, way.halfWidth)) {
      this.push(p.x, p.y, p.z, facing);
      return;
    }
    const c = way.closest(p.x, p.z);
    const tan = way.tangent(c.t, tmp);
    const y = this.world.terrain.heightAt(c.point.x, c.point.z);
    this.push(c.point.x, y, c.point.z, yawOf(tan.x, tan.z));
  }

  /** Forget hazard membership and safe spots after a teleport the player did not walk (waystone respawn). */
  reseed(p: THREE.Vector3, facing: number): void {
    this.hazards.clear();
    this.seed(p, facing);
  }

  /**
   * Bonk now. Ignored during cutscenes, while a bonk is running, just after one and (except 'fall') while
   * disabled. Returns true if it happened.
   */
  bonk(reason: BonkReason): boolean {
    if (this.phase !== 'idle' || this.grace > 0 || this.player.mode === 'cutscene') return false;
    if (!this.enabled && reason !== 'fall') return false;
    const pos = this.player.controller.position;
    this.phase = 'poof';
    this.t = 0;
    this.reason = reason;
    this.lastReason = reason;
    this.count++;
    this.starsDone = false;
    this.restoreMode = this.player.mode === 'play';
    if (this.restoreMode) this.player.mode = 'locked';
    this.world.particles.emit('dust', pos, BONK.dust.at);
    events.emit('sfx', { id: 'bonk', at: [pos.x, pos.y, pos.z] });
    this.player.character.root.visible = false;
    events.emit('player:bonk', { reason });
    return true;
  }

  /** Fixed step: the bonk sequence, hazard and floor checks, safe-spot sampling. */
  update(dt: number): void {
    if (this.grace > 0) this.grace = Math.max(0, this.grace - dt);
    if (this.starsLeft > 0) this.starsLeft -= dt;
    if (this.phase === 'poof') {
      this.t += dt;
      if (this.t >= BONK.poof) this.pop();
      return;
    }
    if (this.phase === 'pop') {
      this.t += dt;
      if (!this.starsDone && this.t >= BONK.starsAt) this.stars();
      if (this.t >= BONK.lock - BONK.poof) this.finish();
      return;
    }
    if (this.player.mode === 'cutscene') return;
    if (this.checkHazards()) return;
    this.sample(dt);
  }

  /** Per rendered frame, after the character has animated: the stars stay over his head as he sits and gets up. */
  render(): void {
    if (this.starsLeft > 0) this.placeStars();
  }

  dispose(): void {
    for (const off of this.offs.splice(0)) off();
    this.hazards.clear();
    if (this.phase !== 'idle') this.player.character.root.visible = true;
    this.phase = 'idle';
  }

  // ------------------------------------------------------------------------------------------- inside

  /** Hazard zones, falling through the floor, leaving the map. True when a bonk started. */
  private checkHazards(): boolean {
    const c = this.player.controller;
    const p = c.position;
    const terrain = this.world.terrain;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) return this.bonk('fall');
    if (!terrain.contains(p.x, p.z)) return this.bonk('fall'); // off the map (the controller keeps it on)
    const ground = terrain.heightAt(p.x, p.z);
    if (p.y < ground - BONK.floorDrop) return this.bonk('fall');
    if (this.hazards.size > 0 && (c.grounded || p.y < ground + BONK.hazardFeet)) {
      let reason: BonkReason = 'hazard';
      for (const r of this.hazards.values()) reason = r;
      return this.bonk(reason);
    }
    return false;
  }

  private sample(dt: number): void {
    const c = this.player.controller;
    this.groundedFor = c.grounded ? this.groundedFor + dt : 0;
    this.sampleT -= dt;
    if (this.sampleT > 0) return;
    this.sampleT = BONK.sample;
    if (this.player.mode !== 'play' || this.groundedFor < BONK.settle || this.hazards.size > 0) return;
    const p = c.position;
    const way = this.world.ways.main;
    if (!way.closestWithin(p.x, p.z, way.halfWidth + BONK.bandPad)) return;
    this.push(p.x, p.y, p.z, this.player.facing);
  }

  private push(x: number, y: number, z: number, yaw: number): void {
    const i = this.ringHead * 4;
    this.ring[i] = x;
    this.ring[i + 1] = y;
    this.ring[i + 2] = z;
    this.ring[i + 3] = yaw;
    this.ringHead = (this.ringHead + 1) % BONK.history;
    this.ringCount = Math.min(BONK.history, this.ringCount + 1);
  }

  /** Newest spot at least `clearance` from the bonk, else the farthest one. Writes `spot`, returns the yaw. */
  private pickSpot(from: THREE.Vector3): number | null {
    if (this.ringCount === 0) return null;
    let best = -1;
    let bestD = -1;
    for (let k = 1; k <= this.ringCount; k++) {
      const i = ((this.ringHead - k + BONK.history) % BONK.history) * 4;
      const dx = this.ring[i]! - from.x;
      const dz = this.ring[i + 2]! - from.z;
      const d = dx * dx + dz * dz;
      if (d >= BONK.clearance * BONK.clearance) {
        best = i;
        break;
      }
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    spot.set(this.ring[best]!, this.ring[best + 1]!, this.ring[best + 2]!);
    return this.ring[best + 3]!;
  }

  /** Pop back: teleport, camera snap, sit down dazed, dust, Hope -5, toast. */
  private pop(): void {
    const pl = this.player;
    this.phase = 'pop';
    this.t = 0;
    let yaw = this.pickSpot(pl.controller.position);
    if (yaw === null) {
      this.seed(pl.controller.position, pl.facing);
      yaw = this.pickSpot(pl.controller.position) ?? pl.facing;
    }
    this.hazards.clear(); // Zones re-reports membership at the new spot
    pl.teleport(spot, yaw);
    pl.character.root.visible = true;
    snapCamera();
    const trip = this.reason === 'trip' || this.reason === 'arrow';
    this.anim.hold(trip ? 'trip' : 'fall', trip ? BONK.tripSpeed : BONK.fallSpeed, 0);
    this.world.particles.emit('dust', spot, BONK.dust.pop);
    if (this.enabled) this.state.addHope(BONK.hope);
    events.emit('hud:toast', { key: 'ui.toast.bonk' });
  }

  private stars(): void {
    this.starsDone = true;
    this.starsLeft = BONK.starsLife;
    const at = this.placeStars();
    this.world.particles.emit('stars', at, 6, { follow: at });
    events.emit('sfx', { id: 'stars', at: [at.x, at.y, at.z] });
  }

  private placeStars(): THREE.Vector3 {
    const c = this.player.character;
    const at = this.starsCentre;
    const h = c.bones['head'];
    if (h) h.getWorldPosition(at);
    else at.copy(c.root.position).setY(c.root.position.y + c.height * 0.6);
    at.y += c.height * BONK.starsAbove;
    return at;
  }

  private finish(): void {
    this.phase = 'idle';
    this.grace = BONK.grace;
    this.groundedFor = 0;
    this.sampleT = BONK.sample;
    this.anim.release();
    if (this.restoreMode && this.player.mode === 'locked') this.player.mode = 'play';
    this.restoreMode = false;
  }
}

/** The follow camera (src/player/Camera.ts) jumps straight to its resting place behind the player. */
function snapCamera(): void {
  const rig = services.tryGet('cameraRig') as (CameraRig & { snap?: () => void }) | undefined;
  rig?.snap?.();
}
