/**
 * The Slough of Despond (GDD 2.10 Ch II, 2.7.5): sinking in the mud and the hidden stepping stones.
 *
 * Sinking, inside any zone of type 'slough' (Zones) and not on a risen stone:
 * - walking sinks Christian slowly, running (or trying to: holding the fast-walk control) sinks him
 *   faster, standing still keeps him where he is; a hop pulls him up a little. At most 0.55 m (SINK_MAX). Out
 *   of the mud or on the stones he rises back out.
 * - he moves at 65% speed (`player.speedScale` 0.65, eased in and out); risen stones give full speed back.
 * - the sink is drawn by lowering the character's root bone (never animated, so this does not depend on system
 *   order), eased per rendered frame; footfalls throw mud splashes, each deeper step gives a 'mud_slurp' and
 *   so does pulling free.
 * - standing still for 2 s in the mud reveals the nearest hidden stepping stones (`autoReveal`, on by default;
 *   only while `player.mode === 'play'`), and so does reading a Promise (`promise:read`) in or near the bog.
 *   Chapter scripts can call `reveal()` (Help showing the steps). A revealed set is remembered in GameState
 *   (flag `steps.<id>`), so a save keeps it up. Stones: see slough-steps.ts.
 *
 * Mud surfaces: the player walks ON a mud surface (`level.water` kind 'mud'), not on the basin floor under it.
 * When the CollisionWorld's ground at a mud body's centre is below its surface, a walkable floor collider at
 * the surface is added for it (DECISIONS: the sink is a visual offset from the surface).
 *
 *   const slough = new Slough({ world, col, player });   // 'zones' service by default; registers 'slough'
 *   loop: slough.update(dt) each fixed step (after Zones), slough.render(alpha, frameDt) per frame
 *   slough.dispose();
 */
import * as THREE from 'three';
import '../audio/events';
import { events } from '../core/Events';
import { services } from '../core/Services';
import { PALETTES } from '../gen/palette';
import { waterAt } from '../gen/terrain/zones';
import type { Collider } from '../gen/types';
import type { Character } from '../gen/CharacterFactory';
import type { PlayerLike } from './Interactables';
import type { Zones } from './Zones';
import { SteppingStones, type ColliderHost, type StepsWorld } from './slough-steps';

export type { ColliderHost } from './slough-steps';

declare module '../core/Services' {
  interface ServiceMap {
    slough: Slough;
  }
}

/** Deepest visual sink (m). */
export const SINK_MAX = 0.55;
export const SLOUGH_ZONE = 'slough';

const SINK = {
  /** m/s while walking, running, rising out, and while in the air (a hop pulls you up). */
  walk: 0.09,
  run: 0.3,
  rise: 0.8,
  air: 0.6,
  /** Horizontal speeds (m/s): below `still` counts as standing still; above `runSpeed` as running (mud speeds). */
  still: 0.25,
  runSpeed: 2.3,
  /** Player speed multiplier in the mud and how fast it eases (per second). */
  speedScale: 0.65,
  speedEase: 2.5,
  /** A 'mud_slurp' each time the sink passes another band this deep (m), at most every `slurpGap` s. */
  slurpBand: 0.15,
  slurpGap: 0.5,
  /** Visual follow rate (1/s) of the drawn sink towards the gameplay depth. */
  showRate: 7,
  /** A jump of more than this in one step is a teleport (respawn): the sink resets at once (m). */
  teleport: 3,
};
const REVEAL = { still: 2, range: 40, promiseRange: 40 };
const SPLASH = { step: 3, land: 10, spread: 0.25 };
/** Mud floors reach this far down (m): always below the basin floor. */
const MUD_FLOOR_DEPTH = 6;
/** Ground at a mud body's edge should be no lower than this under its surface (the controller's step, m). */
const RIM_STEP = 0.3;

export type SloughWorld = StepsWorld;

/** GameState flag that remembers a revealed set of steps across saves. */
export function stepsFlag(id: string): string {
  return `steps.${id}`;
}

