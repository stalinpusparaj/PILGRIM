/**
 * CHAPTER I — THE CITY OF DESTRUCTION (GDD 2.10): content/levels/ch01.json + content/dialogue/ch01.json.
 *
 * Beats, in order (each sets the HUD objective):
 *  1. Christian wakes at home; the Book glows on its table: [E] Read → 'ch01_book' (he reads it aloud) → the
 *     Burden grows with a boing (BurdenSystem.grow).
 *  2. Day: a talk with Christiana at the door, the boys' little bubbles ('ch01_day').
 *  3. The town walk: neighbours shrug, ignore or laugh until they hiccup (ch01-town.ts), chimneys smoke.
 *     Reaching the square turns the objective homeward; the evening talk plays at the door ('ch01_evening').
 *  4. Outside the gate Evangelist walks up: 'ch01_evangelist' (choices), the note ('note' item), the far light
 *     becomes the objective ("Follow the shining light").
 *  5. The family calls from the door (a short cutscene); Christian covers his ears and runs.
 *  6. Obstinate and Pliable run after him: 'ch01_chase'. Obstinate stomps home; Pliable joins as a companion.
 *  7. Waystones along the Way, the Promise in the fields; at the Way's far end a last word with Pliable
 *     ('ch01_end') and ctx.complete().
 * Positions come from the level file only: landmarks by id and small 'spot' zones (ch01.json `zones`).
 */
import * as THREE from 'three';
import type { BarkSet } from '../npc/Companion';
import type { CutsceneDef } from '../narrative/cutscene-types';
import type { ChapterContext, ChapterScript, NPC } from './types';
import { TownLife } from './ch01-town';

type Stage = 'book' | 'day' | 'town' | 'homeward' | 'evening' | 'gate' | 'way' | 'done';

const BOOK = { radius: 2.2, bubbleHeight: 1.15, grow: 0.3 } as const;
const RUN = { speed: 2.4 } as const;
const FAMILY = ['christiana', 'son_1', 'son_2', 'son_3', 'son_4'] as const;
const CALL_LINES = ['ch01.call.1', 'ch01.call.2', 'ch01.call.3', 'ch01.call.4', 'ch01.call.5'] as const;

const PLIABLE_BARKS: BarkSet = {
  idle: ['ch01.bark.pliable.idle.1', 'ch01.bark.pliable.idle.2'],
  cheer: ['ch01.bark.pliable.cheer.1', 'ch01.bark.pliable.cheer.2'],
};

class ChapterOne {
  private stageValue: Stage = 'book';
  get stage(): Stage {
    return this.stageValue;
  }
  set stage(value: Stage) {
    this.stageValue = value;
    this.ctx.state.setFlag('ch01.stage', value);
  }
  private readonly town: TownLife;
  private removeBook: (() => void) | null = null;

  constructor(private readonly ctx: ChapterContext) {
    this.town = new TownLife(ctx);
  }

  start(): void {
    const ctx = this.ctx;
    const saved = ctx.state.flag('ch01.stage');
    const known: readonly Stage[] = ['book', 'day', 'town', 'homeward', 'evening', 'gate', 'way'];
    const restored = typeof saved === 'string' && known.includes(saved as Stage) ? (saved as Stage) : null;
    this.stage =
      restored === 'evening'
        ? 'homeward'
        : (restored ??
          (ctx.state.flag('ch01.pliableJoins')
            ? 'way'
            : ctx.state.flag('ch01.eveningTalk')
              ? 'gate'
              : ctx.state.flag('ch01.dayTalk')
                ? 'town'
                : ctx.state.flag('ch01.readBook')
                  ? 'day'
                  : 'book'));
    const objectives: Record<Stage, string | null> = {
      book: 'ch01.objective.readBook',
      day: 'ch01.objective.talkFamily',
      town: 'ch01.objective.walkTown',
      homeward: 'ch01.objective.goHome',
      evening: 'ch01.objective.goHome',
      gate: 'ch01.objective.toGate',
      way: 'ui.hud.objective.followLight',
      done: null,
    };
    ctx.objective(objectives[this.stage]);
    if (this.stage === 'book') {
      ctx.guide({ landmark: 'book' });
      this.hookBook();
    } else if (this.stage === 'day' || this.stage === 'homeward') ctx.guide({ npc: 'christiana' });
    else if (this.stage === 'gate') ctx.guide({ landmark: 'town_gate' });
    else ctx.guide(null);
    if (this.stage === 'way') {
      if (ctx.npc('pliable')) ctx.addCompanion('pliable', PLIABLE_BARKS);
      const obstinate = ctx.npc('obstinate');
      if (obstinate) obstinate.character.root.visible = false;
    }
    if (this.stage === 'book' || this.stage === 'day')
      ctx.onTalk('christiana', () => this.dayTalk(), { once: true });
    ctx.onTrigger('ch01_square', () => this.townSquare(), { once: false });
    ctx.onTrigger('ch01_home', () => void this.eveningTalk(), { once: false });
    ctx.onTrigger('ch01_gate_out', () => void this.outsideTheGate());
    ctx.onTrigger('ch01_fields', () => this.fieldsBark());
    ctx.onTrigger('ch01_end', () => void this.ending());
  }

