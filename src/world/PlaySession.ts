/**
 * A level being played (ARCHITECTURE "Gameplay (Phase 2)"): the World plus everything that makes it a game.
 * `?chapter=test` runs one (src/world/TestWorld.ts); the Phase 3 ChapterManager reuses it for every chapter.
 *
 *   const play = await PlaySession.start(engine, 'test', { waystone: 'test_w2' });
 *   ...
 *   play.dispose();   // GPU memory and events.count() come back to where they were
 *
 * start(): the loading screen, buildWorld() (play-build.ts), the GameState ('state' service; created when none is
 * registered), the CollisionWorld, Christian (Player, with bonks) at the waystone or the Way's start facing along
 * the Way, the GDD 2.5 FollowCamera, the Burden, Hope, Zones, the Slough, Interactables, Waystones, Promises, the
 * look of gameplay-only landmarks (pits), the HUD, the level's ambience and music, and the F1 controls
 * (play-debug.ts). Shaders are compiled behind the loading screen, then the world is shown.
 *
 * Loop order (PLAY_ORDER): input-driven player → zones / slough / hope / burden → interactables, waystones,
 * Promises → camera → (fly cameras) → world + HUD. Per rendered frame: player interpolation → slough sink →
 * camera → world.update(camera) (NPCs, blob shadows, particles) → HUD bubble; the sun's shadows follow the player.
 *
 * Hope 0 (`player:arise`): I SHALL ARISE (src/ui/Arise.ts), the player wakes at the last waystone (or the Way's
 * start) with Hope 60. Hazard zones bonk through Zones → Bonk ('zone:hazard'); see src/player/Bonk.ts.
 */
import * as THREE from 'three';
import '../audio/events';
import type { Engine } from '../core/Engine';
import { events } from '../core/Events';
import { services } from '../core/Services';
import { urlParams } from '../core/Flags';
import { createGameState, type GameState } from '../core/GameState';
import { Loading, type LoadingInfo } from '../ui/Loading';
import { HUD } from '../ui/HUD';
import { cancelArise, runArise } from '../ui/Arise';
import { Player } from '../player/Player';
import { FollowCamera } from '../player/Camera';
import { BurdenSystem } from '../player/Burden';
import { HopeSystem } from '../player/Hope';
import { runCrossDrop } from '../player/CrossDrop';
import { Waystones } from '../narrative/Waystones';
import { Promises } from '../narrative/Promises';
import { Guide } from './Guide';
import { CollisionWorld } from './Collision';
import { Zones } from './Zones';
import { Slough } from './Slough';
import { Interactables } from './Interactables';
import { PitMarks } from './play-pits';
import { abortError, buildPlayWorld, isAbort, loadingScene, precompileWorld } from './play-build';
import { facingAlongWay, spawnPoint } from './play-spawn';
import { crossSkipHeld, crossStand, crossTomb } from './play-cross';
import { playLevelAudio } from './play-audio';
import { installPlayDebug } from './play-debug';
import { addPlayLoop, type PlayLoopParts } from './play-loop';
import type { World } from './World';

export { PLAY_ORDER } from './play-loop';

export interface PlaySessionOptions {
  /** The session state; default the registered 'state' service, else a new one (registered, freed on dispose). */
  state?: GameState;
  /** Start at this waystone (`&waystone=`); default the state's last waystone, else the Way's start. */
  waystone?: string;
  onProgress?: (p: number) => void;
  /** The camera to drive (default: a new one with the Settings FOV). */
  camera?: THREE.PerspectiveCamera;
  /** Loading-screen title (default: the chapter's own). */
  loading?: LoadingInfo;
  /** Aborting before start() settles frees everything and rejects with an AbortError. */
  signal?: AbortSignal;
}

const CAMERA = { fov: 55, near: 0.1, far: 1000 };

