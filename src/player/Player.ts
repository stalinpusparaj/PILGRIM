/**
 * The player (GDD 2.6, 2.7, 2.15): owns Christian's Character and the kinematic controller; the 'player' service.
 *
 * - Fixed 60 Hz update(): camera-relative movement from Input (walk, fast walk while burdened, run when free, jump), ledge climbs, facing
 *   with a smooth turn, animation choice (player-anim.ts), bonks and safe spots (Bonk.ts).
 * - render(alpha): places the character between the last two fixed positions (interpolation) and animates it with
 *   the simulated time since the last frame, then polls footsteps (Footsteps.ts).
 * - Speeds come from the Burden system (the 'burden' service: `params()`, joy jumps through `consumeJoyJump()`)
 *   times `speedScale` (the Slough, the Cross); without one, the GDD 2.7.1 numbers for GameState.burden. The sack
 *   size is the Burden system's business (it follows outfit swaps itself).
 * - Outfits: starts as christian_burdened while GameState.burden, christian_free after. Dropping the Burden keeps
 *   the clothes (the Shining Ones' white clothes are a scripted setRecipe later in Ch VI, GDD 2.10) but the walk
 *   turns light and upright at once (player-outfit.ts GaitStyle). setRecipe() swaps with a sparkle and keeps the
 *   animator state.
 * - Modes: 'play' (input drives), 'locked' (no input, physics on: bonks, dialogue), 'cutscene' (scripts move the
 *   root or call teleport(); leaving the mode takes the root's place as the new position). Leaving 'play' drops a
 *   buffered jump press.
 *
 *   const player = new Player({ world, col, state, recipe: 'christian_burdened', spawn, facing });
 *   loop: player.update(dt) (fixed), player.render(alpha) (per frame, before the camera)
 *   player.dispose();
 */
import * as THREE from 'three';
import { movementPaceScale } from '../core/MovementPace';
import '../audio/events';
import { events } from '../core/Events';
import { services } from '../core/Services';
import type { GameState } from '../core/GameState';
import { CharacterFactory, type Character } from '../gen/CharacterFactory';
import type { World } from '../world/World';
import type { CollisionWorld } from '../world/Collision';
import { KinematicController, type MoveParams } from './Controller';
import { Bonk, type BonkReason } from './Bonk';
import { Footsteps } from './Footsteps';
import { PlayerAnim, newAnimInput, type AnimInput } from './player-anim';
import { LedgeClimb, LEDGE } from './player-ledge';
import type { BurdenSystem } from './Burden';
import { GaitStyle, recipeFor, swapCharacter } from './player-outfit';
import { installPlayerDebug } from './player-debug';
import { BODY, airTimeOf, isHardLanding, jumpSound, landingFx } from './player-air';
import {
  BURDENED_FALLBACK,
  FREE_FALLBACK,
  cameraWish,
  faceWish,
  lerpAngle,
  scaledParams,
} from './player-move';

export type PlayerMode = 'play' | 'locked' | 'cutscene';

declare module '../core/Services' {
  interface ServiceMap {
    player: Player;
  }
}

declare module '../core/Events' {
  interface EventMap {
    /** Feet touched the ground after being airborne. `hard`: a big drop (squash, dust). */
    'player:landed': { speed: number; hard: boolean };
    /** The player jumped (`joy`: one of the three joy jumps after the Cross). */
    'player:jump': { joy: boolean };
    /** The player's Character was rebuilt from another recipe (outfit swap). */
    'player:recipe': { id: string };
  }
}

export interface PlayerOptions {
  world: World;
  col: CollisionWorld;
  state: GameState;
  recipe: string;
  spawn: THREE.Vector3;
  facing: number;
}

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

