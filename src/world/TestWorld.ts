/**
 * `?chapter=test` (ARCHITECTURE "Runtime modes"): the procedural-toolkit test world.
 *
 * Shows the loading screen, builds `content/levels/test.json` with buildWorld(), precompiles its shaders, then
 * walks Christian along the Way (ping-pong, turning round on the spot at each end) with the gameplay camera
 * 4.5 m behind and 2.2 m above him (GDD 2.5). Keys 1-3 switch camera: follow / free orbit / overview. The F1
 * panel gets build-time and collider readouts, camera and walker controls, and "Rebuild world" (dispose check:
 * renderer.info.memory must come back to the same numbers). The sun's shadow frustum follows the focus.
 *
 *   const test = new TestWorld(engine);
 *   await test.start();   // resolves when the world is on screen
 *   ...
 *   test.dispose();
 */
import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import type { System } from '../core/Loop';
import { events } from '../core/Events';
import { services } from '../core/Services';
import { PRESETS } from '../core/Quality';
import { precompile } from '../core/compile';
import { CharacterFactory, type Character } from '../gen/CharacterFactory';
import { Rng, hashString } from '../gen/rng';
import { Loading, type LoadingInfo } from '../ui/Loading';
import { buildWorld, loadLevel } from './LevelLoader';
import type { World } from './World';
import { TEST_CAMERA_MODES, TestCamera, type TestCameraMode } from './TestCamera';

const LEVEL_ID = 'test';
/** Dev-only screen: plain English is fine (ARCHITECTURE "Debug"). */
const TITLE: LoadingInfo = { kicker: 'DEV', title: 'TEST WORLD' };
/** The level's own Christian is driven if present; otherwise one is built from these recipes. */
const WALKER_NPC = 'christian';
const WALKER_RECIPES = ['christian_burdened', 'christian'];
/** GDD 2.7.1: burdened walk 2.0 m/s. Turning round happens on the spot. */
const WALK = { speed: 2.0, turnRate: 2.4, endMargin: 2 };
const CAMERA = { fov: 55, near: 0.1, far: 1000 };
const DEBUG_GROUP = 'Test world';

type WalkAnim = 'idle' | 'walk' | 'burdenedWalk';

export class TestWorld {
  readonly camera: THREE.PerspectiveCamera;
  /** Every loading-bar value of the last build, in order (tests: proves the bar moved while building). */
  readonly progressLog: number[] = [];

  private readonly loading = new Loading();
  /** Shown while building: an empty scene, so the GPU sits idle and the build gets the main thread. */
  private readonly loadingScene = new THREE.Scene();
  private readonly system: System;
  private readonly offs: Array<() => void> = [];
  private world: World | null = null;
  private rig: TestCamera | null = null;
  private walker: Character | null = null;
  private ownWalker = false;
  private removeSystem: (() => void) | null = null;
  private mode: TestCameraMode = 'follow';
  private generation = 0;
  private building = false;
  private started = false;
  private disposed = false;

  // Walk state: advanced in the fixed step, interpolated per rendered frame.
  private s = 0;
  private prevS = 0;
  private yaw = 0;
  private prevYaw = 0;
  private dir: 1 | -1 = 1;
  private moving = false;
  private walkerPaused = false;
  private speed = WALK.speed;
  private anim: WalkAnim | null = null;
  private readonly focus = new THREE.Vector3();
  private readonly tan = new THREE.Vector3();

  constructor(private readonly engine: Engine) {
    const fov = services.tryGet('settings')?.data.fov ?? CAMERA.fov;
    this.camera = new THREE.PerspectiveCamera(fov, 1, CAMERA.near, CAMERA.far);
    this.loadingScene.name = 'test-world:loading';
    this.loadingScene.background = new THREE.Color(0x2b2235);
    this.system = {
      update: (dt) => this.step(dt),
      render: (alpha, frameDt) => this.frame(alpha, frameDt),
    };
  }

  /** The built world (null while loading). */
  get current(): World | null {
    return this.world;
  }

  get cameraMode(): TestCameraMode {
    return this.mode;
  }

  /** Loads and builds the test level; resolves once it is on screen. Rejects if the level cannot be built. */
  async start(): Promise<void> {
    if (this.disposed || this.started) return;
    this.started = true;
    // A fly-through, not gameplay: no pointer lock, so the mouse can drive the orbit camera.
    services.tryGet('input')?.setGameplayActive(false);
    this.removeSystem = this.engine.loop.add(this.system, 0);
    this.offs.push(
      events.on('settings:changed', ({ key }) => {
        if (key !== 'fov') return;
        const fov = services.tryGet('settings')?.data.fov;
        if (fov !== undefined && fov !== this.camera.fov) {
          this.camera.fov = fov;
          this.camera.updateProjectionMatrix();
        }
      }),
    );
    this.installDebug();
    await this.load();
  }

