/**
 * The Burden (GDD 2.7.1): the big lumpy sack on Christian's back and everything it does to moving.
 *
 * - Burdened: walk 3.0 m/s, fast walk 4.2 m/s, a 0.3 m hop, responsive acceleration and limited air control. The lean and the heavy
 *   stride live in the `burdenedWalk` clip, the sack's bounce in the Character's springs; this system adds the
 *   "huff" puff of breath on the clip's cue, an occasional creak, and a heavy little landing.
 * - It grows (Ch I reading the Book, Ch III the Wrong Hill) with a cartoon "boing": a bigger sack is slower (down to
 *   2.6 m/s at size 1.6) and from size 1.1 the feet drag dusty ruts. The size is kept in the save's flags.
 * - Free (after the Cross): walk 3.4, run 6, jump 1.1 m, and the first three jumps are joy jumps (sparkles and rising
 *   notes; `consumeJoyJump()` from the Player's jump, or detected here as a fallback).
 *
 *   const burden = new BurdenSystem(player, state, world);   // registers the 'burden' service
 *   controller.step(dt, wish, jump, burden.params());        // every fixed step
 *   if (jumped && burden.consumeJoyJump()) character.animator.play('joyJump');
 *   burden.update(dt);
 *   burden.dispose();
 */
import '../audio/events';
import { stepPitch } from '../audio/sfx/pitch';
import { events } from '../core/Events';
import { services } from '../core/Services';
import { settings } from '../core/Settings';
import type { GameState } from '../core/GameState';
import type { Character } from '../gen/CharacterFactory';
import { Rng, hashString } from '../gen/rng';
import type { World } from '../world/World';
import { BurdenFx } from './cross-burden-fx';
import type { MoveParams } from './Controller';
import { clamp, type BurdenPlayer } from './cross-types';

export type { MoveParams } from './Controller';

/** Largest sack (Character.setBurdenSize limit). */
export const BURDEN_MAX = 1.6;
/** Save flag holding the sack size (GameState flags; the save format has only `burden: boolean`). */
export const BURDEN_SIZE_FLAG = 'burden.size';
/** Joy jumps granted when the Burden falls at the Cross. */
export const JOY_JUMPS = 3;

/** Free movement (GDD 2.7.1 after the Cross; 2.15 slope limit and step-up). */
export const FREE_MOVE: Readonly<MoveParams> = {
  walkSpeed: 3.4,
  runSpeed: 6,
  jumpHeight: 1.1,
  gravity: 24,
  accel: 30,
  airControl: 0.5,
  slopeLimit: 40,
  stepUp: 0.3,
};
/** Burdened at size 1 (GDD 2.7.1): a slow heavy 2.0 m/s walk, no running, a stubby hop. */
export const BURDENED_MOVE: Readonly<MoveParams> = {
  walkSpeed: 2.0,
  runSpeed: 2.0,
  jumpHeight: 0.3,
  gravity: 28,
  accel: 9,
  airControl: 0.3,
  slopeLimit: 40,
  stepUp: 0.3,
};
/** Walk speed at the biggest sack. */
const BIG_WALK = 1.6;
/** From this size the feet drag ruts. */
const RUT_FROM = 1.1;
/** Seconds between creaks while walking burdened (random in range). */
const CREAK_GAP: [number, number] = [3.5, 8];
/** A jump take-off seen here (vertical speed m/s) that the Player did not report becomes a joy jump. */
const TAKEOFF_VY = 2;
/** consumeJoyJump() this recently (s) means the Player already handled this take-off. */
const CONSUME_GRACE = 0.3;

declare module '../core/Events' {
  interface EventMap {
    /** The sack grew (GDD 2.7.1 "boing"); the camera or music may react. */
    'burden:grew': { size: number; amount: number };
    /** A joy jump started: n = 0, 1, 2; left = how many remain. */
    'burden:joyJump': { n: number; left: number };
  }
}

declare module '../core/Services' {
  interface ServiceMap {
    burden: BurdenSystem;
  }
}

