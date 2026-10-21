/**
 * The Satchel as GameFlow sees it (GDD 2.6 "Tab / View: Satchel, pauses the game"; GDD 2.14 Pause > SATCHEL):
 * - during play the Satchel key opens it straight from the game (`openFromPlay()`, called by the flow's step);
 * - the pause menu's SATCHEL button opens it over the pause menu (`screen`, a ScreenFactory).
 * Both use the registered 'satchel' service when a chapter made one, else a SatchelUI the flow makes itself on
 * first use (loaded as its own chunk) whose MAP shows the running chapter's level and player
 * (`ChapterHandle.satchelMap`). The Satchel pauses the loop and closes itself (Tab / Esc / View / Menu / B).
 * Opening from play loads a chunk first: if the game was paused (the pause menu, a hidden tab) in the meantime,
 * it does not open (`canOpen`).
 */
import { services } from '../core/Services';
import type { SatchelUI } from '../ui/SatchelUI';
import { storyHoldsInput } from '../narrative/story-input';
import { chapterWantsGameplay } from './flow-pause';
import type { ChapterHandle, ScreenFactory, ScreenHandle } from './flow-types';

export class FlowSatchel {
  /** A Satchel the flow had to make itself (no chapter registered one); freed with the flow. */
  private own: SatchelUI | null = null;
  private opening = false;
  private openSatchel: SatchelUI | null = null;
  private disposed = false;

  constructor(
    private readonly parent: HTMLElement,
    private readonly chapter: () => ChapterHandle | null,
    /** The game is still being played (not paused, no other screen): checked again once the Satchel loaded. */
    private readonly canOpen: () => boolean = () => true,
  ) {}

  /** Opening or open over the running game (not over the pause menu). */
  get isOpen(): boolean {
    return this.opening || this.shown;
  }

  /** On screen over the running game (it pauses the loop itself); false while it is still loading. */
  get shown(): boolean {
    return this.openSatchel?.isOpen ?? false;
  }

  /** The Satchel key during play: opens on the last page shown. Ignored while open, talking or in a cutscene. */
  openFromPlay(): void {
    if (this.isOpen || this.disposed || storyHoldsInput()) return;
    this.opening = true;
    this.load().then(
      (satchel) => {
        this.opening = false;
        if (this.disposed || !satchel || satchel.isOpen || !this.canOpen()) return;
        this.openSatchel = satchel;
        void satchel.open().then(() => {
          if (this.openSatchel === satchel) this.openSatchel = null;
        });
      },
      (err: unknown) => {
        this.opening = false;
        console.error('[flow] the satchel could not open', err);
      },
    );
  }

  /** Pause > SATCHEL: the Satchel module's own adapter (satchelScreen) around the same Satchel. */
  readonly screen: ScreenFactory = (ctx) => {
    let disposed = false;
    let inner: ScreenHandle | null = null;
    Promise.all([import('../ui/SatchelUI'), this.load()])
      .then(([{ satchelScreen }, satchel]) => {
        if (disposed) return;
        if (!satchel) {
          ctx.close();
          return;
        }
        inner = satchelScreen(() => satchel)(ctx);
      })
      .catch((err: unknown) => {
        console.error('[flow] the satchel could not open', err);
        ctx.close();
      });
    return {
      dispose: () => {
        disposed = true;
        inner?.dispose();
      },
    };
  };

  /** Closes a Satchel opened from play (the chapter is going away). */
  close(): void {
    const satchel = this.openSatchel;
    this.openSatchel = null;
    satchel?.close();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.close();
    this.own?.dispose();
    this.own = null;
  }

  private async load(): Promise<SatchelUI | null> {
    const live = services.tryGet('satchel');
    if (live) return live;
    const { SatchelUI } = await import('../ui/SatchelUI');
    if (this.disposed) return null;
    const registered = services.tryGet('satchel'); // a chapter may have made one while this chunk loaded
    if (registered) return registered;
    this.own ??= new SatchelUI({
      parent: this.parent,
      map: () => this.chapter()?.satchelMap?.() ?? null,
      canUse: (id) => this.chapter()?.satchelCanUse?.(id) === true,
      // A fly-through chapter (the test world) keeps gameplay input off after the Satchel closes.
      resumeGameplay: () => chapterWantsGameplay(this.chapter()),
    });
    return this.own;
  }
}
