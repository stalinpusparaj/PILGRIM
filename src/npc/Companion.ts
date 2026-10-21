/**
 * Companions (GDD 2.8: Pliable, Faithful, Hopeful): an NPC that walks with the player.
 *
 * - Follows 2-3 m behind-left (or right), matching speed (walk / run / burdened gait by speed, NPC.ts); far away it
 *   steers along the main Way spline, off the Way along the player's breadcrumbs (npc-follow.ts, npc-trail.ts).
 * - Hops where the player hopped (gaps, logs) or together with a standing player's hop.
 * - More than 25 m away: teleports behind the player, out of the camera's view, on the ground near the trail or
 *   the Way, never into a collider or a hazard (npc-teleport.ts).
 * - Barks (Barks.ts): low Hope (also cheers: +10 Hope when within 6 m, GDD 2.7.2), a Promise near the player,
 *   'detour:entered', the player idle 20 s. At most one automatic bark per 20 s; none while a conversation or
 *   cutscene holds the input. `bark(key)` (scripts) always speaks. While talking it looks at the player.
 * - `following = false` leaves it where it is (scripts move it with npc.walkTo / teleport).
 *
 *   const npc = new NPC({ id: 'pliable', character: world.npcs.get('pliable')!, session });
 *   const pliable = new Companion({ npc, session, side: 'left' });
 *   engine.loop.add(pliable, NPC_ORDER);   // update + render; do not add the NPC itself as well
 *   pliable.dispose();                     // also disposes its NPC (not the Character: the World owns it)
 */
import * as THREE from 'three';
import { events } from '../core/Events';
import { services } from '../core/Services';
import { storyHoldsInput } from '../narrative/story-input';
import type { PlaySession } from '../world/PlaySession';
import type { NPC } from './NPC';
import { FollowSteer, type FollowTarget } from './npc-follow';
import { Trail } from './npc-trail';
import { CATCH_UP_DIST, catchUpSpot } from './npc-teleport';
import {
  BARK_LOW_HOPE,
  BARK_MOOD,
  BarkClock,
  BarkPicker,
  CHEER_HOPE,
  CHEER_RANGE,
  IDLE_AFTER,
  PROMISE_RANGE,
  withDefaults,
  type BarkKind,
  type BarkSet,
} from './Barks';

export type { BarkSet } from './Barks';

declare module '../core/Events' {
  interface EventMap {
    /** A companion spoke a bark (`auto`: a trigger, not a script). */
    'npc:bark': { id: string; key: string; auto: boolean };
    /** A companion caught up with a teleport (out of view). */
    'npc:catchUp': { id: string };
  }
}

export interface CompanionOptions {
  npc: NPC;
  session: PlaySession;
  barks?: BarkSet;
  side?: 'left' | 'right';
}

/** Seconds a talking companion keeps looking at the player (or the Promise it points out). */
const TALK_LOOK = 3.5;
/** A detour bark is still worth saying this long after the event (s). */
const DETOUR_WINDOW = 10;
/** Catch-up: retry interval (s); after this long without a hidden spot, any free spot will do (s). */
const CATCH_RETRY = 0.25;
const CATCH_ANY_AFTER = 4;
const PROMISE_SCAN = 0.5;
const IDLE_SPEED = 0.1;

export class Companion {
  /** Every live companion (debug panels, tests). Do not modify. */
  static readonly all: Companion[] = [];

  readonly npc: NPC;
  /** False: stays put (scripts move it). Barks still fire. */
  following = true;
  /** False: no automatic barks (scripts that want quiet). */
  autoBarks = true;
  private readonly session: PlaySession;
  private readonly steerer: FollowSteer;
  private readonly trail = new Trail(64);
  private readonly picker: BarkPicker;
  private readonly clock = new BarkClock();
  private readonly offs: Array<() => void> = [];
  private readonly target: FollowTarget;
  private readonly heading = { x: 0, z: 1 };
  private readonly spot = new THREE.Vector3();
  private readonly head = new THREE.Vector3();
  private readonly promisePos = new THREE.Vector3();
  private readonly announced = new Set<string>();
  private readonly lookPlayer: () => THREE.Vector3;
  private dismiss: (() => void) | null = null;
  private savedLook: NPC['lookTarget'] = null;
  private talkT = 0;
  private idleT = 0;
  private detourT = 0;
  private scanT = 0;
  private farT = 0;
  private retryT = 0;
  private lowSpell = false;
  private catchUps = 0;
  private lastKey: string | null = null;
  private disposed = false;

