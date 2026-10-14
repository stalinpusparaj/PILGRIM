/**
 * Builds a level for play behind the loading screen (GDD 2.14 "Loading"): loads the level file, shows the
 * chapter title and the bar, builds the World time-sliced (buildWorld), precompiles its shaders while the empty
 * loading scene is still the one being drawn, then shows the world. Gameplay-only landmarks without a prop
 * builder ('pit', 'steps') are kept out of the prop build and put back afterwards (play-pits.ts).
 *
 * Cancellable with an AbortSignal: a build that finishes after the abort is freed at once and the promise
 * rejects with an AbortError (`isAbort(err)`).
 */
import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import { services } from '../core/Services';
import { t } from '../core/I18n';
import { PRESETS } from '../core/Quality';
import { precompile } from '../core/compile';
import { Loading, chapterLoadingInfo, type LoadingInfo } from '../ui/Loading';
import { buildWorld, loadLevel } from './LevelLoader';
import { buildableLevel, restoreLandmarks } from './play-pits';
import type { World } from './World';

/** The last 3% of the bar covers shader compilation. */
const BUILD_SHARE = 0.97;
/** Behind the loading panel: an empty dusk scene, so the GPU idles and the build gets the main thread. */
const LOADING_BACKGROUND = 0x2b2235;

export interface PlayBuildOptions {
  engine: Engine;
  /** The camera the world will be drawn with (shaders are compiled for it). */
  camera: THREE.PerspectiveCamera;
  loading: Loading;
  /** Loading-screen title; defaults to the chapter's own (chapterLoadingInfo). */
  info?: LoadingInfo;
  onProgress?: (p: number) => void;
  signal?: AbortSignal;
}

export function abortError(): Error {
  const err = new Error('The play session was disposed while it was loading');
  err.name = 'AbortError';
  return err;
}

export function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

/** An empty scene to show while building (the caller disposes nothing: it holds no GPU resources). */
export function loadingScene(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.name = 'play:loading';
  scene.background = new THREE.Color(LOADING_BACKGROUND);
  return scene;
}

/**
 * Loads and builds `levelId`, reporting progress 0..1 to the loading bar and `onProgress`. The world is not yet
 * shown: the caller sets the view once its own systems exist. Rejects with the build error (the loading panel
 * says the world could not be built) or an AbortError.
 */
export async function buildPlayWorld(levelId: string, o: PlayBuildOptions): Promise<World> {
  const report = (p: number): void => {
    o.loading.setProgress(p);
    o.onProgress?.(p);
  };
  o.loading.show(o.info ?? chapterLoadingInfo(levelId));
  try {
    const level = await loadLevel(levelId);
    if (o.signal?.aborted) throw abortError();
    const preset = services.tryGet('quality')?.preset ?? PRESETS.medium;
    const world = await buildWorld(buildableLevel(level), preset, (p) => report(p * BUILD_SHARE));
    if (o.signal?.aborted) {
      world.dispose();
      throw abortError();
    }
    restoreLandmarks(world, level);
    return world;
  } catch (err) {
    if (!isAbort(err)) o.loading.showError(t('ui.loading.failed'));
    throw err;
  }
}

/** Compiles every program of the world (in parallel where the driver allows). Failure only costs a hitch. */
export async function precompileWorld(
  engine: Engine,
  scene: THREE.Scene,
  camera: THREE.Camera,
): Promise<void> {
  try {
    await precompile(engine.renderer, scene, camera);
  } catch (err) {
    console.warn('[play] shader precompile failed; shaders compile on first draw', err);
  }
}