export interface SloughOptions {
  world: SloughWorld;
  col: ColliderHost;
  player: PlayerLike;
  /** Default: the 'zones' service. */
  zones?: Zones;
}

export class Slough {
  /** Standing still in the mud for 2 s reveals the steps. Chapter scripts may hold it off until a beat. */
  autoReveal = true;

  private readonly world: SloughWorld;
  private readonly col: ColliderHost;
  private readonly player: PlayerLike;
  private readonly zones: Zones;
  private readonly stones: SteppingStones;
  private readonly floors: number[] = [];
  private readonly offs: Array<() => void> = [];
  private readonly last = new THREE.Vector3();
  private readonly splashAt = new THREE.Vector3();
  private readonly splashOpts: { dir: THREE.Vector3; color: string; spread: number };
  private depthM = 0;
  private shown = 0;
  private snapShown = false;
  private sinkable = false;
  private onStoneNow = false;
  private stillTime = 0;
  private band = 0;
  private slurpCooldown = 0;
  private wasGrounded = true;
  private lastSteps = -1;
  private hasLast = false;
  private ownsSpeed = false;
  private scale = 1;
  private boneChar: Character | null = null;
  private bone: THREE.Bone | null = null;
  private boneBaseY = 0;
  private disposed = false;

  constructor(o: SloughOptions) {
    this.world = o.world;
    this.col = o.col;
    this.player = o.player;
    this.zones = o.zones ?? services.get('zones');
    const pal = o.world.palette;
    const mud = pal.accents['mud'] ?? PALETTES.slough.accents['mud'] ?? pal.ground.low;
    this.splashOpts = { dir: new THREE.Vector3(0, 1, 0), color: mud, spread: SPLASH.spread };
    this.addMudFloors();
    this.stones = new SteppingStones(
      o.world,
      o.col,
      (x, z) => this.zones.isTypeAt(SLOUGH_ZONE, x, z) || this.mudLevelAt(x, z) > -Infinity,
      (x, z) => this.mudLevelAt(x, z),
    );
    // Steps a save remembers as revealed are up from the start.
    const state = services.tryGet('state');
    this.stones.sets.forEach((s, i) => {
      if (state?.flag(stepsFlag(s.id)) === true) this.stones.reveal(i, 0, 0, true);
    });
    this.offs.push(events.on('promise:read', () => this.revealNear(REVEAL.promiseRange)));
    services.register('slough', this);
    this.installDebug();
  }

  /** Current sink depth (m, 0..SINK_MAX). */
  get depth(): number {
    return this.depthM;
  }

  /** In the mud and not on a stone (slowed, sinking when moving). */
  get sinking(): boolean {
    return this.sinkable;
  }

  get onStone(): boolean {
    return this.onStoneNow;
  }

  /** Ids of the stepping-stone sets ('steps' landmarks) in this level. */
  get stepSets(): string[] {
    return this.stones.sets.map((s) => s.id);
  }

  isRevealed(id: string): boolean {
    return this.stones.isRevealed(id);
  }

  /** Raise the stepping stones: one set by id, or every hidden set. The ripple starts at the player. */
  reveal(id?: string): void {
    this.stones.sets.forEach((s, i) => {
      if (id === undefined || s.id === id) this.raise(i);
    });
  }

