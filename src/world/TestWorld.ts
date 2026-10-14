/**
 * `?chapter=test` (ARCHITECTURE "Runtime modes"): the test world, now played (Phase 2).
 *
 * A PlaySession on `content/levels/test.json`: Christian under the player's control, the GDD 2.5 follow camera,
 * the Burden, Hope, bonks, waystones, Promises and the HUD. This class only keeps the Phase 1 overview on top:
 * the fly cameras (keys 1-3 / F1: follow = the gameplay camera, 2 orbit = free OrbitControls round the player,
 * 3 overview = a slow circle over the map), the build readouts and "Rebuild world" (dispose check:
 * renderer.info.memory must come back to the same numbers).
 *
 *   const test = new TestWorld(engine);
 *   await test.start();   // resolves when the world is on screen
 *   test.play?.player     // the session (tests, console)
 *   test.dispose();
 */
import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import type { System } from '../core/Loop';
import { events } from '../core/Events';
import { services } from '../core/Services';
import { urlParams } from '../core/Flags';
import type { LoadingInfo } from '../ui/Loading';
import { PLAY_ORDER, PlaySession } from './PlaySession';
import { isAbort } from './play-build';
import type { World } from './World';
import { TEST_CAMERA_MODES, TestCamera, type TestCameraMode } from './TestCamera';

const LEVEL_ID = 'test';
/** Dev-only screen: plain English is fine (ARCHITECTURE "Debug"). */
const TITLE: LoadingInfo = { kicker: 'DEV', title: 'TEST WORLD' };
const CAMERA = { fov: 55, near: 0.1, far: 1000 };
const DEBUG_GROUP = 'Test world';
const CHOICES = ['choice1', 'choice2', 'choice3'] as const;
/** Blend back into the gameplay camera after a fly camera (s). */
const RESUME_BLEND = 0.8;

export class TestWorld {
  readonly camera: THREE.PerspectiveCamera;
  /** Every loading-bar value of the last build, in order (tests: proves the bar moved while building). */
  readonly progressLog: number[] = [];

  private session: PlaySession | null = null;
  private rig: TestCamera | null = null;
  private mode: TestCameraMode = 'follow';
  private suspended = false;
  private abort: AbortController | null = null;
  private readonly offs: Array<() => void> = [];
  private removeSystems: Array<() => void> = [];
  private building = false;
  private started = false;
  private disposed = false;
  private readonly focus = new THREE.Vector3();

  constructor(private readonly engine: Engine) {
    const fov = services.tryGet('settings')?.data.fov ?? CAMERA.fov;
    this.camera = new THREE.PerspectiveCamera(fov, 1, CAMERA.near, CAMERA.far);
  }

  /** The built world (null while loading). */
  get current(): World | null {
    return this.session?.world ?? null;
  }

  /** The running play session (null while loading). */
  get play(): PlaySession | null {
    return this.session;
  }

  get cameraMode(): TestCameraMode {
    return this.mode;
  }

  /** True once the world is built and on screen (false while loading or rebuilding). */
  get ready(): boolean {
    return this.session !== null && !this.building && !this.disposed;
  }

  /** Loads and plays the test level; resolves once it is on screen. Rejects if the level cannot be built. */
  async start(): Promise<void> {
    if (this.disposed || this.started) return;
    this.started = true;
    const keys: System = { update: () => this.readKeys() };
    const fly: System = { render: (_a, frameDt) => this.fly(frameDt) };
    this.removeSystems = [
      this.engine.loop.add(keys, PLAY_ORDER.input - 1),
      this.engine.loop.add(fly, PLAY_ORDER.cameraOverride),
    ];
    this.installDebug();
    await this.load();
  }

  setCameraMode(mode: TestCameraMode): void {
    if (this.disposed) return;
    this.mode = mode;
    this.rig?.setMode(mode);
    this.syncCamera();
  }

  /** Disposes the session and plays the level again (leak check). Ignored while a build is running. */
  rebuild(): Promise<void> {
    if (this.disposed || this.building || !this.started) return Promise.resolve();
    this.teardown();
    return this.load().catch((err: unknown) => console.error('[test world] rebuild failed', err));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abort?.abort();
    for (const off of this.removeSystems.splice(0)) off();
    for (const off of this.offs.splice(0)) off();
    this.teardown();
  }

