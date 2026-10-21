/**
 * GDD 2.9 Arena: "Sky darkens with each phase". Eases the sky dome's colours, the fog and the sun and sky lights
 * toward a stormy violet by `target` (0 = the level's own look, 1 = darkest), and puts every value back exactly on
 * dispose(). Nothing is created: the dome's own uniforms (their colours are this sky's own copies) and the
 * World's lights are changed in place.
 */
import * as THREE from 'three';
import type { World } from '../world/World';

const STORM = new THREE.Color('#2A2038');
/** How much of the light is left at target 1. */
const LIGHT_LEFT = 0.5;
/** Ease rate (1/s). */
const RATE = 0.8;

export class ArenaDusk {
  /** 0..1, where the look is heading. */
  target = 0;
  private k = 0;
  private readonly colors: Array<{ c: THREE.Color; base: THREE.Color }> = [];
  private readonly sunBase: number;
  private readonly hemiBase: number;

  constructor(private readonly world: World) {
    world.sky.object.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (!(m instanceof THREE.ShaderMaterial)) return;
      for (const key of ['uTop', 'uHorizon', 'uBottom', 'uFog']) {
        const v = m.uniforms[key]?.value;
        if (v instanceof THREE.Color) this.colors.push({ c: v, base: v.clone() });
      }
    });
    const fog = world.scene.fog;
    if (fog) this.colors.push({ c: fog.color, base: fog.color.clone() });
    this.sunBase = world.sun.intensity;
    this.hemiBase = world.hemi.intensity;
  }

  /** Per rendered frame. */
  update(frameDt: number): void {
    const d = this.target - this.k;
    if (Math.abs(d) < 1e-3) return;
    this.k += d * Math.min(1, frameDt * RATE * 3);
    this.apply(this.k);
  }

  dispose(): void {
    this.apply(0);
  }

  private apply(k: number): void {
    for (const e of this.colors) e.c.copy(e.base).lerp(STORM, k * 0.75);
    this.world.sun.intensity = this.sunBase * (1 - (1 - LIGHT_LEFT) * k);
    this.world.hemi.intensity = this.hemiBase * (1 - (1 - LIGHT_LEFT) * k);
  }
}
