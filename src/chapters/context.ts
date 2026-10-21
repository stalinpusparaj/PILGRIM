/**
 * The ChapterContext a chapter script talks to (src/chapters/types.ts), and everything behind it: the cast
 * (ctx-cast.ts), conversations (ctx-talk.ts + ctx-host.ts), game-time waits (ctx-timers.ts), the chapter's
 * SpeechBubbles ('bubbles': companion barks, bubble lines), a CutscenePlayer made on first use, and every
 * listener, interactable and `own()` disposer the script added. The ChapterManager drives `update(dt)` each fixed
 * step and `render(alpha, frameDt)` each frame, and calls `dispose()` (newest first) before the session goes.
 */
import * as THREE from 'three';
import '../audio/events';
import type { AmbienceId, MusicState, SongId } from '../audio/types';
import type { Engine } from '../core/Engine';
import { events, type EventMap, type EventName } from '../core/Events';
import type { GameState } from '../core/GameState';
import type { CutscenePlayer } from '../narrative/Cutscene';
import type { CutsceneDef } from '../narrative/cutscene-types';
import { SpeechBubbles } from '../narrative/SpeechBubbles';
import type { Character } from '../gen/CharacterFactory';
import type { LevelData } from '../world/LevelTypes';
import type { PlaySession } from '../world/PlaySession';
import { ChapterCast } from './ctx-cast';
import { TalkKit } from './ctx-talk';
import { ScriptClock } from './ctx-timers';
import type {
  BarkSet,
  ChapterContext,
  Companion,
  NPC,
  ScriptInteractable,
  TalkHookOptions,
  TalkOptions,
} from './types';

const TALK = { radius: 2.2, verb: 'ui.verb.talk', above: 0.35 };
const FADE = { music: 1.5, ambience: 2 };

export class ChapterRuntime implements ChapterContext {
  readonly level: LevelData;
  readonly state: GameState;
  private readonly cast: ChapterCast;
  private readonly talks: TalkKit;
  private readonly clock = new ScriptClock();
  private readonly bubbles: SpeechBubbles;
  private cutscenes: CutscenePlayer | null = null;
  private readonly disposers: Array<() => void> = [];
  private completed = false;
  private disposed = false;
  private canUse: ((itemId: string) => boolean) | null = null;

