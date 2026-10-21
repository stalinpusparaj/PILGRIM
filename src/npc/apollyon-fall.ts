/**
 * Phase 3 of the Apollyon fight, "The fall" (GDD 2.9): he swoops in, grabs and throws Christian down; the sword
 * spins away and lands 4 m off in slow motion; "[E] Reach for the sword" for 5 s (no limit with Timed prompts
 * off). Letting the prompt run out costs a hit (he stomps) and the prompt starts again. Reaching it gives the sword
 * back and tells the fight (`swordReached`); the chapter then plays the Micah 7:8 line and his flight.
 */
import * as THREE from 'three';
import '../audio/events';
import { events } from '../core/Events';
import { services } from '../core/Services';
import type { ApollyonFight, ApollyonSub } from './Apollyon';

export const FALL = {
  swoop: 1.0,
  swoopSpeed: 9,
  grab: 1.6,
  sword: 4,
  throwTime: 1.4,
  slowScale: 0.35,
  slowFor: 0.55,
  prompt: 5,
} as const;

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

export class FallPhase {
  private offPrompt: (() => void) | null = null;
  private slowPrev: number | null = null;
  private slowLeft = 0;
  private done = false;

  constructor(private readonly f: ApollyonFight) {}

  enter(sub: ApollyonSub): void {
    if (sub === 'swoop') this.done = false;
    if (sub === 'throw') this.throwDown();
    if (sub === 'reach') this.prompt();
  }

  step(dt: number): void {
    const f = this.f;
    if (this.slowLeft > 0) {
      this.slowLeft -= dt;
      if (this.slowLeft <= 0) this.endSlow();
    }
    f.body.belly = Math.max(0, f.body.belly - dt);
    if (this.done) {
      f.facePlayer(dt);
      return;
    }
    switch (f.sub) {
      case 'swoop': {
        const p = f.playerPos;
        f.body.flap = 2.4;
        tmp.set(f.pos.x - p.x, 0, f.pos.z - p.z);
        if (tmp.lengthSq() < 1e-4) tmp.set(1, 0, 0);
        tmp.normalize().multiplyScalar(FALL.grab).add(p);
        const there = f.moveToward(tmp.x, tmp.z, FALL.swoopSpeed, dt);
        f.lift = 1.4 * Math.sin(Math.PI * Math.min(1, f.subTime / FALL.swoop));
        f.facePlayer(dt, 10);
        if ((there && f.subTime > 0.4) || f.subTime >= FALL.swoop) f.enter('throw');
        break;
      }
      case 'throw':
        f.lift = Math.max(0, f.lift - dt * 4);
        f.body.flap = 0.6;
        if (f.subTime >= FALL.throwTime) f.enter('reach');
        break;
      case 'reach': {
        f.facePlayer(dt);
        const timed = services.tryGet('settings')?.data.timedPrompts !== false;
        if (timed && f.subTime >= FALL.prompt) {
          f.body.jaw = 1;
          f.hurtPlayer(f.pos);
          events.emit('hud:toast', { key: 'ch08.toast.reachQuick' });
          f.enter('reach');
        }
        break;
      }
      default:
        break;
    }
  }

  /** Puts everything of this phase back (a restarted phase, a skip, the end). */
  reset(): void {
    this.offPrompt?.();
    this.offPrompt = null;
    this.endSlow();
    this.done = false;
    services.tryGet('guide')?.clear();
  }

  dispose(): void {
    this.reset();
  }

  private throwDown(): void {
    const f = this.f;
    const s = f.o.session;
    const player = s.player;
    const p = f.playerPos;
    player.mode = 'locked';
    player.character.animator.play('fall', { fade: 0.08 });
    events.emit('sfx', { id: 'shield_clang', at: [p.x, p.y + 1, p.z], pitch: 0.6 });
    s.camera.bump(0.9);
    // Away from him, a little to one side, 4 m off; always inside the arena.
    tmp.set(p.x - f.pos.x, 0, p.z - f.pos.z);
    if (tmp.lengthSq() < 1e-4) tmp.set(-1, 0, 0);
    tmp.normalize().applyAxisAngle(THREE.Object3D.DEFAULT_UP, 0.6);
    tmp2.copy(p).addScaledVector(tmp, FALL.sword);
    f.o.arena.clamp(tmp2, 1.5);
    tmp2.y = f.ground(tmp2.x, tmp2.z);
    const hand = player.character.bones['handR'];
    const from = hand ? hand.getWorldPosition(new THREE.Vector3()) : p.clone().setY(p.y + 1);
    f.sword.throw(player.character, from, tmp2);
    // He is knocked back a step; the world slows for the sword's spin.
    p.addScaledVector(tmp.set(p.x - f.pos.x, 0, p.z - f.pos.z).normalize(), 1);
    f.o.arena.clamp(p);
    s.col.resolve(p, 0.35, 1.5);
    s.world.particles.emit('dust', p, 14, { spread: 0.8 });
    const loop = f.o.engine.loop;
    if (this.slowPrev === null) this.slowPrev = loop.timeScale;
    loop.timeScale = this.slowPrev * FALL.slowScale;
    this.slowLeft = FALL.slowFor;
  }

  private prompt(): void {
    const f = this.f;
    const s = f.o.session;
    if (s.player.mode === 'locked') s.player.mode = 'play';
    if (this.offPrompt) return;
    s.player.character.animator.play('idle', { fade: 0.3 });
    const at = f.sword.landing.clone();
    services.tryGet('guide')?.set(at);
    this.offPrompt = s.interactables.add({
      id: 'reach_sword',
      pos: at,
      radius: 2.5,
      verb: 'ui.verb.reachSword',
      enabled: true,
      onUse: () => this.reached(),
    });
  }

  private reached(): void {
    if (this.done) return;
    const f = this.f;
    this.offPrompt?.();
    this.offPrompt = null;
    services.tryGet('guide')?.clear();
    this.done = true;
    f.sword.giveBack();
    const p = f.playerPos;
    f.o.session.world.particles.emit('sparkle', tmp.set(p.x, p.y + 1.2, p.z), 18);
    events.emit('sfx', { id: 'sparkle', at: [p.x, p.y + 1, p.z] });
    f.swordReached();
  }

  private endSlow(): void {
    if (this.slowPrev === null) return;
    this.f.o.engine.loop.timeScale = this.slowPrev;
    this.slowPrev = null;
    this.slowLeft = 0;
  }
}
