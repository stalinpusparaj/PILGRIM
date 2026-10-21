/**
 * The Apollyon fight (GDD 2.9, Chapter VIII), three phases on the level's 'arena' zone:
 *
 * 1. Paws: he walks up and raises a paw that glows red with a red ring on the ground (0.8 s, 1.6 s on Easy), then
 *    slams. Blocked with the Shield, his belly glow opens for 2 s: a sword hit there counts. 3 hits.
 * 2. Fiery darts: he flies up and throws volleys of 3 slow glowing darts (apollyon-darts.ts) after his belly
 *    brightens. Perfect blocks bounce them back; 3 bounced hits knock him down for a 4 s sword window. 3 hits.
 * 3. The fall: he swoops, throws Christian down; the sword spins away and lands 4 m off in slow motion
 *    (apollyon-sword.ts). "[E] Reach for the sword": 5 s with Timed prompts (else no limit); missing it costs a
 *    hit and the prompt starts again. Reaching it resolves `run()`; the chapter plays the Micah 7:8 line, then
 *    `flyAway()` (he flaps off in a sulk of smoke).
 *
 * Hits cost hearts (src/player/Hearts.ts, `hitCost`: Breastplate and Easy halve them). 0 hearts = I SHALL ARISE
 * and the CURRENT phase starts again (hits of that phase back to 0, hearts full), not the whole fight.
 * The sky darkens with each phase (apollyon-sky.ts). Christian is held inside the arena and cannot walk through
 * Apollyon. Probe for tests: service 'apollyon'.
 */
import * as THREE from 'three';
import '../audio/events';
import { events } from '../core/Events';
import { services } from '../core/Services';
import type { Engine } from '../core/Engine';
import type { Combat } from '../player/Combat';
import { hitCost, type Hearts } from '../player/Hearts';
import { turnToward, yawOf } from '../player/player-move';
import { runArise } from '../ui/Arise';
import type { PlaySession } from '../world/PlaySession';
import { PLAY_ORDER } from '../world/play-loop';
import type { Arena } from './apollyon-arena';
import { ApollyonBody } from './apollyon-body';
import { Darts } from './apollyon-darts';
import { ThrownSword } from './apollyon-sword';
import { ArenaDusk } from './apollyon-sky';
import { FallPhase } from './apollyon-fall';
import { DartsPhase, FIGHT, PHASE_HITS, PawsPhase } from './apollyon-phases';
import { NPC_ORDER, type NPC } from './NPC';

declare module '../core/Events' {
  interface EventMap {
    'apollyon:phase': { phase: ApollyonPhase };
    'apollyon:hit': { phase: ApollyonPhase; hits: number };
  }
}
declare module '../core/Services' {
  interface ServiceMap {
    apollyon: ApollyonFight;
  }
}

export type ApollyonPhase = 'paws' | 'darts' | 'fall' | 'done';
export type ApollyonSub =
  | 'approach' | 'telegraph' | 'open' | 'recover' | 'takeoff' | 'hover' | 'volley' | 'knocked' | 'down'
  | 'swoop' | 'throw' | 'reach' | 'arise' | 'leave' | 'gone';

export { FIGHT, PHASE_HITS } from './apollyon-phases';

/** GDD 2.9: the sky darkens with each phase, and clears as he flies off. */
const DUSK: Record<ApollyonPhase, number> = { paws: 0.35, darts: 0.65, fall: 0.9, done: 0 };

export interface FightOptions {
  engine: Engine;
  session: PlaySession;
  npc: NPC;
  combat: Combat;
  hearts: Hearts;
  arena: Arena;
}

const tmp = new THREE.Vector3();

export class ApollyonFight {
  readonly pos = new THREE.Vector3();
  yaw = 0;
  lift = 0;
  hits = 0;
  bounced = 0;

