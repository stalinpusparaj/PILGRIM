/**
 * Chapter X beats 5-7 (GDD 2.10, 1.6): the arrest, the cage in the square while the crowd stares, the trial before
 * Lord Hate-good (witnesses Envy, Superstition and Pickthank; the jury of twelve with name cards as the camera
 * passes; Christian gets 2 choices to speak and the verdict does not change), then night: a chariot of light comes
 * down for Faithful and carries him up. Christian grieves; in the quiet night the cage door swings open (Bunyan:
 * Christian "escaped them") and the sneak begins (ch10-night.ts). Written fresh, nothing from the film.
 *
 * Level: the 'fair_cage' landmark and the 'cage_inside', 'chariot_spot' spot zones; the 'jury' zone (CrowdSet);
 * NPCs 'lord_hate_good', 'envy', 'superstition', 'pickthank', 'faithful'.
 */
import * as THREE from 'three';
import '../audio/events';
import { events } from '../core/Events';
import { services } from '../core/Services';
import type { CutsceneDef } from '../narrative/cutscene-types';
import { Chariot } from './ch10-chariot';
import { buildCrowd, spot, zone, type CrowdSet } from './ch10-kit';
import { JURY_SIZE, JuryCards } from './ch10-jury';
import type { Fair } from './ch10-fair';
import type { NightSneak } from './ch10-night';
import type { ChapterContext } from './types';

/** Seconds per juror as the camera passes along the jury. */
const PER_JUROR = 0.55;
const CAGE_SIDE = 0.6;
const CHARIOT = { down: 4, wait: 1.2, up: 5 } as const;
/** The fixed view of the cage scenes: back from the pair (m), camera height, look height. */
const VIEW = { back: 7.5, up: 2.6, look: 1.2 } as const;

export class Trial {
  private jury: CrowdSet | null = null;
  private chariot: Chariot | null = null;
  private holding = false;

  constructor(
    private readonly ctx: ChapterContext,
    private readonly fair: Fair,
    private readonly night: NightSneak,
  ) {}

  start(): void {
    const ctx = this.ctx;
    const z = zone(ctx, 'jury');
    if (z) this.jury = buildCrowd(ctx, z, true, false);
    this.chariot = new Chariot(ctx.session.world.scene, ctx.session.world.particles);
    ctx.own(() => {
      this.letGo();
      this.jury?.dispose();
      this.chariot?.dispose();
    });
  }

  update(dt: number): void {
    this.jury?.update(this.ctx.engine.loop.elapsed);
    this.chariot?.update(dt);
  }

  /** Arrest → cage → trial → night → chariot → the door opens. */
  async run(): Promise<void> {
    const ctx = this.ctx;
    ctx.state.setFlag('ch10.arrested', true);
    ctx.removeCompanion('faithful');
    ctx.music('vanity', 'tension');
    await ctx.cutscene(this.intoCage());
    if (ctx.session.isDisposed) return;
    this.view('lord_hate_good'); // from now until the door opens, the camera stays outside the bars
    ctx.objective('ch10.objective.inCage');
    ctx.toast('ch10.toast.arrested');
    this.fair.setCrowds(true, true);
    await ctx.wait(2.5);
    if (ctx.session.isDisposed) return;

    ctx.objective('ch10.objective.trial');
    this.jury?.setVisible(true);
    for (const id of ['lord_hate_good', 'envy', 'superstition', 'pickthank']) ctx.state.meet(ctx.npc(id)?.character.recipe.id ?? id);
    this.view('lord_hate_good');
    await ctx.talk('ch10_trial', { with: 'lord_hate_good' });
    if (ctx.session.isDisposed) return;
    const cards = new JuryCards();
    ctx.own(() => cards.dispose());
    this.letGo(); // a cutscene only gives back a follow rig it suspended itself: hand it back first
    await ctx.cutscene(this.juryPan(cards));
    cards.dispose();
    if (ctx.session.isDisposed) return;
    this.view('lord_hate_good'); // the jury's cutscene gave the camera back to the follow rig
    await ctx.talk('ch10_verdict', { with: 'lord_hate_good' });
    if (ctx.session.isDisposed) return;
    await this.nightAndChariot();
  }

  /** The guards' hands are never shown: a cut to the cage, the two of them already inside. */
  private intoCage(): CutsceneDef {
    const ctx = this.ctx;
    const inside = spot(ctx, 'cage_inside')!;
    const out = spot(ctx, 'sneak_start') ?? inside.clone().setZ(inside.z - 4);
    const facing = Math.atan2(out.x - inside.x, out.z - inside.z);
    const side = new THREE.Vector3(Math.cos(facing), 0, -Math.sin(facing));
    const cam = out.clone().addScaledVector(new THREE.Vector3(out.x - inside.x, 0, out.z - inside.z).normalize(), 4);
    cam.y += 2.2;
    const look = inside.clone().setY(inside.y + 1.2);
    return {
      id: 'ch10_cage',
      duration: 3,
      camera: [{ start: 0, end: 3, path: [cam], look: [look], fov: 45 }],
      events: [
        {
          at: 0,
          essential: true,
          run: () => {
            const c = inside.clone().addScaledVector(side, -CAGE_SIDE);
            ctx.session.teleport(c.x, c.z, facing);
            const f = inside.clone().addScaledVector(side, CAGE_SIDE);
            ctx.npc('faithful')?.teleport(f, facing);
            ctx.session.player.character.setExpression('sad');
            events.emit('sfx', { id: 'cage_clank', at: [inside.x, inside.y + 1, inside.z] });
          },
        },
      ],
    };
  }

