/**
 * Chapter scripts (GDD 2.10, 2.15 "Engine rules: build / start / update / dispose"; ARCHITECTURE "Chapters").
 *
 * A chapter is a level file (`content/levels/<level>.json`, built by PlaySession) plus a small script that reacts
 * to triggers, talks and events through a ChapterContext. Scripts never hold level coordinates (CLAUDE.md rule 5):
 * they ask for landmarks, NPCs and triggers by id. Everything a script creates through the context is freed when
 * the chapter is disposed; anything else it makes it frees in `dispose()` or hands to `ctx.own()`.
 *
 *   const script: ChapterScript = {
 *     id: 'ch02', level: 'ch02',
 *     start(ctx) {
 *       ctx.objective('ui.hud.objective.findSteps');
 *       ctx.addCompanion('pliable');
 *       ctx.onTrigger('pliable_quits', () => void ctx.talk('ch02_pliable_quits', { with: 'pliable' }));
 *     },
 *   };
 *   export default script;
 *
 * The ChapterManager (src/world/ChapterManager.ts) builds: script chunk → PlaySession (the World and every
 * gameplay system) → GameState.setChapter → chapter card → context → `start(ctx)` (not awaited: a script may
 * await talks and cutscenes for the whole chapter) → `update(dt, ctx)` every fixed step → `dispose()`.
 */
import type * as THREE from 'three';
import type { AmbienceId, MusicState, SongId } from '../audio/types';
import type { Engine } from '../core/Engine';
import type { EventMap, EventName } from '../core/Events';
import type { GameState } from '../core/GameState';
import type { CutsceneDef } from '../narrative/cutscene-types';
import type { BarkSet, Companion } from '../npc/Companion';
import type { NPC } from '../npc/NPC';
import type { Interactable } from '../world/Interactables';
import type { LevelData } from '../world/LevelTypes';
import type { PlaySession } from '../world/PlaySession';

export type { BarkSet, Companion } from '../npc/Companion';
export type { NPC } from '../npc/NPC';

export interface ChapterScript {
  /** Registry key style id ('test', 'ch01'...), for logs and probes. */
  id: string;
  /** Level file id (`content/levels/<level>.json`; '1'..'13' map to 'ch01'..'ch13'). */
  level: string;
  /** Called once the world is on screen and playable. Not awaited by the manager (errors are logged). */
  start(ctx: ChapterContext): void | Promise<void>;
  /** Every fixed step (60 Hz) while the loop runs (not while paused). */
  update?(dt: number, ctx: ChapterContext): void;
  /** Frees what the script made outside the context. The context and the session are freed after it. */
  dispose?(): void;
}

export interface TalkOptions {
  /** NPC id the player talks with: faces each other, `state.meet()`, the other actor of over-shoulder shots. */
  with?: string;
}

export interface TalkHookOptions {
  /** i18n key of the bubble verb (default 'ui.verb.talk'). */
  verb?: string;
  /** Remove the [E] Talk after the first conversation (default false: it can be replayed). */
  once?: boolean;
}

/** An interactable a script adds: the context fills in nothing but removal on dispose. */
export type ScriptInteractable = Omit<Interactable, 'onUse'> & { onUse(): void };

export interface ChapterContext {
  /** 1..13, 14 = Epilogue (the flow's chapter number; the test chapter runs as the number it was launched as). */
  readonly chapter: number;
  readonly engine: Engine;
  readonly session: PlaySession;
  readonly state: GameState;
  readonly level: LevelData;

  /** Every `level.npcs` entry wrapped as an NPC (not 'christian': the player is Christian). */
  npc(id: string): NPC | null;
  /** Makes an NPC follow the player (GDD 2.8). Returns the existing companion when it already is one. */
  addCompanion(npcId: string, barks?: BarkSet): Companion;
  removeCompanion(npcId: string): void;
  readonly companions: readonly Companion[];

  /**
   * Plays a dialogue graph through the chapter's DialogueRunner, DialoguePanel and SpeechBubbles: the player is
   * locked ('locked'), the two face each other, the HUD hides, `state.meet()` the partner, `cam` effects cut the
   * camera (Cutscene shot helpers; the follow rig is suspended and resumed). Everything is put back at the end.
   * A talk asked for while another runs is queued.
   */
  talk(graphId: string, opts?: TalkOptions): Promise<void>;
  /** Plays a cutscene with the chapter's actors ('christian' + every NPC); the player is put in 'cutscene' mode. */
  cutscene(def: CutsceneDef): Promise<'done' | 'skipped'>;
  /** An [E] Talk interactable on the NPC (follows it). Returns its remover. */
  onTalk(npcId: string, graph: string | (() => Promise<void>), opts?: TalkHookOptions): () => void;
  onInteract(o: ScriptInteractable): () => void;
  /** A level trigger was entered ('trigger:enter'). `once` (default true) unsubscribes after the first call. */
  onTrigger(id: string, fn: () => void, opts?: { once?: boolean }): () => void;
  /** Zone enter / exit by zone type ('zone:enter' / 'zone:exit'). */
  onZone(type: string, enter?: (id: string) => void, exit?: (id: string) => void): () => void;

  /** HUD objective (i18n key) or null; kept in GameState for THE ROLL. */
  objective(key: string | null): void;
  toast(key: string, params?: Record<string, string | number>): void;
  /** Shows the chapter card again (the manager shows it once when the chapter starts). */
  chapterCard(): void;
  music(id: SongId, state?: MusicState): void;
  ambience(id: AmbienceId | null): void;

  /** Resolves after `seconds` of game time (stops while paused). Never resolves after the chapter is disposed. */
  wait(seconds: number): Promise<void>;
  /** The next event `name` whose payload passes `pred`. Never resolves after the chapter is disposed. */
  waitFor<K extends EventName>(name: K, pred?: (p: EventMap[K]) => boolean): Promise<EventMap[K]>;
  /** Ground position of a level landmark (a new vector), or null for an unknown id / a path landmark. */
  landmark(id: string): THREE.Vector3 | null;
  /** The chapter's ending is done: emits 'chapter:complete' {chapter} once (the flow moves on). */
  complete(): void;
  /** Frees `dispose` with the chapter (newest first). */
  own(dispose: () => void): void;
}