export class Player {
  readonly controller: KinematicController;
  /** Interpolated feet position (fixed 60 Hz update, render alpha), without the step easing. The camera follows it. */
  readonly renderPosition = new THREE.Vector3();
  /** Unit facing direction on XZ. */
  readonly forward = new THREE.Vector3(0, 0, 1);
  /** Speed multiplier from zones (the Slough) and scripts (the Cross slows input). 1 by default. */
  speedScale = 1;
  /** Set by scripts that slow the player to a stop (the Cross): input still walks, but jump and climbs do nothing. */
  walkOnly = false;
  /** A unit XZ direction he turns to face instead of his motion (Combat: the foe while the shield is up), or null. */
  aim: { x: number; z: number } | null = null;
  /** The bonk system (GDD 2.7.3): `player.bonks.bonk('arrow')`, or use `player.bonk()`. */
  readonly bonks: Bonk;

  private char: Character;
  private _mode: PlayerMode = 'play';
  private yaw: number;
  private prevYaw: number;
  private readonly prevPos = new THREE.Vector3();
  /** controller.stepOffset at the previous fixed step (interpolated with the position). */
  private prevStep = 0;
  private readonly params: MoveParams = { ...FREE_FALLBACK };
  private readonly wish = { x: 0, z: 0 };
  private readonly anim = new PlayerAnim();
  private readonly gait = new GaitStyle();
  private readonly animIn: AnimInput = newAnimInput();
  private readonly footsteps: Footsteps;
  private readonly ledge: LedgeClimb;
  private readonly world: World;
  private readonly state: GameState;
  private readonly offs: Array<() => void> = [];
  private grounded = true;
  private running = false;
  private speedH = 0;
  private animDt = 0;
  private disposed = false;

  constructor(o: PlayerOptions) {
    this.world = o.world;
    this.state = o.state;
    this.char = CharacterFactory.build(recipeFor(o.recipe, o.state.burden));
    const height = Math.min(BODY.maxHeight, Math.max(BODY.minHeight, this.char.height));
    this.controller = new KinematicController(o.col, BODY.radius, height);
    this.footsteps = new Footsteps(o.col);
    this.ledge = new LedgeClimb(o.col, BODY.radius, height);
    this.bonks = new Bonk(this, this.anim, o.world, o.state);
    this.yaw = this.prevYaw = Number.isFinite(o.facing) ? o.facing : 0;
    this.adopt(this.char);
    this.teleport(o.spawn, this.yaw);

    this.offs.push(installPlayerDebug(this));
    services.register('player', this);
  }

  get character(): Character {
    return this.char;
  }

  get mode(): PlayerMode {
    return this._mode;
  }

  /** Leaving 'cutscene' takes wherever the script left the character as the new position. */
  set mode(m: PlayerMode) {
    if (m === this._mode) return;
    const was = this._mode;
    this._mode = m;
    if (was === 'cutscene') {
      tmp2.copy(this.char.root.position);
      this.teleport(tmp2, this.char.root.rotation.y);
    }
    if (m === 'cutscene') this.char.root.position.y = this.renderPosition.y; // no step easing under scripts
    if (m !== 'play') this.ledge.cancel();
    if (m !== 'play') this.controller.cancelJump(); // a press made just before must not fire on the next landing
  }

  /** Facing angle (rotation.y; characters face +Z). */
  get facing(): number {
    return this.yaw;
  }

  /** Horizontal speed moved in the last fixed step (m/s). */
  get speed(): number {
    return this.speedH;
  }

  get isGrounded(): boolean {
    return this.grounded;
  }

  /** True while climbing a ledge. */
  get climbing(): boolean {
    return this.ledge.climbing;
  }

  /** The animation the body is playing (debug). */
  get animName(): string {
    return this.anim.current;
  }

  /** Cartoon bonk back to the last safe spot on the Way (GDD 2.7.3). */
  bonk(reason: BonkReason): boolean {
    return this.bonks.bonk(reason);
  }

  /** Outfit swap (christian_burdened → christian_free → christian_armour): sparkle, same pose and clip. */
  setRecipe(id: string): void {
    if (this.disposed || id === this.char.recipe.id) return;
    const next = swapCharacter(this.char, id, this.world);
    this.world.blobs.unfollow(this.char);
    this.anim.dispose();
    this.char.dispose();
    this.char = next;
    this.adopt(next);
    events.emit('player:recipe', { id: next.recipe.id });
  }