  constructor(o: CompanionOptions) {
    this.npc = o.npc;
    this.session = o.session;
    const pl = o.session.player;
    this.steerer = new FollowSteer(o.session.col, o.session.world.ways.main, o.side === 'right' ? -1 : 1);
    this.picker = new BarkPicker(withDefaults(o.barks));
    this.target = {
      get position() {
        return pl.controller.position;
      },
      get velocity() {
        return pl.controller.velocity;
      },
      get forward() {
        return pl.forward;
      },
      get speed() {
        return pl.speed;
      },
    };
    this.lookPlayer = () => {
      const p = pl.renderPosition;
      return this.head.set(p.x, p.y + pl.character.height * 0.9, p.z);
    };
    this.offs.push(
      events.on('player:jump', () => this.steerer.noteJump(pl.controller.position, this.npc)),
      events.on('detour:entered', () => {
        this.detourT = DETOUR_WINDOW;
      }),
      events.on('promise:collected', () => {
        if (this.disposed || !this.autoBarks) return;
        const n = this.npc.position;
        const pp = pl.controller.position;
        const d2 = (pp.x - n.x) ** 2 + (pp.z - n.z) ** 2;
        if (d2 > CHEER_RANGE * CHEER_RANGE * 4) return;
        const key = this.picker.pick('promiseFound');
        if (key) this.say(key, 'promiseFound', true, null);
      }),
    );
    Companion.all.push(this);
  }

  /** 'left' or 'right' of the player. */
  get side(): 'left' | 'right' {
    return this.steerer.side === 1 ? 'left' : 'right';
  }

  set side(s: 'left' | 'right') {
    this.steerer.side = s === 'right' ? -1 : 1;
  }

  /** Catch-up teleports so far (tests, debug). */
  get teleports(): number {
    return this.catchUps;
  }

  /** The last bark's key (tests, debug). */
  get lastBark(): string | null {
    return this.lastKey;
  }

  /** The steering's current mode and aim (debug). */
  get steering(): FollowSteer {
    return this.steerer;
  }

  /** Says `key` in a world-space bubble now (scripts; not held to the 20 s rule) and looks at the player. */
  bark(key: string): void {
    this.say(key, 'neutral', false, null);
  }

  update(dt: number): void {
    if (this.disposed) return;
    const pl = this.session.player;
    const pp = pl.controller.position;
    this.clock.tick(dt);
    this.trail.record(pp, pl.isGrounded);
    this.endTalk(dt);
    const npc = this.npc;
    const n = npc.position;
    const dist = Math.hypot(pp.x - n.x, pp.z - n.z);
    if (this.following && !npc.scripted && !npc.moving) {
      if (dist > CATCH_UP_DIST) this.catchUp(dt);
      else {
        this.farT = 0;
        this.steerer.step(dt, npc, this.target, this.trail);
      }
    }
    this.triggers(dt, dist);
    npc.update(dt);
  }

  render(alpha: number): void {
    if (!this.disposed) this.npc.render(alpha);
  }