  readonly o: FightOptions;
  readonly body: ApollyonBody;
  readonly darts: Darts;
  readonly sword: ThrownSword;
  private readonly paws: PawsPhase;
  private readonly dartsPhase: DartsPhase;
  private readonly fall: FallPhase;
  private readonly dusk: ArenaDusk;
  private readonly prev = new THREE.Vector3();
  private readonly offs: Array<() => void> = [];
  private _phase: ApollyonPhase = 'paws';
  private _sub: ApollyonSub = 'approach';
  private t = 0;
  private time = 0;
  private started = false;
  private reached: (() => void) | null = null;
  private left: (() => void) | null = null;
  private disposed = false;

  constructor(o: FightOptions) {
    this.o = o;
    const c = o.npc.character;
    o.npc.scripted = true;
    this.pos.copy(c.root.position);
    this.prev.copy(this.pos);
    this.yaw = c.root.rotation.y;
    const scene = o.session.world.scene;
    this.body = new ApollyonBody(c, scene);
    this.darts = new Darts(scene, o.session.world.particles);
    this.sword = new ThrownSword(scene, o.session.world.particles);
    this.paws = new PawsPhase(this);
    this.dartsPhase = new DartsPhase(this);
    this.fall = new FallPhase(this);
    this.dusk = new ArenaDusk(o.session.world);
    const loop = o.engine.loop;
    this.offs.push(
      loop.add({ update: (dt) => this.update(dt) }, NPC_ORDER + 2),
      loop.add({ render: (a, frameDt) => this.render(a, frameDt) }, PLAY_ORDER.world + 2),
      o.combat.addTarget({
        pos: (out) => (this._sub === 'open' ? this.body.bellyPos(out) : this.chest(out)),
        radius: FIGHT.body,
        hittable: () => this._sub === 'open' || this._sub === 'down',
        onHit: () => this.struck(),
      }),
      events.on('hearts:empty', () => void this.arise()),
    );
    services.register('apollyon', this);
  }

  get phase(): ApollyonPhase {
    return this._phase;
  }

  get sub(): ApollyonSub {
    return this._sub;
  }

  get easy(): boolean {
    return services.tryGet('settings')?.data.difficulty !== 'normal';
  }

  /** Telegraph time: doubled on Easy (GDD 2.9). */
  get tele(): number {
    return FIGHT.telegraph * (this.easy ? 2 : 1);
  }

  /** Starts Phase 1; resolves when Christian reaches his sword in Phase 3. */
  run(): Promise<void> {
    if (!this.started) {
      this.started = true;
      this.setPhase('paws');
    }
    return new Promise((resolve) => {
      this.reached = resolve;
    });
  }

  /** He flaps away in a sulk of smoke and is gone. */
  flyAway(): Promise<void> {
    this.setPhase('done');
    this.enter('leave');
    return new Promise((resolve) => {
      this.left = resolve;
    });
  }

  /** Debug / tests: jump to the start of a phase. */
  skipTo(phase: 'paws' | 'darts' | 'fall'): void {
    this.started = true;
    this.darts.clear();
    this.sword.giveBack();
    this.fall.reset();
    this.setPhase(phase);
  }

  probe(): { phase: ApollyonPhase; sub: ApollyonSub; hits: number; bounced: number; darts: number; dartDist: number } {
    this.o.session.player.character.root.getWorldPosition(tmp).setY(tmp.y + 1.1);
    return {
      phase: this._phase,
      sub: this._sub,
      hits: this.hits,
      bounced: this.bounced,
      darts: this.darts.count,
      dartDist: this.darts.nearest(tmp),
    };
  }

  // ------------------------------------------------------------------------------------------- shared

  /** Into a sub-state (its timer restarts). */
  enter(sub: ApollyonSub): void {
    this._sub = sub;
    this.t = 0;
    if (sub === 'volley') this.dartsPhase.enter();
    if (sub === 'reach' || sub === 'throw' || sub === 'swoop') this.fall.enter(sub);
  }

