/**
 * The top-level flow of the game (service 'flow'): boot → title → (START) a new game and the opening → Chapter I;
 * CONTINUE → the latest save at its chapter and waystone; CHAPTERS → any chapter reached; pause during play;
 * after Chapter IV the demo end (VITE_DEMO builds); after Chapter XIII "THE END OF THE DREAM", the Epilogue,
 * the sequel card "CHRISTIANA'S JOURNEY - coming soon" (GDD 2.10), then the credits and back to the title.
 *
 *   const flow = new GameFlow(engine);   // registers services.flow
 *   flow.setChapterLauncher((n, waystone, state) => chapterManager.start(n, waystone, state));
 *   flow.start();                         // the title screen
 *
 * Chapters plug in through the launcher (until then the test world stands in for every chapter, see
 * flow-launcher.ts) and report their end with `events.emit('chapter:complete', { chapter })`. Settings and the
 * Satchel are other modules' screens, opened through `setScreen()` factories (both wired by default). During
 * play the pause key opens the pause menu and the Satchel key the Satchel (flow-satchel.ts); touch players get a
 * pause icon of the flow's own while the touch controls are hidden (talks, cutscenes: flow-touch.ts).
 * Tests read `window.__pilgrim.services.get('flow').probe()`.
 */
import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import { events } from '../core/Events';
import { buildFlags, urlParams } from '../core/Flags';
import type { GameState } from '../core/GameState';
import type { SaveData } from '../core/Save';
import { services } from '../core/Services';
import { DEMO_LAST_CHAPTER, EPILOGUE } from '../ui/ChapterSelect';
import { Credits } from '../ui/Credits';
import { DemoEnd } from '../ui/DemoEnd';
import { Menu } from '../ui/Menu';
import { Opening } from '../ui/Opening';
import { uiRoot } from '../ui/dom';
import { EndCard } from '../ui/menu-end';
import { installFlowDebug } from './flow-debug';
import { settingsScreen, testWorldLauncher } from './flow-launcher';
import { PauseController, chapterWantsGameplay } from './flow-pause';
import { FlowSatchel } from './flow-satchel';
import { freshState, stateFrom } from './flow-session';
import { TitleHub } from './flow-title';
import { FlowTouchPause } from './flow-touch';
import type {
  ChapterHandle,
  ChapterLauncher,
  FlowProbe,
  FlowState,
  ScreenFactory,
  ScreenId,
} from './flow-types';

export type * from './flow-types';

/** The last chapter before the end card and the Epilogue. */
const LAST_CHAPTER = 13;
/** A pause press this soon after a menu handled a key or button belongs to that menu (Esc closing the pause). */
const PAUSE_DEBOUNCE_MS = 250;

type Overlay = { id: 'opening' | 'demoEnd' | 'endCard' | 'sequelCard' | 'credits'; dispose(): void };

export class GameFlow {
  private readonly parent: HTMLElement;
  private readonly blank = new THREE.Scene();
  private readonly blankCamera = new THREE.PerspectiveCamera(55, 1, 0.1, 10);
  private readonly pauser: PauseController;
  private readonly satchel: FlowSatchel;
  private readonly touchPause: FlowTouchPause;
  private readonly screens = new Map<ScreenId, ScreenFactory>();
  private readonly offs: Array<() => void> = [];
  private launcher: ChapterLauncher;
  private current: FlowState = 'boot';
  private hub: TitleHub | null = null;
  private overlay: Overlay | null = null;
  private handle: ChapterHandle | null = null;
  private chapterNo: number | null = null;
  /** Bumped by every transition: async work from an older one (a chapter still loading) is dropped. */
  private gen = 0;