  /** Jump straight to `p` (feet), optionally facing `facing`. No interpolation streak; safe spots restart here. */
  teleport(p: THREE.Vector3, facing?: number): void {
    tmp.copy(p);
    this.controller.teleport(tmp);
    if (facing !== undefined && Number.isFinite(facing)) this.yaw = facing;
    this.prevYaw = this.yaw;
    this.prevPos.copy(this.controller.position);
    this.prevStep = 0;
    this.renderPosition.copy(this.controller.position);
    this.char.root.position.copy(this.renderPosition);
    this.char.root.rotation.y = this.yaw;
    this.forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.speedH = 0;
    this.anim.reset();
    this.ledge.cancel();
    this.bonks.reseed(this.controller.position, this.yaw);
  }

  update(dt: number): void {
    if (this.disposed) return;
    const ctrl = this.controller;
    this.prevPos.copy(ctrl.position);
    this.prevStep = ctrl.stepOffset;
    this.prevYaw = this.yaw;
    this.animDt += dt;
    const burdened = this.state.burden;
    this.gait.apply(burdened); // also mid-cutscene: he straightens up the moment the Burden is gone
    if (this._mode === 'cutscene' || this.bonks.frozen) {
      this.speedH = 0;
      this.bonks.update(dt);
      return;
    }
    const p = this.resolveParams();

    if (this.ledge.climbing) {
      this.stepClimb(dt, p, burdened);
      return;
    }

    let mx = 0;
    let my = 0;
    let run = false;
    let jump = false;
    const input = this._mode === 'play' && !this.bonks.active ? services.tryGet('input') : undefined;
    if (input) {
      mx = input.move.x;
      my = input.move.y;
      run = input.runHeld();
      jump = !this.walkOnly && input.pressed('jump');
    }
    const asked = this.ledge.consumeRequest();
    const climb = !this.walkOnly && (asked || (jump && !this.ledge.otherFocused()));
    if (climb && this.ledge.available && ctrl.grounded && this.ledge.begin(ctrl.position, burdened)) {
      this.yaw = this.ledge.yaw();
      this.anim.hold('climb', 1, 0.1);
      this.stepClimb(dt, p, burdened);
      return;
    }

    const canRun = p.runSpeed > p.walkSpeed + 0.05;
    this.running = run && canRun;
    const top = this.running ? p.runSpeed : p.walkSpeed;
    this.wish.x = 0;
    this.wish.z = 0;
    const camera = services.tryGet('engine')?.camera;
    if (camera && (mx !== 0 || my !== 0)) cameraWish(camera, mx, my, top, this.wish);

    const res = ctrl.step(dt, this.wish, jump, p);
    this.grounded = res.grounded;
    this.face(dt, burdened);
    const dx = ctrl.position.x - this.prevPos.x;
    const dz = ctrl.position.z - this.prevPos.z;
    this.speedH = dt > 0 ? Math.sqrt(dx * dx + dz * dz) / dt : 0;
    // A buffered jump lands and takes off in the same step: land first, so the new jump's clip is not cancelled.
    if (res.landed) this.onLand(res.landSpeed, p);
    if (res.jumped) this.onJump(p, burdened);
    this.animate(dt, res.grounded, this.speedH, p, burdened);
    this.ledge.probe(
      ctrl.position,
      this.forward,
      res.grounded && this._mode === 'play' && !this.bonks.active,
      burdened,
    );
    this.bonks.update(dt);
  }

