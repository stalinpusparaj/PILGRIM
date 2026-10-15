/** Saves recent safe gameplay, never the middle of a conversation, fall or scripted sequence. */
import { events } from './Events';
import { services } from './Services';
import type { SaveData } from './Save';

export class ProgressAutosave {
  private clock = 5;
  private sampleClock = 0;
  private last: SaveData | null = null;
  private readonly offs: Array<() => void> = [];
  private disposed = false;
  private stale = false;

  constructor(private readonly capture: () => SaveData | null) {
    const flush = (): void => this.flush();
    const hidden = (): void => {
      if (document.hidden) this.flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', hidden);
    this.offs.push(
      () => window.removeEventListener('pagehide', flush),
      () => document.removeEventListener('visibilitychange', hidden),
      events.on('game:pause', flush),
      events.on('state:reset', () => {
        this.stale = true;
        this.last = null;
      }),
      events.on('chapter:changed', () => {
        this.stale = true;
        this.last = null;
      }),
    );
  }

  update(dt: number): void {
    if (this.disposed || this.stale) return;
    this.clock += dt;
    this.sampleClock += dt;
    if (this.sampleClock < 0.5) return;
    this.sampleClock = 0;
    const data = this.capture();
    if (!data) return;
    this.last = data;
    if (this.clock >= 5) this.flush();
  }

  flush(): void {
    if (this.disposed || this.stale) return;
    const data = this.capture() ?? this.last;
    if (!data) return;
    this.last = data;
    this.clock = 0;
    // Save.write mirrors to localStorage synchronously before starting IndexedDB work,
    // so pagehide does not depend on an asynchronous transaction finishing.
    void services
      .tryGet('save')
      ?.write('auto', data)
      .catch((err: unknown) => console.warn('[autosave] write failed', err));
  }

  dispose(): void {
    if (this.disposed) return;
    this.flush();
    this.disposed = true;
    for (const off of this.offs.splice(0)) off();
    this.last = null;
  }
}
