/**
 * Game-time waits and event waits for chapter scripts (ChapterContext.wait / waitFor). Game time advances in the
 * chapter's fixed step, so waits stop while the game is paused. After dispose() nothing resolves: a script
 * awaiting a wait simply stops there (its promise chain is dropped with the chapter).
 */
import { events, type EventMap, type EventName } from '../core/Events';

interface Timer {
  left: number;
  resolve: () => void;
}

export class ScriptClock {
  private timers: Timer[] = [];
  private readonly offs = new Set<() => void>();
  private disposed = false;

  wait(seconds: number): Promise<void> {
    if (this.disposed) return new Promise<void>(() => {});
    return new Promise<void>((resolve) => this.timers.push({ left: Math.max(0, seconds), resolve }));
  }

  waitFor<K extends EventName>(name: K, pred?: (p: EventMap[K]) => boolean): Promise<EventMap[K]> {
    if (this.disposed) return new Promise<EventMap[K]>(() => {});
    return new Promise<EventMap[K]>((resolve) => {
      const handler = (payload?: unknown): void => {
        const p = payload as EventMap[K];
        if (pred && !pred(p)) return;
        off();
        this.offs.delete(off);
        resolve(p);
      };
      // The bus types handlers per event; this one accepts every payload shape.
      const off = events.on(name, handler as Parameters<typeof events.on<K>>[1]);
      this.offs.add(off);
    });
  }

  /** Fixed step: counts timers down and resolves the ones that ran out. */
  update(dt: number): void {
    if (this.disposed || this.timers.length === 0) return;
    let kept = 0;
    for (let i = 0; i < this.timers.length; i++) {
      const tm = this.timers[i]!;
      tm.left -= dt;
      if (tm.left <= 0) tm.resolve();
      else this.timers[kept++] = tm;
    }
    this.timers.length = kept;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.timers = [];
    for (const off of this.offs) off();
    this.offs.clear();
  }
}
