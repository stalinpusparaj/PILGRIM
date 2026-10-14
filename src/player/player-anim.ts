/**
 * Player animation selection (GDD 2.7.1, 2.12): idle / walk / run / burdenedWalk with smooth crossfades and
 * speed-matched cadence (`animator.params.speed`), the burdened hop and free jumps ('hop'), joy jumps, a 'land'
 * squash on hard landings, and held clips for scripted moments (bonk falls, ledge climbs).
 *
 * The controller owns the height (`params.rootMotion = false`), so jump clips are time-warped to the physics:
 * the anticipation plays fast, the air part is stretched to the expected air time, the pose freezes just before
 * touchdown if the fall runs long, and the landing squash plays when the feet really touch.
 * Runs in the fixed update; the Character itself is animated per rendered frame by the Player.
 */
import { CLIPS, type AnimName } from '../gen/anim';
import type { Character } from '../gen/CharacterFactory';

export interface AnimInput {
  grounded: boolean;
  /** Horizontal speed (m/s) actually moved by the controller. */
  speed: number;
  /** The player is pushing the stick / keys (a clip someone else started gives way only to this). */
  wantsMove: boolean;
  walkSpeed: number;
  runSpeed: number;
  burdened: boolean;
}

/** A fresh input record (the Player reuses one, so nothing allocates per step). */
export function newAnimInput(): AnimInput {
  return { grounded: true, speed: 0, wantsMove: false, walkSpeed: 0, runSpeed: 0, burdened: false };
}

/** Crossfade times (s). */
const FADE = { loco: 0.24, idle: 0.3, jump: 0.05, land: 0.06, afterAir: 0.14, held: 0.08 } as const;
/** Idle <-> walk hysteresis (m/s). */
const MOVE_ON = 0.3;
const MOVE_OFF = 0.14;
/** Run threshold as a fraction of the way from walk to run speed, with hysteresis. */
const RUN_ON = 0.45;
const RUN_OFF = 0.3;
/** Jump clips: anticipation speed-up, and the slowest / fastest air stretch allowed. */
const JUMP_PRE_SPEED = 2.6;
const AIR_SPEED_MIN = 0.35;
const AIR_SPEED_MAX = 2.5;
/** Freeze the air pose this far (normalised) before the clip's touchdown while still falling. */
const FREEZE_LEAD = 0.035;
/** Walking off an edge: after this long in the air without a jump, strike the hop's air pose. */
const FALL_POSE_AFTER = 0.28;
/** A one-shot can be cut by moving after this long (s). */
const CUT_AFTER: Partial<Record<AnimName, number>> = {
  land: 0.16,
  fall: 0.2,
  trip: 0.2,
  hop: 0.08,
  joyJump: 0.1,
};

type JumpClip = 'hop' | 'joyJump';

/** Clips this module plays freely. Anything else on the full layer was started by someone else (a script, prayer,
 *  the Cross, a scripted trip) and is left alone until it ends or the player asks to move. */
const MINE: ReadonlySet<AnimName> = new Set<AnimName>([
  'idle',
  'walk',
  'run',
  'burdenedWalk',
  'hop',
  'joyJump',
  'land',
]);

export class PlayerAnim {
  private c: Character | null = null;
  /** Locomotion loop last asked for; null forces a fresh pick (after jumps, holds, teleports). */
  private loco: AnimName | null = 'idle';
  /** Fade for the next locomotion pick (a landing blends in faster). */
  private nextFade = 0;
  /** Full-body one-shot that locomotion leaves alone until it ends (or moving cuts it). */
  private oneShot: AnimName | null = null;
  private oneShotT = 0;
  /** A held clip (bonk fall, climb): nothing overrides it until release(). */
  private held: AnimName | null = null;
  private jump: JumpClip | null = null;
  private jumpT = 0;
  private preEnd = 0;
  private airSpeed = 1;
  private frozen = false;
  private airSet = false;
  private airTime = 0;
  private smoothSpeed = 0;

  /** Follow a (new) character (also after an outfit swap). */
  bind(c: Character): void {
    this.c = c;
    c.animator.params.rootMotion = false;
    c.animator.onEnd = (name) => this.onEnd(name);
    c.animator.params.speed = this.smoothSpeed;
  }

  get current(): AnimName {
    return this.c?.animator.current ?? 'idle';
  }

  /** True while a held or one-shot clip owns the body. */
  get busy(): boolean {
    return this.held !== null || this.oneShot !== null;
  }

  update(dt: number, s: AnimInput): void {
    const c = this.c;
    if (!c) return;
    const a = c.animator;
    this.smoothSpeed += (s.speed - this.smoothSpeed) * (1 - Math.exp(-12 * dt));
    if (this.smoothSpeed < 0.02) this.smoothSpeed = 0;
    a.params.speed = this.smoothSpeed;
    if (this.held) return;

    if (s.grounded) this.airTime = 0;
    else this.airTime += dt;
    if (this.jump) {
      this.updateJump(dt, s);
      return;
    }
    if (this.oneShot) {
      this.oneShotT += dt;
      // Over (or replaced) even if nobody told us: onEnd may belong to someone else for a while.
      const over = a.current !== this.oneShot || a.phase >= 1;
      const cut = CUT_AFTER[this.oneShot];
      const cutNow = s.grounded && cut !== undefined && this.oneShotT >= cut && s.speed > MOVE_ON;
      if (!over && !cutNow) return;
      this.oneShot = null;
      this.loco = null;
    }
    if (!MINE.has(a.current) && !(s.wantsMove && s.grounded)) return;
    if (!s.grounded) {
      if (this.airTime > FALL_POSE_AFTER) this.fallPose();
      return;
    }
    this.playLoco(this.pickLoco(s));
  }

