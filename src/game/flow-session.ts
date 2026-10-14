/**
 * The session GameState GameFlow starts a chapter with: the live 'state' service reset to a save (CONTINUE), or
 * to a fresh save at a chapter (START, CHAPTERS: the chapter applies its own starting kit). Without a live
 * state (tests, early boot) a new one is made.
 */
import { createGameState, type GameState } from '../core/GameState';
import { newSave, type SaveData } from '../core/Save';
import { services } from '../core/Services';

/** The live state reset to `data` (or a new state holding it). */
export function stateFrom(data: SaveData): GameState {
  const live = services.tryGet('state');
  if (live) {
    live.reset(data);
    return live;
  }
  return createGameState(data);
}

/** A new game's state at `chapter`. */
export function freshState(chapter: number): GameState {
  const data = newSave();
  data.chapter = chapter;
  return stateFrom(data);
}
