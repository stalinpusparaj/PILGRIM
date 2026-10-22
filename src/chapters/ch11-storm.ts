/**
 * Chapter XI beats 6-7 (GDD 2.10): over the stile the sky turns, rain comes down and there is no way back. The
 * pilgrims find shelter under a tree ('shelter' spot zone, trigger 'shelter_reach'), sit down and fall asleep;
 * the screen fades, and they wake in Giant Despair's dungeon (the 'dungeon_door' trigger's place), carried off
 * under his arms. Comic, not scary: a stomp, a yawn, a "Hm! Trespassers!" toast.
 *
 * The chapter calls `storm()` on 'storm_trigger'; `update(dt)` drives the rain and the storm look.
 */
import * as THREE from 'three';
import '../audio/events';
import { events } from '../core/Events';
import { LookShift, type Look } from '../gen/fx/LookShift';
import { ParticleEmitter } from '../gen/Particles';
import { clearFade, fadeIn, fadeOut } from '../ui/Fade';
import { spot } from './ch10-kit';
import type { ChapterContext } from './types';

/** GDD 2.10 Ch XI palette: storm #39414F. */
const STORM: Look = {
  sky: { top: '#2A303B', horizon: '#39414F', bottom: '#2C323C' },
  fog: { color: '#3A424F', near: 18, far: 90 },
  sun: { color: '#9AA6B8', intensity: 0.45 },
  hemi: { sky: '#56606F', ground: '#262A30', intensity: 0.7 },
};
const NAP_S = 2.4;
const RAIN_RATE = 70;

export class Storm {
  private look: LookShift | null = null;
  private rain: ParticleEmitter | null = null;
  private readonly rainAt = new THREE.Vector3();
  private started = false;
  private carried = false;

  constructor(private readonly ctx: ChapterContext) {
    ctx.own(() => this.dispose());
    ctx.onTrigger('shelter_reach', () => void this.sleep());
  }

  get raining(): boolean {
    return this.started && !this.carried;
  }

  storm(): void {
    if (this.started) return;
    this.started = true;
    const ctx = this.ctx;
    this.look = new LookShift(ctx.session.world, STORM, 3);
    this.rain = new ParticleEmitter(ctx.session.world.particles, 'rain', RAIN_RATE, { spread: 9 });
    events.emit('sfx', { id: 'thunder' });
    const shelter = spot(ctx, 'shelter');
    if (shelter) ctx.guide(shelter);
  }

  /** Called by the chapter if the player reaches the castle some other way: the storm just ends. */
  end(): void {
    this.carried = true;
    this.look?.back();
  }

  update(dt: number): void {
    this.look?.update(dt);
    if (!this.raining || !this.rain) return;
    const p = this.ctx.session.player.renderPosition;
    this.rainAt.set(p.x, p.y + 9, p.z);
    this.rain.update(dt, this.rainAt);
  }

  private async sleep(): Promise<void> {
    if (!this.started || this.carried) return;
    this.carried = true;
    const ctx = this.ctx;
    const s = ctx.session;
    const player = s.player;
    ctx.guide(null);
    player.mode = 'locked';
    player.character.animator.play('sit', { fade: 0.3 });
    ctx.toast('ch11.toast.asleep');
    await ctx.wait(0.8);
    player.character.animator.play('nap', { fade: 0.4 });
    ctx.npc('hopeful')?.character.animator.play('nap', { fade: 0.4 });
    const zzz = player.renderPosition.clone().setY(player.renderPosition.y + 1.4);
    for (let t = 0; t < NAP_S; t += 0.6) {
      s.world.particles.emit('zzz', zzz, 1);
      await ctx.wait(0.6);
    }
    if (s.isDisposed) return;
    await fadeOut(1);
    if (s.isDisposed) return clearFade();
    this.look?.back();
    events.emit('sfx', { id: 'land', volume: 1, pitch: 0.45 }); // a giant's stomp
    const door = ctx.level.triggers.find((t) => t.id === 'dungeon_door');
    player.character.animator.play('idle');
    player.mode = 'play';
    if (door) s.teleport(door.at[0], door.at[2], Math.PI / 2);
    ctx.toast('ch11.toast.carried');
    await ctx.wait(0.6);
    await fadeIn(1);
    ctx.state.setFlag('ch11.carried', true);
  }

  private dispose(): void {
    this.look?.dispose();
    this.look = null;
    this.rain = null;
    clearFade();
  }
}
