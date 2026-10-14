/**
 * CHAPTER IV — THE WICKET GATE (GDD 2.10 Ch IV) on content/levels/ch04.json.
 *
 * Beats: a waystone before the field → the approach field under the gloomy castle: volleys of dark arrows with
 * red marks on the ground before they land (ch04-volleys.ts, ch04-arrows.ts); Christian, still burdened, waits
 * behind cover rocks between volleys; a hit bonks him back to the last rock → near the wall "Knock on the gate" →
 * [E] Knock: Goodwill opens the little door and pulls him inside just as a volley lands where he stood (a
 * cutscene; the door leaf is ch04-door.ts) → a talk with Goodwill (two choices and a sack joke), who points him
 * down the straight Way to the Interpreter's House → a waystone inside the wall, a short safe garden stretch →
 * the end trigger completes the chapter (the flow shows the demo end in demo builds).
 *
 * Positions come from the level file: landmarks 'castle_ridge' and 'wicket_gate' (+ its rotY), the 'coverRock'
 * triggers (the lee of each rock), 'gate_near' and 'ch04_end'. The 'volley' zone is the only place arrows fall.
 */
import * as THREE from 'three';
import '../audio/events';
import { Rng } from '../gen/rng';
import type { ActorTrack, CutsceneDef } from '../narrative/cutscene-types';
import type { NPC } from '../npc/NPC';
import { ArrowVolleys } from './ch04-arrows';
import { GateDoor } from './ch04-door';
import { VolleyDirector } from './ch04-volleys';
import type { ChapterContext, ChapterScript } from './types';


const KEY = {
  reachGate: 'ui.hud.objective.reachGate',
  knockGate: 'ui.hud.objective.knockGate',
  followStraight: 'ui.hud.objective.followStraightWay',
  knock: 'ui.verb.knock',
  hideRocks: 'ch04.toast.hideRocks',
  safeInside: 'ch04.toast.safeInside',
  comeIn: 'ch04.goodwill.say.comeIn',
} as const;

const ID = {
  castle: 'castle_ridge',
  gate: 'wicket_gate',
  keeper: 'goodwill',
  rockScript: 'coverRock',
  gateNear: 'gate_near',
  end: 'ch04_end',
  talk: 'ch04_goodwill',
  zone: 'volley',
  cutscene: 'ch04_pulled_inside',
} as const;

export const FLAG_INSIDE = 'ch04.insideGate';

/** The gate scene, in metres from the gate's ground point along its facing (`front`, the knock side). */
const GATE = {
  knockDist: 1.3,
  knockRadius: 2.0,
  insideDist: 2.6,
  keeperBack: 0.9,
  keeperSide: 0.4,
  pullSpeed: 4.2,
  volley: { count: 5, flight: 1.0, at: 1.9 },
  doorOpens: 1.0,
  doorSwing: 0.6,
  /** From the hinge side (negative `right`), so the leaf swings away from the camera and the doorway reads open. */
  camera: { back: 6.2, side: -3.6, up: 2.1, pushBack: 5.0, pushSide: -3.0, pushUp: 1.9, fov: 46 },
  duration: 4.6,
} as const;

class WicketGate {
  private readonly arrows: ArrowVolleys;
  private readonly director: VolleyDirector;
  private door: GateDoor | null = null;
  private readonly front = new THREE.Vector3(0, 0, 1);
  private readonly right = new THREE.Vector3(1, 0, 0);
  private readonly gate: THREE.Vector3 | null;
  private removeKnock: (() => void) | null = null;
  private knocked = false;
  private warned = false;
  private disposed = false;

  constructor(private readonly ctx: ChapterContext) {
    const { session, level } = ctx;
    const rng = new Rng(level.seed ^ 0xa770);
    this.arrows = new ArrowVolleys(session);
    const lees = this.coverLees();
    const castle = ctx.landmark(ID.castle) ?? this.fallbackCastle();
    this.director = new VolleyDirector(ctx, this.arrows, lees, castle, rng, ID.zone);
    lees.forEach((_, i) => ctx.onTrigger(`lee_${i + 1}`, () => this.director.setLastRock(i), { once: false }));

    this.gate = ctx.landmark(ID.gate);
    if (this.gate) {
      const rotY = level.landmarks.find((l) => l.id === ID.gate)?.rotY ?? 0;
      this.front.set(Math.sin(rotY), 0, Math.cos(rotY));
      this.right.set(Math.cos(rotY), 0, -Math.sin(rotY));
      this.door = new GateDoor(session, this.gate, rotY);
      const knockAt = this.gate.clone().addScaledVector(this.front, GATE.knockDist);
      this.removeKnock = ctx.onInteract({
        id: 'knock',
        pos: knockAt,
        radius: GATE.knockRadius,
        height: 1.8,
        verb: KEY.knock,
        enabled: true,
        onUse: () => void this.knock().catch((err: unknown) => console.error('[ch04] the gate scene failed', err)),
      });
    } else console.error(`[ch04] the level has no "${ID.gate}" landmark`);

    ctx.objective(KEY.reachGate);
    ctx.onZone(
      ID.zone,
      () => {
        ctx.music('tension', 'tension');
        if (!this.warned) {
          this.warned = true;
          ctx.toast(KEY.hideRocks);
        }
      },
      () => {
        if (!this.knocked) ctx.music('pilgrim', 'calm');
      },
    );
    ctx.onTrigger(ID.gateNear, () => {
      if (!this.knocked) ctx.objective(KEY.knockGate);
    });
    ctx.onTrigger(ID.end, () => ctx.complete());
  }

  update(dt: number): void {
    if (this.disposed) return;
    this.arrows.update(dt);
    this.director.update(dt);
    this.door?.update(dt);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.director.dispose();
    this.arrows.dispose();
    this.door?.dispose();
    this.door = null;
  }

