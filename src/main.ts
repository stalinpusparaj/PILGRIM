/**
 * Entry point: boots the core services in dependency order, picks the runtime mode from the URL
 * (ARCHITECTURE.md "Runtime modes") and starts the loop.
 *
 * Order: flags → settings → i18n → save (all register themselves on import) → engine → audio (the 'audio'
 * service; unlocked by the first gesture) → quality (resolved before the loop starts, so the benchmark has the
 * GPU to itself) → input → debug panel → mode → start.
 * Modes (src/modes.ts): no params → the game (GameFlow: title screen → opening → chapters), `?chapter=…` → the
 * game started in that chapter (`test` = the test world), `?lab=1` → Character Lab, `?dialogue=test` → the
 * dialogue demo, `?music=<id>` → the music test page (no Engine, no WebGL; the page builds its own AudioEngine).
 * The debug panel is created before the mode so a mode can add its own F1 controls while it starts.
 */
import './ui/styles.css';
import { events } from './core/Events';
import { services } from './core/Services';
import { buildFlags, urlParams, type UrlParams } from './core/Flags';
import { settings, type SettingsData } from './core/Settings';
import { t } from './core/I18n';
import './core/Save'; // registers the 'save' service
import { Engine } from './core/Engine';
import { Quality, type QualityPreset } from './core/Quality';
import { Input } from './core/Input';
import { createDebug, installCoreDebug, type Debug } from './core/Debug';
import { AudioEngine } from './audio/AudioEngine';
import { h, uiRoot } from './ui/dom';
import { installJuice } from './ui/Juice';
import { startMode, type FlowStart, type ModeKind, type ModeRunner } from './modes';
import type { LabProbe } from './gen/lab-probe';
import type { DialogueTestScene } from './narrative/DialogueTestScene';
import type { TestWorld } from './world/TestWorld';
import type { PlaySession } from './world/PlaySession';

// ------------------------------------------------------------------------------------------- runtime mode

export type RuntimeMode =
  | { kind: 'title' }
  | { kind: 'lab' }
  | { kind: 'music'; id: string }
  | { kind: 'dialogueTest' }
  | { kind: 'chapter'; id: string; waystone: string | null };

/** `?chapter=` accepts test, 1..13 and epilogue (GDD 2.15). */
const CHAPTER_ID = /^(test|epilogue|[1-9]|1[0-3])$/;
/** The demo build ends after Chapter IV (GDD 2.1). */
const DEMO_LAST_CHAPTER = 4;
/** `?chapter=epilogue` is chapter 14 in the flow and the save format; `?chapter=test` runs as chapter 1. */
const EPILOGUE_CHAPTER = 14;
/** Loop order of the audio listener sync: right after the Engine's render system (1000), so it reads the
 * camera matrix of the frame just drawn. */
const AUDIO_LISTENER_ORDER = 1001;

export function selectMode(params: UrlParams): RuntimeMode {
  if (params.lab) return { kind: 'lab' };
  if (params.music) return { kind: 'music', id: params.music };
  if (params.dialogue === 'test') return { kind: 'dialogueTest' };
  const chapter = params.chapter;
  if (chapter && CHAPTER_ID.test(chapter)) {
    const number = Number(chapter);
    const beyondDemo = chapter === 'epilogue' || number > DEMO_LAST_CHAPTER;
    if (!(buildFlags.DEMO && beyondDemo)) return { kind: 'chapter', id: chapter, waystone: params.waystone };
  }
  return { kind: 'title' };
}

/** Which runner shows a mode: the Lab, the dialogue demo, or the game flow (title or a chapter). */
export function modeKind(mode: RuntimeMode): ModeKind {
  if (mode.kind === 'lab') return 'lab';
  if (mode.kind === 'dialogueTest') return 'dialogueTest';
  return 'flow';
}

/** Where the game flow starts: null = the title screen. */
export function flowStart(mode: RuntimeMode): FlowStart | null {
  if (mode.kind !== 'chapter') return null;
  const test = mode.id === 'test';
  const chapter = test ? 1 : mode.id === 'epilogue' ? EPILOGUE_CHAPTER : Number(mode.id);
  return { chapter, waystone: mode.waystone, test };
}

