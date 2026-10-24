/**
 * The title hub: the title screen over its drifting 3D landscape, plus the screens opened from it without
 * leaving the landscape (CHAPTERS, CREDITS, SETTINGS). GameFlow owns one while in the 'title' state.
 * Plays the 'title' song and the 'meadow' ambience (GDD 2.13 themes; title.json names the same pair).
 */
import type { Engine } from '../core/Engine';
import { events } from '../core/Events';
import { urlParams } from '../core/Flags';
import { save, type SaveData } from '../core/Save';
import { ChapterSelect, EPILOGUE } from '../ui/ChapterSelect';
import { Credits } from '../ui/Credits';
import { DailyCard, dailyButton } from '../ui/DailyCard';
import { daily } from '../core/Daily';
import { Title } from '../ui/Title';
import { TitleScene } from '../ui/TitleScene';
import { landProgress } from './chapter-progress';
import type { ScreenFactory, ScreenHandle, ScreenId } from './flow-types';

export interface TitleHubHandlers {
  start(): void;
  continue(latest: SaveData | null): void;
  startChapter(chapter: number): void;
}

export type TitleSub = 'chapters' | 'credits' | 'daily' | ScreenId;

export class TitleHub {
  readonly title: Title;
  readonly scene: TitleScene;
  private sub: { id: TitleSub; handle: ScreenHandle } | null = null;
  private latest: SaveData | null = null;
  /** Morning Manna's sun button (DECISIONS #403); hidden on the very first day. */
  private readonly sun: HTMLButtonElement | null;
  private disposed = false;

  constructor(
    engine: Engine,
    private readonly parent: HTMLElement,
    private readonly handlers: TitleHubHandlers,
    private readonly screens: (id: ScreenId) => ScreenFactory | null,
  ) {
    this.title = new Title(parent, {
      start: () => handlers.start(),
      continue: () => handlers.continue(this.latest),
      chapters: () => this.open('chapters'),
      settings: () => this.open('settings'),
      credits: () => this.open('credits'),
    });
    this.scene = new TitleScene(engine);
    this.sun = daily.newcomer ? null : dailyButton(() => this.open('daily'));
    if (this.sun) parent.appendChild(this.sun);
    events.emit('music:play', { id: 'title', fade: 1.5, state: 'calm' });
    events.emit('ambience:set', { id: 'meadow', fade: 2 });
    this.scene.start().then(
      () => {
        if (!this.disposed && this.scene.ready) this.title.setSceneReady();
      },
      (err: unknown) =>
        console.warn('[flow] the title landscape could not be built; keeping the backdrop', err),
    );
    save.latest().then(
      (data) => {
        if (this.disposed) return;
        this.latest = data;
        this.title.setContinueAvailable(data !== null);
        if (daily.cardDue) this.open('daily');
      },
      (err: unknown) => console.warn('[flow] could not read the saves', err),
    );
  }

  /** The top screen: 'title' or the sub-screen open over it. */
  get screen(): string {
    return this.sub?.id ?? 'title';
  }

  get ready(): boolean {
    return this.scene.ready;
  }

  showNotice(key: string): void {
    this.title.showNotice(key);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.closeSub();
    this.sun?.remove();
    this.title.dispose();
    this.scene.dispose();
  }

  private open(id: TitleSub): void {
    if (this.disposed || this.sub) return;
    if (id === 'chapters') {
      const select = new ChapterSelect(this.parent, {
        onPick: (n) => this.handlers.startChapter(n),
        onBack: () => this.closeSub(),
      });
      this.sub = { id, handle: select };
      this.title.setCovered(true);
      void furthestChapter().then((n) => {
        if (this.sub?.handle === select) select.setFurthest(n);
      });
      void journeyFinds().then((f) => {
        if (this.sub?.handle === select) select.setProgress((n) => landProgress(n, f.promises, f.achievements));
      });
      return;
    }
    if (id === 'daily') {
      this.sub = { id, handle: new DailyCard(this.parent, { chapter: this.latest?.chapter ?? 1, onClose: () => this.closeSub() }) };
      this.title.setCovered(true, true);
      return;
    }
    if (id === 'credits') {
      this.sub = { id, handle: new Credits(this.parent, { variant: 'menu', onDone: () => this.closeSub() }) };
      this.title.setCovered(true);
      return;
    }
    const factory = this.screens(id);
    if (!factory) {
      console.warn(`[flow] no "${id}" screen is registered (GameFlow.setScreen)`);
      events.emit('sfx', { id: 'ui_close' });
      return;
    }
    this.title.setCovered(true, true);
    let closed = false;
    const entry: { id: TitleSub; handle: ScreenHandle } = { id, handle: { dispose: () => {} } };
    this.sub = entry;
    const handle = factory({
      parent: this.parent,
      from: 'title',
      close: () => {
        if (closed) return;
        closed = true;
        if (this.sub === entry) this.closeSub();
      },
    });
    entry.handle = handle;
    if (closed) handle.dispose(); // closed before the factory even returned
  }

  private closeSub(): void {
    const sub = this.sub;
    if (!sub) return;
    this.sub = null;
    sub.handle.dispose();
    if (!this.disposed) this.title.setCovered(false);
  }
}

/** Every Promise and badge found in any save slot (the CHAPTERS screen's finds lines). */
export async function journeyFinds(): Promise<{ promises: string[]; achievements: string[] }> {
  try {
    const slots = await save.list();
    const promises = new Set<string>();
    const achievements = new Set<string>();
    for (const s of slots) {
      for (const id of s.data.promises) promises.add(id);
      for (const id of s.data.achievements) achievements.add(id);
    }
    return { promises: [...promises], achievements: [...achievements] };
  } catch {
    return { promises: [], achievements: [] };
  }
}

/** The furthest chapter reached in any save (GDD 2.14 CHAPTERS); `?god=1` (debug) opens them all. */
export async function furthestChapter(): Promise<number> {
  if (urlParams.god) return EPILOGUE;
  try {
    const slots = await save.list();
    return slots.reduce((max, s) => Math.max(max, s.data.chapter), 1);
  } catch (err) {
    console.warn('[flow] could not read the saves', err);
    return 1;
  }
}