  update(dt: number): void {
    if (this.disposed) return;
    const ctl = this.player.controller;
    const pos = ctl.position;
    // Speed from the feet's own travel, not the controller's velocity: in a cutscene the controller is not
    // stepped and its velocity is stale.
    let speed = 0;
    if (this.hasLast) {
      const d2 = (pos.x - this.last.x) ** 2 + (pos.z - this.last.z) ** 2;
      if (d2 > SINK.teleport * SINK.teleport) {
        this.depthM = 0;
        this.snapShown = true;
        this.stillTime = 0;
      } else if (dt > 0) {
        speed = Math.sqrt(d2) / dt;
      }
    }
    this.last.copy(pos);
    this.hasLast = true;

    const grounded = ctl.grounded;
    const inMud = this.zones.inZone(SLOUGH_ZONE);
    this.onStoneNow = this.stones.standingOn(pos);
    const wasSinkable = this.sinkable;
    this.sinkable = inMud && !this.onStoneNow;

    if (this.sinkable) {
      if (!grounded) this.depthM = Math.max(0, this.depthM - SINK.air * dt);
      else if (speed > SINK.still) {
        // Running sinks faster; so does trying to (holding the fast-walk control).
        const input = this.player.mode === 'play' ? services.tryGet('input') : undefined;
        const running = speed > SINK.runSpeed || (input?.runHeld() ?? false);
        const rate = running ? SINK.run : SINK.walk;
        // Eased: the deeper you are, the slower you go down.
        this.depthM = Math.min(SINK_MAX, this.depthM + rate * dt * (1 - (0.5 * this.depthM) / SINK_MAX));
      }
    } else {
      this.depthM = Math.max(0, this.depthM - SINK.rise * dt);
    }

    this.slurps(dt, wasSinkable, pos);
    this.applySpeed(dt);
    this.splashes(grounded, pos);

    const still = inMud && grounded && speed < SINK.still && this.player.mode === 'play';
    this.stillTime = still && this.autoReveal && this.stones.hasHidden ? this.stillTime + dt : 0;
    if (this.stillTime >= REVEAL.still) {
      this.stillTime = 0;
      this.revealNear(REVEAL.range);
    }
    this.stones.update(dt, pos);
  }