  get subTime(): number {
    return this.t;
  }

  /** Christian's feet (fixed step). */
  get playerPos(): THREE.Vector3 {
    return this.o.session.player.controller.position;
  }

  /** Apollyon's chest (world). */
  chest(out: THREE.Vector3): THREE.Vector3 {
    const h = this.o.npc.character.height;
    return out.set(this.pos.x, this.pos.y + this.lift + h * 0.55, this.pos.z);
  }

  ground(x: number, z: number): number {
    return this.o.session.world.terrain.heightAt(x, z);
  }

  /** Turn toward Christian (eased). */
  facePlayer(dt: number, rate = 4): void {
    const p = this.playerPos;
    this.yaw = turnToward(this.yaw, yawOf(p.x - this.pos.x, p.z - this.pos.z), dt, rate, 3);
  }

  /** Walk / glide toward (x, z) at `speed`; true once within `stop` m. */
  moveToward(x: number, z: number, speed: number, dt: number, stop = 0.2): boolean {
    tmp.set(x - this.pos.x, 0, z - this.pos.z);
    const d = tmp.length();
    if (d <= stop) return true;
    this.pos.addScaledVector(tmp, Math.min(d - stop, speed * dt) / d);
    this.o.arena.clamp(this.pos, 1.5);
    this.pos.y = this.ground(this.pos.x, this.pos.z);
    return false;
  }

  /** One of his hits lands on Christian (unblocked): hearts, a shove, a thud. */
  hurtPlayer(from: THREE.Vector3): void {
    const s = this.o.session;
    const p = this.playerPos;
    events.emit('sfx', { id: 'bonk', at: [p.x, p.y + 1, p.z] });
    s.world.particles.emit('stars', tmp.set(p.x, p.y + 1.7, p.z), 6);
    s.camera.bump(0.7);
    tmp.set(p.x - from.x, 0, p.z - from.z);
    if (tmp.lengthSq() > 1e-4) {
      p.addScaledVector(tmp.normalize(), 1.2);
      this.o.arena.clamp(p);
      s.col.resolve(p, 0.35, 1.5);
    }
    if (!s.god) this.o.hearts.damage(hitCost(s.state, this.easy ? 'easy' : 'normal'));
  }

  // ------------------------------------------------------------------------------------------- loop

  private update(dt: number): void {
    if (this.disposed || !this.started) return;
    this.t += dt;
    this.time += dt;
    this.prev.copy(this.pos);
    this.prev.y += this.lift;
    if (this._phase === 'paws') this.paws.step(dt);
    else if (this._phase === 'darts') this.dartsPhase.step(dt);
    else if (this._phase === 'fall') this.fall.step(dt);
    else if (this._sub === 'leave') this.stepLeave(dt);
    this.sword.update(dt);
    if (this._phase !== 'done' && this._sub !== 'arise') this.holdPlayer();
    this.animate();
  }

  private render(alpha: number, frameDt: number): void {
    if (this.disposed) return;
    const root = this.o.npc.character.root;
    if (this.started) {
      tmp.copy(this.pos).setY(this.pos.y + this.lift);
      root.position.lerpVectors(this.prev, tmp, Math.max(0, Math.min(1, alpha)));
      root.rotation.y = this.yaw;
    }
    this.body.apply(frameDt, this.time);
    this.dusk.update(frameDt);
  }

  private stepLeave(dt: number): void {
    const b = this.body;
    b.calm();
    b.flap = 2.8;
    this.lift += dt * (2 + this.t * 4);
    this.pos.x += Math.sin(this.yaw + Math.PI) * dt * 3;
    this.pos.z += Math.cos(this.yaw + Math.PI) * dt * 3;
    if (Math.random() < 0.6) this.o.session.world.particles.emit('smoke', this.chest(tmp), 2, { spread: 1 });
    if (this.t >= 2.4) {
      this.o.npc.character.root.visible = false;
      this.enter('gone');
      this.left?.();
      this.left = null;
    }
  }