  constructor(
    private readonly engine: Engine,
    opts: { parent?: HTMLElement } = {},
  ) {
    this.parent = opts.parent ?? uiRoot();
    this.blank.name = 'flow:blank';
    this.blank.background = new THREE.Color(0x000000);
    this.launcher = testWorldLauncher(engine);
    const stillPlaying = (): boolean => this.current === 'playing' && !this.pauser.isOpen;
    this.satchel = new FlowSatchel(this.parent, () => this.handle, stillPlaying);
    this.screens.set('settings', settingsScreen);
    this.screens.set('satchel', this.satchel.screen);
    this.pauser = new PauseController({
      engine,
      parent: this.parent,
      chapter: () => this.handle,
      screens: (id) => this.screens.get(id) ?? null,
      onResumed: () => this.setState('playing'),
      onQuit: () => this.quitToTitle(),
    });
    this.touchPause = new FlowTouchPause(this.parent, {
      wanted: () => this.current === 'playing' && !chapterWantsGameplay(this.handle),
      press: () => this.pause(),
    });
    this.offs.push(
      engine.loop.add({ update: () => this.step() }, -1000),
      events.on('chapter:complete', ({ chapter }) => this.completeChapter(chapter)),
      // GDD 2.15 "pause everywhere": leaving the tab mid-play opens the pause menu, which keeps the game paused
      // when the tab comes back (the Loop would otherwise un-pause what it paused). An open Satchel already holds
      // the pause (the Loop leaves a pause it did not make alone): no pause menu under it.
      events.on('game:pause', ({ reason }) => {
        if (reason === 'hidden' && this.current === 'playing' && !this.satchel.shown) this.pause();
      }),
      events.on('game:resume', () => {
        if (this.pauser.isOpen || this.current === 'opening') this.engine.loop.paused = true;
      }),
    );
    const debug = services.tryGet('debug');
    if (debug) this.offs.push(installFlowDebug(debug, this));
    services.register('flow', this);
  }

  get state(): FlowState {
    return this.current;
  }

  /** The screen on top (see FlowProbe.screen). */
  get screen(): string {
    if (this.pauser.isOpen) return this.pauser.screen;
    if (this.satchel.isOpen) return 'satchel';
    if (this.overlay) return this.overlay.id;
    if (this.hub) return this.hub.screen;
    return this.current === 'loading' ? 'loading' : 'none';
  }

  get chapter(): number | null {
    return this.chapterNo;
  }

  /** The title's landscape is on screen, or a chapter is being played. */
  get ready(): boolean {
    return this.hub ? this.hub.ready : this.current === 'playing' || this.current === 'paused';
  }

  /** null restores the default (the test world). */
  setChapterLauncher(fn: ChapterLauncher | null): void {
    this.launcher = fn ?? testWorldLauncher(this.engine);
  }

  /** Registers the Settings or Satchel screen (null removes it; the button then does nothing but warn). */
  setScreen(id: ScreenId, factory: ScreenFactory | null): void {
    if (factory) this.screens.set(id, factory);
    else this.screens.delete(id);
  }

  /** Boot → the title screen. */
  start(): void {
    if (this.current === 'boot') this.showTitle();
  }

  showTitle(noticeKey?: string): void {
    if (this.current === 'disposed') return;
    this.gen++;
    this.clear();
    this.idle();
    this.chapterNo = null;
    this.setState('title');
    this.hub = new TitleHub(
      this.engine,
      this.parent,
      {
        start: () => this.newGame(),
        continue: (latest) => void this.continueGame(latest),
        startChapter: (n) => void this.startChapter(n, null, freshState(n)),
      },
      (id) => this.screens.get(id) ?? null,
    );
    if (noticeKey) this.hub.showNotice(noticeKey);
  }