  render(alpha: number): void {
    if (this.disposed) return;
    const root = this.char.root;
    if (this._mode !== 'cutscene') {
      const a = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
      this.renderPosition.lerpVectors(this.prevPos, this.controller.position, a);
      root.position.copy(this.renderPosition);
      // A stile step or bridge deck eases the body (not renderPosition: the camera smooths steps itself).
      root.position.y += this.prevStep + (this.controller.stepOffset - this.prevStep) * a;
      root.rotation.y = lerpAngle(this.prevYaw, this.yaw, a);
    } else {
      this.renderPosition.copy(root.position);
    }
    if (this.animDt > 0) {
      this.char.update(this.animDt);
      this.animDt = 0;
      const feet = this.controller.position.y;
      this.footsteps.poll(this.grounded && !this.ledge.climbing, this.state.burden, this.running, feet);
    }
    this.bonks.render();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const off of this.offs.splice(0)) off();
    if (services.tryGet('player') === this) services.unregister('player');
    this.bonks.dispose();
    this.ledge.dispose();
    this.footsteps.dispose();
    this.anim.dispose();
    this.gait.dispose();
    this.world.blobs.unfollow(this.char);
    this.char.dispose();
  }

  /** A new Character joins the scene, the blob shadows, the animation and the footsteps. */
  private adopt(c: Character): void {
    this.world.scene.add(c.root);
    this.world.blobs.follow(c);
    this.anim.bind(c);
    this.gait.bind(c);
    this.gait.apply(this.state.burden);
    this.footsteps.bind(c);
    c.update(0); // posed at once: never a bind-pose frame
  }

  /** The running Burden system (GDD 2.7.1), or null. */
  private get burdenSys(): BurdenSystem | null {
    return services.tryGet('burden') ?? null;
  }

  private resolveParams(): MoveParams {
    const src = this.burdenSys?.params() ?? (this.state.burden ? BURDENED_FALLBACK : FREE_FALLBACK);
    return scaledParams(
      src,
      this.speedScale * movementPaceScale(services.tryGet('settings')?.data.movementPace),
      this.params,
    );
  }

  /** Animation choice for this step (one reused input object: no allocation). */
  private animate(dt: number, grounded: boolean, speed: number, p: MoveParams, burdened: boolean): void {
    const a = this.animIn;
    a.grounded = grounded;
    a.speed = speed;
    a.wantsMove = !this.ledge.climbing && this.wish.x * this.wish.x + this.wish.z * this.wish.z > 0.01;
    a.walkSpeed = p.walkSpeed;
    a.runSpeed = p.runSpeed;
    a.burdened = burdened;
    this.anim.update(dt, a);
  }

  private face(dt: number, burdened: boolean): void {
    this.yaw = faceWish(this.yaw, this.aim ?? this.wish, dt, burdened);
    this.forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  private onJump(p: MoveParams, burdened: boolean): void {
    // The Burden system plays the joy jump's rising note and sparkles; we play the clip.
    const joy = !burdened && (this.burdenSys?.consumeJoyJump() ?? false);
    this.anim.jumped(joy, airTimeOf(p));
    jumpSound(this.controller.position, burdened);
    events.emit('player:jump', { joy });
  }

  private onLand(landSpeed: number, p: MoveParams): void {
    const hard = isHardLanding(landSpeed, p);
    this.anim.landed(hard, this.speedH > 0.5);
    landingFx(this.world, this.controller.position, landSpeed, hard);
    events.emit('player:landed', { speed: landSpeed, hard });
  }

  /** One fixed step of a ledge climb: the feet follow the climb path, then settle on the ledge top. */
  private stepClimb(dt: number, p: MoveParams, burdened: boolean): void {
    this.wish.x = 0;
    this.wish.z = 0;
    const going = this.ledge.advance(dt, tmp);
    if (going) {
      this.controller.position.copy(tmp); // not teleport(): that would snap the feet back to the ground below
      this.controller.velocity.set(0, 0, 0);
    } else {
      this.controller.teleport(tmp);
    }
    this.grounded = !going;
    this.speedH = 0;
    this.forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    if (!going) {
      this.anim.release();
      this.grounded = true;
      events.emit('player:landed', { speed: 0, hard: false });
    }
    this.animate(dt, !going, going ? LEDGE.animSpeed : 0, p, burdened);
    this.bonks.update(dt);
  }
}
