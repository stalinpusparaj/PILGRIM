/**
 * Footstep sounds (GDD 2.13): after each animation update the Player polls the Animator's foot-plant counter
 * (`animator.steps`); every new plant emits one `'sfx' step_<surface>` at the planted foot, the surface coming from
 * CollisionWorld.surfaceAt (mud / water zones, the Way's dirt, grass, wood and stone colliders).
 *
 *   const steps = new Footsteps(col);
 *   steps.bind(character);                       // again after an outfit swap
 *   character.update(dt); steps.poll(grounded, burdened, running);
 */
import * as THREE from 'three';
import '../audio/events';
import type { SfxId } from '../audio/types';
import { events } from '../core/Events';
import type { Character } from '../gen/CharacterFactory';
import type { CollisionWorld } from '../world/Collision';

/** Surface kind → footstep effect. Unknown kinds fall back to grass. */
const STEP_SFX: Readonly<Record<string, SfxId | undefined>> = {
  dirt: 'step_dirt',
  stone: 'step_stone',
  mud: 'step_mud',
  wood: 'step_wood',
  grass: 'step_grass',
  water: 'step_water',
};

/** Burdened plants are heavier (lower, louder); running ones lighter and quicker. */
const VOICE = {
  burdened: { volume: 1, pitch: 0.86 },
  walk: { volume: 0.8, pitch: 1 },
  run: { volume: 0.9, pitch: 1.07 },
  /** ± random pitch per step so a walk never sounds like a loop. */
  jitter: 0.05,
} as const;

const footL = new THREE.Vector3();
const footR = new THREE.Vector3();

export class Footsteps {
  private character: Character | null = null;
  private last = 0;
  private seed = 1;
  /** Steps emitted so far (tests / debug). */
  count = 0;

  constructor(private readonly col: CollisionWorld) {}

  /** Follow `c` (also after an outfit swap): its current plant count becomes the baseline. */
  bind(c: Character | null): void {
    this.character = c;
    this.last = c ? c.animator.steps : 0;
  }

  /**
   * Call after `character.update()`. Plants while airborne are dropped (the clip may still count them).
   * `feetY` (the controller's feet) picks the right layer under bridges.
   */
  poll(grounded: boolean, burdened: boolean, running: boolean, feetY?: number): void {
    const c = this.character;
    if (!c) return;
    const steps = c.animator.steps;
    if (steps === this.last) return;
    this.last = steps;
    if (!grounded) return;

    const foot = this.plantedFoot(c);
    const surface = this.col.surfaceAt(foot.x, foot.z, feetY);
    const voice = burdened ? VOICE.burdened : running ? VOICE.run : VOICE.walk;
    this.count++;
    events.emit('sfx', {
      id: STEP_SFX[surface] ?? 'step_grass',
      at: [foot.x, foot.y, foot.z],
      volume: voice.volume,
      pitch: voice.pitch * (1 + (this.rand() * 2 - 1) * VOICE.jitter),
    });
  }

  dispose(): void {
    this.character = null;
  }

  /** The lower foot is the one that just planted. */
  private plantedFoot(c: Character): THREE.Vector3 {
    const l = c.bones['footL'];
    const r = c.bones['footR'];
    if (!l || !r) return c.root.getWorldPosition(footL);
    l.getWorldPosition(footL);
    r.getWorldPosition(footR);
    return footL.y <= footR.y ? footL : footR;
  }

  /** Tiny deterministic LCG in [0,1) (no Math.random: repeatable runs). */
  private rand(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }
}