  /** START THE JOURNEY: a new game, the opening narration (Chapter I loads behind it), then Chapter I. */
  newGame(): void {
    const state = freshState(1);
    if (urlParams.skipIntro) {
      void this.startChapter(1, null, state);
      return;
    }
    const gen = ++this.gen;
    this.clear();
    this.idle();
    this.setState('opening');
    this.chapterNo = 1;
    const ready = this.launcher(1, null, state).then((handle) => {
      if (gen !== this.gen) {
        handle.dispose();
        return;
      }
      this.handle = handle;
      this.engine.loop.paused = true; // held still behind the narration until the player chooses to play
      handle.setPaused?.(true);
    });
    ready.catch((err: unknown) => {
      if (gen !== this.gen) return;
      console.error('[flow] Chapter I could not start', err);
      this.showTitle('ui.flow.loadFailed');
    });
    const opening = new Opening(this.parent, {
      ready,
      onDone: () => this.afterOpening(gen),
      onBack: () => gen === this.gen && this.showTitle(), // START pressed by mistake
    });
    this.overlay = { id: 'opening', dispose: () => opening.dispose() };
  }

  /** CONTINUE: the latest save, at its chapter and waystone. */
  async continueGame(latest?: SaveData | null): Promise<void> {
    const gen = this.gen;
    const data = latest ?? (await services.get('save').latest());
    if (gen !== this.gen) return;
    if (!data) {
      this.showTitle();
      return;
    }
    await this.startChapter(data.chapter, data.waystone || null, stateFrom(data));
  }

  /** Loads and starts a chapter (behind the launcher's loading screen). `state` defaults to the live one. */
  async startChapter(chapter: number, waystone: string | null = null, state?: GameState): Promise<void> {
    if (this.current === 'disposed') return;
    const gen = ++this.gen;
    this.clear(); // the old chapter goes first, while the state still describes it
    this.idle();
    const gs = state ?? services.tryGet('state') ?? freshState(chapter);
    if (gs.chapter !== chapter) gs.setChapter(chapter);
    if (waystone) gs.setWaystone(waystone);
    this.chapterNo = chapter;
    this.setState('loading');
    // A quiet loading screen; the chapter starts its own song and ambience.
    events.emit('music:stop', { fade: 1.2 });
    events.emit('ambience:set', { id: null, fade: 1.2 });
    try {
      const handle = await this.launcher(chapter, waystone, gs);
      if (gen !== this.gen) {
        handle.dispose();
        return;
      }
      this.handle = handle;
      this.setState('playing');
    } catch (err) {
      if (gen !== this.gen) return;
      console.error(`[flow] chapter ${chapter} could not start`, err);
      this.showTitle('ui.flow.loadFailed');
    }
  }

  /** A chapter finished (also the 'chapter:complete' event): next chapter, demo end, end card or sequel card. */
  completeChapter(chapter: number): void {
    if (this.current !== 'playing' && this.current !== 'paused') return;
    this.pauser.close();
    if (buildFlags.DEMO && chapter >= DEMO_LAST_CHAPTER) this.showDemoEnd();
    else if (chapter === LAST_CHAPTER) this.showEndCard();
    else if (chapter >= EPILOGUE) this.showEndCard('sequel');
    else void this.startChapter(chapter + 1);
  }

  pause(): void {
    if (this.current !== 'playing') return;
    this.pauser.open();
    this.setState('paused');
  }

  resume(): void {
    this.pauser.resume();
  }

  /** Pause > TITLE SCREEN (confirmed): the chapter goes; the next CONTINUE starts from the last waystone save. */
  quitToTitle(): void {
    this.showTitle();
  }

  showDemoEnd(): void {
    this.gen++;
    this.pauser.close();
    this.clearOverlays();
    this.hub?.dispose();
    this.hub = null;
    this.engine.loop.paused = true; // the last chapter stays behind the scrim, still
    services.tryGet('input')?.setGameplayActive(false);
    this.setState('demoEnd');
    const screen = new DemoEnd(this.parent, { onTitle: () => this.showTitle() });
    this.overlay = { id: 'demoEnd', dispose: () => screen.dispose() };
  }

