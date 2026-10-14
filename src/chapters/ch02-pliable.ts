/**
 * Chapter II, Pliable's beats (GDD 2.10 Ch II): he follows from the start chattering about crowns and golden
 * streets, both sink at the bog's edge, the mud takes his boot with a loud slurp (the chapter's laugh), he
 * flounders out on the HOME side, sulks, and stomps back along the Way until he is out of sight. Afterwards
 * Christian is alone (GameState flag `alone`: the Slough drains extra Hope, src/player/Hope.ts).
 *
 * No coordinates live here: the bank is the 'home_bank' landmark, the walk home samples the Way, the boot is
 * built where Pliable stands (src/gen/props 'boot', placed with placeProps so it shares the world materials).
 */
import * as THREE from 'three';
import { events } from '../core/Events';
import { services } from '../core/Services';
import { placeProps } from '../gen/props';
import { Rng, hashString } from '../gen/rng';
import type { ChapterContext, Companion } from './types';

/** Seconds into the chapter for the two timed chatter bubbles (while he still follows, outside the bog). */
const CHATTER = [9, 24] as const;
const CHATTER_KEYS = ['ch02.bark.pliable.chat.1', 'ch02.bark.pliable.chat.2'] as const;
/** Pliable's own bark lines (the generic set fills the rest). */
const BARKS = {
  idle: ['ch02.bark.pliable.idle.1', 'ch02.bark.pliable.idle.2', 'ch02.bark.pliable.idle.3'],
  promiseNear: ['ch02.bark.pliable.promise.1'],
  lowHope: ['ch02.bark.pliable.low.1'],
};
const WALK_HOME = {
  /** Way fractions he walks to after the bank (toward the start), then he is hidden. */
  stops: [0.3, 0.16] as const,
  /** m/s: a stomp, not a stroll. */
  speed: 2.8,
  /** The boot sits this far behind his heel (m) and a touch under the mud surface. */
  bootBack: 0.45,
  bootSink: 0.04,
};
const BOOT_SEED = 'ch02:boot';
/** A comic boot reads from the follow camera at this size. */
const BOOT_SCALE = 1.5;
/** The start talk waits for the chapter card to go (s). */
const START_DELAY = 4;

export interface PliableDeps {
  /** Pliable has gone home: Christian is alone in the bog. */
  onGone(): void;
}

export class PliableBeats {
  private companion: Companion | null = null;
  private inBog = false;
  private gone = false;
  private readonly tmp = new THREE.Vector3();

  constructor(
    private readonly ctx: ChapterContext,
    private readonly deps: PliableDeps,
  ) {}

  /** True while Pliable still walks with Christian. */
  get following(): boolean {
    return this.companion !== null && !this.gone;
  }

  /** He follows from the first step; a short talk about crowns, then two timed bubbles. */
  async start(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx.npc('pliable')) {
      console.error('[ch02] there is no "pliable" NPC in the level');
      return;
    }
    this.companion = ctx.addCompanion('pliable', BARKS);
    await ctx.wait(START_DELAY);
    if (this.inBog || this.gone) return;
    await ctx.talk('ch02_start', { with: 'pliable' });
    void this.chatter();
  }

  /** The bog's edge: both sink, the boot goes, Pliable climbs out on the home side and quits. */
  async bogEnter(): Promise<void> {
    if (this.inBog || this.gone) return;
    this.inBog = true;
    const ctx = this.ctx;
    const companion = this.companion;
    if (!companion) return;
    companion.autoBarks = false;
    services.tryGet('bubbles')?.clear(); // his chatter makes way for the flailing
    const boot = ctx.waitFor(
      'dialogue:line',
      (p) => p.graph === 'ch02_sink' && p.node === 'n4' && p.speaker === 'pliable',
    );
    void boot.then(() => this.dropBoot());
    await ctx.talk('ch02_sink', { with: 'pliable' });
    if (this.gone) return;
    // The boot is on the ground whether or not the line was watched.
    this.dropBoot();
    companion.following = false;
    companion.bark('ch02.bark.pliable.boot.1');
    const bank = ctx.landmark('home_bank');
    if (bank) await companion.npc.walkTo(bank, { speed: WALK_HOME.speed });
    if (this.gone) return;
    await ctx.talk('ch02_quits', { with: 'pliable' });
    if (this.gone) return;
    this.leave();
  }

  // --------------------------------------------------------------------------------------------- private

  private async chatter(): Promise<void> {
    const ctx = this.ctx;
    let elapsed = 0;
    for (let i = 0; i < CHATTER.length; i++) {
      await ctx.wait(CHATTER[i]! - elapsed);
      elapsed = CHATTER[i]!;
      if (this.inBog || this.gone || !this.companion) return;
      this.companion.bark(CHATTER_KEYS[i]!);
    }
  }

  private bootDropped = false;

  /** The laugh: a loud slurp and Pliable's boot left standing in the mud behind him. */
  private dropBoot(): void {
    if (this.bootDropped) return;
    this.bootDropped = true;
    const ctx = this.ctx;
    const npc = this.companion?.npc ?? ctx.npc('pliable');
    if (!npc) return;
    const p = npc.position;
    const yaw = npc.facing;
    const x = p.x - Math.sin(yaw) * WALK_HOME.bootBack;
    const z = p.z - Math.cos(yaw) * WALK_HOME.bootBack;
    const world = ctx.session.world;
    const merged = placeProps(
      [
        {
          type: 'boot',
          at: [x, p.y - WALK_HOME.bootSink, z],
          rotY: yaw + 0.7,
          params: { tilt: 0.45, scale: BOOT_SCALE },
        },
      ],
      new Rng((hashString(BOOT_SEED) ^ ctx.level.seed) >>> 0),
      world.palette,
    );
    merged.mesh.name = 'ch02:boot';
    world.scene.add(merged.mesh);
    if (merged.glow) world.scene.add(merged.glow);
    ctx.own(() => {
      world.scene.remove(merged.mesh);
      if (merged.glow) world.scene.remove(merged.glow);
      merged.dispose();
    });
    events.emit('sfx', { id: 'mud_slurp', at: [x, p.y, z], volume: 1 });
    this.tmp.set(x, p.y + 0.1, z);
    world.particles.emit('splash', this.tmp, 14);
    ctx.state.setFlag('ch02.boot', true);
  }

  /** Off in a huff: no longer a companion, he stomps back along the Way and is hidden out of sight. */
  private leave(): void {
    if (this.gone) return;
    this.gone = true;
    const ctx = this.ctx;
    ctx.removeCompanion('pliable');
    this.companion = null;
    ctx.state.setFlag('ch02.pliableGone', true);
    ctx.state.setFlag('alone', true);
    this.deps.onGone();
    const npc = ctx.npc('pliable');
    if (!npc) return;
    const way = ctx.session.world.ways.main;
    const path = WALK_HOME.stops.map((t) => way.sample(t));
    void npc.followPath(path, { speed: WALK_HOME.speed }).then(() => {
      if (!ctx.npc('pliable')) return;
      npc.character.root.visible = false;
    });
  }
}
