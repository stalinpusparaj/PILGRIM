/**
 * The Cross (GDD 2.7.1), the emotional peak of the game: the input slows to a stop and the music fades to silence;
 * Christian kneels and looks up; the three ropes snap one by one (rising plucks, fibres, the sack swinging); the
 * sack falls, bounces, tumbles down the hill along the terrain, bounces again and drops into the open tomb with an
 * echoing "thoom". 1.5 s of true silence. Then the main theme in joy, Christian straightens up into a big stretch,
 * the Burden is gone (state + 'burden:dropped') and he leaps for joy; his next three jumps are joy jumps.
 *
 *   await runCrossDrop({ player, world, burden, state, tomb: tombLandmarkPosition, skip: () => input.held('skip') });
 *
 * The camera rig is suspended and engine.camera eased between shots (cross-shots.ts), then handed back. `skip()`
 * returning true (or the player's character leaving the scene) jumps straight to the end state. `signal` aborting
 * (the session ending) lets go at once with NO end state: no music, events, state change or camera hand-back. This
 * sequence does not change the outfit (the white clothes are Ch VI's Shining Ones). Timed by the fixed-step loop,
 * so it pauses with the game; visuals in render. Any tomb point works: a 'tomb' landmark there takes the sack into
 * its opening, a bare point swallows it. While input slows the player can only walk (`walkOnly`), and the scene
 * starts once his feet are on the ground (a hop or a step down finishes first, input locked).
 */
import * as THREE from 'three';
import '../audio/events';
import { isAmbienceId } from '../audio/amb-beds';
import type { Engine } from '../core/Engine';
import { events } from '../core/Events';
import type { GameState } from '../core/GameState';
import type { System } from '../core/Loop';
import { services } from '../core/Services';
import { settings } from '../core/Settings';
import type { Character } from '../gen/CharacterFactory';
import { PLAY_ORDER } from '../world/play-loop';
import type { World } from '../world/World';
import type { BurdenSystem } from './Burden';
import { CrossCamera } from './cross-camera';
import { CameraOcclusion } from './cross-occlusion';
import { CrossFx } from './cross-fx';
import { findTomb, planSackPath, type TombInfo } from './cross-path';
import { PoseTweaks } from './cross-pose';
import { SackRoll } from './cross-roll';
import { detachSack, type SackBody } from './cross-sack';
import { CrossShots, type Shot } from './cross-shots';
import { clamp, type BurdenPlayer, type BurdenPlayerMode } from './cross-types';

export interface CrossDropContext {
  player: BurdenPlayer;
  world: World;
  burden: BurdenSystem;
  state: GameState;
  /** The tomb (the level's 'tomb' landmark position); y is re-read from the terrain. */
  tomb: THREE.Vector3;
  /** Polled every step; true skips to the end state (e.g. hold Space). */
  skip?: () => boolean;
  /** Aborted by the owner going away (the session ends): stop at once, no end state, nothing emitted. */
  signal?: AbortSignal;
}

/** Plays the whole sequence; resolves when the player has control again. No-op when not burdened. */
export async function runCrossDrop(ctx: CrossDropContext): Promise<void> {
  await new CrossDropRun(ctx).play();
}

/** Beats (s). The silence is GDD 2.7.1's 1.5 s, counted from the thoom. */
const T = { slow: 1.0, land: 1.5, settle: 0.35, kneel: 1.0, lookUp: 0.9, snapGap: 0.75, fall: 0.5, holdTomb: 0.3,
  silence: 1.5, stretch: 1.6, unstretch: 0.35, joy: 1.45, end: 0.3, rollMax: 25 } as const; // prettier-ignore
/** After Player.render (which animates the character) and the follow camera, before the world's frame. */
const ORDER = PLAY_ORDER.cameraOverride;
const SKIP = Symbol('cross-skip');
/** The camera keeps this far from Christian's chest (m). */
const CAMERA_CLEAR = { radius: 2.0, chest: 0.9 } as const;