  /** The camera passes along the jury; each juror's name card pops up. */
  private juryPan(cards: JuryCards): CutsceneDef {
    const pts = this.jury?.positions ?? [];
    const first = pts[0] ?? new THREE.Vector3();
    const last = pts[pts.length - 1] ?? first;
    const z = zone(this.ctx, 'jury');
    const face = typeof z?.['face'] === 'number' ? (z['face'] as number) : 0;
    const front = new THREE.Vector3(Math.sin(face), 0, Math.cos(face)).multiplyScalar(4);
    const lift = (p: THREE.Vector3, y: number): THREE.Vector3 => p.clone().setY(p.y + y);
    const duration = JURY_SIZE * PER_JUROR + 1;
    return {
      id: 'ch10_jury',
      duration,
      camera: [
        {
          start: 0,
          end: duration,
          path: [lift(first.clone().add(front), 1.8), lift(last.clone().add(front), 1.8)],
          look: [lift(first, 1.5), lift(last, 1.5)],
          fov: 40,
        },
      ],
      events: Array.from({ length: Math.min(JURY_SIZE, pts.length || JURY_SIZE) }, (_, i) => ({
        at: 0.4 + i * PER_JUROR,
        run: () => cards.show(i + 1),
      })),
    };
  }

  /** Night; Faithful says goodbye and the chariot of light carries him up; the cage door swings open. */
  private async nightAndChariot(): Promise<void> {
    const ctx = this.ctx;
    this.fair.setCrowds(false, false);
    this.jury?.setVisible(false);
    for (const id of ['lord_hate_good', 'envy', 'superstition', 'pickthank', 'crier']) {
      const n = ctx.npc(id);
      if (n) n.character.root.visible = false;
    }
    this.night.nightfall();
    events.emit('music:silence', {});
    ctx.ambience(null);
    ctx.toast('ch10.toast.night');
    await ctx.wait(2);
    if (ctx.session.isDisposed) return;
    const f = ctx.npc('faithful');
    const at = spot(ctx, 'chariot_spot');
    if (f && at) {
      f.teleport(at, Math.atan2(ctx.session.player.renderPosition.x - at.x, ctx.session.player.renderPosition.z - at.z));
      this.view('faithful');
      await ctx.talk('ch10_farewell', { with: 'faithful' });
      if (ctx.session.isDisposed) return;
      this.letGo();
      await ctx.cutscene(this.chariotScene(at, f.character.root));
      if (ctx.session.isDisposed) return;
      f.character.root.visible = false;
    }
    this.letGo();
    ctx.music('pilgrim', 'sad');
    ctx.toast('ch10.toast.doorOpen');
    events.emit('sfx', { id: 'gate_grind', at: [at?.x ?? 0, at?.y ?? 0, at?.z ?? 0], pitch: 1.4, volume: 0.6 });
    ctx.state.setFlag('ch10.faithfulGone', true);
    this.night.begin();
  }

  /**
   * A fixed camera outside the cage, framing the caged pilgrims and `npcId` from the side (the follow camera would
   * be squeezed between the bars). Held until `letGo()` or a cutscene hands the camera back.
   */
  private view(npcId: string): void {
    const ctx = this.ctx;
    const cage = spot(ctx, 'cage_inside');
    const other = ctx.npc(npcId)?.position;
    if (!cage || !other) return;
    const mid = cage.clone().add(other).multiplyScalar(0.5);
    const across = new THREE.Vector3(other.x - cage.x, 0, other.z - cage.z);
    if (across.lengthSq() < 1e-4) across.set(1, 0, 0);
    across.normalize();
    // Of the two sides square to the line between them, the one nearer the road (the open square).
    const road = spot(ctx, 'sneak_start') ?? cage;
    const side = new THREE.Vector3(-across.z, 0, across.x);
    if (side.dot(new THREE.Vector3(road.x - cage.x, 0, road.z - cage.z)) < 0) side.negate();
    const cam = ctx.session.view;
    cam.position.copy(mid).addScaledVector(side, VIEW.back).setY(mid.y + VIEW.up);
    cam.lookAt(mid.x, mid.y + VIEW.look, mid.z);
    if (!this.holding) services.tryGet('cameraRig')?.suspend();
    this.holding = true;
  }

  private letGo(): void {
    if (!this.holding) return;
    this.holding = false;
    if (!this.ctx.session.isDisposed) services.tryGet('cameraRig')?.resume(0.8);
  }

  private chariotScene(at: THREE.Vector3, rider: THREE.Object3D): CutsceneDef {
    const ctx = this.ctx;
    const f = ctx.npc('faithful');
    const toCage = new THREE.Vector3(ctx.session.player.renderPosition.x - at.x, 0, ctx.session.player.renderPosition.z - at.z).normalize();
    const cam = at.clone().addScaledVector(toCage, -7).setY(at.y + 2);
    const total = CHARIOT.down + CHARIOT.wait + CHARIOT.up;
    return {
      id: 'ch10_chariot',
      duration: total,
      camera: [
        {
          start: 0,
          end: total,
          path: [cam, cam.clone().setY(cam.y + 1.5)],
          look: [at.clone().setY(at.y + 4), at.clone().setY(at.y + 8)],
          fov: 50,
        },
      ],
      events: [
        { at: 0, essential: true, run: () => this.chariot?.descend(at, Math.atan2(toCage.x, toCage.z), CHARIOT.down) },
        { at: 0.5, sfx: 'bells' },
        {
          at: CHARIOT.down + CHARIOT.wait,
          essential: true,
          run: () => {
            if (f) f.scripted = true;
            this.chariot?.rise(rider, CHARIOT.up);
          },
        },
      ],
    };
  }
}
