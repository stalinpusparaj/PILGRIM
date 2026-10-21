/**
 * Types shared by GameFlow and its helpers, and the events / service the flow adds (declaration merging).
 */
import type { GameState } from '../core/GameState';
import type { SatchelMapContext } from '../ui/satchel-view';
import type { GameFlow } from './GameFlow';

export type FlowState =
  | 'boot'
  | 'title'
  | 'opening'
  | 'loading'
  | 'playing'
  | 'paused'
  | 'demoEnd'
  | 'endCard'
  | 'credits'
  | 'disposed';

/**
 * A running chapter, as returned by the chapter launcher. `gameplay` says whether the chapter wants gameplay
 * input (pointer lock, touch controls) when the pause menu or the Satchel closes (default true); `setPaused`
 * hears the pause menu open and close (the loop is paused by the flow either way); `satchelMap` gives the level
 * and the player's position to the Satchel's MAP tab when the flow made the Satchel (a chapter that registers
 * its own 'satchel' service passes them itself).
 */
export interface ChapterHandle {
  dispose(): void;
  readonly gameplay?: boolean;
  setPaused?(paused: boolean): void;
  satchelMap?(): SatchelMapContext | null;
  /** Whether a Satchel > CARRIED item shows "Use" now (ChapterContext.itemUse). */
  satchelCanUse?(itemId: string): boolean;
}

/**
 * Builds and starts chapter `chapter` (1..13, 14 = Epilogue) at `waystone` ('' / null = the chapter start) for
 * `state`. Resolves once the chapter is on screen and playable. The ChapterManager plugs in here.
 */
export type ChapterLauncher = (
  chapter: number,
  waystone: string | null,
  state: GameState,
) => Promise<ChapterHandle>;

/** Screens owned by other modules that the title and pause menus open. */
export type ScreenId = 'settings' | 'satchel';

export interface ScreenContext {
  /** Where to mount (the #ui root). */
  readonly parent: HTMLElement;
  readonly from: 'title' | 'pause';
  /** Call when the screen is done; the flow then disposes it and gives the focus back to the menu below. */
  close(): void;
}

export interface ScreenHandle {
  dispose(): void;
}

export type ScreenFactory = (ctx: ScreenContext) => ScreenHandle;

/** What tests read through `window.__pilgrim.services.get('flow').probe()`. */
export interface FlowProbe {
  state: FlowState;
  /** The screen on top: 'title', 'chapters', 'credits', 'settings', 'satchel', 'opening', 'loading', 'pause',
   * 'pause.controls', 'pause.confirm', 'demoEnd', 'endCard', 'sequelCard' or 'none' (playing). */
  screen: string;
  chapter: number | null;
  loopPaused: boolean;
  /** The title's 3D background is on screen. */
  titleReady: boolean;
  continueAvailable: boolean;
  /** i18n key (or text) of the focused menu item. */
  focused: string | null;
  menuDepth: number;
}

declare module '../core/Services' {
  interface ServiceMap {
    flow: GameFlow;
  }
}

declare module '../core/Events' {
  interface EventMap {
    /** The flow moved between states (title, opening, loading, playing, paused...). */
    'flow:state': { state: FlowState; prev: FlowState };
    /** A chapter's ending finished (ChapterManager emits it): the flow moves on (next chapter, demo end, end). */
    'chapter:complete': { chapter: number };
  }
}
