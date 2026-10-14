/**
 * Sounds and particles of the Cross (GDD 2.7.1): the three rope snaps (rising plucks, rope fibres, the sack
 * swinging), the sack's two bouncing 'sack_roll's and its dust, the tomb's echoing "thoom", and the sparkles of
 * freedom. Implements the rolling sack's SackFx hooks. Positions are copied into scratch vectors (no allocation
 * beyond the sfx event payloads).
 */
import * as THREE from 'three';
import '../audio/events';
import { stepPitch } from '../audio/sfx/pitch';
import { events } from '../core/Events';
import type { Character } from '../gen/CharacterFactory';
import type { World } from '../world/World';
import type { SackFx } from './cross-roll';
import { at3 } from './cross-types';

const UP = new THREE.Vector3(0, 1, 0);
/** Rope snaps: the sack swings harder each time. */
const WOBBLE = [0.12, 0.2, 0.28] as const;

export interface CrossFxHost {
  readonly world: World;
  /** A rope snapped: swing the sack (PoseTweaks.wobble). */
  wobble(amp: number): void;
  /** A small camera settle (ignored with Reduce camera motion). */
  shake(amp: number): void;
  /** The sack is in the tomb (the 1.5 s of silence count from here). */
  inTomb(): void;
  /** The character the player shows now (it can change with an outfit swap). */
  character(): Character;
}

export class CrossFx implements SackFx {
  private readonly p = new THREE.Vector3();
  private readonly dust: string;

  constructor(private readonly host: CrossFxHost) {
    this.dust = host.world.palette.ground.path;
  }

  /** Rope i (0, 1: the shoulder ropes; 2: the knot on top of the sack) snaps. */
  snapRope(i: number): void {
    const c = this.host.character();
    const bone = c.bones[i === 0 ? 'upperArmL' : i === 1 ? 'upperArmR' : 'sack'];
    const p = bone ? bone.getWorldPosition(this.p) : this.p.copy(c.root.position).setY(c.root.position.y + 1);
    if (i === 2) p.y += c.height * 0.2;
    events.emit('sfx', { id: 'rope_snap', at: at3(p), pitch: stepPitch('rope_snap', i) });
    const rope = c.recipe.colors['sackRope'] ?? c.recipe.colors['belt'] ?? '#C9A66B';
    this.host.world.particles.emit('dust', p, 7, { color: rope, spread: 0.06 });
    this.host.wobble(WOBBLE[Math.min(i, WOBBLE.length - 1)] ?? 0.2);
    if (i === 0) c.setExpression('surprised');
    if (i === 2) this.host.shake(0.025);
  }

  /** Sparkles (and a twinkle) from a bone of the character. */
  sparkle(bone: string, count: number): void {
    const c = this.host.character();
    const b = c.bones[bone];
    const p = b ? b.getWorldPosition(this.p) : this.p.copy(c.root.position).setY(c.root.position.y + 1);
    this.host.world.particles.emit('sparkle', p, count, { spread: 0.4 });
    events.emit('sfx', { id: 'sparkle', at: at3(p) });
  }

  // SackFx ------------------------------------------------------------------------------------------

  bounce(n: number, g: THREE.Vector3): void {
    events.emit('sfx', { id: 'sack_roll', at: at3(g), pitch: n === 0 ? 1 : 1.08 });
    this.puff(g, 10, 0.3);
  }

  land(g: THREE.Vector3): void {
    this.puff(g, 5, 0.25);
  }

  rolling(g: THREE.Vector3): void {
    this.puff(g, 2, 0.2);
  }

  thoom(m: THREE.Vector3): void {
    this.host.inTomb();
    events.emit('sfx', { id: 'tomb_thoom', at: at3(m) });
    this.p.copy(m).addScaledVector(UP, 0.3);
    this.host.world.particles.emit('dust', this.p, 18, { color: this.dust, spread: 0.6 });
    this.p.y += 0.3;
    this.host.world.particles.emit('smoke', this.p, 2, { color: this.dust });
    this.host.shake(0.035);
    this.host.character().setExpression('surprised');
  }

  private puff(g: THREE.Vector3, count: number, spread: number): void {
    this.p.copy(g).addScaledVector(UP, 0.05);
    this.host.world.particles.emit('dust', this.p, count, { color: this.dust, spread });
  }
}
