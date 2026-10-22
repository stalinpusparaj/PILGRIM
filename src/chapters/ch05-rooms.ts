/**
 * Chapter V's six toy-puzzles (GDD 2.10 Ch V table). Each room's puzzle resolves when it is solved; the chapter
 * then plays the room's lesson. Every position comes from content/levels/ch05.json (landmarks and 'spot' zones).
 *
 *   1. The Portrait — light the three lamps ('room1_lamp_a/b/c'); the portrait ('room1_portrait') sparkles.
 *   2. The Dusty Room — sweeping ('room2_broom') raises a dust storm; only then the jug ('room2_jug') settles it.
 *   3. Passion and Patience — the choice lives in the dialogue (ch05_room3); Passion's toys crumble to dust.
 *   4. Fire and Oil — a fire burns at 'room4_fire'; walk round the wall to find who pours oil ('oil_helper').
 *   5. The Brave Man — give your name to the scribe ('scribe'); it is written on your Roll (NamePrompt).
 *   6. The Iron Cage — the cage ('room6_cage') will not open; the lantern dims here (the zone's hopeDrain).
 */
import * as THREE from 'three';
import '../audio/events';
import { events } from '../core/Events';
import { lowSphere, paint } from '../gen/geom';
import { mat } from '../gen/materials';
import { ParticleEmitter } from '../gen/Particles';
import { stepPitch } from '../audio/sfx';
import { askName } from '../ui/NamePrompt';
import { spot } from './ch10-kit';
import type { ChapterContext } from './types';

const LAMPS = ['room1_lamp_a', 'room1_lamp_b', 'room1_lamp_c'] as const;
/** Lamp flame height over the landmark's foot (lamp params.height 1.6 + the lantern). */
const FLAME_Y = 1.97;
const DUST_SECONDS = 5;

export class RoomPuzzles {
  private readonly emitters: Array<{ e: ParticleEmitter; at: THREE.Vector3; until: number }> = [];
  private readonly flames: THREE.Mesh[] = [];
  private readonly flameGeo = paint(lowSphere(0.12, 1), '#FFD27A');
  private time = 0;

  constructor(private readonly ctx: ChapterContext) {
    ctx.own(() => this.dispose());
    const fire = spot(ctx, 'room4_fire');
    if (fire) this.emit('fire', fire, 10, Infinity, { spread: 0.4 });
  }

  /** Waits for the room's puzzle (index 0..5) to be solved. Room 3's choice is in its dialogue. */
  solve(index: number): Promise<void> {
    switch (index) {
      case 0:
        return this.lamps();
      case 1:
        return this.dust();
      case 3:
        return this.oil();
      case 4:
        return this.scribe();
      case 5:
        return this.cage();
      default:
        return Promise.resolve();
    }
  }

  /** After the room 3 talk: Passion's pile of toys crumbles if he was chosen. */
  crumble(): void {
    if (this.ctx.state.flag('ch05.passion') !== true) return;
    const p = this.ctx.npc('passion')?.position;
    if (!p) return;
    this.ctx.session.world.particles.emit('dust', new THREE.Vector3(p.x, p.y + 0.4, p.z), 24, { spread: 0.8 });
    events.emit('sfx', { id: 'sack_roll', at: [p.x, p.y, p.z], volume: 0.5, pitch: 1.4 });
  }

  update(dt: number): void {
    this.time += dt;
    for (const it of this.emitters) if (this.time < it.until) it.e.update(dt, it.at);
  }

  private lamps(): Promise<void> {
    const ctx = this.ctx;
    const spots = LAMPS.map((id) => ctx.landmark(id)).filter((p): p is THREE.Vector3 => p !== null);
    if (spots.length === 0) return Promise.resolve();
    const unlit = new Set(spots);
    const aim = (): void => ctx.guide(unlit.values().next().value ?? null);
    aim();
    return new Promise((done) => {
      let lit = 0;
      for (const [i, p] of spots.entries()) {
        const off = ctx.onInteract({
          id: `room1_lamp_${i}`,
          pos: p,
          radius: 2.2,
          verb: 'ui.verb.light',
          enabled: true,
          onUse: () => {
            off();
            lit++;
            unlit.delete(p);
            aim();
            const flame = new THREE.Mesh(this.flameGeo, mat('glow'));
            flame.position.set(p.x, p.y + FLAME_Y, p.z);
            ctx.session.world.scene.add(flame);
            this.flames.push(flame);
            ctx.session.world.particles.emit('sparkle', flame.position, 10);
            events.emit('sfx', { id: 'joy_note', at: [p.x, p.y + 2, p.z], pitch: stepPitch('joy_note', lit - 1) });
            ctx.toast('ch05.toast.lampLit', { n: lit, total: spots.length });
            if (lit < spots.length) return;
            const portrait = ctx.landmark('room1_portrait');
            if (portrait) {
              ctx.session.world.particles.emit('sparkle', portrait.clone().setY(portrait.y + 1.6), 30, { spread: 1 });
              events.emit('sfx', { id: 'sparkle', at: [portrait.x, portrait.y + 1.6, portrait.z] });
            }
            done();
          },
        });
      }
    });
  }