export class PlaySession {
  readonly world: World;
  readonly col: CollisionWorld;
  readonly player: Player;
  readonly camera: FollowCamera;
  readonly state: GameState;
  /** The THREE camera the FollowCamera drives (also `engine.camera` while the session is shown). */
  readonly view: THREE.PerspectiveCamera;
  readonly levelId: string;
  readonly burden: BurdenSystem;
  readonly hope: HopeSystem;
  readonly zones: Zones;
  readonly slough: Slough;
  readonly interactables: Interactables;
  readonly waystones: Waystones;
  readonly promises: Promises;
  /** Where the HUD points next (service 'guide'). */
  readonly guide: Guide;
  readonly pits: PitMarks;
  hud: HUD | null = null;

  private readonly engine: Engine;
  private readonly blank: THREE.Scene;
  private readonly loading: Loading;
  private readonly disposers: Array<() => void> = [];
  private readonly focus = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private godMode = urlParams.god;
  private arising = false;
  private crossing: Promise<void> | null = null;
  private disposed = false;

  /** Builds and shows a level. Rejects if it cannot be built (the loading panel says so) or with an AbortError. */
  static async start(engine: Engine, levelId: string, opts: PlaySessionOptions = {}): Promise<PlaySession> {
    const fov = services.tryGet('settings')?.data.fov ?? CAMERA.fov;
    const view = opts.camera ?? new THREE.PerspectiveCamera(fov, 1, CAMERA.near, CAMERA.far);
    const loading = new Loading();
    const blank = loadingScene();
    engine.setView(blank, view);
    // A failed build leaves its message on screen; the owner's abort (or the next mode) takes it down.
    opts.signal?.addEventListener('abort', () => loading.dispose(), { once: true });
    const world = await buildPlayWorld(levelId, {
      engine,
      camera: view,
      loading,
      info: opts.loading,
      onProgress: opts.onProgress,
      signal: opts.signal,
    }).catch((err: unknown) => {
      if (isAbort(err)) loading.dispose();
      throw err;
    });
    let session: PlaySession | null = null;
    try {
      session = new PlaySession(engine, levelId, world, view, blank, loading, opts);
      await precompileWorld(engine, world.scene, view);
      if (opts.signal?.aborted || session.disposed) throw abortError();
      session.show();
      opts.onProgress?.(1);
      loading.setProgress(1);
      await loading.hide();
      loading.dispose();
      return session;
    } catch (err) {
      if (session) session.dispose();
      else world.dispose();
      loading.dispose();
      throw err;
    }
  }

  private constructor(
    engine: Engine,
    levelId: string,
    world: World,
    view: THREE.PerspectiveCamera,
    blank: THREE.Scene,
    loading: Loading,
    opts: PlaySessionOptions,
  ) {
    this.engine = engine;
    this.levelId = levelId;
    this.world = world;
    this.view = view;
    this.blank = blank;
    this.loading = loading;
    const d = this.disposers;
    // Everything below is freed in reverse order, also when a later step throws.
    try {
      d.push(() => world.dispose());
      const owned = !opts.state && !services.has('state');
      this.state = opts.state ?? services.tryGet('state') ?? createGameState();
      if (owned) d.push(() => services.tryGet('state') === this.state && services.unregister('state'));

      this.col = new CollisionWorld(world);
      d.push(() => this.col.dispose());
      this.pits = new PitMarks(world);
      world.scene.add(this.pits.object);
      d.push(() => this.pits.dispose());

      const start = spawnPoint(world);
      this.player = new Player({
        world,
        col: this.col,
        state: this.state,
        recipe: this.state.burden ? 'christian_burdened' : 'christian_free',
        spawn: start.pos,
        facing: start.facing,
      });
      d.push(() => this.player.dispose());
      this.camera = new FollowCamera(view, this.player, this.col);
      d.push(() => this.camera.dispose());
      this.burden = new BurdenSystem(this.player, this.state, world);
      d.push(() => this.burden.dispose());
      this.hope = new HopeSystem(this.state, world);
      d.push(() => this.hope.dispose());
      this.zones = new Zones(world, this.player);
      d.push(() => this.zones.dispose());
      this.slough = new Slough({ world, col: this.col, player: this.player, zones: this.zones });
      d.push(() => this.slough.dispose());
      this.interactables = new Interactables(this.player);
      d.push(() => this.interactables.dispose());
      this.waystones = new Waystones({
        world,
        player: this.player,
        interactables: this.interactables,
        state: this.state,
      });
      d.push(() => this.waystones.dispose());
      this.promises = new Promises({ world, player: this.player, state: this.state });
      this.guide = new Guide({ way: world.ways.main, player: this.player });
      this.disposers.push(() => this.guide.dispose());
      d.push(() => this.promises.dispose());
      this.god = this.godMode;

      const waystone = opts.waystone ?? (this.state.waystone || null);
      if (waystone) this.respawn(waystone);
      this.wire();
    } catch (err) {
      this.dispose();
      throw err;
    }
  }

