/**
 * CHAPTER III — THE WRONG HILL (GDD 2.10, 2.7.8 "The Wrong Hill"), on content/levels/ch03.json.
 *
 * Beats: rolling hills; the true Way is narrow and bumpy. At the fork Mr. Worldly Wiseman ([E] Talk, the waltz)
 * sends Christian down a smooth sunny side road to Mr. Legality in the village of Morality — his tall hat keeps
 * blowing off while he pretends it did not (ch03-hat.ts). The detour trigger marks the detour taken ("You left
 * the Way", objective "Go to the village"). Under the leaning mountain the light dims, fire flickers slowly,
 * pebbles rattle, the Burden grows twice (ch03-fx.ts), and the village keeps sliding away up the road
 * (ch03-door.ts). Evangelist appears behind Christian, talks kindly (two choices) and LEADS him back along the
 * road to the Way, waiting whenever Christian falls behind; Hope comes back as they rejoin ('zone:exit' of the
 * detour zone, "Back on the Way"). Then the Way goes on past a waystone to the end trigger: a short shot and
 * ctx.complete(). Every position comes from the level file (CLAUDE.md rule 5); the script reads them by id.
 */
import * as THREE from 'three';
import { services } from '../core/Services';
import type { Character } from '../gen/CharacterFactory';
import type { Mood } from '../audio/types';
import type { Way } from '../gen/Way';
import { VillageDoor } from './ch03-door';
import { MountainFx } from './ch03-fx';
import { HatGag } from './ch03-hat';
import type { ChapterContext, ChapterScript, NPC } from './types';

const DETOUR = 'wrong_hill';
const SHADOW_ZONE = 'wrong_hill_shadow';
/** GDD 2.7.8: the Burden grows twice; the detour cost Hope, which comes back on the Way. */
const BURDEN_GROW = 0.3;
const HOPE_BACK = 30;
/** Evangelist's lead home: walking speed (burdened Christian walks 2.0), waypoint spacing and patience (m). */
const LEAD = { speed: 2.2, step: 9, catchUp: 9, behind: 9, nearPlayer: 2.4, wayAhead: 16 };
const END_SHOT = { seconds: 5 };

type Phase = 'start' | 'detour' | 'mountain' | 'evangelist' | 'leading' | 'done';

class WrongHill {
  private readonly hat: HatGag | null;
  private readonly door: VillageDoor;
  private readonly fx: MountainFx;
  private phase: Phase = 'start';
  private detourTaken = false;
  private rejoined = false;
  private ended = false;
  private waltz = false;
  private hatFlights = 0;
  private readonly tmp = new THREE.Vector3();

  constructor(private readonly ctx: ChapterContext) {
    const wiseman = ctx.npc('wiseman');
    this.hat = wiseman ? new HatGag(ctx.engine, wiseman.character) : null;
    this.door = new VillageDoor(ctx, {
      detour: DETOUR,
      startTrigger: 'village_door',
      onFirstSlide: () => this.say(ctx.session.player.character, 'ch03.christian.door', 'scared'),
    });
    this.fx = new MountainFx(ctx);
  }

  start(): void {
    const { ctx } = this;
    ctx.objective('ch03.objective.followWay');
    this.setPhase('start');
    const evangelist = ctx.npc('evangelist');
    if (evangelist) evangelist.character.root.visible = false; // appears on the road later

    ctx.onTrigger('ch03_fork_near', () => this.forkNear(), { once: false });
    ctx.onTalk('wiseman', () => this.wisemanTalk());
    ctx.onTrigger('ch03_detour_start', () => this.takeDetour(), { once: false });
    ctx.onTrigger('ch03_under_mountain', () => void this.underMountain(), { once: false });
    ctx.onTrigger('ch03_deeper', () => void this.deeper(), { once: false });
    ctx.onZone('detour', undefined, (id) => {
      if (id === SHADOW_ZONE) this.rejoin();
    });
    ctx.onTrigger('ch03_rejoin', () => this.rejoin(), { once: false });
    ctx.onTrigger('ch03_end', () => void this.ending(), { once: false });
  }

  update(dt: number): void {
    this.hat?.update(dt);
    this.door.update(dt);
    this.fx.update(dt);
    const flights = this.hat?.flown ?? 0;
    if (flights !== this.hatFlights) {
      this.hatFlights = flights;
      this.ctx.state.setFlag('ch03.hatFlights', flights);
    }
  }