function describeMode(mode: RuntimeMode): string {
  switch (mode.kind) {
    case 'chapter':
      return `chapter ${mode.id}${mode.waystone ? ` @ ${mode.waystone}` : ''}`;
    case 'music':
      return `music ${mode.id}`;
    case 'dialogueTest':
      return 'dialogue test';
    default:
      return mode.kind;
  }
}

// ----------------------------------------------------------------------------------------- test handle

/** What tests (and the console) can reach: `window.__pilgrim`. Always present, read-only. */
export interface PilgrimHandle {
  readonly ready: boolean;
  readonly engine: Engine | null;
  readonly services: typeof services;
  readonly events: typeof events;
  readonly mode: RuntimeMode | null;
  /** True once the current mode is on screen (Lab: first character; test world: built and shown). */
  readonly modeReady: boolean;
  /** `?lab=1`: drives and measures the Character Lab (src/gen/lab-probe.ts). */
  readonly lab: LabProbe | null;
  /** `?chapter=test`: the test world (build time, progress log, rebuild). */
  readonly testWorld: TestWorld | null;
  /** The running play session (Christian, camera, gameplay systems): `?chapter=test` today. */
  readonly play: PlaySession | null;
  /** `?dialogue=test`: the dialogue demo scene (play the sample, its camera). */
  readonly dialogueTest: DialogueTestScene | null;
  /** Disposes the current mode and starts it again (leak checks). Resolves when it is back on screen. */
  restartMode(): Promise<void>;
}

declare global {
  interface Window {
    readonly __pilgrim: PilgrimHandle;
  }
}

const state: {
  ready: boolean;
  engine: Engine | null;
  mode: RuntimeMode | null;
  runner: ModeRunner | null;
  restart: (() => Promise<void>) | null;
} = {
  ready: false,
  engine: null,
  mode: null,
  runner: null,
  restart: null,
};

Object.defineProperty(window, '__pilgrim', {
  value: Object.freeze({
    get ready() {
      return state.ready;
    },
    get engine() {
      return state.engine;
    },
    get mode() {
      return state.mode;
    },
    get modeReady() {
      return state.runner?.ready ?? false;
    },
    get lab() {
      return state.runner?.lab ?? null;
    },
    get testWorld() {
      return state.runner?.testWorld ?? null;
    },
    get play() {
      return state.runner?.play ?? null;
    },
    get dialogueTest() {
      return state.runner?.dialogueTest ?? null;
    },
    restartMode: () => (state.restart ? state.restart() : Promise.reject(new Error('[main] not booted'))),
    services,
    events,
  } satisfies PilgrimHandle),
  enumerable: false,
});

// --------------------------------------------------------------------------------------------- helpers

/** Settings that live on <body> as CSS classes (styles.css): text size and reduced motion. */
function applyBodyClasses(data: Readonly<SettingsData>): void {
  const body = document.body;
  for (const size of ['M', 'L', 'XL'] as const) body.classList.toggle(`text-${size}`, data.textSize === size);
  body.classList.toggle('reduce-motion', data.reduceMotion);
}

/** The quality preset with the player's Shadows setting applied: "Off" wins; "On" means "if the preset allows". */
function effectivePreset(quality: Quality): QualityPreset {
  const preset = quality.preset;
  return settings.data.shadows || !preset.shadows ? preset : { ...preset, shadows: false };
}

function gameCanvas(): HTMLCanvasElement {
  const found = document.getElementById('game');
  if (found instanceof HTMLCanvasElement) return found;
  const canvas = h('canvas', { id: 'game' });
  document.body.prepend(canvas);
  return canvas;
}

/** A plain message panel for errors the game cannot recover from (no WebGL). */
function showFatal(key: string): void {
  uiRoot().append(
    h(
      'div',
      {
        className: 'safe-pad',
        role: 'alert',
        style: { position: 'absolute', inset: '0', display: 'grid', placeItems: 'center' },
      },
      h('p', { className: 'panel' }, t(key)),
    ),
  );
}

// ------------------------------------------------------------------------------------------------ boot