  setCameraMode(mode: TestCameraMode): void {
    this.mode = mode;
    this.rig?.setMode(mode);
  }

  /** True once the world is built and on screen (false while loading or rebuilding). */
  get ready(): boolean {
    return this.world !== null && !this.building && !this.disposed;
  }

  /** Disposes the world and builds it again (leak check). Ignored while a build is running. */
  rebuild(): Promise<void> {
    if (this.disposed || this.building || !this.started) return Promise.resolve();
    this.teardown();
    return this.load().catch((err: unknown) => console.error('[test world] rebuild failed', err));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++; // a build still running is dropped (and disposed) when it finishes
    this.removeSystem?.();
    this.removeSystem = null;
    for (const off of this.offs.splice(0)) off();
    this.teardown();
    this.loading.dispose();
  }

  // ------------------------------------------------------------------------------------------- building

  private async load(): Promise<void> {
    const gen = ++this.generation;
    this.building = true;
    this.engine.setView(this.loadingScene, this.camera);
    this.progressLog.length = 0;
    this.loading.show(TITLE);
    try {
      const level = await loadLevel(LEVEL_ID);
      if (gen !== this.generation) return;
      const preset = services.tryGet('quality')?.preset ?? PRESETS.medium;
      // The last 3% covers shader compilation below.
      const world = await buildWorld(level, preset, (p) => this.setProgress(p * 0.97));
      if (gen !== this.generation) {
        world.dispose();
        return;
      }
      this.adopt(world);
      try {
        // Compile every program (in parallel where the driver allows) while the empty loading scene is still
        // the one being drawn, so the first frames of the world do not hitch.
        await precompile(this.engine.renderer, world.scene, this.camera);
      } catch (err) {
        console.warn('[test world] shader precompile failed; shaders compile on first draw', err);
      }
      if (gen !== this.generation) return;
      this.engine.setView(world.scene, this.camera);
      this.setProgress(1);
      console.info(
        `[test world] built in ${world.buildMs.toFixed(0)} ms (work ${world.buildWorkMs.toFixed(0)} ms), ` +
          `${world.colliders.length} colliders, ${world.npcs.size} NPCs`,
      );
      await this.loading.hide();
    } catch (err) {
      if (gen === this.generation)
        this.loading.showError(`The test world could not be built: ${describe(err)}`);
      throw err;
    } finally {
      if (gen === this.generation) this.building = false;
    }
  }

  private setProgress(p: number): void {
    this.progressLog.push(p);
    this.loading.setProgress(p);
  }

  private adopt(world: World): void {
    this.world = world;
    this.rig = new TestCamera(this.camera, this.engine.canvas, world.terrain, world.level.size);
    this.rig.setMode(this.mode);

    // Drive the level's own Christian when it was built from a real recipe (an unknown recipe id builds a
    // stand-in villager, which would make a poor stand-in for the player).
    const npc = world.npcs.get(WALKER_NPC);
    if (npc && Object.hasOwn(CharacterFactory.recipes(), npc.recipe.id)) {
      this.walker = npc; // the World animates it; we only move it
      this.ownWalker = false;
    } else {
      this.walker = buildWalker();
      this.ownWalker = this.walker !== null;
      if (this.walker) {
        world.scene.add(this.walker.root);
        world.blobs.follow(this.walker);
      }
    }
    this.anim = null;

    const way = world.ways.main;
    this.s = this.prevS = Math.min(WALK.endMargin, way.length / 2);
    this.dir = 1;
    way.tangent(way.length > 0 ? this.s / way.length : 0, this.tan);
    this.yaw = this.prevYaw = Math.atan2(this.tan.x, this.tan.z);
  }

  private teardown(): void {
    if (this.walker && this.ownWalker) {
      this.world?.blobs.unfollow(this.walker);
      this.walker.root.removeFromParent();
      this.walker.dispose();
    }
    this.walker = null;
    this.ownWalker = false;
    this.rig?.dispose();
    this.rig = null;
    this.world?.dispose();
    this.world = null;
    if (!this.disposed) this.engine.setView(this.loadingScene, this.camera);
  }

  // ------------------------------------------------------------------------------------------ per frame

