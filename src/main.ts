/**
 * Entry point: boots the core services in dependency order, picks the runtime mode from the URL
 * (ARCHITECTURE.md "Runtime modes") and starts the loop.
 *
 * Order: flags → settings → i18n → save (all register themselves on import) → engine → audio (the 'audio'
 * service; unlocked by the first gesture) → quality (resolved before the loop starts, so the benchmark has the
 * GPU to itself) → input → scene → debug panel → start.
 * `?music=<id>` opens the music test page instead (no Engine, no WebGL; the page builds its own AudioEngine).
 * Every other mode shows the Phase 0 test scene; later phases plug in the title screen, chapters and Lab.
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
import { DevScene } from './world/dev/DevScene';

// ------------------------------------------------------------------------------------------- runtime mode

export type RuntimeMode =
  | { kind: 'title' }
  | { kind: 'lab' }
  | { kind: 'music'; id: string }
  | { kind: 'chapter'; id: string; waystone: string | null };

/** `?chapter=` accepts test, 1..13 and epilogue (GDD 2.15). */
const CHAPTER_ID = /^(test|epilogue|[1-9]|1[0-3])$/;
/** The demo build ends after Chapter IV (GDD 2.1). */
const DEMO_LAST_CHAPTER = 4;
/** Loop order of the audio listener sync: right after the Engine's render system (1000), so it reads the
 * camera matrix of the frame just drawn. */
const AUDIO_LISTENER_ORDER = 1001;

export function selectMode(params: UrlParams): RuntimeMode {
  if (params.lab) return { kind: 'lab' };
  if (params.music) return { kind: 'music', id: params.music };
  const chapter = params.chapter;
  if (chapter && CHAPTER_ID.test(chapter)) {
    const number = Number(chapter);
    const beyondDemo = chapter === 'epilogue' || number > DEMO_LAST_CHAPTER;
    if (!(buildFlags.DEMO && beyondDemo)) return { kind: 'chapter', id: chapter, waystone: params.waystone };
  }
  return { kind: 'title' };
}

function describeMode(mode: RuntimeMode): string {
  switch (mode.kind) {
    case 'chapter':
      return `chapter ${mode.id}${mode.waystone ? ` @ ${mode.waystone}` : ''}`;
    case 'music':
      return `music ${mode.id}`;
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
}

declare global {
  interface Window {
    readonly __pilgrim: PilgrimHandle;
  }
}

const state: { ready: boolean; engine: Engine | null; mode: RuntimeMode | null } = {
  ready: false,
  engine: null,
  mode: null,
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

  // Phase 0: every mode shows the test scene.
  let scene = new DevScene({ fov: settings.data.fov });
  let removeScene = loop.add(scene, 0);
  engine.setView(scene.scene, scene.camera);
  const rebuildScene = (): void => {
    removeScene();
    scene.dispose();
    scene = new DevScene({ fov: settings.data.fov });
    removeScene = loop.add(scene, 0);
    engine.setView(scene.scene, scene.camera);
  };
  // The test scene is "gameplay": Click/Tap to play, pointer lock and the touch controls can be tried.
  input.setGameplayActive(true);

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
        scene.setFov(data.fov);
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