  // ------------------------------------------------------------------------------------------- gameplay

  /** God mode (?god=1, F1): no Hope drain, no bonks. */
  get god(): boolean {
    return this.godMode;
  }

  set god(on: boolean) {
    this.godMode = on;
    if (this.hope) this.hope.enabled = !on;
    if (this.player) this.player.bonks.enabled = !on;
  }

  /**
   * Puts the player at a waystone of this level (in front of the stone, facing along the Way) or, for null / an
   * unknown id, at the Way's start; the camera snaps behind.
   */
  respawn(waystone: string | null): void {
    if (this.disposed) return;
    const spot = waystone ? this.waystones.spot(waystone) : null;
    if (spot) {
      this.player.teleport(spot.pos, facingAlongWay(this.world, spot.pos.x, spot.pos.z));
    } else {
      const sp = spawnPoint(this.world);
      this.player.teleport(sp.pos, sp.facing);
    }
    this.camera.snap();
  }

  /** Burden on/off (F1). Putting it on a Christian built without a sack swaps in the burdened outfit. */
  setBurden(on: boolean): void {
    if (this.disposed) return;
    this.state.setBurden(on);
    if (on && !this.player.character.recipe.burden) this.player.setRecipe('christian_burdened');
  }

  /** Teleport to a ground point (x, z) facing `facing` (default: along the Way); camera snaps. Tests, debug. */
  teleport(x: number, z: number, facing?: number): void {
    if (this.disposed) return;
    this.tmp.set(x, this.col.groundAt(x, z), z);
    this.player.teleport(this.tmp, facing ?? facingAlongWay(this.world, x, z));
    this.camera.snap();
  }

  /** Where a fresh start stands: the Way's start, facing along it. */
  spawn(): { x: number; z: number; facing: number } {
    const sp = spawnPoint(this.world);
    return { x: sp.pos.x, z: sp.pos.z, facing: sp.facing };
  }

  /**
   * Stands the player in front of the level's cross, facing it, with the tomb behind and below (F1 "Go to the
   * Cross", tests). False when the level has no cross.
   */
  goToCross(): boolean {
    const at = this.disposed ? null : crossStand(this.world, this.player.facing);
    if (at) this.teleport(at.x, at.z, at.facing);
    return at !== null;
  }