interface Pending {
  until: number;
  pred: (() => boolean) | null;
  resolve: () => void;
  reject: (reason: unknown) => void;
}

class CrossDropRun {
  private readonly engine: Engine | null;
  private readonly system: System;
  private removeSystem: (() => void) | null = null;
  private readonly cam: CrossCamera | null;
  private readonly shots = new CrossShots();
  private readonly pose = new PoseTweaks();
  private readonly fx: CrossFx;
  private readonly prevMode: BurdenPlayerMode;
  private readonly prevScale: number;
  private readonly prevWalkOnly: boolean;
  private readonly onAbort = (): void => this.abort();
  /** The joy leap borrows the clip's own root motion; this is what to put back. */
  private rootMotion: { was: boolean | undefined } | null = null;
  private time = 0;
  private pending: Pending | null = null;
  private skipping = false;
  private finished = false;
  private slowing = false;
  private slowT = 0;
  private freed = false;
  private joyMusic = false;
  private detached = false;
  private thoomAt = -1;
  private shot: Shot = 'none';
  private tomb: TombInfo | null = null;
  private sack: SackBody | null = null;
  private roll: SackRoll | null = null;
  private readonly chest = new THREE.Vector3();

  constructor(private readonly ctx: CrossDropContext) {
    this.engine = services.tryGet('engine') ?? null;
    this.cam = this.engine
      ? new CrossCamera(
          this.engine.camera,
          ctx.world.terrain,
          settings.data.reduceMotion,
          new CameraOcclusion(ctx.world.colliders, ctx.player.renderPosition),
        )
      : null;
    this.prevMode = ctx.player.mode;
    this.prevScale = ctx.player.speedScale;
    this.prevWalkOnly = ctx.player.walkOnly;
    this.fx = new CrossFx({
      world: ctx.world,
      wobble: (amp) => this.pose.wobble(amp),
      shake: (amp) => this.cam?.shake(amp),
      inTomb: () => (this.thoomAt = this.time),
      character: () => this.char,
    });
    this.system = {
      update: (dt) => this.update(dt),
      render: (alpha, frameDt) => this.render(alpha, frameDt),
    };
  }

  /** Always the live character (the Player rebuilds it on an outfit swap). */
  private get char(): Character {
    return this.ctx.player.character;
  }

  async play(): Promise<void> {
    if (!this.ctx.state.burden || this.ctx.signal?.aborted) return; // nothing to drop, or nobody left to watch
    this.ctx.signal?.addEventListener('abort', this.onAbort, { once: true });
    if (this.engine) this.removeSystem = this.engine.loop.add(this.system, ORDER);
    else this.skipping = true; // no loop to time a cutscene: straight to the end state
    try {
      if (!this.skipping) await this.choreograph();
    } catch (err) {
      if (err !== SKIP) throw err;
    } finally {
      this.finish();
      this.dispose();
    }
  }

  // ------------------------------------------------------------------------------------- the sequence