  render(_alpha: number, frameDt: number): void {
    if (this.disposed) return;
    this.bindBone();
    if (this.snapShown) {
      this.shown = this.depthM;
      this.snapShown = false;
    } else {
      this.shown += (this.depthM - this.shown) * (1 - Math.exp(-SINK.showRate * frameDt));
    }
    if (this.bone && this.boneChar) {
      const sy = this.boneChar.root.scale.y || 1;
      this.bone.position.y = this.boneBaseY - this.shown / sy;
    }
    this.stones.render();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const off of this.offs.splice(0)) off();
    if (this.bone) this.bone.position.y = this.boneBaseY;
    this.bone = null;
    this.boneChar = null;
    if (this.ownsSpeed) this.player.speedScale = 1;
    this.stones.dispose();
    for (const h of this.floors) this.col.removeCollider(h);
    this.floors.length = 0;
    if (services.tryGet('slough') === this) services.unregister('slough');
  }

  // --------------------------------------------------------------------------------------------- private

  /** The mud surface height at (x, z), or -Infinity outside every mud body. */
  private mudLevelAt(x: number, z: number): number {
    const w = waterAt(this.world.level, x, z);
    return w && w.kind === 'mud' ? w.level : -Infinity;
  }

  /** Walkable floors at mud surfaces the collision ground lies under. */
  private addMudFloors(): void {
    for (const w of this.world.level.water ?? []) {
      if (w.kind !== 'mud') continue;
      if (this.col.groundAt(w.x, w.z) >= w.level - 0.05) continue; // the CollisionWorld already stands on it
      const h = MUD_FLOOR_DEPTH;
      const c: Collider =
        w.shape === 'circle'
          ? { kind: 'cylinder', center: [w.x, w.level - h / 2, w.z], radius: w.r ?? 0, height: h }
          : {
              kind: 'box',
              center: [w.x, w.level - h / 2, w.z],
              half: [(w.size?.[0] ?? 0) / 2, h / 2, (w.size?.[1] ?? 0) / 2],
              rotY: 0,
            };
      this.checkRim(w); // before its own floor holds the edge up
      this.floors.push(this.col.addCollider(c, { walkable: true, tag: 'mud', floor: true }));
    }
  }

  /**
   * Content check (the terrain is generated, so tools/validate-levels.mjs cannot see it): ground far below a mud
   * surface at its edge makes the mud a raised disc you step up onto. Warns once with the worst drop.
   */
  private checkRim(w: NonNullable<SloughWorld['level']['water']>[number]): void {
    let worst = 0;
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const ex =
        w.shape === 'circle' ? Math.sin(a) * (w.r ?? 0) : Math.sign(Math.sin(a)) * (w.size?.[0] ?? 0) * 0.5;
      const ez =
        w.shape === 'circle' ? Math.cos(a) * (w.r ?? 0) : Math.sign(Math.cos(a)) * (w.size?.[1] ?? 0) * 0.5;
      worst = Math.max(worst, w.level - this.col.groundAt(w.x + ex * 0.99, w.z + ez * 0.99, w.level - 1));
    }
    if (worst > RIM_STEP + 0.02)
      console.warn(
        `[slough] the ground at the edge of the mud at (${w.x}, ${w.z}) is up to ${worst.toFixed(2)} m below its surface`,
      );
  }

  private revealNear(range: number): void {
    const p = this.player.controller.position;
    const set = this.stones.nearestHidden(p.x, p.z, range);
    if (set >= 0) this.raise(set);
  }

  /** Raises a set in a ripple from the player and remembers it in GameState (flag `steps.<id>`) for saves. */
  private raise(set: number): void {
    const s = this.stones.sets[set];
    if (!s || s.revealed) return;
    const p = this.player.controller.position;
    this.stones.reveal(set, p.x, p.z);
    services.tryGet('state')?.setFlag(stepsFlag(s.id), true);
  }

  private slurps(dt: number, wasSinkable: boolean, pos: THREE.Vector3): void {
    if (this.slurpCooldown > 0) this.slurpCooldown -= dt;
    const band = Math.floor(this.depthM / SINK.slurpBand + 1e-6);
    const deeper = band > this.band;
    const pulledFree = wasSinkable && !this.sinkable && this.depthM > SINK.slurpBand;
    this.band = band;
    if ((deeper || pulledFree) && this.slurpCooldown <= 0) {
      this.slurpCooldown = SINK.slurpGap;
      events.emit('sfx', { id: 'mud_slurp', at: [pos.x, pos.y, pos.z] });
    }
  }

  /** Eases `player.speedScale` to 0.65 in the mud and back to 1; writes it only while the Slough owns it. */
  private applySpeed(dt: number): void {
    const target = this.sinkable ? SINK.speedScale : 1;
    if (!this.sinkable && !this.ownsSpeed) return;
    if (!this.ownsSpeed) this.scale = this.player.speedScale;
    this.ownsSpeed = true;
    const step = SINK.speedEase * dt;
    this.scale =
      this.scale < target ? Math.min(target, this.scale + step) : Math.max(target, this.scale - step);
    this.player.speedScale = this.scale;
    if (!this.sinkable && this.scale >= 1) this.ownsSpeed = false;
  }

  private splashes(grounded: boolean, pos: THREE.Vector3): void {
    const steps = this.player.character.animator.steps;
    const footfall = this.lastSteps >= 0 && steps !== this.lastSteps;
    this.lastSteps = steps;
    const landed = grounded && !this.wasGrounded;
    this.wasGrounded = grounded;
    if (!this.sinkable || !grounded || (!footfall && !landed)) return;
    this.splashAt.set(pos.x, pos.y + 0.05, pos.z);
    this.world.particles.emit('splash', this.splashAt, landed ? SPLASH.land : SPLASH.step, this.splashOpts);
  }

  /** Follows outfit swaps: the old character's bone goes back, the new one's rest height is remembered. */
  private bindBone(): void {
    const c = this.player.character;
    if (c === this.boneChar) return;
    if (this.bone) this.bone.position.y = this.boneBaseY;
    this.boneChar = c;
    this.bone = c.bones['root'] ?? null;
    this.boneBaseY = this.bone ? this.bone.position.y : 0;
  }

  private installDebug(): void {
    const debug = services.tryGet('debug');
    if (!debug) return;
    this.offs.push(
      debug.addReadout('Slough', () =>
        this.zones.inZone(SLOUGH_ZONE) || this.depthM > 0
          ? `sink ${this.depthM.toFixed(2)} m${this.onStoneNow ? ', on a stone' : ''}`
          : '-',
      ),
      debug.addButton('Gameplay', 'Reveal steps', () => this.reveal()),
    );
  }
}
