/**
 * A level character that can move and look around (GDD 2.8, 2.15): the base of companions and of scripted walkers.
 *
 * - Body: an in-house KinematicController (the player's own: terrain via the CollisionWorld, capsule push-out
 *   from colliders, slope limit, step-up, hops), so an NPC never stands inside a collider or floats over a dip.
 * - Moving: `walkTo` / `followPath` (scripts, promises resolve on arrival), or `steer()` each fixed step (the
 *   Companion's follow AI). A walk wins over steering. `jump()` hops on the next step.
 * - Animation: idle / walk / run / burdenedWalk speed-matched with the player's own chooser (PlayerAnim), hops
 *   time-warped to the physics. Clips others start (talk, wave, sit...) are left alone until the NPC moves.
 * - Facing turns smoothly along the motion; `face(p)` turns the standing body; `lookAt()` turns chest, neck and
 *   head (npc-look.ts), and a standing NPC turns its body when the target is behind it.
 * - `scripted = true` hands the root to someone else (a cutscene moves it); setting it back takes the root's place.
 *
 * Loop: the owner calls update(dt) at the fixed step and render(alpha) per frame, before the World animates its
 * NPCs (use NPC_ORDER). The NPC adds its own small render system right after the World (PLAY_ORDER.world + 1)
 * for the head turn, and animates the Character itself only when the World does not (not in world.npcs).
 * dispose() does not dispose the Character (the World owns it); it restores the animator hooks it changed.
 */
import * as THREE from 'three';
import { services } from '../core/Services';
import type { Character } from '../gen/CharacterFactory';
import type { PlaySession } from '../world/PlaySession';
import { PLAY_ORDER } from '../world/play-loop';
import { KinematicController, type MoveParams } from '../player/Controller';
import { PlayerAnim, newAnimInput } from '../player/player-anim';
import { airTimeOf, isHardLanding } from '../player/player-air';
import { lerpAngle, turnToward, yawOf } from '../player/player-move';
import { HeadLook, LOOK_LIMIT, type LookTarget } from './npc-look';
import { RUN_SPEED, WALK_SPEED, WalkPlan, type WalkStep } from './npc-walk';

export type { LookTarget } from './npc-look';

/** Loop order for owners adding NPCs / companions: after the player and zones, before the camera and World. */
export const NPC_ORDER = PLAY_ORDER.interact + 5;

/** NPC movement (GDD 2.7.1 free speeds; companions may run a little faster to catch up). */
export const NPC_MOVE: Readonly<MoveParams> = {
  walkSpeed: 3.4,
  runSpeed: 6.6,
  jumpHeight: 0.8,
  gravity: 24,
  accel: 18,
  airControl: 0.6,
  slopeLimit: 40,
  stepUp: 0.3,
};
/** Gait thresholds handed to the animation chooser (the nominal walk / run speeds). */
const GAIT = { walk: 3.4, run: 6 } as const;
const BODY = { radius: 0.32, minHeight: 1.0, maxHeight: 1.9 } as const;
/** Body turn (ease 1/s, max rad/s): moving, and standing turns (face, look behind). */
const TURN_MOVE = { ease: 10, max: 8 } as const;
const TURN_STAND = { ease: 5, max: 4 } as const;
const MOVING = 0.3;

export interface NPCOptions {
  id: string;
  character: Character;
  session: PlaySession;
  /** Movement override (default NPC_MOVE). */
  params?: Partial<MoveParams>;
}

const tmp = new THREE.Vector3();

export class NPC {
  /** Every live NPC (local avoidance between NPCs). Do not modify. */
  static readonly all: NPC[] = [];

  readonly id: string;
  readonly character: Character;
  readonly controller: KinematicController;
  readonly params: MoveParams;
  /** Seconds the body has been pushing into a wall / steep slope (0 when free). */
  blockedTime = 0;

  private readonly session: PlaySession;
  private readonly anim = new PlayerAnim();
  private readonly animIn = newAnimInput();
  private readonly look: HeadLook;
  private readonly walk = new WalkPlan();
  private readonly wish: WalkStep = { x: 0, z: 0 };
  private readonly steerWish: WalkStep = { x: 0, z: 0 };
  private readonly prevPos = new THREE.Vector3();
  private readonly faceAt = new THREE.Vector3();
  private readonly ownsAnim: boolean;
  private readonly prevOnEnd: Character['animator']['onEnd'];
  private readonly prevRootMotion: boolean | undefined;
  private readonly offPost: (() => void) | null;
  private yaw: number;
  private prevYaw: number;
  private prevStep = 0;
  private hasFace = false;
  private steered = false;
  private jumpAsk = false;
  private jumpHeld = false;
  private speedH = 0;
  private isScripted = false;
  private animDt = 0;
  private disposed = false;