  private async choreograph(): Promise<void> {
    const { player, burden, world } = this.ctx;
    burden.beginDrop();
    events.emit('music:silence', { fade: 2 });
    events.emit('hud:visible', { on: false });
    this.tomb = findTomb(world, this.ctx.tomb, player.renderPosition);
    this.shots.aspect = this.engine?.camera.aspect ?? this.shots.aspect;
    this.shots.setFrame(player.forward, player.renderPosition, this.tomb.mouth);
    this.cam?.begin();
    this.shots.baseFov = this.cam?.startFov ?? this.shots.baseFov;
    this.chest.copy(player.renderPosition).setY(player.renderPosition.y + CAMERA_CLEAR.chest);
    this.cam?.avoid(this.chest, CAMERA_CLEAR.radius);
    this.setShot('kneel', 2.2);

    // Input slows to a stop (walking only: no hops or climbs), then he settles on his feet before the scene.
    player.walkOnly = true;
    this.slowing = true;
    await this.wait(T.slow);
    this.slowing = false;
    player.speedScale = 0;
    player.mode = 'locked'; // physics on, no input: whatever he was doing ends on the ground
    await this.until(() => player.controller.grounded, T.land);
    player.mode = 'cutscene';
    this.char.animator.params.speed = 0;
    this.char.animator.play('idle', { fade: 0.3 });
    await this.wait(T.settle);
    this.char.animator.play('kneel', { fade: 0.8 });
    this.char.setExpression('sad');
    await this.wait(T.kneel);
    this.pose.setLookUp(true, 0.9);
    this.char.setExpression('neutral');
    // A portrait screen cannot hold him and the tomb side by side: swing round in front of him while the ropes go.
    if (this.shots.narrow) this.setShot('chase', T.lookUp + T.snapGap * 2);
    await this.wait(T.lookUp);

    for (let i = 0; i < 3; i++) {
      this.fx.snapRope(i);
      await this.wait(i < 2 ? T.snapGap : T.fall);
    }
    this.dropSack();
    await this.until(() => this.roll?.done ?? true, T.rollMax);

    // 1.5 s of true silence from the thoom: hold on the tomb, then come back to Christian, who gets up.
    if (this.thoomAt < 0) this.thoomAt = this.time;
    await this.waitUntil(this.thoomAt + T.holdTomb);
    this.setShot('return', T.silence - T.holdTomb);
    this.pose.watch(null, 0.6);
    this.pose.setLookUp(false, 0.6);
    this.char.animator.play('idle', { fade: 0.9 });
    await this.waitUntil(this.thoomAt + T.silence);

    // Free!
    this.startJoyMusic();
    this.free();
    this.char.setExpression('happy');
    this.pose.setStretch(true, 0.7);
    this.fx.sparkle('chest', 18);
    await this.wait(T.stretch);
    this.pose.setStretch(false, 0.5);
    await this.wait(T.unstretch);
    const anim = this.char.animator;
    this.rootMotion = { was: anim.params.rootMotion };
    anim.params.rootMotion = true; // the clip's own leap: the controller stands still in a cutscene
    anim.play('joyJump', { fade: 0.15, restart: true });
    this.fx.sparkle('hips', 24);
    await this.wait(T.joy);
    this.restoreRootMotion();
    await this.wait(T.end);
  }

  /** The sack comes off: the character's copy hides, a loose one takes its place and starts its trip. */
  private dropSack(): void {
    const { player, world } = this.ctx;
    const c = this.char;
    const tomb = this.tomb ?? findTomb(world, this.ctx.tomb, player.renderPosition);
    const body = detachSack(c, world.scene);
    c.setBurdenSize(0);
    this.detached = true;
    this.sack = body;
    // It lands behind him, a little towards the tomb, then finds its way down around him.
    const feet = player.renderPosition;
    const land = this.shots.forward.clone().multiplyScalar(-1);
    const toTomb = tomb.entry.clone().sub(feet).setY(0);
    if (toTomb.lengthSq() > 1e-6) land.addScaledVector(toTomb.normalize(), 0.6);
    land.setY(0);
    if (land.lengthSq() < 1e-4) land.copy(this.shots.forward).multiplyScalar(-1);
    land
      .normalize()
      .multiplyScalar(0.75 + body.radius)
      .add(feet);
    const path = planSackPath(world, land, tomb.entry, feet, body.radius);
    this.roll = new SackRoll(body, path, tomb, this.fx);
    // The kneel shot watches it fall; the chase starts with the first bounce (update()).
  }

  private restoreRootMotion(): void {
    if (!this.rootMotion) return;
    this.char.animator.params.rootMotion = this.rootMotion.was;
    this.rootMotion = null;
  }

  /** The Burden is gone, for good: free movement, joy jumps, the save and everyone listening. */
  private free(): void {
    if (this.freed) return;
    this.freed = true;
    this.ctx.burden.completeDrop();
    this.ctx.state.setBurden(false);
    events.emit('burden:dropped');
  }

