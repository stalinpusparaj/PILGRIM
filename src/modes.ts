/**
 * Runtime mode runners (ARCHITECTURE "Runtime modes"). Each runner owns the scene, camera, loop systems and DOM
 * of one mode and frees them in `dispose()`; `main.ts` starts one and can restart it (F1 "Rebuild scene", the
 * Playwright leak checks).
 *
 * - `dev`: the Phase 0 test scene (DevScene), the default until the title screen exists (Phase 3).
 * - `lab`: the Character Lab (`?lab=1`, dev builds or `?debug=1` only, like every URL param).
 * - `testWorld`: `?chapter=test`, the procedural-toolkit test world.
 *
 * The Lab and the test world are loaded as their own chunks (dynamic import), so the default mode does not ship
 * the Lab code.
 */
import * as THREE from 'three';
import type { Engine } from './core/Engine';
import { services } from './core/Services';
import { settings } from './core/Settings';
import { DevScene } from './world/dev/DevScene';
import type { LabProbe } from './gen/lab-probe';
import type { TestWorld } from './world/TestWorld';

export type ModeKind = 'dev' | 'lab' | 'testWorld';

export interface ModeRunner {
  readonly kind: ModeKind;
  /** Resolves when the mode is on screen (the Lab's first character, the test world built); rejects on failure. */
  readonly started: Promise<void>;
  /** True once `started` has resolved (and the runner is not disposed). */
  readonly ready: boolean;
  /** `?lab=1` only: the Lab probe (tests, console). */
  readonly lab: LabProbe | null;
  /** `?chapter=test` only. */
  readonly testWorld: TestWorld | null;
  setFov(fov: number): void;
  dispose(): void;
}

const BLANK_FOV = 55;

/** Starts a mode. The returned runner can be disposed at any time, even before `started` settles. */
export function startMode(kind: ModeKind, engine: Engine): ModeRunner {
  switch (kind) {
    case 'lab':
      return labRunner(engine);
    case 'testWorld':
      return testWorldRunner(engine);
    default:
      return devRunner(engine);
  }
}

/** After a mode is gone the engine draws an empty scene, never one whose geometry was just freed. */
function blankView(engine: Engine): void {
  engine.setView(new THREE.Scene(), new THREE.PerspectiveCamera(BLANK_FOV, 1, 0.1, 100));
}

class RunnerState {
  ready = false;
  disposed = false;
}

function devRunner(engine: Engine): ModeRunner {
  const scene = new DevScene({ fov: settings.data.fov });
  const remove = engine.loop.add(scene, 0);
  engine.setView(scene.scene, scene.camera);
  // The test scene is "gameplay": Click/Tap to play, pointer lock and the touch controls can be tried.
  services.tryGet('input')?.setGameplayActive(true);
  const st = new RunnerState();
  st.ready = true;
  return {
    kind: 'dev',
    started: Promise.resolve(),
    get ready() {
      return st.ready && !st.disposed;
    },
    lab: null,
    testWorld: null,
    setFov: (fov) => scene.setFov(fov),
    dispose: () => {
      if (st.disposed) return;
      st.disposed = true;
      remove();
      scene.dispose();
      blankView(engine);
    },
  };
}

function labRunner(engine: Engine): ModeRunner {
  const st = new RunnerState();
  let dispose: (() => void) | null = null;
  let probe: LabProbe | null = null;
  const started = Promise.all([import('./gen/Lab'), import('./gen/lab-probe')]).then(
    async ([{ Lab }, { createLabProbe }]) => {
      if (st.disposed) return;
      const lab = new Lab(engine);
      dispose = () => lab.dispose();
      probe = createLabProbe(engine, () => lab.inspect());
      await lab.start();
      st.ready = !st.disposed;
    },
  );
  return {
    kind: 'lab',
    started,
    get ready() {
      return st.ready && !st.disposed;
    },
    get lab() {
      return st.disposed ? null : probe;
    },
    testWorld: null,
    setFov: () => {}, // the Lab camera keeps its own lens
    dispose: () => {
      if (st.disposed) return;
      st.disposed = true;
      dispose?.();
      blankView(engine);
    },
  };
}

function testWorldRunner(engine: Engine): ModeRunner {
  const st = new RunnerState();
  let world: TestWorld | null = null;
  const started = import('./world/TestWorld').then(async ({ TestWorld }) => {
    if (st.disposed) return;
    world = new TestWorld(engine);
    await world.start();
    st.ready = !st.disposed;
  });
  return {
    kind: 'testWorld',
    started,
    get ready() {
      return st.ready && !st.disposed && (world?.ready ?? false);
    },
    lab: null,
    get testWorld() {
      return st.disposed ? null : world;
    },
    setFov: () => {}, // TestWorld follows settings:changed itself
    dispose: () => {
      if (st.disposed) return;
      st.disposed = true;
      world?.dispose();
      blankView(engine);
    },
  };
}