  // ------------------------------------------------------------------------------------------- building

  private async load(): Promise<void> {
    this.building = true;
    this.progressLog.length = 0;
    const abort = new AbortController();
    this.abort = abort;
    try {
      const session = await PlaySession.start(this.engine, LEVEL_ID, {
        waystone: urlParams.waystone ?? undefined,
        camera: this.camera,
        loading: TITLE,
        signal: abort.signal,
        onProgress: (p) => this.progressLog.push(p),
      });
      if (abort.signal.aborted) {
        session.dispose();
        return;
      }
      this.session = session;
      this.rig = new TestCamera(
        this.camera,
        this.engine.canvas,
        session.world.terrain,
        session.world.level.size,
      );
      this.rig.setMode(this.mode);
      this.suspended = false;
      this.syncCamera();
      const w = session.world;
      console.info(
        `[test world] built in ${w.buildMs.toFixed(0)} ms (work ${w.buildWorkMs.toFixed(0)} ms), ` +
          `${w.colliders.length} colliders, ${w.npcs.size} NPCs`,
      );
    } catch (err) {
      if (isAbort(err)) return;
      throw err;
    } finally {
      if (this.abort === abort) {
        this.abort = null;
        this.building = false;
      }
    }
  }

  private teardown(): void {
    this.rig?.dispose();
    this.rig = null;
    if (this.session && this.suspended) this.session.camera.resume(0);
    this.suspended = false;
    this.session?.dispose();
    this.session = null;
  }

  // ------------------------------------------------------------------------------------------ per frame

  /** Fixed step: keys 1-3 pick the camera (choices are free in the test world: no dialogue here). */
  private readKeys(): void {
    const input = services.tryGet('input');
    if (!input || !this.session) return;
    for (let i = 0; i < CHOICES.length; i++) {
      if (input.pressed(CHOICES[i]!)) this.setCameraMode(TEST_CAMERA_MODES[i]!);
    }
  }

  /** Orbit / overview: the gameplay camera is suspended and the fly rig drives the view instead. */
  private syncCamera(): void {
    const session = this.session;
    if (!session) return;
    const fly = this.mode !== 'follow';
    if (fly !== this.suspended) {
      if (fly) session.camera.suspend();
      else session.camera.resume(RESUME_BLEND);
      this.suspended = fly;
    }
    // Orbit needs the mouse (OrbitControls): leave gameplay so the pointer is not locked.
    services.tryGet('input')?.setGameplayActive(this.mode !== 'orbit');
    events.emit('hud:visible', { on: this.mode === 'follow' });
  }

  private fly(frameDt: number): void {
    const session = this.session;
    const rig = this.rig;
    if (!session || !rig || this.mode === 'follow') return;
    const player = session.player;
    this.focus.copy(player.renderPosition);
    const reduceMotion = services.tryGet('settings')?.data.reduceMotion ?? false;
    rig.update(frameDt, this.focus, player.character.root.rotation.y, {
      burdened: session.state.burden,
      reduceMotion,
    });
  }

  // ---------------------------------------------------------------------------------------------- debug

  private installDebug(): void {
    const debug = services.tryGet('debug');
    if (!debug) return;
    const g = DEBUG_GROUP;
    this.offs.push(
      debug.addReadout('World build', () => {
        const w = this.current;
        return w ? `${w.buildMs.toFixed(0)} ms (work ${w.buildWorkMs.toFixed(0)} ms)` : 'building...';
      }),
      debug.addReadout('Colliders', () => String(this.current?.colliders.length ?? 0)),
      debug.addReadout('NPCs', () => String(this.current?.npcs.size ?? 0)),
      debug.addReadout('Camera', () => `${this.mode} (keys 1-3)`),
      debug.addButton(g, 'Gameplay cam (1)', () => this.setCameraMode('follow')),
      debug.addButton(g, 'Orbit cam (2)', () => this.setCameraMode('orbit')),
      debug.addButton(g, 'Overview (3)', () => this.setCameraMode('overview')),
      debug.addButton(g, 'Rebuild world', () => void this.rebuild()),
    );
  }
}
