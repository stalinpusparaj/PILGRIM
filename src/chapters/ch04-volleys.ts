/**
 * The volley director of Chapter IV (GDD 2.10 Ch IV, 2.7.3): decides when the castle shoots, where the arrows
 * land and what a hit does. The arrows themselves are ch04-arrows.ts.
 *
 * - Volleys only while Christian stands in the level's 'volley' zone (the approach field) and plays; none inside
 *   the wall, none during talks and cutscenes.
 * - Rhythm (GDD: "moves from rock to rock between volleys"): a volley of `count` arrows lands `warn` s after its
 *   marks appear, then a quiet window of `quiet` s before the next marks. Easy (the default): 4 arrows, 1.4 s
 *   warnings, 6-7.5 s of quiet; Normal: 6-7 arrows, 1.0 s, 4.5-5.5 s. Read from Settings at every volley.
 * - Aim: one arrow at Christian's feet (if he is in the open) and the rest scattered 1.2-4.5 m round him, never
 *   outside the field and never within `leeRadius` of a cover rock's lee (the Way side of each rock), so a pilgrim
 *   who waits behind a rock is always safe.
 * - A hit (within `hit` m of a landing arrow) is the engine's bonk ('arrow': dust, stars, Hope -5, toast); as soon
 *   as the bonk has popped him back we move him to the last cover rock he reached (GDD: "a hit = bonk back to the
 *   last rock"), facing along the Way.
 */
import * as THREE from 'three';
import { services } from '../core/Services';
import type { Rng } from '../gen/rng';
import type { ArrowVolleys } from './ch04-arrows';
import type { ChapterContext } from './types';

export interface VolleyTuning {
  count: readonly [number, number];
  warn: number;
  quiet: readonly [number, number];
}

export const VOLLEY_TUNING: Readonly<Record<'easy' | 'normal', VolleyTuning>> = {
  easy: { count: [4, 4], warn: 1.4, quiet: [6, 7.5] },
  normal: { count: [6, 7], warn: 1.0, quiet: [4.5, 5.5] },
};

export const COVER = {
  /** No arrow lands this close to a rock's lee point (m). */
  leeRadius: 2.2,
  /** Christian is hit when his feet are this close to a landing arrow (m). */
  hit: 0.8,
  /** Scatter of the other arrows round him (m). */
  spread: [1.2, 4.5] as const,
  /** Two arrows of one volley never land closer than this (m). */
  apart: 1.0,
  /** Arrows leave the castle this high above its landmark, spread this wide along it (m). */
  originLift: 11,
  originSpread: 7,
  /** First volley this long after the field is entered (s). */
  firstDelay: 2.5,
  /** The bonk's dust puff (0.2 s) has popped him back by then: move him to the rock (s). */
  rockAfter: 0.3,
} as const;

const tmp = new THREE.Vector3();
const way = new THREE.Vector3();

export class VolleyDirector {
  /** False: no more volleys (inside the wall, during the gate scene). */
  enabled = true;
  /** Volleys fired and hits taken so far (tests, debug). */
  volleys = 0;
  hits = 0;
  private lastRock = 0;
  private timer: number = COVER.firstDelay;
  private wasInField = false;
  private readonly targets: THREE.Vector3[] = [];
  private readonly origin = new THREE.Vector3();

  constructor(
    private readonly ctx: ChapterContext,
    private readonly arrows: ArrowVolleys,
    /** Lee points (ground) of the cover rocks, in Way order. */
    private readonly lees: readonly THREE.Vector3[],
    castle: THREE.Vector3,
    private readonly rng: Rng,
    private readonly zoneType = 'volley',
  ) {
    this.origin.copy(castle);
    this.origin.y += COVER.originLift;
    for (let i = 0; i < 8; i++) this.targets.push(new THREE.Vector3());
    arrows.onLand = (at) => this.landed(at);
  }

  /** The lee of the last rock Christian reached (index into `lees`). */
  get rock(): number {
    return this.lastRock;
  }

  setLastRock(index: number): void {
    if (index >= 0 && index < this.lees.length) this.lastRock = index;
  }

  /** The current difficulty's tuning (Settings 'difficulty', default easy). */
  tuning(): VolleyTuning {
    const d = services.tryGet('settings')?.data.difficulty ?? 'easy';
    return VOLLEY_TUNING[d === 'normal' ? 'normal' : 'easy'];
  }