  update(dt: number): void {
    this.town.update(dt);
  }

  dispose(): void {
    this.town.dispose();
  }

  // ------------------------------------------------------------------------------------------ beats

  /** The glowing Book: [E] Read → he reads it aloud → the Burden boings bigger. */
  private hookBook(): void {
    const ctx = this.ctx;
    const at = ctx.landmark('book');
    if (!at) return;
    const item = {
      id: 'book',
      pos: at,
      radius: BOOK.radius,
      height: BOOK.bubbleHeight,
      verb: 'ui.verb.read',
      enabled: true,
      priority: 2,
      onUse: () => {
        if (!item.enabled) return;
        item.enabled = false;
        void this.readBook();
      },
    };
    this.removeBook = ctx.onInteract(item);
  }

  private async readBook(): Promise<void> {
    const ctx = this.ctx;
    await ctx.talk('ch01_book');
    this.removeBook?.();
    this.removeBook = null;
    ctx.session.burden.grow(BOOK.grow);
    ctx.toast('ch01.toast.burden');
    if (this.stage === 'book') {
      this.stage = 'day';
      ctx.objective('ch01.objective.talkFamily');
      ctx.guide({ npc: 'christiana' });
    }
  }

  private async dayTalk(): Promise<void> {
    const ctx = this.ctx;
    await ctx.talk('ch01_day', { with: 'christiana' });
    if (this.stage === 'book' || this.stage === 'day') {
      this.stage = 'town';
      ctx.objective('ch01.objective.walkTown');
      ctx.guide(null); // the Way through town
    }
  }

  private townSquare(): void {
    if (this.stage !== 'town') return;
    this.stage = 'homeward';
    this.ctx.toast('ch01.toast.neighbours');
    this.ctx.objective('ch01.objective.goHome');
    this.ctx.guide({ npc: 'christiana' });
  }

  private async eveningTalk(): Promise<void> {
    if (this.stage !== 'homeward') return;
    this.stage = 'evening';
    const ctx = this.ctx;
    await ctx.talk('ch01_evening', { with: 'christiana' });
    if (this.stage === 'evening') {
      this.stage = 'gate';
      ctx.objective('ch01.objective.toGate');
      ctx.guide({ landmark: 'town_gate' });
    }
  }

  /** Evangelist walks up and talks; the family calls; Obstinate and Pliable give chase. */
  private async outsideTheGate(): Promise<void> {
    if (this.stage === 'way' || this.stage === 'done') return;
    this.stage = 'way';
    const ctx = this.ctx;
    const player = ctx.session.player;
    const evangelist = ctx.npc('evangelist');
    const meet = this.spot('evangelist_meet');
    if (evangelist) ctx.guide({ npc: 'evangelist' });
    if (evangelist && meet) {
      const wasPlaying = player.mode === 'play';
      if (wasPlaying) player.mode = 'locked';
      evangelist.lookAt(() => player.renderPosition);
      await evangelist.walkTo(meet);
      if (wasPlaying && player.mode === 'locked') player.mode = 'play';
    }
    await ctx.talk('ch01_evangelist', { with: 'evangelist' });
    if (!ctx.state.has('note')) ctx.state.give('note'); // a skipped scene still gives it; belt and braces
    ctx.toast('ch01.toast.note');
    ctx.objective('ui.hud.objective.followLight');
    ctx.guide(null); // the Way, towards the far light
    await this.familyCalls();
    await this.chase();
  }

