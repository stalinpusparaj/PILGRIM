/**
 * The Burden's little effects (GDD 2.7.1): the "huff" puff of breath in front of the face, the dust ruts the feet
 * drag when the sack has grown, landing puffs, the joy-jump sparkles and the tiny camera kick of a growth "boing".
 * Sounds go out as 'sfx' events; particles go to the world's pool. Allocation-free per step (bursts reuse vectors).
 */
import * as THREE from 'three';
import '../audio/events';
import type { SfxId } from '../audio/types';
import { events } from '../core/Events';
import { services } from '../core/Services';
import type { System } from '../core/Loop';
import type { Character } from '../gen/CharacterFactory';
import type { Particles } from '../gen/Particles';
import { Rng, hashString } from '../gen/rng';
import { PLAY_ORDER } from '../world/play-loop';
import { at3 } from './cross-types';

/** Dust kicked back from a dragging foot stays this close to its direction (EmitOptions.cone). */
const RUT_CONE = 0.35;
const SPARKLE_COUNTS = [14, 20, 28] as const;
/** Joy-jump sparkle trail: seconds of trail after take-off and the gap between puffs. */
const TRAIL = { seconds: 0.55, every: 0.05 } as const;
const KICK = { seconds: 0.55, amp: 0.028, freq: 26, decay: 7, bump: 0.35 } as const;
/** After the follow camera has placed engine.camera, before the world's frame. */
const LATE_RENDER_ORDER = PLAY_ORDER.cameraOverride;

/** The follow camera's soft downward kick (src/player/Camera.ts `bump(0..1)`), when the rig has one. */
interface Bumpable {
  bump(strength: number): void;
}
function canBump(v: unknown): v is Bumpable {
  return typeof v === 'object' && v !== null && typeof (v as { bump?: unknown }).bump === 'function';
}

export class BurdenFx {
  private readonly particles: Particles | null;
  private readonly dustColor: string;
  private readonly rng = new Rng(hashString('burden-fx'));
  private readonly p = new THREE.Vector3();
  private readonly q = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private trailLeft = 0;
  private trailWait = 0;
  private trailCount = 2;
  private kickT = -1;
  private removeKick: (() => void) | null = null;
  private readonly kickSystem: System;

  constructor(particles: Particles | null, dustColor: string) {
    this.particles = particles;
    this.dustColor = dustColor;
    this.kickSystem = { render: (_a, frameDt) => this.renderKick(frameDt) };
  }

  /**
   * A puff of breath in front of the face, blown forward and a little down, with the huff sound. `vel` (the
   * walker's velocity) is carried by the puff so it does not drift back onto the sack while he walks on.
   */
  huff(c: Character, forward: THREE.Vector3, vel?: THREE.Vector3): void {
    const head = this.bonePos(c, 'head', this.p);
    const r = c.height * 0.11;
    head.addScaledVector(forward, r * 1.6);
    head.y -= r * 0.35;
    this.dir.copy(forward).multiplyScalar(1.2);
    this.dir.y -= 0.25;
    this.particles?.emit('breath', head, 3, { dir: this.dir, vel });
    sfx('burden_huff', head);
  }

  /** The sack creaks against its ropes. */
  creak(c: Character): void {
    sfx('burden_creak', this.bonePos(c, 'sack', this.p), 0.85);
  }

  /** Feet dragging ruts: dust kicked back from the planted foot (alternating). */
  rut(c: Character, forward: THREE.Vector3, step: number): void {
    const foot = this.bonePos(c, step % 2 === 0 ? 'footL' : 'footR', this.p);
    foot.y = c.root.position.y + 0.02;
    this.dir.copy(forward).multiplyScalar(-1);
    this.dir.y = 0.15;
    this.particles?.emit('dust', foot, 3, {
      dir: this.dir,
      cone: RUT_CONE,
      color: this.dustColor,
      spread: 0.08,
    });
  }

  /** A heavy little landing: a puff at the feet. */
  landing(c: Character, count = 6): void {
    this.p.copy(c.root.position);
    this.p.y += 0.04;
    this.particles?.emit('dust', this.p, count, { color: this.dustColor });
  }

  /** A growth "boing": puff of cloth dust round the sack. */
  boing(c: Character): void {
    const at = this.bonePos(c, 'sack', this.p);
    sfx('burden_boing', at);
    this.particles?.emit('dust', at, 6, { color: this.dustColor, spread: 0.3 });
  }

  /** Joy jump n (0, 1, 2): rising note, a burst of sparkles and a short sparkle trail while airborne. */
  joyJump(c: Character, n: number, pitch: number): void {
    this.p.copy(c.root.position);
    this.p.y += c.height * 0.55;
    events.emit('sfx', { id: 'joy_note', at: at3(this.p), pitch });
    sfx('sparkle', this.p, 0.6);
    const count = SPARKLE_COUNTS[Math.min(n, SPARKLE_COUNTS.length - 1)] ?? 14;
    this.particles?.emit('sparkle', this.p, count, { spread: 0.35 });
    this.trailLeft = TRAIL.seconds;
    this.trailWait = 0;
    this.trailCount = 2 + n;
  }

  /** Fixed step: the sparkle trail follows the jumping character. */
  update(dt: number, c: Character): void {
    if (this.trailLeft <= 0) return;
    this.trailLeft -= dt;
    this.trailWait -= dt;
    if (this.trailWait > 0) return;
    this.trailWait = TRAIL.every;
    this.q.copy(c.root.position);
    this.q.x += this.rng.range(-0.15, 0.15);
    this.q.y += c.height * this.rng.range(0.2, 0.9);
    this.q.z += this.rng.range(-0.15, 0.15);
    this.particles?.emit('sparkle', this.q, this.trailCount, { spread: 0.2 });
  }

  /** Tiny camera kick (skipped while a cutscene owns the camera): the rig's own bump(), else a pitch nudge. */
  kick(): void {
    const engine = services.tryGet('engine');
    const rig = services.tryGet('cameraRig');
    if (!engine || rig?.suspended) return;
    if (canBump(rig)) {
      rig.bump(KICK.bump);
      return;
    }
    this.kickT = 0;
    this.removeKick ??= engine.loop.add(this.kickSystem, LATE_RENDER_ORDER);
  }

  dispose(): void {
    this.removeKick?.();
    this.removeKick = null;
    this.trailLeft = 0;
  }

  private renderKick(frameDt: number): void {
    const engine = services.tryGet('engine');
    if (!engine || this.kickT < 0 || this.kickT > KICK.seconds || services.tryGet('cameraRig')?.suspended) {
      this.removeKick?.();
      this.removeKick = null;
      this.kickT = -1;
      return;
    }
    if (!engine.loop.paused) this.kickT += frameDt * engine.loop.timeScale;
    const t = this.kickT;
    // The follow camera re-aims every frame, so this offset never accumulates.
    engine.camera.rotateX(-KICK.amp * Math.exp(-KICK.decay * t) * Math.sin(KICK.freq * t));
  }

  private bonePos(c: Character, bone: string, out: THREE.Vector3): THREE.Vector3 {
    const b = c.bones[bone];
    if (!b) return out.copy(c.root.position).setY(c.root.position.y + c.height * 0.7);
    return b.getWorldPosition(out);
  }
}

function sfx(id: SfxId, at: THREE.Vector3, volume?: number): void {
  events.emit('sfx', volume === undefined ? { id, at: at3(at) } : { id, at: at3(at), volume });
}