export class BurdenSystem {
  private sizeNow: number;
  private joy = 0;
  private dropping = false;
  private readonly move: MoveParams = { ...FREE_MOVE };
  private readonly fx: BurdenFx;
  private readonly rng = new Rng(hashString('burden'));
  private char: Character | null = null;
  private lastSteps = 0;
  private lastCues = 0;
  private wasGrounded = true;
  private creakIn: number;
  private sinceConsume = Infinity;
  private readonly offs: Array<() => void> = [];
  private disposed = false;

  constructor(
    private readonly player: BurdenPlayer,
    private readonly state: GameState,
    world?: World | null,
  ) {
    this.fx = new BurdenFx(world?.particles ?? null, world?.palette.ground.path ?? '#C9B68E');
    this.sizeNow = this.savedSize();
    this.creakIn = this.rng.range(CREAK_GAP[0], CREAK_GAP[1]);
    this.offs.push(
      events.on('burden:changed', ({ on }) => this.onBurdenChanged(on)),
      events.on('state:reset', () => {
        this.dropping = false;
        this.joy = 0;
        this.sizeNow = this.savedSize();
        this.applySize();
      }),
    );
    this.syncCharacter();
    this.applySize();
    services.register('burden', this);
    this.installDebug();
  }

  /** Current sack size: 0 when free, 1 normal, up to 1.6. */
  get size(): number {
    return this.sizeNow;
  }

  /** Joy jumps still to come (3 right after the Cross). */
  get joyJumpsLeft(): number {
    return this.joy;
  }

  /** True while the Cross sequence owns the sack (no huffs, creaks or size changes). */
  get isDropping(): boolean {
    return this.dropping;
  }

  /** Movement rules for the controller (one reused object; read it every step). */
  params(): MoveParams {
    const m = this.move;
    if (!this.state.burden || this.sizeNow <= 0) {
      Object.assign(m, FREE_MOVE);
      return m;
    }
    Object.assign(m, BURDENED_MOVE);
    const k = clamp((this.sizeNow - 1) / (BURDEN_MAX - 1), 0, 1);
    m.walkSpeed = BURDENED_MOVE.walkSpeed + (BIG_WALK - BURDENED_MOVE.walkSpeed) * k;
    m.runSpeed = BURDENED_MOVE.runSpeed * (m.walkSpeed / BURDENED_MOVE.walkSpeed);
    m.accel = BURDENED_MOVE.accel * (1 - 0.2 * k);
    return m;
  }

  /** The sack grows with a cartoon "boing" (Ch I reading the Book, Ch III the Wrong Hill). */
  grow(amount: number): void {
    if (this.disposed || this.dropping || !this.state.burden || !Number.isFinite(amount) || amount === 0)
      return;
    const before = this.sizeNow;
    this.sizeNow = clamp(before + amount, 0.3, BURDEN_MAX);
    if (this.sizeNow === before) return;
    this.state.setFlag(BURDEN_SIZE_FLAG, Math.round(this.sizeNow * 1000) / 1000);
    this.syncCharacter();
    this.applySize();
    const c = this.char;
    if (c) this.fx.boing(c);
    if (!settings.data.reduceMotion) this.fx.kick();
    events.emit('burden:grew', { size: this.sizeNow, amount: this.sizeNow - before });
  }

  /**
   * Call when the Player's jump takes off. After the Cross the first three jumps are joy jumps: plays the rising
   * note and sparkles and returns true (play the 'joyJump' clip); otherwise false.
   */
  consumeJoyJump(): boolean {
    if (this.disposed || this.dropping || this.state.burden || this.joy <= 0) return false;
    const n = JOY_JUMPS - this.joy;
    this.joy--;
    this.sinceConsume = 0;
    this.syncCharacter();
    const c = this.char;
    if (c) this.fx.joyJump(c, n, stepPitch('joy_note', n));
    events.emit('burden:joyJump', { n, left: this.joy });
    return true;
  }

