/**
 * Actor tracks (src/narrative/cutscene-types.ts ActorTrack): fires each actor's timed actions, walks moves along a
 * Catmull-Rom path at a steady speed with the gait chosen by speed, turns bodies gently toward targets, and can
 * jump straight to the end state (skips, early ends) so positions, facing and looping clips are exactly what the
 * scene would have left. The cutscene never calls Character.update(): the World / Player keep animating their
 * own characters (CutsceneContext.animate lists the ones nobody else owns).
 */
import * as THREE from 'three';
import type { Character } from '../gen/CharacterFactory';
import { CLIPS, NOMINAL_SPEED, type AnimName } from '../gen/anim';
import type { ActorAction, CutsceneContext, PointSource } from './cutscene-types';
import { Rail, clamp01, groundHeight, resolvePoint, turnToward, yawToward } from './cutscene-math';

type SayAction = Extract<ActorAction, { do: 'say' }>;
type MoveAction = Extract<ActorAction, { do: 'moveTo' }>;

export interface ActorEnv {
  actors: Record<string, Character>;
  ground: CutsceneContext['ground'];
  say(c: Character, action: SayAction): void;
}

/** Default walking pace for scripted moves (m/s): an unhurried story walk. */
export const DEFAULT_MOVE_SPEED = 1.6;
/** Body turn rates (rad/s): toward a target, and along a path. */
const TURN_RATE = 4;
const PATH_TURN_RATE = 8;
/** Above this speed a move runs instead of walking (halfway between the nominal walk and run speeds). */
const RUN_FROM = ((NOMINAL_SPEED.walk ?? 3.4) + (NOMINAL_SPEED.run ?? 6)) / 2;
const MIN_MOVE = 0.01;

/** Gait for a scripted move: idle when (nearly) still, burdenedWalk under the Burden, walk, or run. */
export function gaitFor(c: Character, speed: number): AnimName {
  if (speed < 0.05) return 'idle';
  if (c.recipe.burden === true && c.burdenSize > 0.05) return 'burdenedWalk';
  return speed >= RUN_FROM ? 'run' : 'walk';
}

interface Move {
  rail: Rail;
  t0: number;
  dur: number;
  face: boolean;
  arrive: AnimName;
  endYaw: number;
}

type Turn = { kind: 'yaw'; yaw: number; rate: number } | { kind: 'target'; src: PointSource; rate: number };

export class ActorRunner {
  readonly name: string;
  readonly character: Character;
  private readonly actions: ActorAction[];
  private readonly env: ActorEnv;
  private next = 0;
  private move: Move | null = null;
  private turn: Turn | null = null;
  private readonly rail = new Rail();
  private readonly p = new THREE.Vector3();
  private readonly q = new THREE.Vector3();

  constructor(name: string, character: Character, actions: readonly ActorAction[], env: ActorEnv) {
    this.name = name;
    this.character = character;
    this.env = env;
    this.actions = actions
      .map((a, i) => ({ a, i }))
      .filter(({ a }) => Number.isFinite(a.at))
      .sort((x, y) => x.a.at - y.a.at || x.i - y.i)
      .map(({ a }) => a);
  }

  /** Time of the last action (0 without actions). */
  get lastAt(): number {
    return this.actions.length > 0 ? this.actions[this.actions.length - 1]!.at : 0;
  }

  /** True while a move is still walking (the cutscene waits for it unless it has a fixed duration). */
  get moving(): boolean {
    return this.move !== null;
  }

  /** Fixed step: fire every action due by `t`, and land a move whose time is up. */
  step(t: number): void {
    while (this.next < this.actions.length && this.actions[this.next]!.at <= t) {
      this.apply(this.actions[this.next++]!, false);
    }
    const m = this.move;
    if (m && t >= m.t0 + m.dur) this.land();
  }

  /** Per rendered frame at (interpolated) time `t`: place a walking actor and turn bodies. */
  pose(t: number, dt: number): void {
    const root = this.character.root;
    const m = this.move;
    if (m) {
      const u = m.dur > 0 ? clamp01((t - m.t0) / m.dur) : 1;
      m.rail.at(u, this.p);
      this.p.y = groundHeight(this.env.ground, this.p.x, this.p.z, this.p.y);
      root.position.copy(this.p);
      if (m.face) {
        m.rail.tangent(u, this.q);
        if (this.q.lengthSq() > 1e-6) {
          root.rotation.y = turnToward(root.rotation.y, Math.atan2(this.q.x, this.q.z), PATH_TURN_RATE, dt);
        }
      }
    }
    const turn = this.turn;
    if (turn && !(m && m.face)) {
      const want = this.desiredYaw(turn);
      root.rotation.y = turnToward(root.rotation.y, want, turn.rate, dt);
    }
  }