  // ------------------------------------------------------------------------------------------ the knock

  /** [E] Knock: three knocks, the door opens, Goodwill pulls him in, a volley lands behind him, then the talk. */
  private async knock(): Promise<void> {
    if (this.knocked || this.disposed || !this.gate) return;
    this.knocked = true;
    this.removeKnock?.();
    this.removeKnock = null;
    this.director.enabled = false;
    const { ctx, gate, front, right } = this;
    const session = ctx.session;
    const spot = session.player.controller.position.clone();
    const keeper = ctx.npc(ID.keeper);
    if (keeper) keeper.scripted = true;
    try {
      await ctx.cutscene(this.pulledInside(gate, front, right, spot, keeper));
    } finally {
      if (!session.isDisposed && !this.disposed) {
        this.door?.setOpen();
        if (keeper) keeper.scripted = false;
      }
    }
    if (session.isDisposed || this.disposed) return;
    ctx.state.setFlag(FLAG_INSIDE, true);
    ctx.music('pilgrim', 'calm');
    ctx.ambience('birdsong');
    ctx.toast(KEY.safeInside);
    ctx.objective(null);
    await ctx.talk(ID.talk, keeper ? { with: ID.keeper } : {});
    if (session.isDisposed || this.disposed) return;
    ctx.objective(KEY.followStraight);
  }

  private pulledInside(
    gate: THREE.Vector3,
    front: THREE.Vector3,
    right: THREE.Vector3,
    spot: THREE.Vector3,
    keeper: NPC | null,
  ): CutsceneDef {
    const cam = GATE.camera;
    const camA = gate.clone().addScaledVector(front, cam.back).addScaledVector(right, cam.side);
    camA.y += cam.up;
    const camB = gate.clone().addScaledVector(front, cam.pushBack).addScaledVector(right, cam.pushSide);
    camB.y += cam.pushUp;
    const doorLook = gate.clone();
    doorLook.y += 1.3;
    const inside = gate.clone().addScaledVector(front, -GATE.insideDist);
    const keeperAt = gate.clone().addScaledVector(front, -GATE.keeperBack).addScaledVector(right, GATE.keeperSide);
    const keeperYaw = Math.atan2(front.x, front.z);
    const knockAt: [number, number, number] = [gate.x, gate.y + 1.2, gate.z];
    const actors: ActorTrack[] = [
      {
        actor: 'christian',
        actions: [
          { at: 0, do: 'overlay', anim: 'knock' },
          { at: GATE.volley.at, do: 'overlay', anim: null },
          { at: GATE.volley.at, do: 'moveTo', path: [inside], speed: GATE.pullSpeed, anim: 'burdenedWalk' },
        ],
      },
    ];
    if (keeper) {
      actors.push({
        actor: ID.keeper,
        actions: [
          { at: GATE.doorOpens, do: 'place', to: keeperAt, yaw: keeperYaw },
          { at: GATE.doorOpens + 0.2, do: 'overlay', anim: 'reach' },
          { at: GATE.doorOpens + 0.3, do: 'say', key: KEY.comeIn, mood: 'excited' },
          { at: GATE.volley.at + 0.1, do: 'lookAt', target: { actor: 'christian', at: 'head' } },
          { at: GATE.volley.at + 1.3, do: 'overlay', anim: null },
        ],
      });
    }
    return {
      id: ID.cutscene,
      duration: GATE.duration,
      blendOut: 0.8,
      camera: [{ start: 0, end: GATE.duration, path: [camA, camB], look: [doorLook], fov: cam.fov }],
      actors,
      events: [
        { at: 0.15, sfx: { id: 'knock', at: knockAt } },
        { at: 0.5, sfx: { id: 'knock', at: knockAt } },
        { at: 0.85, sfx: { id: 'knock', at: knockAt } },
        { at: GATE.doorOpens, run: () => this.door?.swingOpen(GATE.doorSwing) },
        { at: GATE.volley.at, run: () => void this.director.fireAt(spot, GATE.volley.count, GATE.volley.flight) },
        { at: GATE.volley.at + GATE.volley.flight + 0.1, essential: true, run: () => this.ctx.state.setFlag(FLAG_INSIDE, true) },
      ],
    };
  }

  // -------------------------------------------------------------------------------------------- helpers

  /** Lee points (ground) of the cover rocks: the 'coverRock' triggers, in id order (lee_1, lee_2, ...). */
  private coverLees(): THREE.Vector3[] {
    const { level, session } = this.ctx;
    const byNumber = (id: string): number => Number(id.split('_').pop() ?? 0);
    return level.triggers
      .filter((t) => t.script === ID.rockScript)
      .sort((a, b) => byNumber(a.id) - byNumber(b.id))
      .map((t) => new THREE.Vector3(t.at[0], session.world.terrain.heightAt(t.at[0], t.at[2]), t.at[2]));
  }

  /** No castle landmark: shoot from high above the field's far side (a readable fallback, logged). */
  private fallbackCastle(): THREE.Vector3 {
    console.error(`[ch04] the level has no "${ID.castle}" landmark; arrows come from above the Way's start`);
    const s = this.ctx.session.spawn();
    return new THREE.Vector3(s.x, this.ctx.session.world.terrain.heightAt(s.x, s.z) + 20, s.z);
  }
}

let run: WicketGate | null = null;

const script: ChapterScript = {
  id: 'ch04',
  level: 'ch04',
  start(ctx) {
    run?.dispose();
    run = new WicketGate(ctx);
  },
  update(dt) {
    run?.update(dt);
  },
  dispose() {
    run?.dispose();
    run = null;
  },
};

export default script;
