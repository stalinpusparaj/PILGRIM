/**
 * Prayer, the gift (GDD 2.6 Q / pad Y / PRAY, 2.7.6 #6): from Chapter VII, anywhere.
 *
 * A prayer kneels Christian into the 'pray' clip and sends out a golden ring of light (PRAYER.radius m), gives
 * +20 Hope, lights the Way ahead (PRAYER.lightAhead m of drifting motes for PRAYER.lightSeconds s) and tells the
 * world with `prayer:burst` {x, y, z, radius}: shadows inside the ring flee for PRAYER.fleeSeconds (src/npc/
 * Shadow.ts), the Ch IX smoking pit parts. Then it rests PRAYER.cooldown s (GDD 2.6: 15 s); pressing during the
 * rest does nothing. Not while a conversation, cutscene or bonk holds him (`player.mode !== 'play'`).
 *
 * The ring is one small mesh with its own material (one draw call while it shows), freed on dispose.
 */
import * as THREE from 'three';
import '../audio/events';
import { events } from '../core/Events';
import { services } from '../core/Services';
import type { GameState } from '../core/GameState';
import type { World } from '../world/World';
import type { Player } from './Player';

declare module '../core/Events' {
  interface EventMap {
    /** A prayer went up at (x, y, z): its light reaches `radius` m. */
    'prayer:burst': { x: number; y: number; z: number; radius: number };
  }
}
declare module '../core/Services' {
  interface ServiceMap {
    prayer: Prayer;
  }
}

export const PRAYER = {
  cooldown: 15,
  radius: 6,
  hope: 20,
  fleeSeconds: 8,
  lightAhead: 25,
  lightSeconds: 10,
} as const;
/** Ring expansion time (s). */
const RING_S = 0.8;
const GOLD = '#FFD978';

export interface PrayerOptions {
  player: Player;
  state: GameState;
  world: World;
}

const tmp = new THREE.Vector3();
const hit = { t: 0, dist: 0, point: new THREE.Vector3() };

export class Prayer {
  private readonly player: Player;
  private readonly state: GameState;
  private readonly world: World;
  private readonly ring: THREE.Mesh;
  private rest = 0;
  private ringT = -1;
  private light = 0;
  private lightFrom = 0;
  private lightWait = 0;
  private disposed = false;

  constructor(o: PrayerOptions) {
    this.player = o.player;
    this.state = o.state;
    this.world = o.world;
    const geo = new THREE.RingGeometry(0.86, 1, 48, 1);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.MeshBasicMaterial({
      color: new THREE.Color(GOLD),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
    });
    this.ring = new THREE.Mesh(geo, m);
    this.ring.name = 'prayer:ring';
    this.ring.visible = false;
    this.ring.renderOrder = 5;
    this.world.scene.add(this.ring);
    services.register('prayer', this);
  }

  /** The gift is held and rested. */
  get ready(): boolean {
    return this.state.hasGift('prayer') && this.rest <= 0;
  }

  /** Seconds until the next prayer (0 = ready). */
  get cooldownLeft(): number {
    return this.rest;
  }

  /** Prays now (as if Q was pressed). False when there is no gift, it is resting, or he is not free to move. */
  pray(): boolean {
    if (this.disposed || !this.ready || this.player.mode !== 'play') return false;
    this.rest = PRAYER.cooldown;
    const p = this.player.renderPosition;
    this.player.character.animator.play('pray', { fade: 0.15 });
    events.emit('sfx', { id: 'prayer_swell', at: [p.x, p.y + 1, p.z] });
    this.state.addHope(PRAYER.hope);
    this.ringT = 0;
    this.ring.visible = true;
    this.ring.position.set(p.x, p.y + 0.15, p.z);
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      tmp.set(p.x + Math.cos(a) * 1.2, p.y + 0.6, p.z + Math.sin(a) * 1.2);
      this.world.particles.emit('sparkle', tmp, 1, { color: GOLD });
    }
    const way = this.world.ways.main;
    way.closest(p.x, p.z, hit);
    this.lightFrom = hit.t;
    this.light = PRAYER.lightSeconds;
    events.emit('prayer:burst', { x: p.x, y: p.y, z: p.z, radius: PRAYER.radius });
    return true;
  }

  /** Debug / tests: ready at once. */
  resetCooldown(): void {
    this.rest = 0;
  }

  update(dt: number): void {
    if (this.disposed) return;
    this.rest = Math.max(0, this.rest - dt);
    if (services.tryGet('input')?.pressed('pray')) this.pray();
    if (this.light > 0) this.stepLight(dt);
  }

  /** Per rendered frame: the ring grows and fades. */
  render(frameDt: number): void {
    if (this.ringT < 0 || this.disposed) return;
    this.ringT += frameDt;
    const k = Math.min(1, this.ringT / RING_S);
    const r = 0.5 + (PRAYER.radius - 0.5) * (1 - (1 - k) * (1 - k));
    this.ring.scale.set(r, 1, r);
    (this.ring.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - k * k);
    if (k >= 1) {
      this.ringT = -1;
      this.ring.visible = false;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.ring.removeFromParent();
    this.ring.geometry.dispose();
    (this.ring.material as THREE.Material).dispose();
    if (services.tryGet('prayer') === this) services.unregister('prayer');
  }

  /** Motes drift up along the Way ahead of where he prayed. */
  private stepLight(dt: number): void {
    this.light -= dt;
    this.lightWait -= dt;
    if (this.lightWait > 0) return;
    this.lightWait = 0.12;
    const way = this.world.ways.main;
    const span = way.length > 0 ? PRAYER.lightAhead / way.length : 0;
    const t = Math.min(1, this.lightFrom + Math.random() * span);
    way.sample(t, tmp);
    tmp.y += 0.3;
    this.world.particles.emit('motes', tmp, 1, { color: GOLD, spread: way.halfWidth });
  }
}