  private dust(): Promise<void> {
    const ctx = this.ctx;
    const broom = ctx.landmark('room2_broom');
    const jug = ctx.landmark('room2_jug');
    const room = spot(ctx, 'room2_middle') ?? broom;
    if (!broom || !jug || !room) return Promise.resolve();
    return new Promise((done) => {
      let jugOff: (() => void) | null = null;
      let storm: { until: number } | null = null;
      ctx.guide(broom);
      ctx.onInteract({
        id: 'room2_sweep',
        pos: broom,
        radius: 2.2,
        verb: 'ui.verb.sweep',
        enabled: true,
        onUse: () => {
          ctx.session.player.character.animator.overlay('reach');
          const at = room.clone().setY(room.y + 1);
          storm = this.emit('dust', at, 45, this.time + DUST_SECONDS, { spread: 3.5 });
          events.emit('sfx', { id: 'sack_roll', at: [at.x, at.y, at.z], volume: 0.4, pitch: 1.8 });
          ctx.toast('ch05.toast.dustWorse');
          if (jugOff) return;
          ctx.guide(jug);
          jugOff = ctx.onInteract({
            id: 'room2_jug',
            pos: jug,
            radius: 2.2,
            verb: 'ui.verb.sprinkle',
            enabled: true,
            onUse: () => {
              jugOff?.();
              ctx.guide(null);
              if (storm) storm.until = 0;
              ctx.session.world.particles.emit('splash', room.clone().setY(room.y + 0.6), 26, { spread: 2.5 });
              events.emit('sfx', { id: 'step_water', at: [room.x, room.y, room.z], volume: 0.9 });
              ctx.toast('ch05.toast.dustSettles');
              done();
            },
          });
        },
      });
    });
  }

  private oil(): Promise<void> {
    const helper = this.ctx.npc('oil_helper');
    if (!helper) return Promise.resolve();
    this.ctx.guide({ npc: 'oil_helper' });
    return new Promise((done) => {
      const off = this.ctx.onInteract({
        id: 'room4_oil',
        pos: helper.position,
        radius: 2.2,
        verb: 'ui.verb.look',
        enabled: true,
        onUse: () => {
          off();
          this.ctx.guide(null);
          helper.character.animator.overlay('wave');
          const p = helper.position;
          this.ctx.session.world.particles.emit('sparkle', new THREE.Vector3(p.x, p.y + 1.2, p.z), 14);
          done();
        },
      });
    });
  }

  private scribe(): Promise<void> {
    const ctx = this.ctx;
    const scribe = ctx.npc('scribe');
    if (!scribe) return Promise.resolve();
    ctx.guide({ npc: 'scribe' });
    return new Promise((done) => {
      const off = ctx.onInteract({
        id: 'room5_name',
        pos: scribe.position,
        radius: 2.4,
        verb: 'ui.verb.giveName',
        enabled: true,
        onUse: () => {
          off();
          ctx.guide(null);
          const player = ctx.session.player;
          player.mode = 'locked';
          void askName(ctx.state.playerName).then((name) => {
            if (!ctx.session.isDisposed) player.mode = 'play';
            if (name) {
              ctx.state.setPlayerName(name);
              ctx.state.setFlag('ch05.named', true);
              scribe.character.animator.overlay('read');
              ctx.toast('ch05.toast.nameWritten', { name });
            }
            done();
          });
        },
      });
    });
  }

  private cage(): Promise<void> {
    const ctx = this.ctx;
    const cage = ctx.landmark('room6_cage');
    if (!cage) return Promise.resolve();
    ctx.guide(cage);
    return new Promise((done) => {
      const off = ctx.onInteract({
        id: 'room6_open',
        pos: cage,
        radius: 2.8,
        verb: 'ui.verb.open',
        enabled: true,
        onUse: () => {
          off();
          ctx.guide(null);
          events.emit('sfx', { id: 'cage_clank', at: [cage.x, cage.y + 1, cage.z] });
          ctx.npc('cage_man')?.character.setExpression('sad');
          ctx.toast('ch05.toast.cageShut');
          done();
        },
      });
    });
  }

  private emit(
    preset: 'dust' | 'fire',
    at: THREE.Vector3,
    rate: number,
    until: number,
    opts: { spread: number },
  ): { until: number } {
    const it = { e: new ParticleEmitter(this.ctx.session.world.particles, preset, rate, opts), at, until };
    this.emitters.push(it);
    return it;
  }

  private dispose(): void {
    for (const f of this.flames) f.removeFromParent();
    this.flames.length = 0;
    this.emitters.length = 0;
    this.flameGeo.dispose();
  }
}