  constructor(
    readonly chapter: number,
    readonly engine: Engine,
    readonly session: PlaySession,
  ) {
    this.level = session.world.level;
    this.state = session.state;
    this.bubbles = new SpeechBubbles(session.view);
    this.cast = new ChapterCast(session);
    this.talks = new TalkKit({
      session,
      npc: (id) => this.cast.npc(id),
      companions: () => this.cast.companions,
    });
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  /** A chapter conversation is on screen (probe). */
  get talking(): boolean {
    return this.talks.active;
  }

  /** Camera cuts of the current / last talk (probe). */
  get cuts(): number {
    return this.talks.host.cuts;
  }

  get npcIds(): string[] {
    return this.cast.npcs.map((n) => n.id);
  }

  // --------------------------------------------------------------------------------------- the cast

  npc(id: string): NPC | null {
    return this.cast.npc(id);
  }

  get companions(): readonly Companion[] {
    return this.cast.companions;
  }

  addCompanion(npcId: string, barks?: BarkSet): Companion {
    return this.cast.addCompanion(npcId, barks);
  }

  removeCompanion(npcId: string): void {
    this.cast.removeCompanion(npcId);
  }

  // ---------------------------------------------------------------------------------- story beats

  talk(graphId: string, opts: TalkOptions = {}): Promise<void> {
    if (this.disposed) return Promise.resolve();
    return this.talks.talk(graphId, opts.with ?? null);
  }

  async cutscene(def: CutsceneDef): Promise<'done' | 'skipped'> {
    if (this.disposed) return 'skipped';
    if (!this.cutscenes) {
      const { CutscenePlayer } = await import('../narrative/Cutscene');
      if (this.disposed) return 'skipped';
      this.cutscenes = new CutscenePlayer(this.engine);
    }
    const player = this.session.player;
    const actors: Record<string, Character> = { christian: player.character };
    for (const n of this.cast.npcs) actors[n.id] = n.character;
    const took = player.mode === 'play';
    if (took) player.mode = 'cutscene';
    try {
      return await this.cutscenes.play(def, { actors, ground: this.session.col });
    } finally {
      if (took && !this.session.isDisposed && player.mode === 'cutscene') player.mode = 'play';
    }
  }

  onTalk(npcId: string, graph: string | (() => Promise<void>), opts: TalkHookOptions = {}): () => void {
    const npc = this.cast.npc(npcId);
    if (!npc) {
      console.error(`[chapter] onTalk: there is no NPC "${npcId}"`);
      return () => {};
    }
    let remove = (): void => {};
    const item: ScriptInteractable = {
      id: `talk:${npcId}`,
      pos: npc.position, // the NPC moves it
      radius: TALK.radius,
      height: npc.character.height + TALK.above,
      verb: opts.verb ?? TALK.verb,
      enabled: true,
      onUse: () => {
        if (!item.enabled || this.disposed) return;
        item.enabled = false;
        const run = typeof graph === 'string' ? this.talk(graph, { with: npcId }) : graph();
        run
          .catch((err: unknown) => console.error(`[chapter] talk with "${npcId}" failed`, err))
          .finally(() => {
            if (opts.once) remove();
            else item.enabled = true;
          });
      },
    };
    remove = this.onInteract(item);
    return remove;
  }

  onInteract(o: ScriptInteractable): () => void {
    return this.track(this.session.interactables.add(o));
  }

  onTrigger(id: string, fn: () => void, opts: { once?: boolean } = {}): () => void {
    const once = opts.once !== false;
    const off = this.track(
      events.on('trigger:enter', (p) => {
        if (p.id !== id) return;
        if (once) off();
        fn();
      }),
    );
    return off;
  }

  onZone(type: string, enter?: (id: string) => void, exit?: (id: string) => void): () => void {
    const a = enter ? events.on('zone:enter', (p) => p.type === type && enter(p.id)) : null;
    const b = exit ? events.on('zone:exit', (p) => p.type === type && exit(p.id)) : null;
    return this.track(() => {
      a?.();
      b?.();
    });
  }

  // ------------------------------------------------------------------------------------ HUD, audio

  objective(key: string | null): void {
    this.state.setObjective(key);
  }

  guide(target: { npc: string } | { landmark: string } | THREE.Vector3 | (() => THREE.Vector3 | null) | null): void {
    const guide = this.session.guide;
    if (target === null) return guide.clear();
    if (target instanceof THREE.Vector3 || typeof target === 'function') return guide.set(target);
    if ('npc' in target) {
      const npc = this.cast.npc(target.npc);
      return guide.set(npc ? () => npc.position : null);
    }
    guide.set(this.landmark(target.landmark));
  }

  toast(key: string, params?: Record<string, string | number>): void {
    events.emit('hud:toast', params ? { key, params } : { key });
  }

  chapterCard(): void {
    events.emit('hud:chapterCard', { chapter: this.chapter });
  }

  music(id: SongId, state?: MusicState): void {
    events.emit('music:play', state ? { id, state, fade: FADE.music } : { id, fade: FADE.music });
  }

  ambience(id: AmbienceId | null): void {
    events.emit('ambience:set', { id, fade: FADE.ambience });
  }

  // ------------------------------------------------------------------------------------- utilities

  wait(seconds: number): Promise<void> {
    return this.clock.wait(seconds);
  }

  waitFor<K extends EventName>(name: K, pred?: (p: EventMap[K]) => boolean): Promise<EventMap[K]> {
    return this.clock.waitFor(name, pred);
  }

  landmark(id: string): THREE.Vector3 | null {
    const lm = this.level.landmarks.find((l) => l.id === id);
    if (!lm?.at) return null;
    const [x, lift, z] = lm.at;
    return new THREE.Vector3(x, this.session.world.terrain.heightAt(x, z) + lift, z);
  }

  complete(): void {
    if (this.completed || this.disposed) return;
    this.completed = true;
    events.emit('chapter:complete', { chapter: this.chapter });
  }

  itemUse(canUse: ((itemId: string) => boolean) | null): void {
    this.canUse = canUse;
  }

  /** The Satchel asks whether a CARRIED item has a "Use" button right now. */
  canUseItem(itemId: string): boolean {
    return !this.disposed && this.canUse?.(itemId) === true;
  }

  own(dispose: () => void): void {
    if (this.disposed) dispose();
    else this.disposers.push(dispose);
  }

  // -------------------------------------------------------------------------------- manager hooks

  update(dt: number): void {
    if (this.disposed) return;
    this.clock.update(dt);
    this.cast.update(dt);
  }

  render(alpha: number, frameDt: number): void {
    if (this.disposed) return;
    this.cast.render(alpha);
    this.talks.render(frameDt);
  }

  /** After the camera moved (late in the frame): bubbles follow the heads. */
  renderLate(): void {
    if (!this.disposed) this.bubbles.update(this.engine.camera);
  }

  dispose(): void {
    if (!this.session.isDisposed) this.session.guide.clear();
    if (this.disposed) return;
    this.disposed = true;
    this.clock.dispose();
    this.talks.dispose();
    this.cutscenes?.dispose();
    this.cutscenes = null;
    for (let i = this.disposers.length - 1; i >= 0; i--) {
      try {
        this.disposers[i]!();
      } catch (err) {
        console.error('[chapter] dispose failed', err);
      }
    }
    this.disposers.length = 0;
    this.cast.dispose();
    this.bubbles.dispose(); // unregisters 'bubbles'
  }

  /** Keeps `off` for dispose; calling the returned function early removes it from the list too. */
  private track(off: () => void): () => void {
    let done = false;
    const once = (): void => {
      if (done) return;
      done = true;
      const i = this.disposers.indexOf(once);
      if (i >= 0) this.disposers.splice(i, 1);
      off();
    };
    this.disposers.push(once);
    return once;
  }
}