async function boot(): Promise<void> {
  applyBodyClasses(settings.data);
  document.title = t('ui.title.gameName');
  state.mode = selectMode(urlParams);
  if (state.mode.kind === 'music') {
    // Music test page (Phase 3): plain DOM over the empty canvas, no 3D scene and no WebGL needed.
    const songId = state.mode.id;
    const { MusicTestPage } = await import('./audio/MusicTestPage');
    new MusicTestPage(songId).start();
    state.ready = true;
    return;
  }

  const canvas = gameCanvas();
  let engine: Engine;
  try {
    engine = new Engine(canvas);
  } catch (err) {
    console.warn('[main] WebGL is not available', err);
    showFatal('ui.context.unsupported');
    return;
  }
  state.engine = engine;
  const loop = engine.loop;

  // Audio (GDD 2.13): registers the 'audio' service; the AudioContext starts on the first tap / click / key.
  const audio = new AudioEngine();
  loop.add({ render: () => audio.setListener(engine.camera) }, AUDIO_LISTENER_ORDER);

  // Quality: one listener applies every preset change (settings, auto pick, debug buttons) to the Engine.
  const quality = new Quality();
  events.on('quality:changed', () => engine.applyQuality(effectivePreset(quality)));
  await quality.resolve(settings.data.quality, engine.renderer);
  loop.frameCap = settings.data.frameCap;
  engine.setResolutionScale(settings.data.resolutionScale);

  const input = new Input(canvas, uiRoot());
  loop.onBeforeStep = () => input.beginStep();
  loop.onAfterStep = () => input.endStep();

  // The mode runner (src/modes.ts) owns its scene; restarting disposes it first (F1 "Rebuild scene").
  const kind = modeKind(state.mode);
  const start = flowStart(state.mode);
  const launch = (): ModeRunner => {
    const runner = startMode(kind, engine, start);
    state.runner = runner;
    runner.started.catch((err: unknown) => console.error(`[main] the ${kind} mode could not start`, err));
    return runner;
  };
  state.restart = async (): Promise<void> => {
    state.runner?.dispose();
    await launch().started;
  };
  const rebuildScene = (): void => {
    state.restart?.().catch(() => {}); // already logged by launch()
  };

  events.on('settings:changed', ({ key }) => {
    const data = settings.data;
    switch (key as keyof SettingsData) {
      case 'quality':
        quality.resolve(data.quality, engine.renderer).catch((err: unknown) => {
          console.warn('[main] could not apply the quality setting', err);
        });
        break;
      case 'shadows':
        engine.applyQuality(effectivePreset(quality));
        break;
      case 'resolutionScale':
        engine.setResolutionScale(data.resolutionScale);
        break;
      case 'frameCap':
        loop.frameCap = data.frameCap;
        break;
      case 'fov':
        state.runner?.setFov(data.fov);
        break;
      case 'textSize':
      case 'reduceMotion':
        applyBodyClasses(data);
        break;
      default:
        break; // lang → I18n, bindings → Input; the rest arrive with later phases
    }
  });

  const debug = createDebug();
  if (debug) {
    installCoreDebug(engine, quality, input, debug);
    installPhase0Debug(debug, engine, quality, rebuildScene);
  }

  installJuice(); // sparkles, vignettes, button squash: event-driven, app-lifetime

  // Started before the loop so its first frame already shows the mode (the test world's loading scene).
  launch();

  events.once('engine:ready', () => {
    state.ready = true;
  });
  engine.start();
}

/** Phase 0 extras on the F1 panel: the runtime mode, a scene rebuild (dispose check) and context loss. */
function installPhase0Debug(debug: Debug, engine: Engine, quality: Quality, rebuildScene: () => void): void {
  debug.addReadout('Mode', () => (state.mode ? describeMode(state.mode) : '-'));
  debug.addReadout('Benchmark', () => {
    const ms = quality.benchmarkMs;
    return ms === null ? `- (${quality.setting})` : `${ms.toFixed(2)} ms`;
  });
  debug.addReadout('Pixel ratio', () => engine.pixelRatio.toFixed(2));
  debug.addButton('Engine', 'Rebuild scene', rebuildScene);
  debug.addButton('Engine', 'Lose context 3 s', () => {
    engine.renderer.forceContextLoss();
    window.setTimeout(() => engine.renderer.forceContextRestore(), 3000);
  });
  debug.addButton('Quality', 'Re-run benchmark', () => {
    quality.forgetBenchmark();
    quality.resolve('auto', engine.renderer).catch((err: unknown) => console.warn('[main] benchmark', err));
  });
}

boot().catch((err: unknown) => {
  console.error('[main] the game could not start', err);
  showFatal('ui.context.unsupported');
});
