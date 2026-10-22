/**
 * Promise pickups (GDD 2.7.5): walk into a glowing scroll to take it. No button, so the youngest players never
 * miss one. Within 1.1 m (horizontal) of a scroll that is not collected yet, and at about its height (a scroll
 * on a ledge needs the ledge or a jump), the player gets it:
 * `GameState.collectPromise(id)`, the scroll hides (`PromiseMarkers.setCollected`), a 'promise_chime', a sparkle
 * burst and the toast "A Promise!". Reading them happens in the Satchel (Phase 3).
 *
 * Scrolls already in the save start hidden; a `state:reset` (load) or a `promise:collected` from elsewhere
 * (debug, scripts) keeps the markers in step with GameState.
 *
 *   const promises = new Promises({ world, player });   // 'state' service by default
 *   loop: promises.update(dt) each fixed step, after the player moved
 */
import * as THREE from 'three';
import '../audio/events';
import { events } from '../core/Events';
import { services } from '../core/Services';
import type { GameState } from '../core/GameState';
import type { Particles } from '../gen/Particles';
import type { PromiseMarkers } from '../world/PromiseMarkers';
import type { PlayerLike } from '../world/Interactables';

export interface PromiseWorld {
  readonly promises: PromiseMarkers;
  readonly particles: Particles;
}

export interface PromisesOptions {
  world: PromiseWorld;
  player: Pick<PlayerLike, 'controller' | 'mode'>;
  /** Default: the 'state' service. */
  state?: GameState;
}

const PICKUP = {
  /** Horizontal reach (m). */
  radius: 1.1,
  /** Player feet relative to the scroll's ground anchor (m): standing next to a 1 m ledge is not enough. */
  below: 0.6,
  above: 1.9,
};
/** The scroll floats this far above its anchor (PromiseMarkers HOVER). */
const SCROLL_HEIGHT = 0.95;
const BURST = { count: 28, spread: 0.45 };
/** Curiosity nudge: "Something glows nearby..." once per Promise when he passes within this distance (m). */
const NEAR = 12;
const BURST_MOTES = { count: 12, spread: 0.3 };

export class Promises {
  private readonly markers: PromiseMarkers;
  private readonly particles: Particles;
  private readonly player: PromisesOptions['player'];
  private readonly state: GameState;
  private readonly ids: readonly string[];
  /** Anchors as x, y, z triples (static: scrolls never move). */
  private readonly anchors: Float32Array;
  private readonly taken: Uint8Array;
  private readonly nudged: Uint8Array;
  private readonly tmp = new THREE.Vector3();
  private readonly burstOpts = { spread: BURST.spread };
  private readonly motesOpts = { spread: BURST_MOTES.spread };
  private readonly offs: Array<() => void> = [];
  private disposed = false;

  constructor(o: PromisesOptions) {
    this.markers = o.world.promises;
    this.particles = o.world.particles;
    this.player = o.player;
    this.state = o.state ?? services.get('state');
    this.ids = this.markers.ids;
    this.anchors = new Float32Array(this.ids.length * 3);
    this.taken = new Uint8Array(this.ids.length);
    this.nudged = new Uint8Array(this.ids.length);
    this.ids.forEach((id, i) => {
      if (this.markers.positionOf(id, this.tmp)) this.tmp.toArray(this.anchors, i * 3);
    });
    this.sync();
    this.offs.push(
      events.on('state:reset', () => this.sync()),
      events.on('promise:collected', ({ id }) => this.hide(id)),
      // Reading a waystone tells how many of this land's Promises are found (only while some are still hidden).
      events.on('waystone:read', () => {
        const found = this.taken.reduce((n, v) => n + v, 0);
        if (this.ids.length === 0 || found >= this.ids.length) return;
        // After the waystone's own "The Roll is updated" (emitted right after this event).
        queueMicrotask(() => {
          if (this.offs.length > 0)
            events.emit('hud:toast', { key: 'ui.toast.promisesHere', params: { found, total: this.ids.length } });
        });
      }),
    );
    const debug = services.tryGet('debug');
    if (debug) {
      this.offs.push(
        debug.addReadout(
          'Promises here',
          () => `${this.taken.reduce((n, v) => n + v, 0)} / ${this.ids.length}`,
        ),
        debug.addButton('Gameplay', 'Collect nearest Promise', () => this.collectNearest()),
      );
    }
  }

  /** Collects a Promise of this level now (scripts, debug). False when unknown or already taken. */
  collect(id: string): boolean {
    const i = this.ids.indexOf(id);
    if (i < 0 || this.taken[i] === 1 || this.disposed) return false;
    this.hide(id);
    const x = this.anchors[i * 3]!;
    const y = this.anchors[i * 3 + 1]! + SCROLL_HEIGHT;
    const z = this.anchors[i * 3 + 2]!;
    this.tmp.set(x, y, z);
    this.particles.emit('sparkle', this.tmp, BURST.count, this.burstOpts);
    this.particles.emit('motes', this.tmp, BURST_MOTES.count, this.motesOpts);
    events.emit('sfx', { id: 'promise_chime', at: [x, y, z] });
    this.state.collectPromise(id);
    events.emit('hud:toast', { key: 'ui.toast.promise' });
    if (this.taken.every((v) => v === 1)) events.emit('hud:toast', { key: 'ui.toast.allPromisesHere' });
    return true;
  }

  update(_dt: number): void {
    if (this.disposed || this.player.mode === 'cutscene') return;
    const p = this.player.controller.position;
    const r2 = PICKUP.radius * PICKUP.radius;
    for (let i = 0; i < this.ids.length; i++) {
      if (this.taken[i] === 1) continue;
      const dx = this.anchors[i * 3]! - p.x;
      const dz = this.anchors[i * 3 + 2]! - p.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < NEAR * NEAR && this.nudged[i] === 0 && this.player.mode === 'play') this.nudge(i);
      if (d2 > r2) continue;
      const dy = p.y - this.anchors[i * 3 + 1]!;
      if (dy < -PICKUP.below || dy > PICKUP.above) continue;
      this.collect(this.ids[i]!);
    }
  }

  /** A hidden Promise close by: a soft chime, a glint above it and a hint, once. */
  private nudge(i: number): void {
    this.nudged[i] = 1;
    this.tmp.fromArray(this.anchors, i * 3);
    this.tmp.y += SCROLL_HEIGHT;
    this.particles.emit('sparkle', this.tmp, 10, this.burstOpts);
    events.emit('hud:toast', { key: 'ui.toast.promiseNear' });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const off of this.offs.splice(0)) off();
  }

  private hide(id: string): void {
    const i = this.ids.indexOf(id);
    if (i < 0) return;
    this.taken[i] = 1;
    this.markers.setCollected(id, true);
  }

  /** Markers follow GameState: collected ones hidden, the rest shown. */
  private sync(): void {
    for (let i = 0; i < this.ids.length; i++) {
      const has = this.state.hasPromise(this.ids[i]!);
      this.taken[i] = has ? 1 : 0;
      this.markers.setCollected(this.ids[i]!, has);
    }
  }

  private collectNearest(): void {
    const p = this.player.controller.position;
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < this.ids.length; i++) {
      if (this.taken[i] === 1) continue;
      const d = Math.hypot(this.anchors[i * 3]! - p.x, this.anchors[i * 3 + 2]! - p.z);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) this.collect(this.ids[best]!);
  }
}