  /** Fixed step: the volley clock while Christian is in the field and playing. */
  update(dt: number): void {
    const session = this.ctx.session;
    if (!this.enabled || session.isDisposed) return;
    const inField = session.zones.inZone(this.zoneType);
    if (!inField) {
      this.wasInField = false;
      return;
    }
    if (!this.wasInField) {
      this.wasInField = true;
      this.timer = Math.min(this.timer, COVER.firstDelay);
    }
    if (session.player.mode !== 'play') return;
    this.timer -= dt;
    if (this.timer > 0) return;
    const tune = this.tuning();
    const n = this.aim(tune);
    if (n > 0) {
      this.arrows.fire(this.targets.slice(0, n), this.jitteredOrigin(), tune.warn);
      this.volleys++;
    }
    this.timer = tune.warn + this.rng.range(tune.quiet[0], tune.quiet[1]);
  }

  /**
   * Picks a fixed volley round `spot` (the gate scene: where he stood when the door opened). The first arrow is
   * on the spot itself; the field and lee rules are skipped (the player is already inside).
   */
  fireAt(spot: THREE.Vector3, count: number, flight: number): number {
    const n = Math.min(count, this.targets.length);
    const ground = this.ctx.session.world.terrain;
    for (let i = 0; i < n; i++) {
      const t = this.targets[i]!;
      if (i === 0) t.copy(spot);
      else {
        const a = (i / (n - 1)) * Math.PI * 2 + this.rng.range(-0.3, 0.3);
        const r = this.rng.range(0.8, 1.6);
        t.set(spot.x + Math.sin(a) * r, 0, spot.z + Math.cos(a) * r);
      }
      t.y = ground.heightAt(t.x, t.z);
    }
    this.volleys++;
    return this.arrows.fire(this.targets.slice(0, n), this.jitteredOrigin(), flight);
  }

  dispose(): void {
    this.enabled = false;
    this.arrows.onLand = null;
  }

  // ------------------------------------------------------------------------------------------- inside

  private jitteredOrigin(): THREE.Vector3 {
    tmp.copy(this.origin);
    tmp.x += this.rng.range(-COVER.originSpread, COVER.originSpread);
    return tmp;
  }

  /** Fills `targets` for a volley round Christian; returns how many are valid. */
  private aim(tune: VolleyTuning): number {
    const session = this.ctx.session;
    const p = session.player.controller.position;
    const ground = session.world.terrain;
    const want = this.rng.int(tune.count[0], tune.count[1]);
    let n = 0;
    // Straight at him when he stands in the open.
    if (this.allowed(p.x, p.z, n)) {
      this.targets[n++]!.set(p.x, ground.heightAt(p.x, p.z), p.z);
    }
    let tries = 0;
    while (n < want && tries < want * 6) {
      tries++;
      const a = this.rng.range(0, Math.PI * 2);
      const r = this.rng.range(COVER.spread[0], COVER.spread[1]);
      const x = p.x + Math.sin(a) * r;
      const z = p.z + Math.cos(a) * r;
      if (!this.allowed(x, z, n)) continue;
      this.targets[n++]!.set(x, ground.heightAt(x, z), z);
    }
    return n;
  }

  /** Inside the field, clear of every rock's lee and of the targets picked so far. */
  private allowed(x: number, z: number, picked: number): boolean {
    const session = this.ctx.session;
    if (!session.zones.isTypeAt(this.zoneType, x, z)) return false;
    const lee2 = COVER.leeRadius * COVER.leeRadius;
    for (const l of this.lees) {
      const dx = l.x - x;
      const dz = l.z - z;
      if (dx * dx + dz * dz < lee2) return false;
    }
    const apart2 = COVER.apart * COVER.apart;
    for (let i = 0; i < picked; i++) {
      const t = this.targets[i]!;
      const dx = t.x - x;
      const dz = t.z - z;
      if (dx * dx + dz * dz < apart2) return false;
    }
    return true;
  }

  private landed(at: THREE.Vector3): void {
    const session = this.ctx.session;
    if (session.isDisposed) return;
    const player = session.player;
    if (player.mode !== 'play') return;
    const p = player.controller.position;
    const dx = p.x - at.x;
    const dz = p.z - at.z;
    if (dx * dx + dz * dz > COVER.hit * COVER.hit) return;
    if (!player.bonk('arrow')) return;
    this.hits++;
    const lee = this.lees[this.lastRock];
    if (!lee) return;
    // The bonk pops him back to the Way behind him; a moment later he sits dazed behind the last rock instead.
    void this.ctx.wait(COVER.rockAfter).then(() => {
      if (session.isDisposed) return;
      const main = session.world.ways.main;
      const c = main.closest(lee.x, lee.z);
      main.tangent(c.t, way);
      session.teleport(lee.x, lee.z, Math.atan2(way.x, way.z));
      session.world.particles.emit('dust', lee, 6);
    });
  }
}