  dispose(): void {
    this.hat?.dispose();
    this.door.dispose();
    this.fx.dispose();
  }

  // ------------------------------------------------------------------------------------------ beats

  /** The fork: the waltz, and a nudge to talk to the gentleman first (the detour is story-mandatory, GDD 2.7.8). */
  private forkNear(): void {
    const { ctx } = this;
    if (!this.waltz) {
      this.waltz = true;
      ctx.music('wiseman', 'calm');
    }
    if (!this.wisemanTold) this.nudgeToWiseman();
  }

  private get wisemanTold(): boolean {
    return this.ctx.state.flag('ch03.wisemanTold') === true;
  }

  private nudgeToWiseman(): void {
    this.ctx.objective('ch03.objective.talkWiseman');
    this.ctx.guide({ npc: 'wiseman' });
    this.say(this.ctx.session.player.character, 'ch03.christian.talkFirst', 'neutral');
  }

  private async wisemanTalk(): Promise<void> {
    const { ctx } = this;
    this.hat?.start();
    try {
      await ctx.talk('ch03_wiseman', { with: 'wiseman' });
    } finally {
      this.hat?.stop();
    }
    if (!this.detourTaken) ctx.objective('ch03.objective.goToVillage');
    ctx.guide(null); // GDD 2.7.8: the detour must look inviting by itself; the guide keeps to the Way
  }

  /** The side road is taken only after the Wiseman talk; before it, the trigger nudges back to him. */
  private takeDetour(): void {
    if (this.detourTaken) return;
    if (!this.wisemanTold) {
      this.nudgeToWiseman();
      return;
    }
    this.detourTaken = true;
    const { ctx } = this;
    ctx.state.enterDetour(DETOUR);
    ctx.toast('ui.toast.leftWay');
    ctx.objective('ch03.objective.goToVillage');
    ctx.music('wiseman', 'calm');
    this.door.active = true;
    this.setPhase('detour');
  }

  private async underMountain(): Promise<void> {
    const { ctx } = this;
    this.takeDetour();
    if (this.phase !== 'detour') return; // not on the story road yet (or already deeper in)
    this.setPhase('mountain');
    this.fx.begin();
    ctx.music('tension', 'tension');
    ctx.ambience('wind');
    ctx.session.burden.grow(BURDEN_GROW);
    await ctx.wait(1.2);
    this.say(ctx.session.player.character, 'ch03.christian.darker', 'sad');
  }

  private async deeper(): Promise<void> {
    const { ctx } = this;
    this.takeDetour();
    if (this.phase === 'detour') await this.underMountain();
    if (this.phase !== 'mountain') return;
    this.fx.begin();
    ctx.music('tension', 'tension');
    ctx.session.burden.grow(BURDEN_GROW);
    this.door.freeze();
    await this.evangelistArrives();
  }

  /** Evangelist steps onto the road behind Christian, walks up, talks, then leads him back to the Way. */
  private async evangelistArrives(): Promise<void> {
    const { ctx } = this;
    const ev = ctx.npc('evangelist');
    const road = ctx.session.world.wayById(DETOUR);
    if (!ev || !road) return;
    this.setPhase('evangelist');
    const p = ctx.session.player.controller.position;
    const hit = road.closest(p.x, p.z);
    const spot = road.sample(Math.max(0, hit.t - LEAD.behind / road.length));
    spot.y = ctx.session.world.terrain.heightAt(spot.x, spot.z);
    ev.teleport(spot, Math.atan2(p.x - spot.x, p.z - spot.z));
    ev.character.root.visible = true;
    this.say(ev.character, 'ch03.evangelist.call', 'excited');
    await ctx.wait(0.6);
    const to = this.tmp.copy(spot).sub(p);
    const len = to.length() || 1;
    to.multiplyScalar(LEAD.nearPlayer / len).add(p);
    await ev.walkTo(to.clone(), { speed: LEAD.speed });
    await ctx.talk('ch03_evangelist', { with: 'evangelist' });
    await this.leadBack(ev, road);
  }

  /** He walks ahead along the road to the fork and a little way up the Way, waiting when Christian lags. */
  private async leadBack(ev: NPC, road: Way): Promise<void> {
    const { ctx } = this;
    this.setPhase('leading');
    ctx.objective('ui.hud.objective.backToWay');
    ctx.guide({ npc: 'evangelist' }); // follow him home
    const points = this.pathHome(ev, road);
    const goal = points[points.length - 1];
    if (!goal) return;
    for (const pt of points) {
      await ev.walkTo(pt, { speed: LEAD.speed });
      await this.waitForPlayer(ev, goal);
    }
    ev.face(ctx.session.player.controller.position);
    this.rejoin();
    this.setPhase('done');
    this.say(ev.character, 'ch03.evangelist.bye', 'neutral');
    ctx.objective('ch03.objective.followWay');
    ctx.guide(null);
  }

