/**
 * Phases 1 and 2 of the Apollyon fight (GDD 2.9), stepped by ApollyonFight (src/npc/Apollyon.ts):
 *
 * - Paws: walk up → raise a paw that glows red, a red ring where it will land (the telegraph) → slam. In reach
 *   and blocked: his belly opens for FIGHT.open s ('open', the sword's target); unblocked: a hit on Christian.
 * - Darts: take off and hover FIGHT.hoverDist m away → the belly brightens (the telegraph) → a volley of 3 darts
 *   → rest → again. 3 darts bounced back by perfect blocks knock him down ('knocked' → 'down' for FIGHT.down s,
 *   the sword's window), then he takes off again with the bounce count reset.
 */
import * as THREE from 'three';
import '../audio/events';
import { events } from '../core/Events';
import type { ApollyonFight } from './Apollyon';
import type { DartHost } from './apollyon-darts';

export const PHASE_HITS = 3;
export const FIGHT = {
  telegraph: 0.8, open: 2, recover: 1.1, slamReach: 2.4, slamAhead: 2.2, near: 3.0, walk: 2.0,
  takeoff: 1.4, hover: 4.2, hoverDist: 8, gap: 0.45, rest: 1.6, dart: 6.5, dartEasy: 5, knock: 0.7, down: 4,
  body: 1.25,
}; // not `as const`: the F1 tuning sliders (apollyon-tune.ts) write it live

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const smooth = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

export class PawsPhase {
  /** Where the raised paw will land (ground). */
  private readonly aim = new THREE.Vector3();

  constructor(private readonly f: ApollyonFight) {}

  step(dt: number): void {
    const f = this.f;
    const b = f.body;
    const t = f.subTime;
    const k = t / f.tele;
    switch (f.sub) {
      case 'approach': {
        f.facePlayer(dt);
        const p = f.playerPos;
        b.slam = Math.max(0, b.slam - dt * 3);
        if (f.moveToward(p.x, p.z, FIGHT.walk, dt, FIGHT.near) || t > 3.5) f.enter('telegraph');
        break;
      }
      case 'telegraph': {
        if (k < 0.6) f.facePlayer(dt, 6);
        b.paw = smooth(k * 1.6);
        b.pawGlow = smooth(k);
        b.jaw = smooth(k) * 0.6;
        const a = this.aim;
        a.set(f.pos.x + Math.sin(f.yaw) * FIGHT.slamAhead, 0, f.pos.z + Math.cos(f.yaw) * FIGHT.slamAhead);
        a.y = f.ground(a.x, a.z);
        b.setRing(a, FIGHT.slamReach, k);
        if (k >= 1) this.slam();
        break;
      }
      case 'open':
        b.belly = 1;
        b.lean = -0.25;
        b.slam = Math.max(0, b.slam - dt * 2);
        if (t >= FIGHT.open) f.enter('recover');
        break;
      case 'recover':
        b.slam = Math.max(0, b.slam - dt * 3);
        b.belly = Math.max(0, b.belly - dt * 2);
        b.lean *= 1 - Math.min(1, dt * 4);
        if (t >= FIGHT.recover) f.enter('approach');
        break;
      default:
        break;
    }
  }

  private slam(): void {
    const f = this.f;
    const b = f.body;
    const s = f.o.session;
    const a = this.aim;
    b.paw = 0;
    b.pawGlow = 0;
    b.jaw = 0;
    b.slam = 1;
    b.setRing(null, 0, -1);
    s.world.particles.emit('dust', a, 18, { spread: 1.2 });
    events.emit('sfx', { id: 'land', at: [a.x, a.y, a.z], pitch: 0.45, volume: 1 });
    s.camera.bump(0.5);
    const p = f.playerPos;
    const inReach = Math.hypot(p.x - a.x, p.z - a.z) <= FIGHT.slamReach;
    if (!inReach || s.player.mode !== 'play') return f.enter('recover');
    if (f.o.combat.block(f.chest(tmp2)) !== 'none') return f.enter('open');
    f.hurtPlayer(a);
    f.enter('recover');
  }
}

export class DartsPhase {
  private thrown = 0;
  private readonly host: DartHost;

  constructor(private readonly f: ApollyonFight) {
    this.host = {
      target: (out) => f.o.session.player.character.root.getWorldPosition(out).setY(out.y + 1.1),
      foe: (out) => f.chest(out),
      ground: (x, z) => f.ground(x, z),
      reach: (at) => {
        const r = f.o.combat.block(f.chest(tmp2));
        if (r === 'none' && f.o.session.player.mode === 'play') f.hurtPlayer(at);
        return r;
      },
      bounced: () => {
        if (f.sub !== 'hover' && f.sub !== 'volley') return;
        f.bounced++;
        f.hurtFx();
        if (f.bounced >= PHASE_HITS) f.enter('knocked');
      },
    };
  }

  /** A volley starts over. */
  enter(): void {
    this.thrown = 0;
  }

  step(dt: number): void {
    const f = this.f;
    const b = f.body;
    const t = f.subTime;
    f.darts.update(dt, this.host);
    switch (f.sub) {
      case 'takeoff': {
        b.flap = 2.4;
        b.lean = 0;
        b.belly = 0;
        const p = f.playerPos;
        tmp.set(f.pos.x - p.x, 0, f.pos.z - p.z);
        if (tmp.lengthSq() < 1e-4) tmp.set(1, 0, 0);
        tmp.normalize().multiplyScalar(FIGHT.hoverDist).add(p);
        f.o.arena.clamp(tmp, 2);
        f.moveToward(tmp.x, tmp.z, 5, dt);
        f.lift = FIGHT.hover * smooth(t / FIGHT.takeoff);
        f.facePlayer(dt);
        if (t >= FIGHT.takeoff) f.enter('hover');
        break;
      }
      case 'hover':
        f.facePlayer(dt);
        b.belly = smooth(t / f.tele);
        b.jaw = b.belly * 0.5;
        if (t >= f.tele) f.enter('volley');
        break;
      case 'volley':
        f.facePlayer(dt);
        if (this.thrown < 3 && t >= this.thrown * FIGHT.gap) {
          this.thrown++;
          this.host.target(tmp2);
          f.darts.throw(b.bellyPos(tmp), tmp2, f.easy ? FIGHT.dartEasy : FIGHT.dart);
          events.emit('sfx', { id: 'dart_whoosh', at: [f.pos.x, f.pos.y + f.lift, f.pos.z] });
        }
        b.belly = Math.max(0.2, b.belly - dt);
        if (this.thrown >= 3 && t >= 3 * FIGHT.gap + FIGHT.rest) f.enter('hover');
        break;
      case 'knocked':
        b.flap = 0.3;
        b.belly = 0.5;
        f.lift = Math.max(0, f.lift * (1 - smooth(t / FIGHT.knock)));
        if (t >= FIGHT.knock) {
          f.lift = 0;
          f.o.session.world.particles.emit('dust', f.pos, 20, { spread: 1.5 });
          events.emit('sfx', { id: 'land', at: [f.pos.x, f.pos.y, f.pos.z], pitch: 0.4 });
          f.o.session.camera.bump(0.6);
          f.enter('down');
        }
        break;
      case 'down':
        b.lean = -0.4;
        b.belly = 0.7;
        if (t >= FIGHT.down) {
          f.bounced = 0;
          f.enter('takeoff');
        }
        break;
      default:
        break;
    }
  }
}
