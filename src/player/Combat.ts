/**
 * The Sword and the Shield (GDD 2.6, 2.7.6 #1-#2, 2.9): combat zones only.
 *
 * - Active when Christian holds the gift and stands in a combat zone (level zone types COMBAT_ZONE_TYPES: the
 *   Ch VIII arena, the Ch IX shadow path) or a script has `engaged` it (the Apollyon fight). `combat:active` tells
 *   the touch buttons (SWORD and SHIELD show only then, src/world/play-gifts.ts).
 * - Sword (LMB / pad RT / SWORD): a bonk-swing ('swing' overlay, whoosh, a sparkle trail). At the blade's pass
 *   (SWORD.impact s in) every hittable target in reach and in front gets `onHit`. One swing per SWORD.cooldown.
 * - Shield (RMB hold / pad LT / SHIELD): the 'block' overlay while held. `block(from)` is how attackers ask:
 *   anything in front of him (±SHIELD.frontDeg) is blocked; raised within the perfect window before the hit
 *   (0.3 s, 0.5 s on Easy) it is a perfect block that bounces fiery darts back.
 * - While the shield is up or a swing runs, he turns to face the nearest target (`player.aim`), so a child never
 *   has to aim the camera to block.
 * Targets register with `addTarget()` (Apollyon's belly, the shadows); the system keeps no list of enemies itself.
 */
import * as THREE from 'three';
import '../audio/events';
import { events } from '../core/Events';
import { services } from '../core/Services';
import type { GameState } from '../core/GameState';
import type { World } from '../world/World';
import type { Zones } from '../world/Zones';
import type { Player } from './Player';

declare module '../core/Events' {
  interface EventMap {
    /** Combat input turned on / off (combat zone entered or left, a fight engaged). */
    'combat:active': { on: boolean };
    /** A sword swing reached its blade pass; `hits` = targets struck. */
    'combat:swing': { hits: number };
    /** Something was stopped by the shield. */
    'combat:block': { perfect: boolean };
  }
}
declare module '../core/Services' {
  interface ServiceMap {
    combat: Combat;
  }
}

/** Level zone types where the Sword and Shield work (GDD 2.6 "combat zones only"). */
export const COMBAT_ZONE_TYPES: readonly string[] = ['arena', 'shadows'];

export const SWORD = { reach: 1.9, frontDeg: 80, cooldown: 0.42, impact: 0.15 } as const;
export const SHIELD = { frontDeg: 75, perfect: 0.3, perfectEasy: 0.5 } as const;
/** Targets further than this are not turned to. */
const FOCUS_RANGE = 10;

export type BlockResult = 'none' | 'block' | 'perfect';

export interface CombatTarget {
  /** Writes the target's centre (world) into `out`. */
  pos(out: THREE.Vector3): THREE.Vector3;
  /** Body radius (m), added to the sword's reach. */
  radius: number;
  /** False: not hittable right now (the player still turns to face it). */
  hittable(): boolean;
  onHit(from: THREE.Vector3): void;
}

export interface CombatOptions {
  player: Player;
  state: GameState;
  world: World;
  zones: Zones;
}

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const cosDeg = (d: number): number => Math.cos((d * Math.PI) / 180);

export class Combat {
  /** Scripts (the Apollyon fight) keep combat on wherever he stands. */
  engaged = false;

  private readonly player: Player;
  private readonly state: GameState;
  private readonly world: World;
  private readonly zones: Zones;
  private readonly targets: CombatTarget[] = [];
  private readonly aimDir = { x: 0, z: 1 };
  private wasActive = false;
  private shieldHeld = false;
  private shieldOverride: boolean | null = null;
  private shieldSince = 0;
  private time = 0;
  private swingT = -1;
  private cooldown = 0;
  private disposed = false;

  constructor(o: CombatOptions) {
    this.player = o.player;
    this.state = o.state;
    this.world = o.world;
    this.zones = o.zones;
    services.register('combat', this);
  }

  /** Sword or Shield usable right now. */
  get active(): boolean {
    if (!this.state.hasGift('sword') && !this.state.hasGift('shield')) return false;
    if (this.engaged) return true;
    for (const type of COMBAT_ZONE_TYPES) if (this.zones.inZone(type)) return true;
    return false;
  }

  get shieldUp(): boolean {
    return this.shieldHeld;
  }

  /** True from a swing's start until its blade pass. */
  get swinging(): boolean {
    return this.swingT >= 0;
  }

  addTarget(t: CombatTarget): () => void {
    this.targets.push(t);
    return () => {
      const i = this.targets.indexOf(t);
      if (i >= 0) this.targets.splice(i, 1);
    };
  }

  /** Scripts and tests: hold the shield up (true), force it down (false), or give it back to input (null). */
  holdShield(on: boolean | null): void {
    this.shieldOverride = on;
  }

