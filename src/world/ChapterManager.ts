/**
 * Builds, runs and disposes chapters (GDD 2.15 "Engine rules": build / start / update / dispose; ARCHITECTURE
 * "Chapters"). It is the flow's ChapterLauncher (`manager.launch`), registered as the 'chapters' service while a
 * chapter is up (probe for tests and the console).
 *
 * launch(chapter, waystone, state):
 *   1. the script: CHAPTERS[key] ('1'..'13', 'epilogue'; `opts.script` forces one, `?chapter=test` → 'test'). A
 *      chapter with no script yet is played with the test script on the test level (logged with console.info).
 *   2. PlaySession.start(engine, script.level, {state, waystone}) behind the chapter's loading screen
 *   3. state.setChapter(chapter) when it differs, the chapter card, the ChapterContext, level Triggers
 *   4. script.start(ctx) (not awaited), then every fixed step: triggers → ctx (timers, NPCs, companions) →
 *      script.update; every frame: NPC render, held talk shots, bubbles.
 * Reading the chapter's LAST waystone fetches the next chapter's script, level and dialogue in the background
 * (chapter-prefetch.ts). The returned ChapterHandle's dispose() frees, newest first: script.dispose(), the
 * context (talks, cutscenes, NPC wrappers, companions, interactables, listeners, `own()`), triggers, loop
 * systems, the session (World, GPU memory). `restart()` disposes and builds the running chapter again (leak checks).
 */
import type { Engine } from '../core/Engine';
import { events } from '../core/Events';
import type { GameState } from '../core/GameState';
import { services } from '../core/Services';
import { chapterKey, hasChapter, nextChapterKey } from '../chapters/index';
import { ChapterRuntime } from '../chapters/context';
import type { ChapterScript } from '../chapters/types';
import type { ChapterHandle, ChapterLauncher } from '../game/flow-types';
import { chapterLoadingInfo } from '../ui/Loading';
import { ChapterDevProbe } from './chapter-devcam';
import { ChapterScripts } from './chapter-prefetch';
import { PLAY_ORDER, PlaySession } from './PlaySession';
import { isAbort } from './play-build';
import { Triggers } from './Triggers';

declare module '../core/Services' {
  interface ServiceMap {
    chapters: ChapterManager;
  }
}

/** The script a chapter without its own is played with. */
export const FALLBACK_SCRIPT = 'test';
/** Fixed-step slot: after interactables (120), before the camera (130), so NPCs move before it frames them. */
const ORDER = { step: PLAY_ORDER.interact + 5, late: 999 };

export interface ChapterManagerOptions {
  /** Always play this registry key (`?chapter=test`). */
  script?: string;
}

export interface ChapterProbe {
  key: string | null;
  chapter: number | null;
  level: string | null;
  ready: boolean;
  building: boolean;
  builds: number;
  npcs: string[];
  companions: string[];
  talking: boolean;
  cuts: number;
  triggers: number;
  prefetched: string[];
}

interface Launch {
  chapter: number;
  waystone: string | null;
  state: GameState;
}

/** One built chapter. */
class ActiveChapter {
  private readonly offs: Array<() => void> = [];
  private disposed = false;

  constructor(
    readonly key: string,
    readonly chapter: number,
    readonly script: ChapterScript,
    readonly session: PlaySession,
    readonly ctx: ChapterRuntime,
    readonly triggers: Triggers,
    engine: Engine,
    onLastWaystone: () => void,
  ) {
    const lastWaystone = session.world.level.waystones.at(-1)?.id ?? null;
    this.offs.push(
      engine.loop.add(
        {
          update: (dt) => {
            triggers.update();
            ctx.update(dt);
            script.update?.(dt, ctx);
          },
          render: (alpha, frameDt) => ctx.render(alpha, frameDt),
        },
        ORDER.step,
      ),
      engine.loop.add({ render: () => ctx.renderLate() }, ORDER.late),
      events.on('waystone:read', ({ id }) => {
        if (id === lastWaystone) onLastWaystone();
      }),
    );
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const off of this.offs.splice(0)) off();
    try {
      this.script.dispose?.();
    } catch (err) {
      console.error(`[chapters] chapter "${this.key}" dispose failed`, err);
    }
    this.ctx.dispose();
    this.triggers.dispose();
    this.session.dispose();
  }
}

export class ChapterManager {
  readonly scripts = new ChapterScripts();
  /** The test world's dev surface (window.__pilgrim.testWorld on `?chapter=test`); null when no chapter is up. */
  dev: ChapterDevProbe | null = null;
  /** Loading-bar values of the last build. */
  readonly progressLog: number[] = [];
  private active: ActiveChapter | null = null;
  private last: Launch | null = null;
  private abort: AbortController | null = null;
  private builds = 0;
  private disposed = false;

  constructor(
    private readonly engine: Engine,
    private readonly opts: ChapterManagerOptions = {},
  ) {}

