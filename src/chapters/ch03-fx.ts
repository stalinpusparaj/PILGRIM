/**
 * Under the leaning mountain (GDD 2.10 Ch III): the sky darkens (the chapter's sun and hemisphere lights ease
 * down), fire flickers slowly on the mountain's face (ember / fire particle bursts, well under 3 a second: GDD
 * 2.15 accessibility, no full-screen flashes), pebbles rattle down near Christian (dust puffs with a quiet, low
 * 'tomb_thoom' rumble). `end()` eases the light back. Everything is restored on dispose.
 */
import * as THREE from 'three';
import { events } from '../core/Events';
import { Rng } from '../gen/rng';
import type { ChapterContext } from './types';

/** How far the lights dim (factor) and how fast they ease (1/s). */
const DIM = { sun: 0.45, hemi: 0.6, ease: 0.7 };
/** Seconds between fire flickers (random in range): at most ~2 a second. */
const FLICKER = { min: 0.55, max: 1.1, count: 7 };
/** Seconds between pebble falls (random in range). */
const PEBBLES = { min: 1.6, max: 3.2, count: 9, near: 4, far: 10 };
const RUMBLE = { volume: 0.28, pitch: 0.8 };
/** Where fire shows on the mountain: around its centre, this high up and this far toward the road side (-Z). */
const FACE = { x: 16, yMin: 18, yMax: 40, zMin: 8, zMax: 26 };

export class MountainFx {
  /** Flickers and pebble falls so far (probe / tests). */
  flickers = 0;
  pebbles = 0;
  private on = false;
  private factor = 0; // 0 bright .. 1 dark
  private flickerIn = 0;
  private pebbleIn = 0;
  private readonly rng: Rng;
  private readonly sun: THREE.DirectionalLight;
  private readonly hemi: THREE.HemisphereLight;
  private readonly sunBase: number;
  private readonly hemiBase: number;
  private readonly mountain: THREE.Vector3 | null;
  private readonly fireDir = new THREE.Vector3(0, 1, -0.4);
  private readonly tmp = new THREE.Vector3();

  constructor(private readonly ctx: ChapterContext) {
    const world = ctx.session.world;
    this.rng = new Rng(ctx.level.seed ^ 0xf1e5);
    this.sun = world.sun;
    this.hemi = world.hemi;
    this.sunBase = this.sun.intensity;
    this.hemiBase = this.hemi.intensity;
    this.mountain = ctx.landmark('mountain_overhang');
  }

  get active(): boolean {
    return this.on;
  }

  begin(): void {
    if (this.on) return;
    this.on = true;
    this.flickerIn = 0.4;
    this.pebbleIn = 1.2;
  }

  end(): void {
    this.on = false;
  }

  update(dt: number): void {
    const want = this.on ? 1 : 0;
    if (this.factor !== want) {
      const k = Math.min(1, dt * DIM.ease);
      this.factor += (want - this.factor) * k;
      if (Math.abs(this.factor - want) < 0.005) this.factor = want;
      this.sun.intensity = this.sunBase * (1 - this.factor * (1 - DIM.sun));
      this.hemi.intensity = this.hemiBase * (1 - this.factor * (1 - DIM.hemi));
    }
    if (!this.on) return;
    this.flickerIn -= dt;
    if (this.flickerIn <= 0) {
      this.flickerIn = this.rng.range(FLICKER.min, FLICKER.max);
      this.flicker();
    }
    this.pebbleIn -= dt;
    if (this.pebbleIn <= 0) {
      this.pebbleIn = this.rng.range(PEBBLES.min, PEBBLES.max);
      this.pebbleFall();
    }
  }

  dispose(): void {
    this.on = false;
    this.sun.intensity = this.sunBase;
    this.hemi.intensity = this.hemiBase;
  }

  /** One slow lick of fire on the mountain's face. */
  private flicker(): void {
    const m = this.mountain;
    if (!m) return;
    const r = this.rng;
    this.tmp.set(
      m.x + r.range(-FACE.x, FACE.x),
      m.y + r.range(FACE.yMin, FACE.yMax),
      m.z - r.range(FACE.zMin, FACE.zMax),
    );
    const particles = this.ctx.session.world.particles;
    particles.emit(r.chance(0.35) ? 'fire' : 'ember', this.tmp, FLICKER.count, {
      dir: this.fireDir,
      spread: 2.5,
    });
    this.flickers++;
  }

  /** Pebbles rattle down somewhere just ahead of Christian, toward the mountain. */
  private pebbleFall(): void {
    const r = this.rng;
    const p = this.ctx.session.player.controller.position;
    const d = r.range(PEBBLES.near, PEBBLES.far);
    const a = r.range(-0.9, 0.9); // mostly on the mountain side (+Z)
    this.tmp.set(p.x + Math.sin(a) * d, 0, p.z + Math.cos(a) * d);
    this.tmp.y = this.ctx.session.world.terrain.heightAt(this.tmp.x, this.tmp.z) + 0.3;
    this.ctx.session.world.particles.emit('dust', this.tmp, PEBBLES.count, { spread: 1.2 });
    events.emit('sfx', {
      id: 'tomb_thoom',
      at: [this.tmp.x, this.tmp.y, this.tmp.z],
      volume: RUMBLE.volume,
      pitch: RUMBLE.pitch * r.range(0.9, 1.1),
    });
    this.pebbles++;
  }
}