  /** GDD: "The family calls from the door; Christian covers his ears and runs (short and gentle)". */
  private async familyCalls(): Promise<void> {
    const ctx = this.ctx;
    const door = this.spot('home_door');
    const runTo = this.spot('run_to');
    if (!door || !runTo) return;
    const family = FAMILY.map((id) => ctx.npc(id)).filter((n): n is NPC => n !== null);
    const faceCam = door.clone().add(new THREE.Vector3(0.6, 2.1, -7.5));
    const faceLook = door.clone().add(new THREE.Vector3(0, 1.3, -1));
    const callEnd = 5.2;
    const def: CutsceneDef = {
      id: 'ch01_family_calls',
      camera: [
        { start: 0, end: callEnd, path: [faceCam], look: [faceLook], fov: 42 },
        {
          start: callEnd,
          end: callEnd + 5.5,
          path: [{ actor: 'christian', at: 'chest', offset: [3.2, 1.4, -3.6], local: true }],
          look: [{ actor: 'christian', at: 'head' }],
          fov: 50,
        },
      ],
      actors: [
        ...family.map((n, i) => ({
          actor: n.id,
          actions: [
            { at: 0.4 + i * 0.95, do: 'say' as const, key: CALL_LINES[i]!, mood: 'excited' as const },
            { at: 0.2 + i * 0.3, do: 'overlay' as const, anim: 'wave' as const },
          ],
        })),
        {
          actor: 'christian',
          actions: [
            { at: callEnd + 0.2, do: 'say', key: 'ch01.call.6', mood: 'sad' },
            { at: callEnd + 0.4, do: 'moveTo', path: [runTo], speed: RUN.speed, anim: 'coverEarsRun' },
          ],
        },
      ],
      blendOut: 0.8,
    };
    await ctx.cutscene(def);
    for (const n of family) n.character.animator.overlay(null);
  }

  /** Obstinate and Pliable run out of the gate after him; one stomps home, the other comes along. */
  private async chase(): Promise<void> {
    const ctx = this.ctx;
    const player = ctx.session.player;
    const obstinate = ctx.npc('obstinate');
    const pliable = ctx.npc('pliable');
    const oStop = this.spot('obstinate_stop');
    const pStop = this.spot('pliable_stop');
    const wasPlaying = player.mode === 'play';
    if (wasPlaying) player.mode = 'locked';
    const runs: Promise<void>[] = [];
    if (obstinate && oStop) runs.push(obstinate.walkTo(oStop, { run: true }));
    if (pliable && pStop) runs.push(pliable.walkTo(pStop, { run: true }));
    await Promise.all(runs);
    if (wasPlaying && player.mode === 'locked') player.mode = 'play';
    if (obstinate) await ctx.talk('ch01_chase', { with: 'obstinate' });
    const home = this.spot('obstinate_home');
    if (obstinate && home) void obstinate.walkTo(home);
    if (pliable) {
      ctx.addCompanion('pliable', PLIABLE_BARKS);
      ctx.toast('ch01.toast.pliable');
    }
    ctx.objective('ui.hud.objective.followLight');
  }

  private fieldsBark(): void {
    const pliable = this.ctx.companions.find((c) => c.npc.id === 'pliable');
    pliable?.bark('ch01.bark.pliable.fields');
  }

  private async ending(): Promise<void> {
    if (this.stage === 'done') return;
    this.stage = 'done';
    const ctx = this.ctx;
    if (ctx.companions.some((c) => c.npc.id === 'pliable')) await ctx.talk('ch01_end', { with: 'pliable' });
    ctx.complete();
  }

  // ---------------------------------------------------------------------------------------- helpers

  /** A story spot from the level file: a tiny 'spot' zone, as a ground position. */
  private spot(id: string): THREE.Vector3 | null {
    const z = this.ctx.level.zones.find((zone) => zone.id === id && zone.type === 'spot');
    if (!z || typeof z.x !== 'number' || typeof z.z !== 'number') return null;
    return new THREE.Vector3(z.x, this.ctx.session.world.terrain.heightAt(z.x, z.z), z.z);
  }
}

let running: ChapterOne | null = null;

const script: ChapterScript = {
  id: 'ch01',
  level: 'ch01',
  start(ctx) {
    running = new ChapterOne(ctx);
    running.start();
  },
  update(dt) {
    running?.update(dt);
  },
  dispose() {
    running?.dispose();
    running = null;
  },
};

export default script;