  /** Stops listening, takes the bubble down and disposes the NPC (the Character stays: the World owns it). */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const i = Companion.all.indexOf(this);
    if (i >= 0) Companion.all.splice(i, 1);
    for (const off of this.offs.splice(0)) off();
    this.dismiss?.();
    this.dismiss = null;
    this.npc.dispose();
  }

  // ------------------------------------------------------------------------------------------- inside

  private catchUp(dt: number): void {
    this.farT += dt;
    this.retryT -= dt;
    if (this.retryT > 0) return;
    this.retryT = CATCH_RETRY;
    const pl = this.session.player;
    const v = pl.controller.velocity;
    const vh = Math.hypot(v.x, v.z);
    this.heading.x = vh > 0.3 ? v.x / vh : pl.forward.x;
    this.heading.z = vh > 0.3 ? v.z / vh : pl.forward.z;
    const hidden = this.farT < CATCH_ANY_AFTER;
    if (!catchUpSpot(this.session, this.trail, this.npc.controller, this.heading, hidden, this.spot)) return;
    const pp = pl.controller.position;
    this.npc.teleport(this.spot, Math.atan2(pp.x - this.spot.x, pp.z - this.spot.z));
    this.steerer.reset();
    this.farT = 0;
    this.catchUps++;
    events.emit('npc:catchUp', { id: this.npc.id });
  }

  /** Automatic barks (GDD 2.8), at most one per 20 s. */
  private triggers(dt: number, dist: number): void {
    const s = this.session;
    const pl = s.player;
    this.detourT = Math.max(0, this.detourT - dt);
    if (s.state.hope >= BARK_LOW_HOPE) this.lowSpell = false;
    const quiet = !this.autoBarks || pl.mode !== 'play' || storyHoldsInput();
    this.idleT = quiet || pl.speed > IDLE_SPEED ? 0 : this.idleT + dt;
    this.scanT -= dt;
    if (quiet || !this.clock.ready) return;

    if (s.state.hope < BARK_LOW_HOPE && dist <= CHEER_RANGE) {
      // The first line of a low spell is a kind word, the next ones cheer; each one lifts Hope (GDD 2.7.2).
      const kind: BarkKind = this.lowSpell ? 'cheer' : 'lowHope';
      this.lowSpell = true;
      if (this.auto(kind, null)) s.state.addHope(CHEER_HOPE);
      return;
    }
    if (this.detourT > 0) {
      this.detourT = 0;
      this.auto('detour', null);
      return;
    }
    if (this.scanT <= 0) {
      this.scanT = PROMISE_SCAN;
      const id = this.promiseNear();
      if (id) {
        this.announced.add(id);
        this.auto('promiseNear', this.promisePos);
        return;
      }
    }
    if (this.idleT >= IDLE_AFTER) {
      this.idleT = 0;
      this.auto('idle', null);
    }
  }

  /** An uncollected Promise of this level within range of the player that has not been pointed out yet. */
  private promiseNear(): string | null {
    const s = this.session;
    const markers = s.world.promises;
    const p = s.player.controller.position;
    const ids = markers.ids;
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]!;
      if (this.announced.has(id) || markers.isCollected(id) || s.state.hasPromise(id)) continue;
      if (!markers.positionOf(id, this.promisePos)) continue;
      const dx = this.promisePos.x - p.x;
      const dz = this.promisePos.z - p.z;
      if (dx * dx + dz * dz <= PROMISE_RANGE * PROMISE_RANGE) return id;
    }
    return null;
  }

  private auto(kind: BarkKind, lookAt: THREE.Vector3 | null): boolean {
    const key = this.picker.pick(kind);
    if (!key) return false;
    this.clock.mark();
    this.say(key, kind, true, lookAt);
    return true;
  }

  private say(key: string, kind: BarkKind | 'neutral', auto: boolean, lookAt: THREE.Vector3 | null): void {
    if (this.disposed) return;
    this.lastKey = key;
    const bubbles = services.tryGet('bubbles');
    this.dismiss?.();
    this.dismiss = null;
    if (bubbles) {
      const mood = kind === 'neutral' ? 'neutral' : BARK_MOOD[kind];
      const off = bubbles.show(this.npc.character, key, {
        mood,
        onDone: () => {
          if (this.dismiss === off) this.dismiss = null;
        },
      });
      this.dismiss = off;
    }
    if (this.talkT <= 0) this.savedLook = this.npc.lookTarget;
    this.talkT = TALK_LOOK;
    this.npc.lookAt(lookAt ?? this.lookPlayer);
    events.emit('npc:bark', { id: this.npc.id, key, auto });
  }

  private endTalk(dt: number): void {
    if (this.talkT <= 0) return;
    this.talkT -= dt;
    if (this.talkT <= 0) {
      this.npc.lookAt(this.savedLook);
      this.savedLook = null;
    }
  }
}