  /** The flow's ChapterLauncher. */
  readonly launch: ChapterLauncher = async (chapter, waystone, state) => {
    await this.build({ chapter, waystone, state });
    const handle: ChapterHandle = {
      gameplay: true,
      satchelMap: () => {
        const s = this.active?.session;
        if (!s) return null;
        const p = s.player;
        const player = {
          x: p.renderPosition.x,
          z: p.renderPosition.z,
          heading: { x: p.forward.x, z: p.forward.z },
        };
        return { level: s.world.level, player };
      },
      dispose: () => this.end(),
    };
    return handle;
  };

  get session(): PlaySession | null {
    return this.active?.session ?? null;
  }

  get context(): ChapterRuntime | null {
    return this.active?.ctx ?? null;
  }

  get building(): boolean {
    return this.abort !== null;
  }

  /** Disposes the running chapter and builds it again from its launch (state, waystone). */
  async restart(): Promise<void> {
    const again = this.last;
    if (!again || this.building || this.disposed) return;
    this.teardown();
    try {
      await this.build(again);
    } catch (err) {
      if (!isAbort(err)) console.error('[chapters] restart failed', err);
    }
  }

  /** Ends the running chapter (the flow's handle). */
  end(): void {
    this.abort?.abort();
    this.abort = null;
    this.teardown();
    this.release();
  }

  dispose(): void {
    if (this.disposed) return;
    this.end();
    this.disposed = true;
  }

  probe(): ChapterProbe {
    const a = this.active;
    return {
      key: a?.key ?? null,
      chapter: a?.chapter ?? null,
      level: a?.session.levelId ?? null,
      ready: a !== null && !this.building,
      building: this.building,
      builds: this.builds,
      npcs: a?.ctx.npcIds ?? [],
      companions: a ? a.ctx.companions.map((c) => c.npc.id) : [],
      talking: a?.ctx.talking ?? false,
      cuts: a?.ctx.cuts ?? 0,
      triggers: a?.triggers.count ?? 0,
      prefetched: this.scripts.prefetched,
    };
  }

  // ---------------------------------------------------------------------------------------------- private

  /** Which script plays `chapter`: the forced one, its own, or the fallback. */
  private keyFor(chapter: number): string {
    if (this.opts.script) return this.opts.script;
    const key = chapterKey(chapter);
    if (hasChapter(key)) return key;
    console.info(`[chapters] chapter "${key}" has no script yet: playing the test chapter in its place`);
    return FALLBACK_SCRIPT;
  }

  private async build(l: Launch): Promise<void> {
    if (this.disposed) throw new Error('[chapters] the chapter manager was disposed');
    this.abort?.abort();
    this.teardown();
    const abort = new AbortController();
    this.abort = abort;
    this.last = l;
    services.register('chapters', this);
    const key = this.keyFor(l.chapter);
    this.progressLog.length = 0;
    this.dev ??= new ChapterDevProbe(this.engine, this);
    try {
      const script = await this.scripts.load(key);
      if (abort.signal.aborted) throw abortError();
      const forced = this.opts.script !== undefined;
      const session = await PlaySession.start(this.engine, script.level, {
        state: l.state,
        waystone: l.waystone ?? undefined,
        signal: abort.signal,
        loading: chapterLoadingInfo(forced ? script.level : chapterKey(l.chapter)),
        onProgress: (p) => this.progressLog.push(p),
      });
      if (abort.signal.aborted) {
        session.dispose();
        throw abortError();
      }
      this.active = this.startChapter(key, l, script, session);
      this.builds++;
    } catch (err) {
      // Nothing is up (the flow shows the title, or the owner aborted): let go of the probe and the service.
      if (this.abort === abort) this.release();
      throw err;
    } finally {
      if (this.abort === abort) this.abort = null;
    }
  }

  private startChapter(key: string, l: Launch, script: ChapterScript, session: PlaySession): ActiveChapter {
    if (l.state.chapter !== l.chapter) l.state.setChapter(l.chapter);
    let ctx: ChapterRuntime | null = null;
    let triggers: Triggers | null = null;
    try {
      ctx = new ChapterRuntime(l.chapter, this.engine, session);
      triggers = new Triggers(session.world.level, session.player);
      const next = nextChapterKey(l.chapter);
      const active = new ActiveChapter(key, l.chapter, script, session, ctx, triggers, this.engine, () => {
        if (next && !this.opts.script) void this.scripts.prefetch(next);
      });
      events.emit('hud:chapterCard', { chapter: l.chapter });
      const run = ctx;
      Promise.resolve()
        .then(() => (run.isDisposed ? undefined : script.start(run)))
        .catch((err: unknown) => console.error(`[chapters] chapter "${key}" start failed`, err));
      return active;
    } catch (err) {
      ctx?.dispose();
      triggers?.dispose();
      session.dispose();
      throw err;
    }
  }

  private release(): void {
    this.last = null;
    this.dev?.dispose();
    this.dev = null;
    if (services.tryGet('chapters') === this) services.unregister('chapters');
  }

  private teardown(): void {
    this.dev?.detach();
    const a = this.active;
    this.active = null;
    a?.dispose();
  }
}

function abortError(): Error {
  const err = new Error('The chapter was disposed while it was loading');
  err.name = 'AbortError';
  return err;
}