  /** Road points from Evangelist back to the fork (every LEAD.step m), then a few along the Way. */
  private pathHome(ev: NPC, road: Way): THREE.Vector3[] {
    const world = this.ctx.session.world;
    const ground = (v: THREE.Vector3): THREE.Vector3 => {
      v.y = world.terrain.heightAt(v.x, v.z);
      return v;
    };
    const pts: THREE.Vector3[] = [];
    const from = road.closest(ev.position.x, ev.position.z).t;
    const dt = LEAD.step / road.length;
    for (let t = from - dt; t > dt * 0.5; t -= dt) pts.push(ground(road.sample(t)));
    const fork = road.sample(0);
    const main = world.ways.main;
    const t0 = main.closest(fork.x, fork.z).t;
    const dm = LEAD.step / main.length;
    for (let t = t0 + dm; t <= t0 + LEAD.wayAhead / main.length + 1e-6 && t <= 1; t += dm) pts.push(ground(main.sample(t)));
    if (pts.length === 0) pts.push(ground(fork));
    return pts;
  }

  /** Resolves when Christian is close to Evangelist, or is already nearer the goal than he is. */
  private async waitForPlayer(ev: NPC, goal: THREE.Vector3): Promise<void> {
    const player = this.ctx.session.player;
    let called = false;
    for (;;) {
      const p = player.controller.position;
      if (p.distanceTo(ev.position) <= LEAD.catchUp || p.distanceTo(goal) <= ev.position.distanceTo(goal)) return;
      if (!called) {
        called = true;
        this.say(ev.character, 'ch03.evangelist.thisWay', 'excited');
      }
      ev.face(p);
      await this.ctx.wait(0.3);
    }
  }

  /** Back on the Way after the detour: Hope returns, the hills are bright again. */
  private rejoin(): void {
    if (this.rejoined || !this.detourTaken) return;
    if (this.phase !== 'leading' && this.phase !== 'done') return;
    this.rejoined = true;
    const { ctx } = this;
    ctx.state.addHope(HOPE_BACK);
    ctx.toast('ui.toast.backOnWay');
    this.fx.end();
    ctx.music('burden', 'calm');
    ctx.ambience('hills');
    const ev = ctx.npc('evangelist');
    if (ev && ev.character.root.visible) this.say(ev.character, 'ch03.evangelist.back', 'excited');
    ctx.state.setFlag('ch03.rejoined', true);
  }

  /** The Way's end completes the chapter only after Evangelist led Christian back (story-mandatory detour). */
  private async ending(): Promise<void> {
    if (this.ended) return;
    const { ctx } = this;
    if (!this.rejoined) {
      if (!this.wisemanTold) this.nudgeToWiseman();
      else {
        ctx.objective('ch03.objective.goToVillage');
        this.say(ctx.session.player.character, 'ch03.christian.notYet', 'neutral');
      }
      return;
    }
    this.ended = true;
    ctx.objective(null);
    await ctx.cutscene({
      id: 'ch03_end',
      duration: END_SHOT.seconds,
      camera: [
        {
          start: 0,
          end: END_SHOT.seconds,
          path: ['camera', { actor: 'christian', at: 'head', offset: [-1.6, 1.1, -4.2], local: true }],
          look: [{ actor: 'christian', at: 'head', offset: [0, -0.3, 7], local: true }],
          ease: 'sineInOut',
        },
      ],
      actors: [{ actor: 'christian', actions: [{ at: 0.8, do: 'say', key: 'ch03.christian.end', mood: 'excited' }] }],
    });
    ctx.complete();
  }

  // ---------------------------------------------------------------------------------------- helpers

  private setPhase(p: Phase): void {
    this.phase = p;
    this.ctx.state.setFlag('ch03.phase', p);
  }

  private say(c: Character, key: string, mood: Mood): void {
    services.tryGet('bubbles')?.speak(c, key, { mood });
  }
}

let run: WrongHill | null = null;

const script: ChapterScript = {
  id: 'ch03',
  level: 'ch03',
  start(ctx) {
    run?.dispose();
    run = new WrongHill(ctx);
    run.start();
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
