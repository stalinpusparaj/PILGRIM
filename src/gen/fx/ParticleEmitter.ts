/**
 * Continuous particle emission for src/gen/Particles.ts (re-exported there): a chimney, a campfire, a rain field round
 * the camera.
 */
import type * as THREE from 'three';
import type { EmitOptions, Particles } from '../Particles';
import type { ParticlePreset } from './particlePresets';

/** Continuous emission (a chimney, a campfire, a rain field around the camera): `rate` particles per second
 *  with the fractional remainder carried between frames. */
export class ParticleEmitter {
  private carry = 0;

  constructor(
    private readonly particles: Particles,
    public preset: ParticlePreset,
    public rate: number,
    public opts?: EmitOptions,
  ) {}

  update(dt: number, pos: THREE.Vector3): void {
    this.carry += Math.max(0, this.rate) * Math.min(Math.max(dt, 0), 0.25);
    const n = Math.floor(this.carry);
    if (n <= 0) return;
    this.carry -= n;
    this.particles.emit(this.preset, pos, n, this.opts);
  }
}