  /**
   * The full GDD 2.7.1 Cross sequence now (F1, tests): toward the level's 'tomb' landmark when it is near, else 12 m
   * ahead. Puts the Burden back on first if it is off. Resolves when Christian is free and playing again; a second
   * call while one runs returns the same promise.
   */
  crossDrop(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.crossing) return this.crossing;
    if (!this.state.burden) this.setBurden(true);
    // The session owns the run: ending mid-sequence aborts it at once, with no end state (no music, no events).
    const abort = new AbortController();
    this.disposers.push(() => abort.abort());
    const run = runCrossDrop({
      player: this.player,
      world: this.world,
      burden: this.burden,
      state: this.state,
      tomb: crossTomb(this.world, this.player.controller.position, this.player.facing),
      skip: crossSkipHeld, // hold Space / A / JUMP 1 s
      signal: abort.signal,
    });
    const crossing = run.finally(() => {
      if (this.crossing === crossing) this.crossing = null;
    });
    this.crossing = crossing;
    return crossing;
  }

  /** I SHALL ARISE, then wake at the last waystone with Hope 60 (Arise sets it). */
  private async arise(): Promise<void> {
    if (this.arising || this.disposed) return;
    this.arising = true;
    // Arise owns the lock (a bonk that took Hope to 0 hands its own over, so it cannot unlock under the screen).
    const locked = this.player.bonks.handOverLock() || this.player.mode === 'play';
    if (locked) this.player.mode = 'locked';
    try {
      await runArise({ respawn: () => this.respawn(this.state.waystone || null) });
    } finally {
      this.arising = false;
      if (locked && !this.disposed && this.player.mode === 'locked') this.player.mode = 'play';
    }
  }

  // -------------------------------------------------------------------------------------------- wiring

  private wire(): void {
    const d = this.disposers;
    d.push(
      ...addPlayLoop(this.engine.loop, {
        ...this.systems(),
        tick: (dt) => {
          this.guide.update(dt);
          this.hud?.update(dt);
          this.state.tickPlaytime(dt);
        },
        frame: (frameDt) => this.frame(frameDt),
      }),
    );
    d.push(
      events.on('player:arise', () => {
        this.arise().catch((err: unknown) => console.error('[play] I SHALL ARISE failed', err));
      }),
    );
    d.push(() => cancelArise());
    const debug = services.tryGet('debug');
    if (debug) d.push(installPlayDebug(this, debug));
  }

  private systems(): Omit<PlayLoopParts, 'tick' | 'frame'> {
    const { player, zones, slough, hope, burden, interactables, waystones, promises, camera } = this;
    return { player, zones, slough, hope, burden, interactables, waystones, promises, camera };
  }

  /** Per rendered frame, after the camera: the world animates around the view, the shadows follow the player. */
  private frame(frameDt: number): void {
    const loop = this.engine.loop;
    const dt = loop.paused ? 0 : frameDt * loop.timeScale;
    this.focus.copy(this.player.renderPosition);
    this.world.setShadowFocus(this.focus);
    this.world.update(dt, this.view);
    this.hud?.render(this.view);
  }

  /** The world goes on screen: view, HUD, input, the level's sounds. */
  private show(): void {
    this.engine.setView(this.world.scene, this.view);
    this.hud = new HUD();
    this.disposers.push(() => {
      this.hud?.dispose();
      this.hud = null;
    });
    const input = services.tryGet('input');
    // GDD 2.6: JUMP and USE; PRAY once the Prayer gift is given (Ch VII); combat buttons are the fight's call.
    const buttons = (): void =>
      input?.setTouchButtons(this.state.hasGift('prayer') ? ['jump', 'use', 'pray'] : ['jump', 'use']);
    buttons();
    this.disposers.push(events.on('gift:given', buttons), events.on('state:reset', buttons));
    input?.setGameplayActive(true);
    this.disposers.push(() => services.tryGet('input')?.setGameplayActive(false));
    this.disposers.push(playLevelAudio(this.world.level));
  }

  // ------------------------------------------------------------------------------------------- dispose

  get isDisposed(): boolean {
    return this.disposed;
  }

  /** Frees everything in reverse order of creation; the engine is left drawing an empty scene. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (let i = this.disposers.length - 1; i >= 0; i--) {
      try {
        this.disposers[i]!();
      } catch (err) {
        console.error('[play] dispose failed', err);
      }
    }
    this.disposers.length = 0;
    this.loading.dispose();
    if (this.engine.scene === this.world.scene) this.engine.setView(this.blank, this.view);
  }
}