  constructor(o: NPCOptions) {
    this.id = o.id;
    this.character = o.character;
    this.session = o.session;
    this.params = { ...NPC_MOVE, ...o.params };
    const c = o.character;
    const height = Math.min(BODY.maxHeight, Math.max(BODY.minHeight, c.height));
    this.controller = new KinematicController(o.session.col, BODY.radius, height);
    this.look = new HeadLook(c);
    let inWorld = false;
    for (const w of o.session.world.npcs.values()) if (w === c) inWorld = true;
    this.ownsAnim = !inWorld;
    this.prevOnEnd = c.animator.onEnd;
    this.prevRootMotion = c.animator.params.rootMotion;
    this.anim.bind(c);
    this.yaw = this.prevYaw = c.root.rotation.y;
    tmp.copy(c.root.position);
    this.teleport(tmp, this.yaw);
    const loop = services.tryGet('engine')?.loop;
    this.offPost = loop
      ? loop.add({ render: (_a, frameDt) => this.post(frameDt) }, PLAY_ORDER.world + 1)
      : null;
    NPC.all.push(this);
  }

  /** Feet, world space (the controller's position: read it, move the NPC with teleport / walkTo). */
  get position(): THREE.Vector3 {
    return this.controller.position;
  }

  /** Body yaw (rotation.y; characters face +Z). */
  get facing(): number {
    return this.yaw;
  }

  /** Horizontal speed moved in the last fixed step (m/s). */
  get speed(): number {
    return this.speedH;
  }

  get grounded(): boolean {
    return this.controller.grounded;
  }

  /** True while a walkTo / followPath runs. */
  get moving(): boolean {
    return this.walk.active;
  }

  /** The current look target (null = straight ahead). */
  get lookTarget(): LookTarget {
    return this.look.current;
  }

  /** True: someone else (a cutscene) moves the root; physics and steering pause. */
  get scripted(): boolean {
    return this.isScripted;
  }

  set scripted(on: boolean) {
    if (on === this.isScripted || this.disposed) return;
    this.isScripted = on;
    if (on) {
      this.walk.finish();
      this.speedH = 0;
    } else {
      const root = this.character.root;
      tmp.copy(root.position);
      this.teleport(tmp, root.rotation.y);
    }
  }

  /** Head (and chest) turn toward a point or a moving target, eased; null = straight ahead. */
  lookAt(target: LookTarget): void {
    this.look.set(target);
  }

  /** Turns the standing body toward `p` (smoothly; walking still faces along the motion). */
  face(p: THREE.Vector3): void {
    this.faceAt.copy(p);
    this.hasFace = true;
  }

  /** Walks (or runs) to a ground point; resolves on arrival, or when stopped / replaced. */
  walkTo(p: THREE.Vector3, opts?: { speed?: number; run?: boolean }): Promise<void> {
    return this.followPath([p], { speed: opts?.speed ?? (opts?.run ? RUN_SPEED : WALK_SPEED) });
  }

  /** Walks through the points in order (corners cut gently); resolves at the last one. */
  followPath(points: THREE.Vector3[], opts?: { speed?: number }): Promise<void> {
    if (this.disposed || this.isScripted) return Promise.resolve();
    this.hasFace = false;
    return this.walk.start(points, opts?.speed ?? WALK_SPEED);
  }

  /** Ends a walk (its promise resolves) and any steering; the NPC slows to a stand. */
  stop(): void {
    this.walk.finish();
    this.steered = false;
    this.steerWish.x = 0;
    this.steerWish.z = 0;
  }

  /** Puts the feet at `p` (snapped onto the ground below within 5 cm) with no interpolation streak. */
  teleport(p: THREE.Vector3, facing?: number): void {
    if (this.disposed) return;
    this.controller.teleport(p);
    if (facing !== undefined && Number.isFinite(facing)) this.yaw = facing;
    this.prevYaw = this.yaw;
    this.prevPos.copy(this.controller.position);
    this.prevStep = 0;
    this.speedH = 0;
    this.blockedTime = 0;
    this.anim.reset();
    const root = this.character.root;
    root.position.copy(this.controller.position);
    root.rotation.y = this.yaw;
  }

  /** Steering for the next fixed step (m/s on XZ). Ignored while a walk runs or while scripted. */
  steer(x: number, z: number): void {
    this.steerWish.x = Number.isFinite(x) ? x : 0;
    this.steerWish.z = Number.isFinite(z) ? z : 0;
    this.steered = true;
  }

  /** Hop on the next fixed step (when on the ground). */
  jump(): void {
    this.jumpAsk = true;
  }