  /** Fixed 60 Hz: camera keys and the walk along the Way. */
  private step(dt: number): void {
    const input = services.tryGet('input');
    if (input) {
      for (let i = 0; i < TEST_CAMERA_MODES.length; i++) {
        if (input.pressed(i === 0 ? 'choice1' : i === 1 ? 'choice2' : 'choice3')) {
          this.setCameraMode(TEST_CAMERA_MODES[i]!);
        }
      }
    }
    const world = this.world;
    this.prevS = this.s;
    this.prevYaw = this.yaw;
    if (!world || this.walkerPaused) {
      this.moving = false;
      return;
    }
    const way = world.ways.main;
    const len = way.length;
    if (len <= 2 * WALK.endMargin) return;
    way.tangent(this.s / len, this.tan);
    const want = Math.atan2(this.tan.x * this.dir, this.tan.z * this.dir);
    const d = wrapAngle(want - this.yaw);
    const maxTurn = WALK.turnRate * dt;
    this.yaw += Math.max(-maxTurn, Math.min(maxTurn, d));
    // Walk only while facing roughly the right way, so turning round at the ends happens on the spot.
    const along = Math.max(0, (Math.cos(d) - 0.6) / 0.4);
    this.s += this.dir * this.speed * along * dt;
    this.moving = along > 0.05;
    if (this.s >= len - WALK.endMargin) {
      this.s = len - WALK.endMargin;
      this.dir = -1;
    } else if (this.s <= WALK.endMargin) {
      this.s = WALK.endMargin;
      this.dir = 1;
    }
  }

  /** Per rendered frame: place the walker and camera (interpolated), then animate the world. */
  private frame(alpha: number, frameDt: number): void {
    const world = this.world;
    const rig = this.rig;
    if (!world || !rig) return;
    const loop = this.engine.loop;
    const dt = loop.paused ? 0 : frameDt * loop.timeScale;
    const way = world.ways.main;
    const s = this.prevS + (this.s - this.prevS) * alpha;
    const yaw = this.prevYaw + (this.yaw - this.prevYaw) * alpha;
    way.sample(way.length > 0 ? s / way.length : 0, this.focus);
    this.focus.y = world.terrain.heightAt(this.focus.x, this.focus.z);

    const walker = this.walker;
    const burdened = walker?.recipe.burden === true;
    if (walker) {
      walker.root.position.copy(this.focus);
      walker.root.rotation.y = yaw;
      const anim: WalkAnim = this.moving ? (burdened ? 'burdenedWalk' : 'walk') : 'idle';
      walker.animator.params.speed = this.moving ? this.speed : 0;
      if (anim !== this.anim) {
        walker.animator.play(anim, { fade: 0.3 });
        this.anim = anim;
      }
      if (this.ownWalker && dt > 0) walker.update(dt);
    }

    const reduceMotion = services.tryGet('settings')?.data.reduceMotion ?? false;
    rig.update(frameDt, this.focus, yaw, { burdened, reduceMotion });
    world.setShadowFocus(this.focus);
    world.update(dt, this.camera);
  }

  // ---------------------------------------------------------------------------------------------- debug

  private installDebug(): void {
    const debug = services.tryGet('debug');
    if (!debug) return;
    const g = DEBUG_GROUP;
    this.offs.push(
      debug.addReadout('World build', () => {
        const w = this.world;
        return w ? `${w.buildMs.toFixed(0)} ms (work ${w.buildWorkMs.toFixed(0)} ms)` : 'building...';
      }),
      debug.addReadout('Colliders', () => String(this.world?.colliders.length ?? 0)),
      debug.addReadout('NPCs', () => String(this.world?.npcs.size ?? 0)),
      debug.addReadout('Camera', () => `${this.mode} (keys 1-3)`),
      debug.addToggle(
        g,
        'Free orbit',
        () => this.mode === 'orbit',
        (v) => this.setCameraMode(v ? 'orbit' : 'follow'),
      ),
      debug.addButton(g, 'Follow cam (1)', () => this.setCameraMode('follow')),
      debug.addButton(g, 'Orbit cam (2)', () => this.setCameraMode('orbit')),
      debug.addButton(g, 'Overview (3)', () => this.setCameraMode('overview')),
      debug.addToggle(
        g,
        'Pause walker',
        () => this.walkerPaused,
        (v) => (this.walkerPaused = v),
      ),
      debug.addSlider(
        g,
        'Walk speed',
        0.5,
        6,
        0.1,
        () => this.speed,
        (v) => (this.speed = v),
      ),
      debug.addButton(g, 'Rebuild world', () => void this.rebuild()),
    );
  }
}

/** A Christian of our own when the level has none (deterministic seed). */
function buildWalker(): Character | null {
  const rng = new Rng(hashString('test-world:walker'));
  for (const recipe of WALKER_RECIPES) {
    try {
      return CharacterFactory.build(recipe, rng);
    } catch {
      // try the next id
    }
  }
  console.warn('[test world] no Christian recipe; the camera follows an empty point');
  return null;
}

function wrapAngle(a: number): number {
  let d = a % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
