/**
 * The living bits of the City of Destruction (GDD 2.10 Ch I): smoke curling from every chimney and the neighbours'
 * silly reactions when Christian comes near (shrug, ignore, laugh so hard he hiccups, a pumpkin bigger than a head).
 *
 * - Chimneys: each house landmark carries `smokeX/Y/Z` (the chimney top in the prop's own frame) in its params; a
 *   ParticleEmitter on the World's particle pool puffs 'smoke' there, with a few far ones dropped per step.
 * - Crowd: an NPC with a `crowd_*` recipe gets one bubble kind by its index; within REACT_RANGE of Christian it
 *   speaks once, then not again for COOLDOWN seconds. The laugher hops and hiccups a second bubble.
 * Nothing here holds a coordinate: every position comes from the level file or the NPCs.
 */
import * as THREE from 'three';
import { ParticleEmitter } from '../gen/Particles';
import { services } from '../core/Services';
import type { Mood } from '../audio/types';
import type { ChapterContext, NPC } from './types';

const SMOKE = { rate: 1.6, lift: 0.25 } as const;
const REACT = { range: 4.2, cooldown: 14, hiccupAfter: 2.2 } as const;

type Kind = 'shrug' | 'ignore' | 'laugh' | 'silly';
const KINDS: readonly Kind[] = ['shrug', 'ignore', 'laugh', 'silly', 'shrug', 'ignore', 'shrug', 'ignore'];
const LINE: Readonly<Record<Kind, string>> = {
  shrug: 'ch01.crowd.shrug.1',
  ignore: 'ch01.crowd.ignore.1',
  laugh: 'ch01.crowd.laugh.1',
  silly: 'ch01.crowd.silly.1',
};
const MOOD: Readonly<Record<Kind, Mood>> = { shrug: 'neutral', ignore: 'neutral', laugh: 'excited', silly: 'scared' };

interface Chimney {
  emitter: ParticleEmitter;
  pos: THREE.Vector3;
}

interface Neighbour {
  npc: NPC;
  kind: Kind;
  cooldown: number;
  hiccup: number;
}

export class TownLife {
  private readonly chimneys: Chimney[] = [];
  private readonly neighbours: Neighbour[] = [];
  private readonly up = new THREE.Vector3(0, 1, 0);
  private disposed = false;

  constructor(private readonly ctx: ChapterContext) {
    const { world } = ctx.session;
    const terrain = world.terrain;
    for (const lm of ctx.level.landmarks) {
      const p = lm.params;
      if (!lm.at || !p || typeof p['smokeY'] !== 'number') continue;
      const sx = Number(p['smokeX'] ?? 0);
      const sy = Number(p['smokeY']);
      const sz = Number(p['smokeZ'] ?? 0);
      const rot = lm.rotY ?? 0;
      const [x, lift, z] = lm.at;
      const wx = x + sx * Math.cos(rot) + sz * Math.sin(rot);
      const wz = z - sx * Math.sin(rot) + sz * Math.cos(rot);
      const pos = new THREE.Vector3(wx, terrain.heightAt(x, z) + lift + sy + SMOKE.lift, wz);
      this.chimneys.push({
        emitter: new ParticleEmitter(world.particles, 'smoke', SMOKE.rate, { dir: this.up, cone: 0.25 }),
        pos,
      });
    }
    let i = 0;
    for (const def of ctx.level.npcs) {
      if (!def.recipe.startsWith('crowd_')) continue;
      const npc = ctx.npc(def.id);
      if (!npc) continue;
      this.neighbours.push({ npc, kind: KINDS[i % KINDS.length]!, cooldown: 0, hiccup: 0 });
      i++;
    }
  }

  get chimneyCount(): number {
    return this.chimneys.length;
  }

  get neighbourCount(): number {
    return this.neighbours.length;
  }

  update(dt: number): void {
    if (this.disposed) return;
    const player = this.ctx.session.player;
    const me = player.controller.position;
    for (let i = 0; i < this.chimneys.length; i++) {
      const c = this.chimneys[i]!;
      // Smoke only where it can be seen: within ~90 m of Christian (the fog hides the rest).
      if (c.pos.distanceToSquared(me) < 90 * 90) c.emitter.update(dt, c.pos);
    }
    const talking = player.mode !== 'play';
    for (let i = 0; i < this.neighbours.length; i++) {
      const n = this.neighbours[i]!;
      if (n.cooldown > 0) n.cooldown -= dt;
      if (n.hiccup > 0) {
        n.hiccup -= dt;
        if (n.hiccup <= 0) this.say(n, 'ch01.crowd.laugh.2', 'excited');
      }
      if (talking || n.cooldown > 0) continue;
      const d = n.npc.position.distanceToSquared(me);
      if (d > REACT.range * REACT.range) continue;
      n.cooldown = REACT.cooldown;
      n.npc.face(me);
      this.say(n, LINE[n.kind], MOOD[n.kind]);
      if (n.kind === 'laugh') {
        n.npc.jump();
        n.hiccup = REACT.hiccupAfter;
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    this.chimneys.length = 0;
    this.neighbours.length = 0;
  }

  private say(n: Neighbour, key: string, mood: Mood): void {
    services.tryGet('bubbles')?.show(n.npc.character, key, { mood });
  }
}