  update(dt: number): void {
    if (this.disposed) return;
    const ctrl = this.controller;
    this.prevPos.copy(ctrl.position);
    this.prevStep = ctrl.stepOffset;
    this.prevYaw = this.yaw;
    this.animDt += dt;
    if (this.isScripted) {
      this.speedH = 0;
      this.steered = false;
      this.jumpAsk = false;
      return;
    }
    const w = this.wish;
    if (this.walk.active) {
      const r = this.walk.step(dt, ctrl.position, w);
      if (r === 'stuck') this.unstick();
    } else if (this.steered) {
      w.x = this.steerWish.x;
      w.z = this.steerWish.z;
    } else {
      w.x = 0;
      w.z = 0;
    }
    this.steered = false;
    // A rising edge per ask: the controller treats a held button as one press.
    const jump = this.jumpAsk && !this.jumpHeld;
    this.jumpHeld = this.jumpAsk;
    this.jumpAsk = false;
    const res = ctrl.step(dt, w, jump, this.params);
    this.blockedTime = res.blocked || this.pushedBack(w, dt) ? this.blockedTime + dt : 0;
    const dx = ctrl.position.x - this.prevPos.x;
    const dz = ctrl.position.z - this.prevPos.z;
    this.speedH = dt > 0 ? Math.sqrt(dx * dx + dz * dz) / dt : 0;
    this.turn(dt, w);
    if (res.landed) this.anim.landed(isHardLanding(res.landSpeed, this.params), this.speedH > 0.5);
    if (res.jumped) this.anim.jumped(false, airTimeOf(this.params));
    const a = this.animIn;
    const c = this.character;
    a.grounded = res.grounded;
    a.speed = this.speedH;
    a.wantsMove = w.x * w.x + w.z * w.z > 0.01;
    a.walkSpeed = GAIT.walk;
    a.runSpeed = GAIT.run;
    a.burdened = c.recipe.burden === true && c.burdenSize > 0.05;
    this.anim.update(dt, a);
  }

  /** Per rendered frame: places the body between the last two fixed steps. */
  render(alpha: number): void {
    if (this.disposed || this.isScripted) return;
    const a = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
    const root = this.character.root;
    root.position.lerpVectors(this.prevPos, this.controller.position, a);
    root.position.y += this.prevStep + (this.controller.stepOffset - this.prevStep) * a;
    root.rotation.y = lerpAngle(this.prevYaw, this.yaw, a);
  }

  dispose(): void {
    if (this.disposed) return;
    this.walk.finish();
    this.disposed = true;
    this.offPost?.();
    const i = NPC.all.indexOf(this);
    if (i >= 0) NPC.all.splice(i, 1);
    this.look.restore();
    this.anim.dispose();
    const an = this.character.animator;
    an.onEnd = this.prevOnEnd;
    an.params.rootMotion = this.prevRootMotion;
  }

  // ------------------------------------------------------------------------------------------- inside

  /** After the World animated its NPCs: our own character's animation (if nobody else does it), then the look. */
  private post(frameDt: number): void {
    if (this.disposed) return;
    const loop = services.tryGet('engine')?.loop;
    const dt = loop ? (loop.paused ? 0 : frameDt * loop.timeScale) : frameDt;
    const c = this.character;
    if (this.ownsAnim && this.animDt > 0 && c.root.visible) {
      c.update(this.animDt);
    }
    this.animDt = 0;
    this.look.measure(c.root.rotation.y);
    this.look.apply(dt);
  }

  /** Body yaw: along the motion; standing, toward face() or a look target behind the shoulder. */
  private turn(dt: number, w: WalkStep): void {
    const v = this.controller.velocity;
    const vh = Math.sqrt(v.x * v.x + v.z * v.z);
    if (vh > MOVING && w.x * w.x + w.z * w.z > 0.01) {
      this.yaw = turnToward(this.yaw, yawOf(v.x, v.z), dt, TURN_MOVE.ease, TURN_MOVE.max);
      return;
    }
    const pos = this.controller.position;
    if (this.hasFace) {
      const dx = this.faceAt.x - pos.x;
      const dz = this.faceAt.z - pos.z;
      if (dx * dx + dz * dz > 1e-4) {
        this.yaw = turnToward(this.yaw, yawOf(dx, dz), dt, TURN_STAND.ease, TURN_STAND.max);
      }
      return;
    }
    const rel = this.look.relativeYaw;
    if (Number.isFinite(rel) && Math.abs(rel) > LOOK_LIMIT.yaw * 0.9) {
      this.yaw = turnToward(this.yaw, this.yaw + rel, dt, TURN_STAND.ease, TURN_STAND.max);
    }
  }

  /** True when a step wanted to move but went (almost) nowhere: a collider holds the body back. */
  private pushedBack(w: WalkStep, dt: number): boolean {
    const want = Math.sqrt(w.x * w.x + w.z * w.z);
    if (want < 0.5 || !this.controller.grounded) return false;
    const dx = this.controller.position.x - this.prevPos.x;
    const dz = this.controller.position.z - this.prevPos.z;
    return Math.sqrt(dx * dx + dz * dz) < want * dt * 0.25;
  }

  /** A walk that cannot get through: stand on the point if it is free, else stay; the walk ends either way. */
  private unstick(): void {
    const p = this.walk.target;
    if (p) {
      const col = this.session.col;
      const y = col.groundAt(p.x, p.z, p.y + 0.5);
      if (!col.overlaps(p.x, y, p.z, this.controller.radius, this.controller.height)) {
        tmp.set(p.x, y, p.z);
        this.teleport(tmp);
      }
    }
    this.walk.finish();
  }
}