  /** Jump to the end state: land the walk, apply every action left instantly (lines are dropped), stop turning. */
  finish(): void {
    if (this.move) this.land();
    while (this.next < this.actions.length) this.apply(this.actions[this.next++]!, true);
    if (this.turn) {
      this.character.root.rotation.y = this.desiredYaw(this.turn);
      this.turn = null;
    }
  }

  // ------------------------------------------------------------------------------------------- actions

  private apply(a: ActorAction, instant: boolean): void {
    const c = this.character;
    switch (a.do) {
      case 'play': {
        // One-shots (hop, trip, knock...) are skipped when jumping to the end: the Animator would be back on
        // its last loop by then anyway.
        if (instant && !CLIPS[a.anim].loop) return;
        c.animator.play(a.anim, { fade: instant ? 0.2 : a.fade, speed: a.speed });
        return;
      }
      case 'overlay':
        if (a.anim !== null && instant && !CLIPS[a.anim].loop) return;
        c.animator.overlay(a.anim, { fade: instant ? 0.2 : a.fade });
        return;
      case 'expression':
        c.setExpression(a.expression);
        return;
      case 'moveTo':
        this.startMove(a, instant);
        return;
      case 'lookAt':
        this.turn =
          a.target === null ? null : { kind: 'target', src: a.target, rate: a.turnRate ?? TURN_RATE };
        if (instant && this.turn) {
          c.root.rotation.y = this.desiredYaw(this.turn);
          this.turn = null;
        }
        return;
      case 'face':
        if (instant) {
          c.root.rotation.y = a.yaw;
          this.turn = null;
        } else this.turn = { kind: 'yaw', yaw: a.yaw, rate: TURN_RATE };
        return;
      case 'place': {
        if (this.move) {
          this.move = null; // a teleport ends the walk where it is
          c.animator.params.speed = 0;
          c.animator.play('idle', { fade: 0.2 });
        }
        resolvePoint(a.to, this.env.actors, c.root.position, this.p);
        this.p.y = groundHeight(this.env.ground, this.p.x, this.p.z, this.p.y);
        c.root.position.copy(this.p);
        if (a.yaw !== undefined) {
          c.root.rotation.y = a.yaw;
          this.turn = null;
        }
        return;
      }
      case 'say':
        if (!instant) this.env.say(c, a);
        return;
      case 'show':
        c.root.visible = true;
        return;
      case 'hide':
        c.root.visible = false;
        return;
    }
  }

  private startMove(a: MoveAction, instant: boolean): void {
    const c = this.character;
    const speed = Math.max(0.05, a.speed ?? DEFAULT_MOVE_SPEED);
    const pts = this.rail.setCount(a.path.length + 1);
    pts[0]!.copy(c.root.position);
    for (let i = 0; i < a.path.length; i++) {
      const v = pts[i + 1]!;
      resolvePoint(a.path[i]!, this.env.actors, pts[i]!, v);
      v.y = groundHeight(this.env.ground, v.x, v.z, v.y);
    }
    this.rail.rebuild();
    const face = a.face !== false;
    this.rail.tangent(1, this.q);
    const endYaw = this.q.lengthSq() > 1e-6 ? Math.atan2(this.q.x, this.q.z) : c.root.rotation.y;
    if (face) this.turn = null; // walking steers the body; a lookAt resumes only if given again
    this.move = {
      rail: this.rail,
      t0: a.at,
      dur: this.rail.length / speed,
      face,
      arrive: a.arrive ?? 'idle',
      endYaw,
    };
    if (instant || this.rail.length < MIN_MOVE) {
      this.land();
      return;
    }
    c.animator.params.speed = speed;
    c.animator.play(a.anim ?? gaitFor(c, speed), { fade: 0.25 });
  }

  /** End of a walk: stand on the last point facing along the path, speed 0, the arrive clip. */
  private land(): void {
    const m = this.move;
    if (!m) return;
    this.move = null;
    const c = this.character;
    m.rail.at(1, this.p);
    this.p.y = groundHeight(this.env.ground, this.p.x, this.p.z, this.p.y);
    c.root.position.copy(this.p);
    if (m.face) c.root.rotation.y = m.endYaw;
    c.animator.params.speed = 0;
    c.animator.play(m.arrive, { fade: 0.3 });
  }

  private desiredYaw(turn: Turn): number {
    const root = this.character.root;
    if (turn.kind === 'yaw') return turn.yaw;
    if (!resolvePoint(turn.src, this.env.actors, root.position, this.q)) return root.rotation.y;
    return yawToward(root.position, this.q, root.rotation.y);
  }
}
