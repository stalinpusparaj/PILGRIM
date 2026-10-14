/**
 * The village of Morality that never gets any closer (GDD 2.10 Ch III). Merged landmarks cannot move, so the
 * chapter builds the 'village_door' facade itself (one lit mesh + one glow mesh, no collider: the player never
 * reaches it) and slides it along the 'wrong_hill' detour spline: whenever Christian comes within KEEP metres of
 * it along the road it eases away up the road, facing him, until the road ends or the script freezes it.
 * The start spot is the level's 'village_door' trigger (coordinates stay in the level file, CLAUDE.md rule 5).
 */
import * as THREE from 'three';
import { mat } from '../gen/materials';
import { buildProp } from '../gen/props';
import { Rng } from '../gen/rng';
import type { Way } from '../gen/Way';
import type { ChapterContext } from './types';

/** How far ahead (m along the road) the village keeps itself once Christian starts chasing it. */
const KEEP = 25;
/** Ease toward the kept distance (1/s): it visibly slides rather than teleports. */
const EASE = 1.6;
/** Only a player this close to the road's centre line is chasing the village. */
const NEAR_ROAD = 24;

export class VillageDoor {
  /** The road moves it (the script switches this on when the detour is taken). */
  active = false;
  /** Times the village slid away (probe / tests). */
  slides = 0;
  private readonly group = new THREE.Group();
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly road: Way | null;
  private readonly roadLength: number;
  private readonly pos = new THREE.Vector3();
  private readonly tan = new THREE.Vector3();
  private readonly hit = { t: 0, dist: 0, point: new THREE.Vector3() };
  private t: number;
  private frozen = false;
  private firstSlide: (() => void) | null;

  constructor(
    private readonly ctx: ChapterContext,
    opts: { detour: string; startTrigger: string; onFirstSlide?: () => void },
  ) {
    const world = ctx.session.world;
    this.road = world.wayById(opts.detour);
    this.roadLength = this.road?.length ?? 1;
    this.firstSlide = opts.onFirstSlide ?? null;
    const start = ctx.level.triggers.find((tr) => tr.id === opts.startTrigger);
    this.t = 0.5;
    if (this.road && start) this.t = this.road.closest(start.at[0], start.at[2], this.hit).t;
    const built = buildProp('village_door', new Rng(ctx.level.seed ^ 0x5d00), world.palette, { width: 3 });
    const lit = new THREE.Mesh(built.geometry, mat('lambert'));
    lit.castShadow = true;
    lit.receiveShadow = true;
    lit.name = 'ch03:village';
    this.group.add(lit);
    this.geometries.push(built.geometry);
    if (built.glow) {
      const glow = new THREE.Mesh(built.glow, mat('glow'));
      glow.name = 'ch03:village:glow';
      this.group.add(glow);
      this.geometries.push(built.glow);
    }
    this.group.name = 'ch03:village_door';
    world.scene.add(this.group);
    this.placeAt(this.t);
  }

  /** World position of the facade's base. */
  get position(): THREE.Vector3 {
    return this.group.position;
  }

  /**
   * Stops the sliding for good (Evangelist has arrived). The village still keeps its distance: if Christian got
   * close without the slide (a waystone jump, a teleport) it steps up the road one last time, to its end at most.
   */
  freeze(): void {
    this.frozen = true;
    if (!this.road) return;
    const p = this.ctx.session.player.controller.position;
    if (!this.road.closestWithin(p.x, p.z, NEAR_ROAD, this.hit)) return;
    const want = Math.min(1, this.hit.t + (KEEP * 0.75) / this.roadLength);
    if (want > this.t) this.placeAt(want);
  }

  update(dt: number): void {
    if (!this.active || this.frozen || !this.road) return;
    const p = this.ctx.session.player.controller.position;
    if (!this.road.closestWithin(p.x, p.z, NEAR_ROAD, this.hit)) return;
    const keepT = KEEP / this.roadLength;
    const want = this.hit.t + keepT;
    if (want <= this.t) return; // still far enough ahead
    if (this.t >= 1) {
      this.frozen = true; // the road ends under the mountain: the village finally stands still
      return;
    }
    const target = Math.min(1, want);
    const k = Math.min(1, dt * EASE);
    const next = this.t + (target - this.t) * k;
    if (next - this.t > 1e-5) {
      if (this.firstSlide) {
        const cb = this.firstSlide;
        this.firstSlide = null;
        this.slides++;
        cb();
      }
      this.placeAt(next);
    }
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const g of this.geometries) g.dispose();
    this.geometries.length = 0;
  }

  private placeAt(t: number): void {
    if (!this.road) return;
    this.t = t;
    this.road.sample(t, this.pos);
    this.road.tangent(t, this.tan);
    const y = this.ctx.session.world.terrain.heightAt(this.pos.x, this.pos.z);
    this.group.position.set(this.pos.x, y, this.pos.z);
    // Props face +Z: face back down the road, toward the pilgrim walking up it.
    this.group.rotation.y = Math.atan2(-this.tan.x, -this.tan.z);
  }
}