  /** Fixed step. */
  update(dt: number): void {
    if (this.disposed) return;
    this.syncCharacter();
    const c = this.char;
    if (!c) return;
    const anim = c.animator;
    const newSteps = anim.steps - this.lastSteps;
    const newCues = anim.cues - this.lastCues;
    this.lastSteps = anim.steps;
    this.lastCues = anim.cues;
    const ctl = this.player.controller;
    const grounded = ctl.grounded;
    const v = ctl.velocity;
    const speed = Math.hypot(v.x, v.z);
    const playing = this.player.mode === 'play';
    this.sinceConsume += dt;

    if (this.state.burden && this.sizeNow > 0 && !this.dropping && playing) {
      if (newCues > 0 && anim.lastCue === 'burdenedWalk')
        this.fx.huff(c, this.player.forward, this.player.controller.velocity);
      if (newSteps > 0 && this.sizeNow >= RUT_FROM && speed > 0.3) {
        for (let i = 0; i < newSteps; i++) this.fx.rut(c, this.player.forward, anim.steps - i);
      }
      if (speed > 0.4) {
        this.creakIn -= dt;
        if (this.creakIn <= 0) {
          this.fx.creak(c);
          this.creakIn = this.rng.range(CREAK_GAP[0], CREAK_GAP[1]);
        }
      }
      if (grounded && !this.wasGrounded) {
        this.fx.landing(c, 6);
        this.fx.creak(c);
      }
    } else if (!this.state.burden && this.joy > 0 && playing && !this.dropping) {
      // Fallback for a Player that does not call consumeJoyJump(): a take-off it did not report.
      if (this.wasGrounded && !grounded && v.y > TAKEOFF_VY && this.sinceConsume > CONSUME_GRACE) {
        if (this.consumeJoyJump()) anim.play('joyJump', { fade: 0.08, restart: true });
      }
    }
    this.fx.update(dt, c);
    this.wasGrounded = grounded;
  }

  // ------------------------------------------------------------------- the Cross (CrossDrop.ts only)

  /** The Cross sequence takes the sack over: no huffs, creaks, growth or size changes until completeDrop(). */
  beginDrop(): void {
    this.dropping = true;
  }

  /** The sack is gone: free movement and three joy jumps. Call before state.setBurden(false). */
  completeDrop(): void {
    this.dropping = false;
    this.sizeNow = 0;
    this.joy = JOY_JUMPS;
    this.sinceConsume = Infinity;
    this.state.setFlag(BURDEN_SIZE_FLAG, undefined);
    this.applySize();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const off of this.offs.splice(0)) off();
    this.fx.dispose();
    if (services.tryGet('burden') === this) services.unregister('burden');
    this.char = null;
  }

  // ---------------------------------------------------------------------------------------- internal

  private savedSize(): number {
    if (!this.state.burden) return 0;
    const f = this.state.flag(BURDEN_SIZE_FLAG);
    return typeof f === 'number' && Number.isFinite(f) ? clamp(f, 0.3, BURDEN_MAX) : 1;
  }

  private onBurdenChanged(on: boolean): void {
    if (on) {
      // Put back on (debug toggle, a load): the saved size, no joy jumps left.
      this.dropping = false;
      this.joy = 0;
      this.sizeNow = this.savedSize();
    } else {
      this.sizeNow = 0;
    }
    this.applySize();
  }

  /** Follows outfit swaps (Player.setRecipe builds a new Character). */
  private syncCharacter(): void {
    const c = this.player.character;
    if (c === this.char) return;
    this.char = c;
    this.lastSteps = c.animator.steps;
    this.lastCues = c.animator.cues;
    if (!this.dropping) c.setBurdenSize(this.sizeNow);
  }

  private applySize(): void {
    if (this.dropping) return;
    this.char?.setBurdenSize(this.sizeNow);
  }

  private installDebug(): void {
    const debug = services.tryGet('debug');
    if (!debug) return;
    this.offs.push(
      debug.addReadout('Burden', () =>
        this.state.burden
          ? `size ${this.sizeNow.toFixed(2)}${this.dropping ? ' (dropping)' : ''}`
          : `free, joy ${this.joy}`,
      ),
      debug.addButton('Burden', 'Grow +0.3', () => this.grow(0.3)),
    );
  }
}