  /** Take-off. `airTime` = expected seconds until touchdown (from jump height and gravity). */
  jumped(joy: boolean, airTime: number): void {
    const c = this.c;
    if (!c || this.held) return;
    const name: JumpClip = joy ? 'joyJump' : 'hop';
    const clip = CLIPS[name];
    const off = (clip.cues?.[0] ?? 0.2) * clip.duration;
    const land = (clip.cues?.[1] ?? 0.7) * clip.duration;
    this.preEnd = off / JUMP_PRE_SPEED;
    const air = Math.max(0.1, airTime - this.preEnd);
    this.airSpeed = clamp((land - off) / air, AIR_SPEED_MIN, AIR_SPEED_MAX);
    this.jump = name;
    this.jumpT = 0;
    this.frozen = false;
    this.airSet = false;
    this.oneShot = null;
    this.loco = null;
    c.animator.play(name, { fade: FADE.jump, restart: true, speed: JUMP_PRE_SPEED });
  }

  /** Touchdown. Hard landings squash; soft ones finish the jump clip or blend into the walk. */
  landed(hard: boolean, moving: boolean): void {
    const c = this.c;
    if (!c || this.held) return;
    const wasJump = this.jump;
    this.jump = null;
    this.frozen = false;
    if (hard || wasJump === 'joyJump') {
      this.oneShot = 'land';
      this.oneShotT = 0;
      c.animator.play('land', { fade: FADE.land, restart: true });
      return;
    }
    if (wasJump && !moving) {
      // Let the hop play its own landing squash.
      this.oneShot = wasJump;
      this.oneShotT = 0;
      c.animator.play(wasJump, { speed: 1 });
      return;
    }
    this.oneShot = null;
    this.loco = null;
    this.nextFade = FADE.afterAir;
  }

  /** Scripted clip that nothing overrides until release() (bonk fall, ledge climb). */
  hold(name: AnimName, speed = 1, fade: number = FADE.held): void {
    const c = this.c;
    if (!c) return;
    this.held = name;
    this.jump = null;
    this.oneShot = null;
    this.frozen = false;
    c.animator.play(name, { fade, restart: true, speed });
  }

  /** Ends a hold. A one-shot keeps playing until it ends or the player moves; a loop hands over at once. */
  release(): void {
    const name = this.held;
    if (!name) return;
    this.held = null;
    const a = this.c?.animator;
    if (a && !CLIPS[name].loop && a.current === name && a.phase < 1) {
      this.oneShot = name;
      this.oneShotT = CUT_AFTER[name] ?? 0;
    } else {
      // A loop (climb) or a finished one-shot: hand over to standing now (nobody else started it).
      this.oneShot = null;
      this.loco = 'idle';
      a?.play('idle', { fade: FADE.idle });
    }
  }

  /** Forget jump/one-shot state (teleports). */
  reset(): void {
    this.jump = null;
    this.oneShot = null;
    this.frozen = false;
    this.airTime = 0;
    this.loco = null;
  }

  dispose(): void {
    if (this.c && this.c.animator.onEnd) this.c.animator.onEnd = undefined;
    this.c = null;
  }

  // -------------------------------------------------------------------------------------------- inside

  private pickLoco(s: AnimInput): AnimName {
    const fromRest = this.loco === null || this.loco === 'idle';
    const moving = fromRest ? s.speed > MOVE_ON : s.speed > MOVE_OFF;
    if (!moving) return 'idle';
    if (s.burdened || s.runSpeed <= s.walkSpeed + 0.2) return s.burdened ? 'burdenedWalk' : 'walk';
    const span = s.runSpeed - s.walkSpeed;
    const runAt = s.walkSpeed + span * (this.loco === 'run' ? RUN_OFF : RUN_ON);
    return s.speed > runAt ? 'run' : 'walk';
  }

  private playLoco(name: AnimName): void {
    const a = this.c?.animator;
    if (!a) return;
    if (name === this.loco && a.current === name) return;
    const fade = this.nextFade > 0 ? this.nextFade : name === 'idle' ? FADE.idle : FADE.loco;
    this.nextFade = 0;
    this.loco = name;
    a.play(name, { fade });
  }

  private updateJump(dt: number, s: AnimInput): void {
    const a = this.c!.animator;
    const name = this.jump!;
    this.jumpT += dt;
    if (a.current !== name) {
      this.jump = null; // something else took over
      return;
    }
    if (this.jumpT >= this.preEnd && !this.airSet && !this.frozen) {
      this.airSet = true;
      a.play(name, { speed: this.airSpeed });
    }
    // Still falling near the clip's touchdown: hold the reaching pose until the feet really land.
    const clip = CLIPS[name];
    const landU = clip.cues?.[1] ?? 0.7;
    if (!this.frozen && !s.grounded && a.phase >= landU - FREEZE_LEAD) {
      this.frozen = true;
      a.play(name, { speed: 0 });
    }
  }

  /** Walked off an edge: strike the hop's air pose and hold it until touchdown. */
  private fallPose(): void {
    const a = this.c!.animator;
    if (this.jump) return;
    this.jump = 'hop';
    this.jumpT = 0;
    this.preEnd = 0;
    this.airSpeed = AIR_SPEED_MAX;
    this.frozen = false;
    this.airSet = true;
    this.loco = null;
    a.play('hop', { fade: FADE.afterAir, restart: true, speed: AIR_SPEED_MAX });
  }

  private onEnd(name: AnimName): void {
    if (this.oneShot === name) this.oneShot = null;
    if (this.jump === name) this.jump = null;
    if (this.held === name && !CLIPS[name].loop) {
      // A held one-shot that finished: keep the last pose until release() (the Animator would fall back).
      this.c?.animator.play(name, { speed: 0 });
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