  /**
   * An attack from `from` (world) lands on Christian now: blocked when the shield is up and it comes from in front;
   * perfect when the shield went up within the perfect window. Plays the clang / ring.
   */
  block(from: THREE.Vector3): BlockResult {
    if (!this.shieldHeld || this.player.mode !== 'play') return 'none';
    const p = this.player.renderPosition;
    tmp.set(from.x - p.x, 0, from.z - p.z);
    if (tmp.lengthSq() > 1e-6) {
      tmp.normalize();
      if (tmp.dot(this.player.forward) < cosDeg(SHIELD.frontDeg)) return 'none';
    }
    const easy = services.tryGet('settings')?.data.difficulty !== 'normal';
    const perfect = this.time - this.shieldSince <= (easy ? SHIELD.perfectEasy : SHIELD.perfect);
    const at: [number, number, number] = [p.x, p.y + 1, p.z];
    events.emit('sfx', { id: perfect ? 'perfect_block' : 'shield_clang', at });
    this.world.particles.emit('sparkle', tmp2.set(p.x, p.y + 1.1, p.z).addScaledVector(this.player.forward, 0.5), perfect ? 14 : 6);
    events.emit('combat:block', { perfect });
    return perfect ? 'perfect' : 'block';
  }

  /** Starts a sword swing (as if the sword button was pressed). False when it cannot swing now. */
  swing(): boolean {
    if (!this.canSwing()) return false;
    this.swingT = 0;
    this.cooldown = SWORD.cooldown;
    this.player.character.animator.overlay('swing', { fade: 0.06, restart: true });
    const p = this.player.renderPosition;
    events.emit('sfx', { id: 'sword_whoosh', at: [p.x, p.y + 1, p.z] });
    return true;
  }

  update(dt: number): void {
    if (this.disposed) return;
    this.time += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    const active = this.active;
    if (active !== this.wasActive) {
      this.wasActive = active;
      events.emit('combat:active', { on: active });
    }
    const input = services.tryGet('input');
    const playing = this.player.mode === 'play';
    if (active && playing && input?.pressed('sword')) this.swing();
    const wantShield =
      active && playing && this.state.hasGift('shield') && (this.shieldOverride ?? input?.held('shield') ?? false);
    this.setShield(wantShield && !this.swinging);
    if (this.swingT >= 0) this.stepSwing(dt);
    this.updateAim();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.targets.length = 0;
    this.player.aim = null;
    if (services.tryGet('combat') === this) services.unregister('combat');
  }

  // ------------------------------------------------------------------------------------------- inside

  private canSwing(): boolean {
    return (
      !this.disposed &&
      this.state.hasGift('sword') &&
      this.player.mode === 'play' &&
      this.cooldown <= 0 &&
      this.swingT < 0 &&
      !this.player.climbing
    );
  }

  private setShield(on: boolean): void {
    if (on === this.shieldHeld) return;
    this.shieldHeld = on;
    const an = this.player.character.animator;
    if (on) {
      this.shieldSince = this.time;
      an.overlay('block', { fade: 0.08 });
    } else if (an.overlayName === 'block') {
      an.overlay(null, { fade: 0.15 });
    }
  }

  private stepSwing(dt: number): void {
    const before = this.swingT;
    this.swingT += dt;
    // A sparkle trail along the blade's arc.
    const p = this.player.renderPosition;
    const f = this.player.forward;
    const k = Math.min(1, this.swingT / SWORD.impact);
    tmp.set(p.x + f.x * 0.9 - f.z * (0.5 - k), p.y + 1.9 - 1.1 * k, p.z + f.z * 0.9 + f.x * (0.5 - k));
    this.world.particles.emit('sparkle', tmp, 1, { color: '#F6F1D8', spread: 0.05 });
    if (before < SWORD.impact && this.swingT >= SWORD.impact) {
      const hits = this.strike();
      if (hits > 0) events.emit('sfx', { id: 'sword_hit', at: [p.x, p.y + 1, p.z] });
      events.emit('combat:swing', { hits });
      this.swingT = -1;
    }
  }

  /** Every hittable target in reach and in front of him is struck. */
  private strike(): number {
    const p = this.player.renderPosition;
    const f = this.player.forward;
    const cos = cosDeg(SWORD.frontDeg);
    let hits = 0;
    for (const t of [...this.targets]) {
      if (!t.hittable()) continue;
      t.pos(tmp);
      tmp2.set(tmp.x - p.x, 0, tmp.z - p.z);
      const d = tmp2.length();
      if (d - t.radius > SWORD.reach) continue;
      if (d > 0.3 && tmp2.multiplyScalar(1 / d).dot(f) < cos) continue;
      t.onHit(p);
      hits++;
    }
    return hits;
  }

  /** Shield up or mid-swing: turn to the nearest target in range. */
  private updateAim(): void {
    let best: CombatTarget | null = null;
    let bestD = FOCUS_RANGE;
    if (this.shieldHeld || this.swingT >= 0) {
      const p = this.player.renderPosition;
      for (const t of this.targets) {
        t.pos(tmp);
        const d = Math.hypot(tmp.x - p.x, tmp.z - p.z);
        if (d < bestD && d > 0.2) {
          bestD = d;
          best = t;
          this.aimDir.x = (tmp.x - p.x) / d;
          this.aimDir.z = (tmp.z - p.z) / d;
        }
      }
    }
    this.player.aim = best ? this.aimDir : null;
  }
}
