/**
 * Pause during play (GDD 2.14 "Pause - PAUSED", GDD 2.15 "Pause everywhere"): pauses the loop, frees the mouse,
 * ducks the music (the audio engine itself only reacts to a hidden tab), shows the Pause screen and opens the
 * Satchel or Settings over it. Resuming gives gameplay input back the way the chapter wants it.
 */
import type { Engine } from '../core/Engine';
import { events } from '../core/Events';
import { services } from '../core/Services';
import { storyHoldsInput } from '../narrative/story-input';
import { Pause } from '../ui/Pause';
import { playSfx } from '../ui/menu-screen';
import type { ChapterHandle, ScreenFactory, ScreenHandle, ScreenId } from './flow-types';

/**
 * Whether gameplay input comes back when a menu over a running chapter closes. A conversation or a cutscene owns
 * the input (story-input.ts): closing the pause menu or the Satchel must not hand it back in the middle of one.
 */
export function chapterWantsGameplay(chapter: ChapterHandle | null): boolean {
  return (chapter?.gameplay ?? true) && !storyHoldsInput();
}

export interface PauseHooks {
  readonly engine: Engine;
  readonly parent: HTMLElement;
  chapter(): ChapterHandle | null;
  screens(id: ScreenId): ScreenFactory | null;
  /** KEEP GOING (the loop already runs again). */
  onResumed(): void;
  /** TITLE SCREEN, confirmed. */
  onQuit(): void;
}

export class PauseController {
  private pause: Pause | null = null;
  private external: { id: ScreenId; handle: ScreenHandle } | null = null;
  /** What had the focus when the menu opened (a dialogue choice, the dialogue layer): it gets it back. */
  private returnFocus: HTMLElement | null = null;

  constructor(private readonly hooks: PauseHooks) {}

  get isOpen(): boolean {
    return this.pause !== null;
  }

  /** A screen of another module (Settings, Satchel) is open over the pause menu. */
  get externalOpen(): boolean {
    return this.external !== null;
  }

  /** 'pause', 'pause.controls', 'pause.confirm', 'settings' or 'satchel'; '' when closed. */
  get screen(): string {
    if (this.external) return this.external.id;
    if (!this.pause) return '';
    return this.pause.view === 'root' ? 'pause' : `pause.${this.pause.view}`;
  }

  open(): void {
    if (this.pause) return;
    const active = document.activeElement;
    this.returnFocus = active instanceof HTMLElement && active !== document.body ? active : null;
    this.hooks.engine.loop.paused = true;
    services.tryGet('input')?.setGameplayActive(false);
    this.hooks.chapter()?.setPaused?.(true);
    events.emit('audio:duck', { on: true, by: 'pause' });
    events.emit('game:pause', { reason: 'menu' });
    this.pause = new Pause(this.hooks.parent, {
      resume: () => this.resume(),
      satchel: () => this.openExternal('satchel'),
      settings: () => this.openExternal('settings'),
      quitToTitle: () => {
        this.close();
        this.hooks.onQuit();
      },
    });
  }

  /** KEEP GOING: close the menu and give the chapter back its input. */
  resume(): void {
    if (!this.pause) return;
    this.close();
    playSfx('ui_close');
    this.hooks.engine.loop.paused = false;
    const chapter = this.hooks.chapter();
    chapter?.setPaused?.(false);
    // Inside the closing click / key press, so the desktop pointer lock is granted again at once.
    services.tryGet('input')?.setGameplayActive(chapterWantsGameplay(chapter));
    events.emit('game:resume');
    this.hooks.onResumed();
  }

  /**
   * Close everything without resuming (quit to the title, flow teardown). The loop stays as it is. The focus goes
   * back where it was (Enter keeps working on a conversation's choices).
   */
  close(): void {
    this.closeExternal();
    if (!this.pause) return;
    this.pause.dispose();
    this.pause = null;
    events.emit('audio:duck', { on: false, by: 'pause' });
    const back = this.returnFocus;
    this.returnFocus = null;
    if (back?.isConnected) back.focus({ preventScroll: true });
  }

  dispose(): void {
    this.close();
  }

  private openExternal(id: ScreenId): void {
    if (!this.pause || this.external) return;
    const factory = this.hooks.screens(id);
    if (!factory) {
      console.warn(`[flow] no "${id}" screen is registered (GameFlow.setScreen)`);
      playSfx('ui_close');
      return;
    }
    this.pause.setCovered(true);
    let closed = false;
    const entry: { id: ScreenId; handle: ScreenHandle } = { id, handle: { dispose: () => {} } };
    this.external = entry;
    const handle = factory({
      parent: this.hooks.parent,
      from: 'pause',
      close: () => {
        if (closed) return;
        closed = true;
        if (this.external === entry) this.closeExternal();
      },
    });
    entry.handle = handle;
    if (closed) handle.dispose();
  }

  private closeExternal(): void {
    const ext = this.external;
    if (!ext) return;
    this.external = null;
    ext.handle.dispose();
    this.pause?.setCovered(false);
  }
}
