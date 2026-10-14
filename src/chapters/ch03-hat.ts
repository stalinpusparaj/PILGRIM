/**
 * Chapter III's laugh (GDD 2.10): Mr. Worldly Wiseman's tall hat keeps getting blown off by the mountain wind
 * while he talks, and he pretends it did not happen. The hat is the recipe's own `hat` bone: during a talk it
 * flies off in a little arc (up, sideways and back, tumbling) and pops back on, a few times, and he gives it a
 * quick 'reach' pat as if nothing happened. Position and tumble are written once per rendered frame AFTER the
 * World animated the character (the Character resets the hat's quaternion each update, so a late system is
 * the one robust place to add to it). Cheap: one bone, no allocations per frame.
 */
import * as THREE from 'three';
import type { Character } from '../gen/CharacterFactory';
import type { Engine } from '../core/Engine';
import { PLAY_ORDER } from '../world/play-loop';

/** Seconds into the talk at which the wind takes the hat. */
const FLIGHTS = [2.4, 8.5, 15] as const;
const FLIGHT_SECONDS = 1.7;
/** Kept low and wide so the hat stays in an over-the-shoulder frame while it tumbles. */
const ARC = { up: 0.45, side: 1.3, back: 0.25, spins: 1.5 } as const;
/** The pat on the head after the hat is back (upper-body overlay), seconds. */
const PAT_SECONDS = 0.7;

const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

export class HatGag {
  private readonly hat: THREE.Bone | null;
  private readonly base = new THREE.Vector3();
  private readonly tumble = new THREE.Quaternion();
  private readonly tilt = new THREE.Quaternion();
  private readonly off: () => void;
  private talking = false;
  private talkTime = 0;
  private next = 0;
  private flight = -1; // < 0: on the head
  private pat = 0;
  /** Flights completed (probe / tests). */
  flown = 0;

  constructor(
    engine: Engine,
    private readonly who: Character,
  ) {
    this.hat = who.bones['hat'] ?? null;
    if (this.hat) this.base.copy(this.hat.position);
    this.off = engine.loop.add({ render: () => this.place() }, PLAY_ORDER.world + 2);
  }

  /** A talk with him began: the wind starts counting. */
  start(): void {
    this.talking = true;
    this.talkTime = 0;
    this.next = 0;
  }

  /** The talk ended: no new gusts (a flight in the air finishes). */
  stop(): void {
    this.talking = false;
  }

  /** Fixed step. */
  update(dt: number): void {
    if (!this.hat) return;
    if (this.flight >= 0) {
      this.flight += dt;
      if (this.flight >= FLIGHT_SECONDS) {
        this.flight = -1;
        this.flown++;
        this.pat = PAT_SECONDS;
        this.who.animator.overlay('reach', { fade: 0.12, restart: true });
      }
    } else if (this.pat > 0) {
      this.pat -= dt;
      if (this.pat <= 0) this.who.animator.overlay(null, { fade: 0.25 });
    }
    if (!this.talking) return;
    this.talkTime += dt;
    const at = FLIGHTS[this.next];
    if (at !== undefined && this.talkTime >= at && this.flight < 0) {
      this.next++;
      this.flight = 0;
    }
  }

  dispose(): void {
    this.off();
    if (this.hat) this.hat.position.copy(this.base);
  }

  /** Per rendered frame, after the character animated: the hat's arc and tumble (or its resting place). */
  private place(): void {
    const hat = this.hat;
    if (!hat) return;
    if (this.flight < 0) {
      hat.position.copy(this.base);
      return;
    }
    const u = Math.min(1, this.flight / FLIGHT_SECONDS);
    const arc = Math.sin(Math.PI * u);
    hat.position.set(
      this.base.x + ARC.side * arc,
      this.base.y + ARC.up * arc,
      this.base.z - ARC.back * arc,
    );
    this.tumble.setFromAxisAngle(Y, u * Math.PI * 2 * ARC.spins);
    this.tilt.setFromAxisAngle(Z, arc * 0.9);
    hat.quaternion.multiply(this.tumble).multiply(this.tilt);
  }
}