  /**
   * 'dream': "THE END OF THE DREAM" after Chapter XIII, then the Epilogue. 'sequel': after the Epilogue the
   * title card "CHRISTIANA'S JOURNEY - coming soon", then the credits (GDD 2.10 Epilogue).
   */
  showEndCard(variant: 'dream' | 'sequel' = 'dream'): void {
    this.gen++;
    this.clear();
    this.idle();
    this.setState('endCard');
    const dream = variant === 'dream';
    if (dream) events.emit('music:play', { id: 'celestial', fade: 3, state: 'calm' });
    const card = new EndCard(this.parent, {
      variant,
      onDone: () => (dream ? void this.startChapter(EPILOGUE) : this.showCredits('end')),
    });
    this.overlay = { id: dream ? 'endCard' : 'sequelCard', dispose: () => card.dispose() };
  }

  showCredits(variant: 'menu' | 'end' = 'end'): void {
    this.gen++;
    this.clear();
    this.idle();
    this.setState('credits');
    events.emit('music:play', { id: 'pilgrim', fade: 3, state: 'calm' });
    const credits = new Credits(this.parent, { variant, onDone: () => this.showTitle() });
    this.overlay = { id: 'credits', dispose: () => credits.dispose() };
  }

  probe(): FlowProbe {
    const active = Menu.active?.focused ?? null;
    return {
      state: this.current,
      screen: this.screen,
      chapter: this.chapterNo,
      loopPaused: this.engine.loop.paused,
      titleReady: this.hub?.ready ?? false,
      continueAvailable: this.hub?.title.continueAvailable ?? false,
      focused: active ? (active.dataset.key ?? active.textContent) : null,
      menuDepth: Menu.depth,
    };
  }

  dispose(): void {
    if (this.current === 'disposed') return;
    this.gen++;
    for (const off of this.offs.splice(0)) off();
    this.clear();
    this.pauser.dispose();
    this.satchel.dispose();
    this.touchPause.dispose();
    this.engine.loop.paused = false;
    this.setState('disposed');
    if (services.tryGet('flow') === this) services.unregister('flow');
  }

  // ------------------------------------------------------------------------------------------- internals

  /** Fixed step while playing: the pause key (Esc, pad Menu, touch icon) and the Satchel key (Tab, View, icon). */
  private step(): void {
    if (this.current !== 'playing' || this.satchel.isOpen) return;
    const input = services.tryGet('input');
    if (!input || Menu.sinceLastInput() < PAUSE_DEBOUNCE_MS) return;
    if (input.pressed('pause')) this.pause();
    else if (input.pressed('satchel')) this.satchel.openFromPlay();
  }

  private afterOpening(gen: number): void {
    if (gen !== this.gen || !this.handle) return;
    this.clearOverlays();
    this.engine.loop.paused = false;
    const handle = this.handle;
    handle.setPaused?.(false);
    const input = services.tryGet('input');
    const gameplay = handle.gameplay ?? true;
    input?.setGameplayActive(gameplay);
    if (gameplay) input?.requestPointerLock(); // still inside the click / key press that chose to play
    this.setState('playing');
  }

  /** Menus own the screen: no gameplay input, the loop runs (the title landscape drifts), nothing ducked. */
  private idle(): void {
    this.engine.loop.paused = false;
    services.tryGet('input')?.setGameplayActive(false);
  }

  /** Drops every screen and the running chapter; the engine draws a blank scene until the next owner. */
  private clear(): void {
    this.pauser.close();
    this.satchel.close();
    this.clearOverlays();
    this.hub?.dispose();
    this.hub = null;
    if (this.handle) {
      const handle = this.handle;
      this.handle = null;
      handle.dispose();
    }
    this.engine.setView(this.blank, this.blankCamera);
  }

  private clearOverlays(): void {
    this.overlay?.dispose();
    this.overlay = null;
  }

  private setState(next: FlowState): void {
    const prev = this.current;
    if (prev === next) return;
    this.current = next;
    events.emit('flow:state', { state: next, prev });
  }
}