  /** A sword hit on the belly (Phase 1) or on him lying down (Phase 2). */
  private struck(): void {
    this.hits++;
    this.hurtFx();
    events.emit('apollyon:hit', { phase: this._phase, hits: this.hits });
    if (this.hits >= PHASE_HITS) this.setPhase(this._phase === 'paws' ? 'darts' : 'fall');
    else if (this._sub === 'open') this.enter('recover');
  }

  hurtFx(): void {
    this.o.session.world.particles.emit('sparkle', this.chest(tmp), 16, { spread: 0.6 });
    this.body.jaw = 1;
    events.emit('sfx', { id: 'lion_roar', at: [this.pos.x, this.pos.y + 2, this.pos.z], pitch: 0.7, volume: 0.7 });
  }

  private setPhase(phase: ApollyonPhase): void {
    if (phase !== 'darts') this.darts.clear(); // darts still flying when he is knocked out of the air burn out
    this._phase = phase;
    this.dusk.target = DUSK[phase];
    this.hits = 0;
    this.bounced = 0;
    this.body.calm();
    this.body.flap = 0.3;
    if (phase === 'paws') this.lift = 0;
    if (phase !== 'done') this.enter(phase === 'paws' ? 'approach' : phase === 'darts' ? 'takeoff' : 'swoop');
    events.emit('apollyon:phase', { phase });
  }

  /** Christian stays in the arena and outside Apollyon's body. */
  private holdPlayer(): void {
    const s = this.o.session;
    if (s.player.mode !== 'play') return;
    const p = this.playerPos;
    if (!this.o.arena.contains(p.x, p.z, 4)) {
      this.o.arena.start(p);
      s.teleport(p.x, p.z, this.o.arena.facing);
      return;
    }
    this.o.arena.clamp(p);
    if (this.lift > 1) return;
    tmp.set(p.x - this.pos.x, 0, p.z - this.pos.z);
    const d = tmp.length();
    if (d < FIGHT.body && d > 1e-3) p.addScaledVector(tmp, (FIGHT.body - d) / d);
  }

  private animate(): void {
    const an = this.o.npc.character.animator;
    const moving = Math.hypot(this.pos.x - this.prev.x, this.pos.z - this.prev.z) > 0.01 && this.lift < 0.3;
    an.params.speed = moving ? FIGHT.walk : 0;
    const want = moving ? 'walk' : 'idle';
    if (an.current !== want) an.play(want, { fade: 0.25 });
  }

  /** 0 hearts: I SHALL ARISE, then this phase again from its start. */
  private async arise(): Promise<void> {
    if (this.disposed || this._phase === 'done' || this._sub === 'arise') return;
    const phase = this._phase;
    const s = this.o.session;
    this.enter('arise');
    this.darts.clear();
    s.player.mode = 'locked';
    await runArise({
      respawn: () => {
        this.sword.giveBack();
        this.fall.reset();
        this.o.arena.start(tmp);
        s.teleport(tmp.x, tmp.z, this.o.arena.facing);
        this.o.arena.home(this.pos);
        this.pos.y = this.ground(this.pos.x, this.pos.z);
        this.prev.copy(this.pos);
        this.yaw = this.o.arena.facing + Math.PI;
        this.o.hearts.fill();
      },
    });
    if (this.disposed) return;
    if (s.player.mode === 'locked') s.player.mode = 'play';
    this.setPhase(phase);
  }

  /** Phase 3 is over: the sword is in his hand again. */
  swordReached(): void {
    this.reached?.();
    this.reached = null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const off of this.offs.splice(0)) off();
    this.fall.dispose();
    this.dusk.dispose();
    this.sword.dispose();
    this.darts.dispose();
    this.body.dispose();
    this.o.session.player.aim = null;
    if (services.tryGet('apollyon') === this) services.unregister('apollyon');
  }
}