  private startJoyMusic(): void {
    if (this.joyMusic) return;
    this.joyMusic = true;
    events.emit('music:play', { id: 'pilgrim', state: 'joy' });
    // 'music:silence' also hushed the ambience; it comes back slowly under the theme.
    const amb = this.ctx.world.level.ambience;
    if (isAmbienceId(amb)) events.emit('ambience:set', { id: amb, fade: 4 });
  }

  private setShot(shot: Shot, seconds: number): void {
    this.shot = shot;
    this.shots.update(shot, this.ctx.player.renderPosition, this.roll, this.tomb);
    this.cam?.to(this.shots, seconds);
  }

  // ------------------------------------------------------------------------------------------- driving

  private update(dt: number): void {
    this.time += dt;
    const player = this.ctx.player;
    if (!this.skipping && (this.ctx.skip?.() === true || !player.character.root.parent)) this.startSkip();
    if (this.slowing) {
      this.slowT += dt;
      player.speedScale = this.prevScale * (1 - clamp(this.slowT / T.slow, 0, 1));
    }
    this.pose.step(dt);
    const roll = this.roll;
    if (roll) {
      roll.step(dt);
      if (!roll.done) this.pose.watch(roll.pos, 0.4);
    }
    // Live goals: he may still be drifting to a stop, and the sack keeps moving.
    this.chest.copy(player.renderPosition).setY(player.renderPosition.y + CAMERA_CLEAR.chest);
    if (this.shot === 'kneel' && roll && roll.phase !== 'fall') this.setShot('chase', 1.8);
    else if (this.shot !== 'none') this.shots.update(this.shot, player.renderPosition, roll, this.tomb);
    const p = this.pending;
    if (p && (this.time >= p.until || p.pred?.() === true)) {
      this.pending = null;
      p.resolve();
    }
  }

  private render(alpha: number, frameDt: number): void {
    if (this.finished) return;
    const loop = this.engine?.loop;
    const dt = !loop || loop.paused ? 0 : frameDt * loop.timeScale;
    this.roll?.render(alpha);
    this.cam?.render(dt);
    this.pose.apply(this.char);
  }

  private wait(seconds: number): Promise<void> {
    return this.waitUntil(this.time + seconds);
  }

  private waitUntil(time: number): Promise<void> {
    return this.until(null, Math.max(0, time - this.time));
  }

  private until(pred: (() => boolean) | null, maxSeconds: number): Promise<void> {
    if (this.skipping) return Promise.reject(SKIP);
    return new Promise<void>((resolve, reject) => {
      this.pending = { until: this.time + maxSeconds, pred, resolve, reject };
    });
  }

  private startSkip(): void {
    this.skipping = true;
    const p = this.pending;
    this.pending = null;
    p?.reject(SKIP);
  }

  /** The end state, however far the sequence got (normal end, skip, error). Idempotent. */
  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    if (!this.detached) this.char.setBurdenSize(0);
    this.restoreRootMotion();
    this.startJoyMusic();
    this.free();
    const c = this.char;
    if (this.skipping) {
      c.animator.play('idle', { fade: 0.3 });
      c.setExpression('happy');
    }
    this.pose.reset(c);
    this.cam?.end(this.skipping ? 0.6 : 1.0);
    this.restorePlayer();
    events.emit('hud:visible', { on: true });
  }

  /** The owner went away mid-sequence: let go at once. No music, no events, no state change, no camera hand-back. */
  private abort(): void {
    if (this.finished) return;
    this.finished = true;
    this.skipping = true;
    this.restoreRootMotion();
    this.pose.reset(this.char);
    this.cam?.release();
    this.restorePlayer();
    const p = this.pending;
    this.dispose();
    p?.reject(SKIP);
  }

  private restorePlayer(): void {
    const { player } = this.ctx;
    player.mode = this.prevMode;
    player.speedScale = this.prevScale;
    player.walkOnly = this.prevWalkOnly;
  }

  private dispose(): void {
    this.ctx.signal?.removeEventListener('abort', this.onAbort);
    this.removeSystem?.();
    this.removeSystem = null;
    this.pending = null;
    this.sack?.dispose();
    this.sack = null;
    this.roll = null;
  }
}
