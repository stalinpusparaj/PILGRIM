/**
 * Runtime mode runners (ARCHITECTURE "Runtime modes"). Each runner owns the scene, camera, loop systems and DOM
 * of one mode and frees them in `dispose()`; `main.ts` starts one and can restart it (F1 "Rebuild scene", the
 * Playwright leak checks).
 *
 * - `flow`: the game itself (src/game/GameFlow.ts): the title screen by default, or straight into a chapter
 *   (`?chapter=test` → the test chapter, src/chapters/test.ts; `?chapter=N` → chapter N), all through the
 *   ChapterManager (src/world/ChapterManager.ts). Pause and the Satchel work through the flow.
 * - `lab`: the Character Lab (`?lab=1`, dev builds or `?debug=1` only, like every URL param).
 * - `dialogueTest`: `?dialogue=test`, the Phase 3 dialogue demo (src/narrative/DialogueTestScene.ts).
 *
 * Every runner's code is a dynamic import (its own chunk), so the default mode does not ship the Lab or the demo.
 */
import * as THREE from 'three';
import type { Engine } from './core/Engine';
import type { GameFlow } from './game/GameFlow';
import type { LabProbe } from './gen/lab-probe';
import type { DialogueTestScene } from './narrative/DialogueTestScene';
import { dialogueTestRunner } from './narrative/dtest-mode';
import type { TestWorld } from './world/TestWorld';
import type { PlaySession } from './world/PlaySession';
import type { ChapterManager } from './world/ChapterManager';

export type ModeKind = 'flow' | 'lab' | 'dialogueTest';

/** Where the flow starts: null = the title screen; else a chapter (1..13, 14 = Epilogue) at a waystone. */
export interface FlowStart {
  chapter: number;
  waystone: string | null;
  /** `?chapter=test`: the test chapter (src/chapters/test.ts on content/levels/test.json). */
  test: boolean;
}

export interface ModeRunner {
  readonly kind: ModeKind;
  /** Resolves when the mode is on screen (the Lab's first character, the title, a chapter); rejects on failure. */
  readonly started: Promise<void>;
  /** True once the mode is on screen (and the runner is not disposed). */
  readonly ready: boolean;
  /** `?lab=1` only: the Lab probe (tests, console). */
  readonly lab: LabProbe | null;
  /**
   * `?chapter=test` only: the running chapter's dev surface (the ChapterManager's ChapterDevProbe), which keeps
   * the test world's public shape (ready, current, play, progressLog, setCameraMode, rebuild).
   */
  readonly testWorld: TestWorld | null;
  /** The running play session (Christian, camera, systems), null while loading or in a non-play mode. */
  readonly play: PlaySession | null;
  /** `?dialogue=test` only: the dialogue demo scene. */
  readonly dialogueTest?: DialogueTestScene | null;
  setFov(fov: number): void;
  dispose(): void;
}

const BLANK_FOV = 55;

/** Starts a mode. The returned runner can be disposed at any time, even before `started` settles. */
export function startMode(kind: ModeKind, engine: Engine, start: FlowStart | null = null): ModeRunner {
  switch (kind) {
    case 'lab':
      return labRunner(engine);
    case 'dialogueTest':
      return dialogueTestRunner(engine, blankView);
    default:
      return flowRunner(engine, start);
  }
}

/** After a mode is gone the engine draws an empty scene, never one whose geometry was just freed. */
export function blankView(engine: Engine): void {
  engine.setView(new THREE.Scene(), new THREE.PerspectiveCamera(BLANK_FOV, 1, 0.1, 100));
}

class RunnerState {
  ready = false;
  disposed = false;
}

/** The game flow: the title screen, or a chapter started directly (debug URL). */
function flowRunner(engine: Engine, start: FlowStart | null): ModeRunner {
  const st = new RunnerState();
  let flow: GameFlow | null = null;
  let chapters: ChapterManager | null = null;
  const started = Promise.all([import('./game/GameFlow'), import('./game/flow-launcher')]).then(
    async ([{ GameFlow }, { chapterLauncher }]) => {
      if (st.disposed) return;
      flow = new GameFlow(engine);
      const onManager = (m: ChapterManager): void => {
        chapters = m;
      };
      flow.setChapterLauncher(
        chapterLauncher(engine, { script: start?.test ? 'test' : undefined, onManager }),
      );
      if (!start) flow.start();
      else await flow.startChapter(start.chapter, start.waystone);
      st.ready = !st.disposed;
    },
  );
  const chapterReady = (): boolean => !!chapters?.session && !chapters.building;
  return {
    kind: 'flow',
    started,
    get ready() {
      if (!st.ready || st.disposed || !flow) return false;
      if (!start) return flow.state !== 'title' || flow.ready; // the title: once its landscape is on screen
      return flow.ready && chapterReady();
    },
    lab: null,
    get testWorld() {
      if (st.disposed || !start?.test) return null;
      // main.ts types this as TestWorld: the dev probe has the same public surface the tests use.
      return (chapters?.dev ?? null) as unknown as TestWorld | null;
    },
    get play() {
      return st.disposed ? null : (chapters?.session ?? null);
    },
    setFov: () => {}, // the title scene and the chapters follow settings:changed themselves
    dispose: () => {
      if (st.disposed) return;
      st.disposed = true;
      flow?.dispose();
      flow = null;
      chapters = null;
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
    play: null,
    setFov: () => {}, // the Lab camera keeps its own lens
    dispose: () => {
      if (st.disposed) return;
      st.disposed = true;
      dispose?.();
      blankView(engine);
    },
  };
}
