/**
 * Who holds gameplay input during a story beat. A conversation (DialoguePanel over the 'dialogue' runner) and a
 * cutscene ('cutscene' CutscenePlayer) each switch gameplay input off when they start and back on when they end.
 * They can overlap (a cutscene event starts a conversation, a choice starts a cutscene), so each one hands input
 * back only when the other is not still running; menus closing over a story beat (pause, Satchel) leave it off.
 */
import { services } from '../core/Services';
import type {} from './Cutscene'; // 'cutscene' service typing
import type {} from './Dialogue'; // 'dialogue' service typing

/** A conversation is running. */
export function dialogueHoldsInput(): boolean {
  return services.tryGet('dialogue')?.active ?? false;
}

/** A cutscene is playing. */
export function cutsceneHoldsInput(): boolean {
  return services.tryGet('cutscene')?.playing ?? false;
}

/** A conversation or a cutscene owns gameplay input right now. */
export function storyHoldsInput(): boolean {
  return dialogueHoldsInput() || cutsceneHoldsInput();
}
