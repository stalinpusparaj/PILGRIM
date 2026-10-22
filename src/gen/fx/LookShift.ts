/**
 * Eases a built World's look (sky dome colours, scene fog colour and range, sun and sky light colours and
 * strengths) toward a target, and puts every value back exactly on dispose(). Nothing is created: the dome's own
 * colour uniforms (this sky's copies), the scene's Fog and the World's lights are changed in place.
 *
 *   const dawn = new LookShift(world, DAWN_LOOK, 4);   // 4 s ease
 *   loop: dawn.update(frameDt)                          // or dawn.snap() to arrive at once
 *   dawn.dispose();                                     // back to the level's own look
 */
import * as THREE from 'three';
import type { World } from '../../world/World';

export interface Look {
  sky?: { top: string; horizon: string; bottom: string };
  fog?: { color: string; near: number; far: number };
  sun?: { color: string; intensity: number };
  hemi?: { sky: string; ground: string; intensity: number };
}

interface ColorTrack {
  c: THREE.Color;
  from: THREE.Color;
  to: THREE.Color;
}

const SKY_KEYS = { uTop: 'top', uHorizon: 'horizon', uBottom: 'bottom' } as const;

export class LookShift {
  private readonly colors: ColorTrack[] = [];
  private readonly nums: Array<{ set(v: number): void; from: number; to: number }> = [];
  private k = 0;
  private disposed = false;

  constructor(
    world: World,
    look: Look,
    private readonly seconds = 4,
  ) {
    const track = (c: THREE.Color, hex: string): void => {
      this.colors.push({ c, from: c.clone(), to: new THREE.Color(hex) });
    };
    const num = (get: number, set: (v: number) => void, to: number): void => {
      this.nums.push({ set, from: get, to });
    };
    world.sky.object.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (!(m instanceof THREE.ShaderMaterial)) return;
      for (const [key, part] of Object.entries(SKY_KEYS)) {
        const v = m.uniforms[key]?.value;
        if (look.sky && v instanceof THREE.Color) track(v, look.sky[part]);
      }
      const fogU = m.uniforms['uFog']?.value;
      if (look.fog && fogU instanceof THREE.Color) track(fogU, look.fog.color);
    });
    const fog = world.scene.fog;
    if (look.fog && fog instanceof THREE.Fog) {
      track(fog.color, look.fog.color);
      num(fog.near, (v) => (fog.near = v), look.fog.near);
      num(fog.far, (v) => (fog.far = v), look.fog.far);
    }
    const { sun, hemi } = world;
    if (look.sun) {
      track(sun.color, look.sun.color);
      num(sun.intensity, (v) => (sun.intensity = v), look.sun.intensity);
    }
    if (look.hemi) {
      track(hemi.color, look.hemi.sky);
      track(hemi.groundColor, look.hemi.ground);
      num(hemi.intensity, (v) => (hemi.intensity = v), look.hemi.intensity);
    }
  }

  /** 0 = the level's own look, 1 = the target. */
  get amount(): number {
    return this.k;
  }

  /** Per rendered frame (or fixed step): eases toward the target. */
  update(dt: number): void {
    if (this.disposed || this.k >= 1) return;
    this.k = Math.min(1, this.k + dt / Math.max(1e-3, this.seconds));
    this.apply(this.k * this.k * (3 - 2 * this.k));
  }

  /** Arrives at the target at once (a chapter reopened after its dawn). */
  snap(): void {
    this.k = 1;
    this.apply(1);
  }

  dispose(): void {
    if (this.disposed) return;
    this.apply(0);
    this.disposed = true;
  }

  private apply(t: number): void {
    for (const e of this.colors) e.c.copy(e.from).lerp(e.to, t);
    for (const n of this.nums) n.set(n.from + (n.to - n.from) * t);
  }
}
