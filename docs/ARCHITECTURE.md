# Architecture contracts

This file pins the module boundaries and public APIs so several people (or agents) can build modules in
parallel and have them fit. `docs/GDD.md` is the source of truth for *what* to build; this file says *where*
it lives and *how modules talk*. If you need to change a contract here, change it here first and say so in
`docs/DECISIONS.md`.

## Conventions

- TypeScript strict. No `any` (use `unknown` + narrowing). `import * as THREE from 'three'`.
- Files under 400 lines. One responsibility per file.
- Systems talk through `events` (`src/core/Events.ts`) and find each other through `services`
  (`src/core/Services.ts`). Add events and services with **declaration merging** in your own module, never by
  editing someone else's file.
- Everything you create, you dispose: geometries, materials, render targets, DOM nodes, event subscriptions
  (`events.on` returns an unsubscribe function), `window` listeners, timers, audio nodes.
- All visible text goes through `t('key')` from `src/core/I18n.ts`. Keys are flat dotted strings in
  `content/i18n/en.json` and `ta.json` (e.g. `"ui.title.start"`).
- No hard-coded level coordinates in TypeScript; worlds come from `content/levels/*.json`.
- No asset files. Geometry, colour, sound and icons are made in code (`src/gen`, `src/audio`, inline SVG in
  `src/ui/Svg.ts`). System fonts only.
- Runtime dependency: `three` only. Modules from `three/examples/jsm` are allowed only if they are code
  (BufferGeometryUtils, TransformControls...). Never load anything from `three/examples` that is an asset.
- `import.meta.env.DEV` gates dev-only code (debug panel, Lab, place mode) unless `?debug=1`.

## Runtime modes (`src/main.ts`)

| URL | Mode |
|---|---|
| (none) | Title screen → opening narration → Chapter I (GameFlow, Phase 3) |
| `?lab=1` | Character Lab (Phase 1) |
| `?music=<id>` | Music test page (Phase 3) |
| `?dialogue=test` | Dialogue demo: the sample conversation with choices, camera cuts, babble and Hope (Phase 3) |
| `?chapter=test` / `?chapter=1..13` / `?chapter=epilogue` | Load a chapter directly (debug), through GameFlow |
| `&waystone=ch08_w1&debug=1&god=1&skipIntro=1` | Debug params (GDD 2.15) |

Phase 1 wires two modes: `?lab=1` → Character Lab (`src/gen/Lab.ts`) and `?chapter=test` → the test world
(`src/world/TestWorld.ts`, built from `content/levels/test.json`). Since Phase 2 the test world is played: TestWorld
wraps a `PlaySession` (Gameplay below) and keeps the Phase 1 fly cameras on keys 1-3 (1 = the gameplay camera,
2 = orbit, 3 = overview; the orbit and overview suspend the FollowCamera through CameraRig). `?music=<id>` opens the music test page
(`src/audio/MusicTestPage.ts`, plain DOM, loaded with a dynamic import before the Engine is created, so it needs
no WebGL). Every other mode still shows the Phase 0 test scene (`src/world/dev/DevScene.ts`) until the title
screen (Phase 3) and the chapters exist.
The default mode is the game itself: `GameFlow` (src/game/GameFlow.ts) shows the title screen. `?chapter=…` starts
the same flow straight in that chapter through the ChapterManager (`src/world/ChapterManager.ts`, "Chapters
(Phase 3)" below): `test` plays the test chapter (`src/chapters/test.ts` on `content/levels/test.json`) as chapter
1; `1..13` / `epilogue` (14) play their scripts, and a chapter with no script yet plays the test chapter in its
place. Pause (Esc / Menu) and the Satchel (Tab / View) work through the
flow in every chapter. `?lab=1` → Character Lab (`src/gen/Lab.ts`), `?dialogue=test` → the dialogue demo
(`src/narrative/DialogueTestScene.ts`), `?music=<id>` → the music test page (`src/audio/MusicTestPage.ts`, plain DOM,
loaded with a dynamic import before the Engine is created, so it needs no WebGL). The Phase 0 dev scene
(`src/world/dev/`) is no longer started by any mode.
```ts
export type RuntimeMode =
  | { kind: 'title' } | { kind: 'lab' } | { kind: 'music'; id: string } | { kind: 'dialogueTest' }
  | { kind: 'chapter'; id: string; waystone: string | null };
export function selectMode(params: UrlParams): RuntimeMode;  // lab > music > dialogue > chapter > title
export function modeKind(mode: RuntimeMode): ModeKind;       // 'lab' | 'dialogueTest' | 'flow'
export function flowStart(mode: RuntimeMode): FlowStart | null;  // null = title; test → chapter 1, epilogue → 14
```
Mode runners (`src/modes.ts`) own a mode's scene, camera, loop systems and DOM:
```ts
export type ModeKind = 'flow' | 'lab' | 'dialogueTest';
export interface FlowStart { chapter: number; waystone: string | null; test: boolean }
export interface ModeRunner {
  readonly kind: ModeKind;
  readonly started: Promise<void>;   // the mode is on screen (Lab: first character; title; chapter started)
  readonly ready: boolean;           // title: its landscape is drawn; chapter: playing (test world built)
  readonly lab: LabProbe | null;     // ?lab=1 only
  readonly testWorld: TestWorld | null;
  readonly play: PlaySession | null;   // the running play session (?chapter=test), null while loading
  readonly testWorld: TestWorld | null;              // ?chapter=test only, while it is the running chapter
  readonly dialogueTest?: DialogueTestScene | null;  // ?dialogue=test only
  setFov(fov: number): void;
  dispose(): void;                   // frees everything (the flow and its chapter); the engine draws an empty scene
}
export function startMode(kind: ModeKind, engine: Engine, start?: FlowStart | null): ModeRunner;
```
- Every runner is a dynamic import (its own chunk): GameFlow, the Lab, the test world and the dialogue demo.
- `main.ts` keeps one runner; F1 "Rebuild scene" and `window.__pilgrim.restartMode()` dispose it and start a
  new one (leak checks). The debug panel is created before the mode starts, so a mode can add F1 controls.
- `?chapter=` accepts `test`, `1`..`13`, `epilogue`; anything else falls back to the title. Demo builds
  (`VITE_DEMO=true`) also fall back to the title for chapters beyond IV and the epilogue.
- All URL params are ignored outside dev builds unless `?debug=1` (see Flags.ts).
- Boot order in `main.ts`: flags → settings → i18n → save (each registers itself on import) → `Engine` →
  `AudioEngine` (registers the 'audio' service; a loop System at order 1001, right after the Engine's render
  system, calls `audio.setListener(engine.camera)` every rendered frame) → `Quality` (resolved before
  `engine.start()`, so the benchmark has the GPU to itself) → `Input` (hooked into `loop.onBeforeStep` /
  `onAfterStep`) → debug panel → mode runner → `engine.start()`.
- `main.ts` owns the live wiring: one `quality:changed` listener applies `quality.preset` with the Shadows
  setting merged in (Shadows Off always wins; On means "if the preset allows") to `engine.applyQuality`;
  `settings:changed` applies quality, shadows, resolutionScale, frameCap, fov and the `text-M/L/XL` /
  `reduce-motion` body classes. Language and bindings are followed by I18n and Input themselves.

## Core (Phase 0) — `src/core/`

### Events.ts (written)
`events.on(name, fn) → unsubscribe`, `events.once`, `events.emit(name, payload?)`, `events.count()`.

### Services.ts (written)
`services.register(key, value)`, `services.get(key)`, `services.tryGet(key)`, `services.has(key)`.
`services.unregister(key)` also exists (used by `dispose()`).
Service keys registered in Phase 0: `engine`, `input`, `settings`, `save`, `i18n`, `quality`, `debug`, `flags`.
`flags`, `settings`, `save` and `i18n` are singletons that register themselves when their module is first
imported; `engine`, `quality`, `input` and `debug` register in their constructors and unregister in `dispose()`.

### Flags.ts
```ts
export interface BuildFlags { DEMO: boolean; IGNORANCE_EPILOGUE: boolean; STORE_URL: string; DEV: boolean }
export interface UrlParams {
  chapter: string | null; waystone: string | null; debug: boolean; god: boolean;
  skipIntro: boolean; lab: boolean; music: string | null; dialogue: string | null;
}
export const buildFlags: BuildFlags;            // from import.meta.env (VITE_DEMO, IGNORANCE_EPILOGUE, VITE_STORE_URL)
export function parseUrlParams(search?: string): UrlParams;
export const urlParams: UrlParams;
export const debugEnabled: boolean;             // DEV || urlParams.debug
export interface FlagsService { readonly build: BuildFlags; readonly url: UrlParams; readonly debug: boolean }
```
- Registers `services.flags` on import. `parseUrlParams` is pure: id params are lower-cased and must match
  `[a-z0-9_-]{1,64}` (else null); booleans are true only for `1` / `true`.
- `urlParams` is blanked (all null/false) unless `debugEnabled`; use `parseUrlParams()` for the raw values.
- `VITE_STORE_URL` is kept only if it is an absolute http(s) URL, otherwise `''`.

### Loop.ts
Fixed 60 Hz update with accumulator and interpolated render.
```ts
export const FIXED_DT = 1 / 60;
export interface System {
  /** Called at a fixed 60 Hz. dt is always FIXED_DT * timeScale. */
  update?(dt: number): void;
  /** Called once per rendered frame after all fixed steps; alpha in [0,1) for interpolation.
   *  frameDt = real seconds since the last rendered frame (not time-scaled, clamped to 0.25 s). */
  render?(alpha: number, frameDt: number): void;
  /** Keep receiving update() while the loop is paused (pause menu, title screen). */
  updateWhenPaused?: boolean;
}
export class Loop {
  timeScale: number;           // debug time scale, default 1
  paused: boolean;             // when true: no update(); render() still runs (so menus animate)
  frameCap: 30 | 60;
  add(system: System, order?: number): () => void;   // lower order runs first; returns remove fn
  start(): void; stop(): void;
  onBeforeStep?: () => void; onAfterStep?: () => void; // Input hooks (beginStep/endStep)
  readonly elapsed: number;    // seconds of unpaused simulated time
  readonly frameStartMs: number; // performance.now() at the start of the last rendered frame
  readonly isRunning: boolean;
}
```
- The Input hooks run every fixed step even while paused, so presses made in a menu are consumed there and
  never fire on the first unpaused step. alpha and elapsed stay frozen while paused.
- A system that throws is logged once (`console.error`) and keeps being called; the others keep running.
- The frame cap also applies at 60 (a 120/144/360 Hz display renders at 60). Pacing uses the rAF timestamp and
  a median display-interval estimate: a cap that is a whole number of display frames renders every n-th frame
  (steady on 59.94 Hz too); otherwise render times sit on a fixed 1000/cap ms grid (DECISIONS #97).
- Max 5 fixed steps per frame (drop the rest, no spiral of death).
- `frameCap: 30` skips rendering frames so the render rate stays ≤ 30 fps.
- When `document.hidden`, the loop stops scheduling frames and emits `game:pause {reason:'hidden'}`; on return it
  resets the accumulator (no catch-up burst) and emits `game:resume` only if it was the one that paused.

### Engine.ts
```ts
export interface EngineStats { fps: number; frameMs: number; drawCalls: number; triangles: number;
                              geometries: number; textures: number }
export class Engine {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;     // antialias, sRGB output, ACESFilmic tone mapping, exposure ~1
  readonly loop: Loop;
  scene: THREE.Scene;                          // active scene (set by whoever owns the current mode)
  camera: THREE.PerspectiveCamera;             // active camera
  readonly stats: EngineStats;                 // frameMs = CPU ms per rendered frame (steps + submit), not 1000/fps
  readonly contextLost: boolean;
  readonly pixelRatio: number;                 // ratio currently applied to the drawing buffer
  constructor(canvas: HTMLCanvasElement);      // registers services.engine; throws if WebGL is unavailable
  setView(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void;
  applyQuality(preset: QualityPreset): void;   // pixel ratio cap, shadows on/off + map size
  setResolutionScale(scale: number): void;     // 0.5..1, multiplies the device pixel ratio
  start(): void;
  dispose(): void;
}
```
- Device pixel ratio cap: 2 on desktop, 1.5 on mobile (coarse pointer), then × resolution scale.
- Resize via `ResizeObserver` on the canvas/window; updates camera aspect; emits `resize`.
- WebGL context loss: `preventDefault()`, show the DOM overlay text `t('ui.context.restoring')`
  ("Restoring the world..."), emit `context:lost`; on restore emit `context:restored` and hide overlay.
- Renders `scene` with `camera` in a `System.render` registered at order 1000 (last).
- `stats` read `renderer.info` each frame (`renderer.info.autoReset` stays true).
- Emits `engine:ready` once, after the first frame is actually rendered.
- Shadow map type is `PCFShadowMap` (r186 removed `PCFSoftShadowMap`). Change shadows only through
  `applyQuality` (it resizes/frees shadow maps of shadow-casting lights and recompiles materials when shadows
  toggle). The Engine does not listen to `quality:changed`; `main.ts` does.

### Quality.ts
```ts
export type QualityLevel = 'low' | 'medium' | 'high';
export type QualitySetting = QualityLevel | 'auto';
export interface QualityPreset {
  level: QualityLevel; pixelRatioCap: number; shadows: boolean; shadowMapSize: number;
  drawDistance: number; grassDensity: number; crowdMax: number; particlesMax: number;
  bloom: boolean; rimLight: boolean; maxDrawCalls: number;
}
export const PRESETS: Record<QualityLevel, QualityPreset>;
export function isQualityLevel(v: unknown): v is QualityLevel;
export function isCoarsePointer(): boolean;
export function isSmallTouchScreen(): boolean;   // coarse pointer and shortest screen side <= 820 CSS px
export class Quality {
  constructor();                               // registers services.quality, starts at medium
  readonly preset: QualityPreset;              // already adapted for touch (smaller shadow maps, <= 80 draw calls)
  readonly level: QualityLevel;
  readonly setting: QualitySetting;            // last value passed to resolve()
  readonly benchmarkMs: number | null;
  forgetBenchmark(): void;                     // debug
  /** 'auto' runs a short in-house GPU benchmark once (first launch), caches the result in localStorage. */
  resolve(setting: QualitySetting, renderer: THREE.WebGLRenderer): Promise<QualityPreset>;
  set(level: QualityLevel): void;              // emits 'quality:changed' (every call, even if unchanged)
}
```
Benchmark: render an offscreen scene of ~200 instanced faceted spheres with a directional light for up to 36
frames into a 960x540 MSAA target (under 1 s, behind the loading screen), syncing each frame with a 1-pixel
read-back (more reliable than `gl.finish`), and map the median frame time to a level (<= 4 ms High, <= 9 ms
Medium, else Low). The median ms is cached in localStorage `pilgrim.quality.bench.v1`; a failed benchmark
falls back to Medium and caches nothing.
Mobile (coarse pointer + small screen) never auto-picks High. Shadows are off on Low (GDD 2.11).

### Input.ts (+ `InputActions.ts`, `Gamepad.ts`, `src/ui/Touch.ts`, `src/ui/ClickToPlay.ts`, `src/ui/Svg.ts`)
```ts
export type Action =
  | 'moveForward' | 'moveBack' | 'moveLeft' | 'moveRight' | 'run' | 'jump' | 'use' | 'pray'
  | 'sword' | 'shield' | 'satchel' | 'pause' | 'skip' | 'choice1' | 'choice2' | 'choice3' | 'debug';
export type InputDevice = 'kbm' | 'pad' | 'touch';
export type TouchButton = 'jump' | 'use' | 'pray' | 'sword' | 'shield';
export class Input {
  constructor(canvas: HTMLCanvasElement, uiRoot?: HTMLElement); // uiRoot defaults to #ui; registers services.input
  readonly device: InputDevice;               // last device used; emits 'input:device' on change
  readonly move: { x: number; y: number };    // -1..1, y = forward. Deadzoned, length ≤ 1
  readonly look: { x: number; y: number };    // look delta accumulated since last step (radians-ish, sensitivity applied, invertY applied)
  runHeld(): boolean;                          // Shift / pad B / joystick pushed to the edge
  held(a: Action): boolean;
  pressed(a: Action): boolean;                 // true for exactly one fixed step after the press
  released(a: Action): boolean;
  holdTime(a: Action): number;                 // seconds held (0 when not held)
  readonly pointerLocked: boolean;
  readonly mouseLooks: boolean;                // true once the mouse has really turned the camera (>= 400 px of look this session)
  requestPointerLock(): void;                  // desktop only; shows the "Click to play" overlay when not locked during gameplay
  releasePointerLock(): void;                  // frees the mouse on purpose (debug panel, overlays): not a pause press
  setGameplayActive(active: boolean): void;    // false in menus: no pointer lock, touch controls hidden, held input released
  setTouchButtons(buttons: TouchButton[]): void; // which round buttons show (combat buttons only when needed)
  // Remapping (GDD 2.6: all keys remappable, saved)
  getBindings(a: Action): string[];            // KeyboardEvent.code values and 'Mouse0'/'Mouse2'
  rebind(a: Action, code: string, slot?: number): boolean; // persists via Settings; slot 0 = primary, past the end = add;
                                               // false (nothing changed) when another action would be left with no key
  resetBindings(): void;
  captureNextKey(): Promise<string>;           // for the "Press a key..." UI; '' when cancelled (Esc)
  glyph(a: Action): string;                    // prompt glyph HTML for the current device
  beginStep(): void; endStep(): void;          // called by Loop around each fixed step
  dispose(): void;
}
export const DEFAULT_BINDINGS: Record<Action, string[]>;
export const ACTIONS: readonly Action[];         // Controls-screen order
export const PAD_BINDINGS: ReadonlyArray<readonly [button: number, actions: readonly Action[]]>;
// Event 'input:bindings' (void): bindings changed (rebind, reset, or loaded from Settings).
```
- `main.ts` sets `loop.onBeforeStep = () => input.beginStep()` and `loop.onAfterStep = () => input.endStep()`.
- `pressed`/`released` are true only inside the step that latched them; `look` is filled in `beginStep` and
  zeroed in `endStep` (read it in `update()`).
- Space drives both jump and skip (the only pair allowed to share a key). Rebinding moves a key away from the
  action that had it; an action left with no key gets the replaced key, else a free default key, else the rebind
  is refused (`rebind` returns false). No action ever has zero keys; stored overrides round-trip exactly.
  Gamepad buttons are not remappable.
- Losing pointer lock mid-gameplay (Esc, alt-tab) taps `pause` once; `releasePointerLock()` and leaving gameplay
  do not. A lock granted after gameplay ended is released.
- Releasing everything (blur, hidden tab, `setGameplayActive(false)`) also covers pad buttons: one still held
  reads as up until it is let go, so it never comes back as a second press.
- Default keyboard per GDD 2.6: WASD + arrows, Shift run, Space jump/skip, E use, Q pray, Mouse0 sword,
  Mouse2 shield, Tab satchel, Esc pause, Digit1-3 choices, F1 debug. Tab/Space must `preventDefault`.
- Gamepad (standard mapping): left stick move, right stick look, A(0) jump, X(2) use, B(1) run hold, Y(3) pray,
  RT(7) sword, LT(6) shield, View(8) satchel, Menu(9) pause. Deadzone 0.18.
- Touch: floating joystick on the left half (centred where the thumb lands, so touch-down never moves the
  player; only the drawn base is kept inside the screen; push to the edge = run),
  drag on the right half = look, round buttons bottom-right ≥ 72 px: JUMP, USE, PRAY, SWORD, SHIELD; satchel icon
  top-left and pause icon top-right. Icons are inline SVG from `src/ui/Svg.ts`. Multi-touch safe (track
  `pointerId`). Uses `touch-action: none`.
- Context menu disabled on the canvas (right mouse = shield).

### Settings.ts
```ts
export interface SettingsData {
  quality: QualitySetting; resolutionScale: number; shadows: boolean; frameCap: 30 | 60;
  difficulty: 'easy' | 'normal'; autoCamera: 'default' | 'on' | 'off'; cameraSpeed: number;
  invertY: boolean; reduceMotion: boolean; timedPrompts: boolean; hints: boolean; fov: number;
  volMaster: number; volMusic: number; volVoices: number; volEffects: number; volAmbience: number;
  textSize: 'M' | 'L' | 'XL'; textSpeed: 'slow' | 'normal' | 'instant'; lang: 'en' | 'ta';
  bindings: Partial<Record<Action, string[]>>;  // only overrides; defaults live in Input
}
export const DEFAULT_SETTINGS: SettingsData;     // difficulty 'easy', fov 55, autoCamera 'default' (on for touch and keyboard-only players)
export const SETTINGS_STORAGE_KEY = 'pilgrim.settings.v1';
export const SETTINGS_RANGES;                    // resolutionScale 0.5-1, fov 45-75, cameraSpeed 0.25-3, volume 0-1
export function sanitizeSettings(raw: unknown): SettingsData;
export const settings: Settings;                 // the singleton, registered as services.settings on import
export class Settings {
  constructor(storage?: Storage | null);         // injectable for tests
  readonly data: Readonly<SettingsData>;
  get<K extends keyof SettingsData>(k: K): SettingsData[K];
  set<K extends keyof SettingsData>(k: K, v: SettingsData[K]): void;   // persists + emits 'settings:changed'
  reset(): void;                                 // keeps the current language
}
```
`data` is the live object (bindings deep-frozen); `get()` returns copies of object values. First launch
follows `navigator.languages` for `lang`.
localStorage key `pilgrim.settings.v1`, every access wrapped in try/catch; unknown/invalid fields fall back
to defaults (validate ranges).

### Save.ts (+ `src/core/idb.ts`)
```ts
export interface SaveData {               // GDD 2.15 save format, version 1
  version: 1; chapter: number; waystone: string; playerName: string; hasRoll: boolean; burden: boolean;
  gifts: string[]; carried: string[]; hope: number; promises: string[]; promisesReadThisChapter: string[];
  detours: string[]; flags: Record<string, boolean | number | string>; achievements: string[];
  playtimeSec: number; savedAt: number;    // savedAt: epoch ms, for the slot list
}
export type SlotId = 'slot1' | 'slot2' | 'slot3' | 'auto';
export function newSave(): SaveData;
export class Save {
  load(slot: SlotId): Promise<SaveData | null>;   // runs migrate()
  write(slot: SlotId, data: SaveData): Promise<void>;   // emits 'save:written'
  remove(slot: SlotId): Promise<void>;
  list(): Promise<Array<{ slot: SlotId; data: SaveData }>>;
  latest(): Promise<SaveData | null>;             // newest of all slots, for CONTINUE
}
export function migrate(raw: unknown): SaveData | null; // version switch; unknown future versions → null
export const SAVE_VERSION = 1;
export const SLOT_IDS: readonly SlotId[];
export const EPILOGUE_CHAPTER = 14;              // SaveData.chapter for the epilogue
export const save: Save;                         // the singleton, registered as services.save on import
// Save also has `readonly persistent: boolean` (false when running on the in-memory fallback).
// write() stamps savedAt = Date.now(); event 'save:written' { slot: SlotId }.
```
`idb.ts`: tiny promise wrapper (`open`, `get`, `put`, `del`, `keys`, `isPersistent`, `close`) over one database
`pilgrim`, store `saves`.
If IndexedDB is unavailable (private mode), fall back to an in-memory map and warn once.

### I18n.ts
```ts
export type Lang = 'en' | 'ta';
export function t(key: string, params?: Record<string, string | number>): string;  // "{n}" placeholders
export class I18n {
  lang: Lang;                                   // getter/setter; assigning calls setLang()
  setLang(l: Lang): void; has(key: string): boolean;
  t(key: string, params?: Record<string, string | number>): string;
  missingTranslations(lang?: Lang): string[]; dispose(): void;
}
export const LANGS: readonly Lang[];
export const i18n: I18n;                        // the singleton, registered as services.i18n on import
```
- I18n imports Settings for its side effect and also follows `settings.set('lang', ...)`.
- Loads `content/i18n/en.json` and `ta.json` (flat `{ "key": "text" }` maps) by static import.
- Missing in Tamil → English fallback. Missing in English → returns the key and (dev only) `console.warn` once per key.
- Setting `lang` sets `document.documentElement.lang` and a `lang-ta` class on `<body>` so CSS can switch to
  the Tamil font stack (GDD 2.14). Emits `lang:changed`.

### Debug.ts (dev or `?debug=1` only)
```ts
export class Debug {
  constructor(opts?: { visible?: boolean; parent?: HTMLElement }); // registers services.debug; mounts on body
  toggle(): void;                       // F1 (follows the remapped Input 'debug' binding once installed)
  setVisible(v: boolean): void; readonly visible: boolean;
  setHotkeys(codes: () => readonly string[]): void; refresh(): void; dispose(): void;
  addReadout(label: string, fn: () => string): () => void;
  addButton(group: string, label: string, fn: () => void): () => void;
  addToggle(group: string, label: string, get: () => boolean, set: (v: boolean) => void): () => void;
  addSlider(group: string, label: string, min: number, max: number, step: number,
            get: () => number, set: (v: number) => void): () => void;
}
export function createDebug(opts?): Debug | null;   // null unless debugEnabled
export function installCoreDebug(engine, quality, input, debug?): () => void;  // Phase 0 readouts + controls
// Event 'debug:toggled' { visible: boolean }.
```
- The panel owns the F1 toggle; nothing else should call `toggle()` on the Input `debug` action. Opening it frees
  the mouse through `input.releasePointerLock()`, so it never counts as a pause press.
- Its quality buttons only call `quality.set(level)`; `main.ts` applies the preset from `quality:changed`.
- `main.ts` adds Phase 0 extras: mode / benchmark / pixel-ratio readouts, "Rebuild scene" (dispose check) and
  "Lose context 3 s" (context-loss check).
Small plain-DOM panel, top-right, monospace system font. Phase 0 content: FPS, frame ms, draw calls, triangles,
geometries/textures, quality level, input device, time-scale slider, quality buttons. Later phases add their
controls (chapter jump, burden, hope, gifts, show triggers, free camera, place mode) through this API.
Debug strings are developer-only and may be plain English (not i18n).

### UI root
`#ui` is a full-screen DOM overlay above the canvas (`pointer-events: none` on the root; children opt in).
Global CSS: `src/ui/styles.css` (system font stacks from GDD 2.14, CSS variables for colours, Tamil class).
Body text ≥ 20 px on mobile. `src/ui/dom.ts` has the typed `h()` element builder and small helpers (`listen`,
`setText`, `setVisible`, `mount`, `uiRoot`). `src/ui/Emblem.ts` holds the logo emblem shapes and `emblemSvg()`
(also read by `tools/gen-icons.mjs`).

## Phase 0 dev scene

`src/world/dev/` holds the Phase 0 test scene (`DevScene.ts`, `devWorld.ts`) and its own tiny helpers
(`rng.ts`, `geom.ts`, `Sky.ts`). It is self-contained and is NOT the procedural toolkit: new code must use
`src/gen/` below. It stays as the default mode until the title screen exists (Phase 3), then it can be deleted.

## Procedural toolkit (Phase 1) — `src/gen/`

Units: metres, Y up. One world unit = 1 m. Chapter worlds are `size × size` metres centred on the origin.

### Foundations (WRITTEN — read the files; use them, do not rewrite them)

`src/gen/rng.ts`
```ts
export function hashString(s: string): number;            // 32-bit FNV-1a
export class Rng {                                        // mulberry32, in-house
  constructor(seed: number);
  next(): number;                                         // [0,1)
  range(min: number, max: number): number;
  int(min: number, max: number): number;                  // inclusive
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
  sign(): 1 | -1;
  gauss(mean?: number, sd?: number): number;
  fork(salt: number | string): Rng;                       // independent child stream
}
```

`src/gen/noise.ts`
```ts
export type Noise2D = (x: number, y: number) => number;            // ~[-1,1]
export type Noise3D = (x: number, y: number, z: number) => number;
export function createNoise2D(seed: number): Noise2D;              // in-house simplex
export function createNoise3D(seed: number): Noise3D;
export function fbm2(n: Noise2D, x: number, y: number, octaves?: number, lacunarity?: number, gain?: number): number;
export function ridge2(n: Noise2D, x: number, y: number, octaves?: number): number;
```

`src/gen/palette.ts`
```ts
export type PaletteId = 'title' | 'test' | 'city' | 'slough' | 'wrongHill' | 'wicketGate' | 'interpreter' | 'cross'
  | 'hill' | 'humiliation' | 'shadow' | 'vanity' | 'doubting' | 'delectable' | 'river' | 'epilogue';
export interface Palette {
  id: PaletteId;
  sky: { top: string; horizon: string; bottom: string; sun: string };
  fog: { color: string; near: number; far: number };
  light: { sun: string; sunIntensity: number; sunDir: [number, number, number];
           hemiSky: string; hemiGround: string; hemiIntensity: number };
  ground: { low: string; mid: string; high: string; slope: string; path: string; pathEdge: string; detour: string };
  water: { shallow: string; deep: string };
  accents: Record<string, string>;                        // GDD 2.10 named hex values, e.g. accents.horizonLight
}
export const PALETTES: Record<PaletteId, Palette>;        // every chapter's GDD 2.10 hex values appear here
export function color(hex: string): THREE.Color;          // cached, sRGB→linear handled by three's ColorManagement
export function shade(hex: string, amount: number): string; // lighten (+) / darken (-), for derived tints
export function mix(a: string, b: string, t: number): string;
export function vary(hex: string, amount: number, r: number): string;   // per-instance jitter (r = rng.next())
export function getPalette(id: string): Palette;                       // throws on unknown id
export const SKIN_TONES: readonly ['#F1C7A3', '#E0A57A', '#C68A5E', '#9C6644', '#6E4A33'];  // GDD 2.11
```

`src/gen/geom.ts` — every builder returns a **non-indexed BufferGeometry with `position`, `normal`, `color`**
(flat-shaded faces, vertex colours). Low segment counts.
```ts
export function lowSphere(radius: number, detail?: number): THREE.BufferGeometry;      // icosahedron based
export function capsule(radius: number, length: number, radial?: number): THREE.BufferGeometry;
export function bevelBox(w: number, h: number, d: number, bevel?: number): THREE.BufferGeometry;
export function cone(radius: number, height: number, radial?: number): THREE.BufferGeometry;
export function cylinder(rTop: number, rBottom: number, height: number, radial?: number): THREE.BufferGeometry;
export function lathe(profile: Array<[number, number]>, radial?: number, phiStart?: number, phiLength?: number): THREE.BufferGeometry;
export function extrude(shape: Array<[number, number]>, depth: number, bevel?: number): THREE.BufferGeometry;
export function jitter(g: THREE.BufferGeometry, amount: number, rng: Rng): THREE.BufferGeometry; // welds shared verts so faces stay closed
export function paint(g: THREE.BufferGeometry, hex: string | ((p: THREE.Vector3, n: THREE.Vector3) => string)): THREE.BufferGeometry;
export function xform(g: THREE.BufferGeometry, o: { pos?: Vec3; rot?: Vec3; scale?: number | Vec3 }): THREE.BufferGeometry;
export function merge(gs: THREE.BufferGeometry[]): THREE.BufferGeometry;               // disposes inputs
export function finalize(g: THREE.BufferGeometry): THREE.BufferGeometry;               // toNonIndexed + flat normals + bounds
export function part(g, hex | fn, o?: { pos?; rot?; scale? }): THREE.BufferGeometry;   // paint + xform in one call
export function colorOf(hex: string): THREE.Color;                                     // cached linear colour, do not mutate
export type Vec3 = [number, number, number];
```

`src/gen/materials.ts` — shared, app-lifetime materials (never disposed by chapters).
```ts
export function mat(kind: 'lambert' | 'toon' | 'glow' | 'skinned' | 'path' | 'unlit' | 'unlitTransparent' | 'decal'): THREE.Material;
export function disposeSharedMaterials(): void;   // app shutdown / tests only
// flatShading: true, vertexColors: true; 'glow' adds emissive from vertex colour; 'skinned' is the character material;
// 'decal' = unlit, transparent, no depth write, polygon offset: marks laid on the ground (blob shadows, RGBA colours).
```

`src/gen/yielder.ts` — time-sliced work so generation never freezes the page.
```ts
export class Yielder { constructor(budgetMs?: number /* default 8 */); tick(): Promise<void>; finish(): number; workMs: number }
// `await y.tick()` between chunks; it only really yields when the 8 ms slice is used up. finish() → total work ms.
export function nextFrame(): Promise<void>;
```

`src/gen/types.ts`
```ts
export type Collider =
  | { kind: 'box'; center: Vec3; half: Vec3; rotY: number }
  | { kind: 'cylinder'; center: Vec3; radius: number; height: number }
  | { kind: 'sphere'; center: Vec3; radius: number };
export interface PropResult { geometry: THREE.BufferGeometry; colliders: Collider[]; glow?: THREE.BufferGeometry }
export type PropBuilder = (rng: Rng, pal: Palette, params: Record<string, number | string | boolean>) => PropResult;
```
Prop geometry is built at the origin facing +Z; the placer transforms it. `colliders` are in the prop's local
space. `glow` (optional) is geometry for emissive parts (candle flames, windows, the far light).

### Level data — `src/world/LevelTypes.ts`
Mirrors GDD 2.15 exactly, plus optional fields the GDD implies:
```ts
export interface LevelData {
  id: string; seed: number; palette: PaletteId; size: number;
  terrain: { base: number; noise: { scale: number; height: number; octaves?: number };
             stamps: Array<{ type: 'hill' | 'valley' | 'plateau' | 'basin' | 'cliff' | 'ridge';
                             x: number; z: number; r: number; height?: number; depth?: number; dir?: number }> };
  way: Vec3[]; wayWidth?: number;                         // default 3 m (DEFAULT_WAY_WIDTH)
  detours: Array<{ id: string; points: Vec3[]; width?: number }>;
  zones: Array<{ id: string; type: string; shape: 'circle' | 'box' | 'way'; x?: number; z?: number; r?: number;
                 size?: [number, number]; from?: number; to?: number; hopeDrain?: number; [k: string]: unknown }>;
  scatter: Array<{ type: string; zone?: string; density: number; minDist?: number; slopeMax?: number;
                   keepClear?: number; scale?: [number, number]; area?: { x: number; z: number; r: number } }>;
  landmarks: Array<{ type: string; id: string; at?: Vec3; rotY?: number; path?: string; from?: number; to?: number;
                     params?: Record<string, number | string | boolean> }>;
  npcs: Array<{ id: string; recipe: string; role?: string; at?: Vec3; rotY?: number }>;
  triggers: Array<{ id: string; shape: 'box' | 'circle'; at: Vec3; size?: Vec3; r?: number; script: string; once?: boolean }>;
  waystones: Array<{ id: string; at: Vec3 }>;
  promises: Array<{ id: string; at: Vec3 }>;
  water?: Array<{ kind: 'water' | 'mud'; shape: 'circle' | 'box'; x: number; z: number; r?: number; size?: [number, number]; level: number }>;
  ambience: string; music: string;
}
export const DEFAULT_WAY_WIDTH = 3;
export function parseLevel(raw: unknown): LevelData;   // readable errors; missing optional lists → [], ambience/music → ''
// Section aliases: StampType, TerrainStamp, DetourDef, LevelZone, ScatterRule, LevelLandmark, LevelNpc, LevelTrigger,
// LevelWaystone, LevelPromise, LevelWater.
```
- `at` triples on landmarks, NPCs, waystones and promises are `[x, lift, z]`: y is a height above the terrain,
  which the builder samples. Water `level` is an absolute world height. `dir` (stamps) is radians, 0 = +X.
- Optional fields read through the zones' index signature: `tint` (hex or palette key) and `tintAmount`, `rotY` on
  box zones, `path` on `'way'` band zones (default the main Way), `at` instead of x/z. Landmarks: `params.clear`
  (scatter keep-out radius), and for runs along a path `offset`, `both`, `spacing`, `align`, `lift`.

### Terrain — `src/gen/Terrain.ts`, The Way — `src/gen/Way.ts`, Scatter — `src/gen/Scatter.ts`
```ts
export type WayKind = 'way' | 'detour';
export interface ClosestResult { t: number; dist: number; point: THREE.Vector3 }
export class Way {
  constructor(points: Vec3[], width: number, kind: WayKind, id: string);
  readonly id: string; readonly kind: WayKind; readonly width: number; readonly halfWidth: number;
  readonly points: readonly Vec3[]; readonly length: number;            // horizontal arc length (m)
  readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number;
  sample(t: number, out?: THREE.Vector3): THREE.Vector3;               // t in [0,1], arc-length, O(1)
  tangent(t: number, out?: THREE.Vector3): THREE.Vector3;              // includes the ground slope once draped
  closest(x: number, z: number, out?: ClosestResult): ClosestResult;  // 8 m bucket grid, ~1.5 µs
  closestWithin(x: number, z: number, maxDist: number, out?: ClosestResult): boolean;
  distanceWithin(x: number, z: number, maxDist: number): number;      // Infinity when further
  drape(heightAt: (x: number, z: number) => number): void;            // Terrain.build calls it: sample().y = ground
  buildMesh(terrain: Terrain, pal: Palette, rng: Rng): THREE.Object3D;  // ribbon (mat 'path') + instanced edge stones
  dispose(): void;                                                     // frees what buildMesh made (the Way owns it)
}
export class Terrain {
  static build(level: LevelData, ways: Way[], pal: Palette, y: Yielder, onProgress?: (p: number) => void): Promise<Terrain>;
  heightAt(x: number, z: number): number;      // exact height of the DRAWN triangles (not bilinear), so feet sit on facets
  normalAt(x: number, z: number, out?: THREE.Vector3): THREE.Vector3;
  slopeAt(x: number, z: number): number;       // degrees
  contains(x: number, z: number, margin?: number): boolean;
  readonly mesh: THREE.Mesh; readonly size: number; readonly segments: number; readonly cellSize: number;
  readonly minHeight: number; readonly maxHeight: number; readonly ways: readonly Way[];  // main Way first
  readonly heights: Float32Array;              // rows by z then x
  readonly wayMask: Float32Array;              // per-vertex weight of the flattened band
  dispose(): void;                             // geometry only (shared material; Ways are disposed by their builder)
}
export interface ScatterResult { object: THREE.Object3D; colliders: Collider[]; dispose(): void }  // scatter-meshes.ts
export function scatter(level: LevelData, terrain: Terrain, ways: Way[], pal: Palette, rng: Rng, quality: QualityPreset,
                        y: Yielder): Promise<ScatterResult>;
```
- Grid: round(128 × size / 300) cells per side, clamped 32-256 (≈2.3 m cells), alternating diagonals. Progress:
  heights 0-0.45, flattening 0.45-0.65, mesh 0.65-1. Helpers live in `src/gen/terrain/` (spline, heightfield,
  terrainMesh, wayMesh, zones, scatterRules).
- Flattening: flat for half-width + 0.6 m, then a 2.2 m smooth falloff, target heights smoothed along the path; the
  main Way first, detours never change its band; fades over 7 m past each end. Ribbons are lifted 3.5 cm (detours
  2.5 cm) on the polygon-offset `path` material; detour ribbons are clipped under the main Way.
- Scatter: per-type defaults (min distance, slope, keep-clear from the ribbon edge, scale, sink, tilt, collider kind,
  water rule, instance cap), dart throwing with spacing hashes. Circle zones are sampled in their disc, 'way' zones
  in their band, box zones in their own (turned) frame, so every attempt lands inside the zone. Meshes
  (`scatter-meshes.ts`): every type is chunked into `THREE.LOD`s with chunk-sized bounds, so the camera and the
  sun's shadow frustum cull them: grass and flowers in ~75 m cells, hidden beyond clamp(0.35 × drawDistance, 35,
  90) m + the chunk radius and scaled by `quality.grassDensity` at build time; trees, bushes, rocks and reeds in
  ~100 m cells (a type whose placements fit in one cell, e.g. a wood or a bog, stays one chunk), switching to the
  prop's `lod: 1` build beyond clamp(0.3 × drawDistance, 30, 90) m + half the chunk radius (GDD 2.15 "simple LOD
  for distant trees") and hidden only past the palette's fog far. Colliders are world space: trees use the
  prop's cylinders, rocks a sphere.

### Props — `src/gen/props/*.ts`, registry `src/gen/props/index.ts`
```ts
export const PROPS: Record<string, PropBuilder>;   // { ...NATURE_PROPS, ...BUILT_PROPS }
// NATURE_PROPS (props/nature.ts): tree_cone, tree_round, tree_dead, tree_fruit, fruit_tree_orchard, bush, reeds, grass,
//   rock, flower, lily, mushroom, log, stump, vine_row
// BUILT_PROPS (props/built.ts): fence, wall, stile, bridge_plank, gate, wicket_gate, house_a, house_b, house_c,
//   waystone, arbour, cross, tomb, stall, cage, flag, sign, lamp, candle, well, bench, barrel, crate, cart,
//   palace_tower, castle_tower, mountain_peak
export function buildProp(type: string, rng: Rng, pal: Palette, params?: PropParams): PropResult;  // throws on unknown type
export function transformCollider(c: Collider, at: Vec3, rotY: number, scale: number): Collider;
// Simple merge helpers (one lit + one glow mesh): placeProps(items: PropItem[], rng, pal): MergedProps and
// placePropsAsync(items, rng, pal, y: Yielder, onProgress?). Chapters use src/world/placeProps.ts (below).
```
- Every builder returns one merged, non-indexed geometry (position, normal, color) at the origin, standing on y = 0,
  facing +Z; walls, fences, logs and vine rows run along X. Trunks and bases sink 5-14 cm so nothing floats.
- Common params: `variant` (0..3), `height`, `colour`/`color`, `lod` (0|1, nature props; same silhouette, ~half the
  triangles). Kit helpers: `props/nature-kit.ts`, `props/built-kit.ts`, `props/built-house-kit.ts`.
- **Collider convention:** `center` is the centre of the volume for every kind; a cylinder spans
  `center.y ± height / 2`.
- Budgets (lit triangles): grass < 40, flower < 60, rock < 80, bush < 150, trees < 300, walls < 200 per segment,
  houses ~1000-1200 (+60-110 glow), other built props < 600 outside their wall segments.

### Sky, water, particles
```ts
// src/gen/Sky.ts
export class Sky { constructor(pal: Palette, q: QualityPreset); readonly object: THREE.Object3D;
  update(dt: number, camera: THREE.Camera): void; dispose(): void; }       // dome 1 call + instanced clouds 1 call
export interface Atmosphere { hemi: THREE.HemisphereLight; sun: THREE.DirectionalLight;
  focus(p: THREE.Vector3): void; dispose(): void; }                        // focus: shadow area follows p (texel-snapped)
export function applyAtmosphere(scene: THREE.Scene, pal: Palette): Atmosphere;
// src/gen/Water.ts
export interface WaterOptions { kind: 'water' | 'mud'; pal: Palette; shape: 'circle' | 'box'; r?: number; size?: [number, number] }
export interface WaterBody { mesh: THREE.Mesh; update(t: number): void; dispose(): void }   // t = absolute seconds
export function createWater(o: WaterOptions): WaterBody;   // flat in local XZ at y = 0: caller sets mesh.position
// src/gen/Particles.ts
export type ParticlePreset = 'dust' | 'sparkle' | 'smoke' | 'ember' | 'rain' | 'zzz' | 'fire' | 'motes' | 'stars' | 'splash' | 'breath';
export interface EmitOptions { dir?: THREE.Vector3; color?: string; spread?: number;
  cone?: number;            // 0 = straight along dir, 1 = any way (default: the preset's)
  vel?: THREE.Vector3;      // added to every start velocity (puffs from someone walking keep up)
  follow?: THREE.Vector3 }  // orbit presets ('stars'): a live centre the ring follows (the caller keeps it updated)
export class Particles { constructor(max: number, seed?: number); readonly object: THREE.InstancedMesh; readonly max: number;
  emit(preset: ParticlePreset, pos: THREE.Vector3, count?: number, opts?: EmitOptions): void;
  update(dt: number, camera: THREE.Camera): void; setLight(pal: Palette): void; clear(): void; dispose(): void; }
export class ParticleEmitter { constructor(p: Particles, preset: ParticlePreset, ratePerSec: number, opts?: EmitOptions);
  update(dt: number, pos: THREE.Vector3): void; }   // src/gen/fx/ParticleEmitter.ts, re-exported; chimneys, fires, rain
```
- The sky dome is redrawn around the rendering camera in its shader (no lag, never clipped), not tone mapped, and
  its eye-level band is the fog colour so fogged ground meets the sky without a seam. Clouds: 7/12/18 by quality.
- The sun is a child of `sun.target`; its shadow area is a 60 m square. `castShadow` is always on; the renderer's
  shadow setting decides whether shadows draw. Water/mud read the palette's light once, at creation.
- Particles: one InstancedMesh, alpha and additive mixed in one draw call (premultiplied alpha), world-space
  positions (add `object` at the scene root), back-to-front sorted, no per-frame allocation. Slots come from a
  free-slot stack; only a full pool recycles a live particle (the one furthest through its life).
- Shader/preset helpers: `src/gen/fx/` (particlePresets, particleShaders, waterGrid).

### Characters — `src/gen/CharacterFactory.ts`, `src/gen/rig.ts`, `src/gen/face.ts`, `content/characters/recipes.json`

**One draw call per character**, including the face: eyes, brows and every mouth shape are part of the same
SkinnedMesh, each bound rigidly to its own face bone. Blink = scale the eye bones on Y. Brows = rotate/offset the
brow bones. Mouth shapes swap by scaling the active mouth bone to 1 and the others to 0. (Logged as a decision:
the GDD's "separate tiny meshes" goal — swappable expressions — is met with zero extra draw calls.) Characters with
glowing bits (candle flame, lantern glass, forehead dot, beast belly) add ONE tiny `glowMesh` (mat 'glow') on the
same skeleton.

Bone names (`rig.ts`), rest pose = arms hanging down (A-pose ~8°, in bone positions: every rest ROTATION is
identity), character faces +Z, feet on y = 0:
```ts
export const BODY_BONES = ['root','hips','spine','chest','neck','head','upperArmL','lowerArmL','handL','upperArmR',
  'lowerArmR','handR','thighL','shinL','footL','thighR','shinR','footR','propL','propR','back','sack','hat'] as const;
export const FACE_BONES = ['eyeL','eyeR','browL','browR','mouth_neutral','mouth_smile','mouth_open','mouth_frown',
  'mouth_o','mouth_flat','mouth_wavy','mouth_grin'] as const;
export const BEAST_BONES = ['wingL','wingR','tail1','tail2','tail3','jaw'] as const;   // body 'beast' only
export const ROPES_BONE = 'ropes';   // internal, child of chest, scaled with the sack (shoulder ropes); never animated
export type BoneName = typeof BODY_BONES[number] | typeof FACE_BONES[number] | typeof BEAST_BONES[number];
// Also: bodyFor(recipe) and Body (rig-bodies.ts), layoutRig, buildRig, faceAnchors, headSurfaceZ.
```
Types live in `src/gen/char-types.ts` and are re-exported by `CharacterFactory.ts` (with `EXPRESSIONS`, `MOUTHS`,
`normaliseRecipe`):
```ts
export type Expression = 'neutral' | 'happy' | 'sad' | 'scared' | 'surprised' | 'angry' | 'sleepy' | 'determined';
export type MouthShape = 'neutral' | 'smile' | 'open' | 'frown' | 'o' | 'flat' | 'wavy' | 'grin';
export interface CharacterRecipe {
  id: string; name?: string;
  body: 'adult' | 'adultF' | 'elder' | 'child' | 'youngAdult' | 'stocky' | 'thin' | 'big' | 'giant' | 'giantess' | 'tall' | 'beast';
  scale?: number;                                        // default: giants 3, beast 1.6, else 1 (Shining Ones set 1.3)
  build?: { height?: number; girth?: number; head?: number; legs?: number; arms?: number; belly?: number }; // BUILD_LIMITS 0.6-1.6
  skin: string;                                          // one of the GDD 2.11 skin tones
  colors: { top: string; bottom: string; feet?: string; accent?: string; hair?: string; hat?: string; trim?: string;
            [k: string]: string | undefined };           // also read: belt, sack, sackRope, glow, plume, shield, shieldRim,
            // emblemSun, emblemPath, sword, swordHilt, apron, shirt, beard, brows, cape, bag, buttons, chains, wings,
            // horns, lantern, candle and one per prop type (staff, toy, cane, keys, book, letter, gavel, club, crook, pole)
  parts: { top?: 'tunic' | 'robe' | 'dress' | 'coat' | 'vest' | 'shirt' | 'judge';
           bottom?: 'trousers' | 'robe' | 'skirt';
           hair?: 'none' | 'short' | 'curls' | 'bun' | 'long' | 'tuft' | 'bald';
           beard?: 'none' | 'short' | 'full' | 'long';
           hat?: 'none' | 'cap' | 'hood' | 'tall' | 'wig' | 'scarf' | 'helmet' | 'droopy' | 'mirrorMask';
           extras?: string[] };   // 'apron','ropeBelt','belt','cape','buttons','plume','glowDot','trim','sleeves','chains','bag','blush'
  props?: Array<{ type: 'staff' | 'candle' | 'lantern' | 'keys' | 'book' | 'gavel' | 'crook' | 'sword' | 'shield' | 'cane' | 'letter' | 'toy' | 'club' | 'pole';
                  bone: 'propL' | 'propR' | 'back' }>;
  burden?: boolean; glow?: boolean; expression?: Expression;
  face?: { brows?: number };                             // brow size × (FACE_LIMITS 0.6-1.8; Obstinate's big frown brows)
  pose?: 'armsCrossed' | 'handsOnHeart' | 'pointFar';    // GDD 2.11 design-sheet signature, held by the idle clip
  voice: { pitch: number; speed: number; wave: 'sine' | 'triangle' | 'square' | 'sawtooth'; vowel: number }; // Phase 3 babble
  style?: { bounce?: number; stiffness?: number; swagger?: number; lean?: number };  // 0..2, 0..1, 0..1, -0.6..0.6
}
export interface Character {
  readonly recipe: CharacterRecipe;
  readonly root: THREE.Object3D;                         // position/rotate this
  readonly mesh: THREE.SkinnedMesh;                      // 1 draw call (fixed bounding sphere: no CPU skinning to cull)
  readonly glowMesh: THREE.SkinnedMesh | null;           // +1 tiny call only for glowing bits; hide with mesh when culling
  readonly skeleton: THREE.Skeleton;
  readonly bones: Record<string, THREE.Bone>;
  readonly animator: Animator;
  readonly height: number;                               // top of head with hair, at rest
  readonly expression: Expression; readonly burdenSize: number; readonly triangles: number;
  setExpression(e: Expression): void;
  setMouth(shape: MouthShape | null): void;              // override; null = expression's mouth (joy jumps grin by themselves)
  setEyesClosed(closed: boolean): void;                  // scripts; nap and pray close the eyes by themselves
  setTalking(on: boolean): void;                         // mouth flap ~8/s + head nod (call animator.overlay('talk') for gestures)
  setBurdenSize(s: number): void;                        // 0 hides sack and ropes, 1 normal, up to 1.6; sprung ("boing")
  attach(obj: THREE.Object3D, bone: 'propL' | 'propR' | 'back' | 'head'): void;   // caller owns obj (extra draw call)
  onSparkle: ((worldPos: THREE.Vector3) => void) | null; // glow recipes, every 0.1-0.3 s (reused vector: copy it)
  update(dt: number): void;                              // animator, face (blend, blink, flap; follows nap/pray/joyJump), springs, talk nod
  dispose(): void;                                       // geometry + bone texture (materials are shared)
}
export class CharacterFactory {
  static recipes(): Record<string, CharacterRecipe>;     // normalised copy of recipes.json
  static build(recipe: CharacterRecipe | string, rng?: Rng): Character;  // unknown id: warns once, builds a villager
}
```
The recipe loader keeps build multipliers inside `BUILD_LIMITS` (char-types.ts), the same range `bodyFor` builds
with and the Lab's sliders offer, so a stored value is always the one used. Brows lift at most `BROW_LIFT_MAX`
(face.ts, 0.09 head radii) and hero hair keeps its fringe above `FRINGE.hero` (char-head.ts, 0.5): raised brows
stay on skin. Hair shells, the helmet dome and its neck guard close their open edges with a skirt into the skull
(`skirt`, char-parts.ts), so no gap with sky ever shows between a shell and the head.

**Blob shadows** — `src/gen/BlobShadows.ts` (GDD 2.11: "cheap blob shadows under every character on all
qualities"): one InstancedMesh (mat 'decal') of soft discs per scene = 1 draw call for the whole cast and every
crowd citizen, with or without the shadow map.
```ts
export class BlobShadows { constructor(max: number, ground?: { heightAt(x, z): number; normalAt(x, z, out?): Vector3 } | null);
  readonly mesh: THREE.InstancedMesh; readonly max: number;
  follow(c: Character, radius?: number): void; unfollow(c: Character): void;   // radius default 0.27 × height
  addCrowd(crowd: CrowdMesh, radius?: number): void; removeCrowd(crowd: CrowdMesh): void;   // static crowds
  update(): void;   // per rendered frame after characters moved: under the hips, on the ground, tilted to it
  dispose(): void; }
```
A character hidden (root or mesh, e.g. World distance culling) loses its blob; a crowd's blobs hide with it. With a
ground sampler (a chapter's Terrain) blobs lie on the terrain; up to 1.5 m above it (a hop) the blob stays on the
ground and shrinks; higher, the character stands on something and the blob goes to its feet.

Builder files: `char-build.ts` (assembly), `char-parts.ts` (part kit, baking), `char-body.ts` + `char-limbs.ts`
(torso, garments, arms, legs, extras), `char-head.ts` + `char-hats.ts`, `char-props.ts` + `char-prop-shapes.ts`
(hand props, the Burden), `char-motion.ts` (springs), `char-recipes.ts` (loader), `rig-bodies.ts` (proportions).

### Procedural animation — `src/gen/anim/` (import from `src/gen/anim/index.ts`)
```ts
export interface BonePose { x: number; y: number; z: number }               // Euler offset (rad) from rest, order 'YXZ'
export interface Pose { bones: Map<BoneName, BonePose>; hips: { x: number; y: number; z: number }; squash?: number }
export interface AnimParams { speed: number; burden: number; time: number; style: AnimStyle; height: number;
  rootMotion?: boolean;   // false: clips drop their jump arcs (the controller owns height)
  pose?: 'armsCrossed' | 'handsOnHeart' | 'pointFar' | null;   // recipe signature held by idle (clips-pose.ts)
  rig?: RigInfo }         // measured from the skeleton by the Animator
export interface ProcClip {
  name: AnimName; loop: boolean; duration: number; layer: 'full' | 'upper';
  sample(t: number, p: AnimParams, out: Pose): void;
  rate?(p: AnimParams): number;          // integrated playback rate (stride rate from speed; clips-gait.ts)
  gait?: number; steps?: readonly number[]; cues?: readonly number[];   // in-step crossfades, foot plants, cues
}
export type AnimName = 'idle' | 'walk' | 'run' | 'burdenedWalk' | 'hop' | 'joyJump' | 'talk' | 'wave' | 'point' | 'sit'
  | 'nap' | 'pray' | 'read' | 'trip' | 'coverEarsRun' | 'climb' | 'push' | 'kneel' | 'knock' | 'reach' | 'fall' | 'land'
  | 'swing' | 'block';
export interface PlayOptions { fade?: number; speed?: number; restart?: boolean }
export class Animator {
  constructor(bones: Record<string, THREE.Bone>, params: AnimParams);       // starts on idle
  play(name: AnimName, opts?: PlayOptions): void;   // full-body crossfade; an upper clip is routed to overlay()
  overlay(name: AnimName | null, opts?: PlayOptions): void;                 // chest, neck, head, arms
  update(dt: number): void; rest(): void;
  readonly current: AnimName; readonly overlayName: AnimName | null; readonly params: AnimParams;
  readonly phase: number; readonly gaitPhase: number; readonly squash: number;
  steps: number; cues: number; lastCue: AnimName;  // poll counters: foot plants, clip cues (huff, knock, snore...)
  onEnd?: (name: AnimName) => void;                 // one-shots on either layer; then falls back to the last loop
}
export const CLIPS: Record<AnimName, ProcClip>;     // defined in clips-all.ts
export const ANIM_NAMES: readonly AnimName[]; export const NOMINAL_SPEED: Partial<Record<AnimName, number>>;
export function isUpperClip(name: AnimName): boolean;
export const DEFAULT_STYLE: AnimStyle;              // bounce 0.4, stiffness 0.4, swagger 0.1, lean 0
// Also: ANIM_BONES, UPPER_BONES, measureRig, standardRig, types RigInfo, ArmRest, AnimStyle.
```
Upper clips: talk, wave, point, read, knock, reach, swing (sword, one-shot), block (shield held; clips-combat.ts). Full-body one-shots: hop, joyJump, land, trip, fall.
Planted feet (`clips-gait.ts`): walk, run, burdenedWalk, coverEarsRun and push solve stride cadence and thigh swing
together from the speed (a preferred cadence per leg length per second, the swing that makes the planted foot
travel as far as the body, the cadence solved back within limits scaled by leg length), with a linear stance
sweep (walks) or flights with the legs split (runs), and `steadyLegs()` countering hip yaw, roll and sway, so feet
do not skate at the GDD 2.7.1 speeds (walk ~3.2 Hz, run ~4.2 Hz, burdened ~2.6 Hz for Christian). The burdened
walk loop is 4 strides (8 steps, one huff).
Squash-and-stretch is on the `hips` scale, about the feet (the root is never touched). Secondary motion (sack spring,
hat bounce, burden "boing") lives in the Character (`char-motion.ts`), driven by root and hips acceleration.

### Crowds — `src/gen/CrowdMesh.ts`, `src/gen/CrowdShadow.ts`
`InstancedMesh` per body type built from a recipe (static, no skeleton, lower LOD), per-instance colour applied only
to the top garment (a `tint` vertex attribute masks skin, face, hair and the rest), vertex-shader sway/nod/breath
driven by `uTime` and a per-instance `crowdPhase`. CrowdMeshes do not cast shadows: one `CrowdShadow` draws every
citizen's shadow (a scaled capsule-and-head proxy) into one light's shadow map only. 100 citizens of 8 body types
= 8 calls + 1 shadow call. Their blob shadows join the scene's BlobShadows (`addCrowd`), whose single call the
cast already pays for.
```ts
export class CrowdMesh { constructor(recipe: CharacterRecipe | string, max: number); readonly mesh: THREE.InstancedMesh;
  readonly max: number; readonly height: number; readonly width: number;   // citizen size, for the shadow proxy
  set(i: number, pos: THREE.Vector3, rotY: number, tint: string, phase?: number): void;  // raises count to i+1
  count: number; update(t: number): void; dispose(): void; }
export class CrowdShadow { constructor(max: number, light: THREE.DirectionalLight | THREE.SpotLight);
  readonly mesh: THREE.InstancedMesh; count: number;
  set(i: number, pos: THREE.Vector3, rotY: number, height: number, width: number): void; dispose(): void; }
```

### Lab — `src/gen/Lab.ts` (`?lab=1`)
Turntable scene; list of every recipe, every animation and every expression; sliders for colours and build
multipliers; "Copy recipe JSON"; lineup view (all characters side by side at gameplay camera distance);
a "crowd of 100" toggle; readouts for draw calls/triangles. Dev tool: plain English UI is fine.
```ts
export class Lab implements System {
  constructor(engine: Engine); start(): Promise<void>; dispose(): void;
  inspect(): LabInternals | null;          // tests / console (lab-probe.ts)
}
// src/gen/lab-probe.ts — window.__pilgrim.lab in ?lab=1:
export interface LabProbe {
  ready(): boolean; recipeIds(): string[]; clipNames(): AnimName[]; expressions(): Expression[];
  select(id: string): void; view(v: 'turntable' | 'lineup'): void; shot(s: 'close' | 'gameplay' | 'wide'): void;
  crowd(on: boolean): void; play(name: AnimName): void; expression(e: Expression): void; talking(on: boolean): void;
  burden(size: number): void; setRepeat(on: boolean): void; turn(angle: number): void; lineupBuilt(): number;
  current(): { id: string; clip: AnimName; overlay: AnimName | null; height: number } | null; poseFinite(): boolean;
  measureRecipe(id: string): RecipeStats;  // offscreen render: draw calls (main mesh / with glow), triangles, build ms
  exercise(id: string): ExerciseResult;    // every clip, expression (mouth check), blinks in 12 s, talking, Burden,
                                           // eyes shut in nap/pray, planted-foot slide per gait (lab-footslip.ts)
  measureCrowd(): CrowdStats | null;       // colour calls and the measured cost with the shadow pass
}
```
Files: `lab-stage` (scene, plinth, meadow), `lab-camera` (OrbitControls + eased shots; `GAMEPLAY_CAMERA` 4.5 m back,
2.2 m up), `lab-cast` (characters + anim state), `lab-lineup` (lineup, crowd), `lab-panel` + `lab-style` (DOM),
`lab-recipe` (editing helpers), `lab-readouts`, `lab-probe`, `lab-footslip`. The stage owns a BlobShadows that the
turntable character, the lineup and the crowd join.

## World assembly (Phase 1) — `src/world/`

```ts
// src/world/LevelLoader.ts
export function loadLevel(id: string): Promise<LevelData>;     // 'test', 'epilogue', 'chNN' or '1'..'13'; lazy chunk per level
export function buildWorld(level: LevelData, quality: QualityPreset, onProgress: (p: number) => void): Promise<World>;
export function levelFileId(id: string): string; export function levelIds(): string[];
export { placeProps } from './placeProps';   // + types Ground, PathLike, PlacedProps, PropPlacement
// src/world/World.ts
export interface World {
  scene: THREE.Scene; level: LevelData; palette: Palette; terrain: Terrain; ways: { main: Way; detours: Way[] };
  colliders: Collider[]; particles: Particles; npcs: Map<string, Character>;
  update(dt: number, camera: THREE.Camera): void; dispose(): void; buildMs: number;   // wall clock
  readonly buildWorkMs: number; readonly sky: Sky; readonly sun: THREE.DirectionalLight; readonly hemi: THREE.HemisphereLight;
  readonly promises: PromiseMarkers; setShadowFocus(p: THREE.Vector3): void; wayById(id: string): Way | null;
  readonly blobs: BlobShadows;   // every NPC followed; the player / walkers / crowds added later call follow / addCrowd
}
// Also WorldImpl, WorldParts, disposeSceneGraph, runDisposers, isSharedMaterial ('shared:' name prefix), clearScene.
// src/world/placeProps.ts
export function placeProps(items: PropPlacement[], pal: Palette, ground: { heightAt(x: number, z: number): number },
  y: Yielder, opts?: { name?: string }): Promise<{ object: THREE.Group; colliders: Collider[]; placed: number; dispose(): void }>;
// PropPlacement = { kind: 'point', type, rng, x, z, rotY, lift?, scale?, params? }
//              | { kind: 'path', type, rng, path, from, to, offset?, both?, spacing?, align?: 'along' | 'face', rotY?, lift?, scale?, params? }
// src/world/PromiseMarkers.ts — one InstancedMesh (mat 'glow') of floating scrolls
export class PromiseMarkers { constructor(entries: { id: string; pos: THREE.Vector3 }[], pal: Palette);
  readonly mesh: THREE.InstancedMesh; readonly ids: readonly string[]; readonly count: number;
  setCollected(id: string, on: boolean): void; isCollected(id: string): boolean; positionOf(id: string, out: THREE.Vector3): THREE.Vector3 | null;
  update(time: number, dt: number, camPos: THREE.Vector3 | null, particles: Particles | null): void; dispose(): void; }
// src/ui/Loading.ts — GDD 2.14 loading screen (en.json keys)
export class Loading { constructor(parent?: HTMLElement); readonly visible: boolean;
  show(info: { title: string; kicker?: string; seed?: number }): void; setProgress(p: number): void;
  showError(text: string): void; hide(): Promise<void>; dispose(): void; }
export function chapterLoadingInfo(id: string): LoadingInfo;
// src/world/TestWorld.ts (?chapter=test) + TestCamera.ts (follow / orbit / overview, keys 1-3)
export class TestWorld { constructor(engine: Engine); start(): Promise<void>; dispose(): void;
  readonly camera: THREE.PerspectiveCamera; readonly current: World | null; readonly ready: boolean;
  readonly play: PlaySession | null;       // Phase 2: the session that plays the level (current = play.world)
  readonly progressLog: number[];          // every loading-bar value of the last build (tests)
  readonly cameraMode: TestCameraMode; setCameraMode(m: TestCameraMode): void; rebuild(): Promise<void>; }
```
- `buildWorld` order: atmosphere + sky, Ways, terrain, ribbons, scatter, landmarks + waystones (merged per 160 m
  area: ≤ 4 lit meshes + 1 glow mesh on a 300 m map), water, particles (seeded from the level), NPCs (+ their blob
  shadows, BlobShadows on the terrain, room for 32 more), promises.
  One 8 ms Yielder; progress weights scene 3, ways 1, terrain 38, paths 6, scatter 24, landmarks 12, water 3,
  particles 1, npcs 9, promises 3; progress only moves forward. A failed build frees what it made.
- `World.dispose()` runs module disposers newest first, then sweeps the scene graph (geometry, non-shared materials
  and textures, instance buffers, bone textures, shadow maps). Shared `shared:*` materials are never freed.
- Shaders are precompiled behind the loading screen with `precompile()` (`src/core/compile.ts`, also used by the
  quality benchmark): `compileAsync` where the GPU has KHR_parallel_shader_compile, `compile()` otherwise, so
  software GL (SwiftShader, CI) logs no three.js warning.
- NPCs beyond `quality.drawDistance` are hidden (mesh + glowMesh) and not animated. Landmarks/waystones without
  `rotY` face the nearest Way; NPCs without `at` wait near the Way's start, alternating sides.

## Session state (shared by Phase 2 and 3) — `src/core/GameState.ts` (WRITTEN), `src/core/CameraRig.ts` (WRITTEN)

`GameState` wraps the GDD 2.15 `SaveData` and is the 'state' service (`createGameState(save?)`). Mutate only through
its methods so events fire: `setHope/addHope` (→ `hope:changed`), `setBurden` (→ `burden:changed`), `giveRoll/
loseRoll/findRoll` (→ `roll:changed`), `give/take` (→ `item:given/taken`), `giveGift(id, quiet?)` (→ `gift:given` +
`hud:toast ui.toast.gift.<id>` unless quiet), `collectPromise` (→ `promise:collected`), `readPromise` (+15 once per
chapter → `promise:read`), `enterDetour` (→ `detour:entered`), `setFlag` (→ `flag:changed`), `meet(recipeId)`
(→ `friend:met`; FRIENDS MET), `setObjective(key|null)` (→ `objective:changed`; history for THE ROLL),
`setChapter` (resets Promise reads → `chapter:changed`), `setWaystone`, `setPlayerName`, `unlock`
(→ `achievement:unlocked`), `tickPlaytime(dt)`, `snapshot()` for `Save.write`, `reset(save?)`.
Constants: `GIFT_IDS`, `PROMISE_TOTAL` 24, `HOPE_WAYSTONE_FLOOR` 60, `PROMISE_READ_HOPE` 15.
HUD request events (declared there): `hud:toast {key, params?}`, `hud:chapterCard {chapter}`, `hud:visible {on}`.

`CameraRig` ('cameraRig' service, implemented by the Phase 2 follow camera): `suspend()`, `resume(blend?)`,
`suspended`, `focus(out)`. Cutscenes/dialogue cuts suspend it and drive `engine.camera` directly.

## Gameplay (Phase 2) — `src/player/`, `src/world/`, `src/narrative/`, `src/ui/`

Everything below is built for a level by `PlaySession` (last block) and runs in its loop slots (`PLAY_ORDER`).
Services registered by Phase 2: `player`, `cameraRig` (the FollowCamera), `burden`, `zones`, `slough`,
`interactables`, `waystones`, `hud`. All are unregistered on dispose (only if they are still the registered one).

### Collision and the kinematic controller (GDD 2.15) — `src/world/Collision.ts` (+ `collision-*.ts`), `src/player/Controller.ts`
```ts
export type SurfaceKind = 'dirt' | 'stone' | 'mud' | 'wood' | 'grass' | 'water';
export interface CollisionSource { terrain: GroundField; colliders: readonly Collider[];
  level: Pick<LevelData, 'zones' | 'water'>; ways: { main: Way; detours: readonly Way[] } }   // a World satisfies it
export interface GroundHit { y: number; nx: number; ny: number; nz: number; steep: boolean; handle: number /* -1 terrain */ }
export interface LedgeHit { top: number; at: THREE.Vector3 }
export class CollisionWorld {
  constructor(world: CollisionSource);              // terrain + world.colliders, ~8 m uniform grid broadphase
  stepUp: number;                                   // 0.3 default for groundAt / resolve
  slopeLimit: number;                               // degrees (the controller sets it from MoveParams)
  readonly size: number; readonly colliderCount: number;
  readonly contactCount: number; readonly contactNx: Float64Array; readonly contactNz: Float64Array;
  readonly contactHandle: Int32Array;               // filled by resolve()
  groundAt(x: number, z: number, fromY?: number): number;   // terrain or the highest walkable top <= fromY + stepUp (any height without fromY)
  probeGround(x: number, z: number, fromY: number, stepUp: number, footRadius: number, out: GroundHit): GroundHit;  // a floor's top also when fromY is inside it
  ceilingAbove(x: number, z: number, headY: number, radius: number): number;   // Infinity = open sky
  addCollider(c: Collider, opts?: { walkable?: boolean /* false */; tag?: string; floor?: boolean /* false */ }): number;  // handle (never reused), -1 after dispose
                                                    // floor: a floor only (mud surfaces): holds up anything over it or sunk into it, never a wall or a ledge
  removeCollider(handle: number): void; setEnabled(handle: number, on: boolean): void;
  resolve(pos: THREE.Vector3, radius: number, height: number, stepUp?: number): boolean;  // capsule push-out (feet at pos.y), in place
  overlaps(x: number, feetY: number, z: number, radius: number, height: number, stepUp?: number): boolean;
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): number | null;   // terrain + colliders; shapes holding the origin are ignored
  surfaceAt(x: number, z: number, y?: number): SurfaceKind;   // tagged/walkable top under the feet → water/mud areas → mud/water zones (or a zone's `surface`) → Way band 'dirt' → 'grass'
  ledgeAhead(pos: THREE.Vector3, forward: THREE.Vector3, radius: number, height?: number): LedgeHit | null;  // walkable collider top 0.6-1.8 m up (not a floor); scratch result
  dispose(): void;
}
export function makeGroundHit(): GroundHit;

export interface MoveParams { walkSpeed: number; runSpeed: number; jumpHeight: number; gravity: number /* sign ignored */;
  accel: number; airControl: number; slopeLimit: number /* 40° */; stepUp: number /* 0.3 */ }
export interface StepResult { jumped: boolean; landed: boolean; landSpeed: number; grounded: boolean; blocked: boolean }
export const DEFAULT_MOVE_PARAMS: Readonly<MoveParams>;   // free: 3.4 / 6 / 1.1 m, g 24, accel 30, air 0.5
export const COYOTE_TIME = 0.1; export const JUMP_BUFFER = 0.1;
export class KinematicController {
  constructor(col: CollisionWorld, radius?: number /* 0.35 */, height?: number /* 1.5 */);
  readonly position: THREE.Vector3;  // feet
  readonly velocity: THREE.Vector3; readonly groundNormal: THREE.Vector3;
  readonly grounded: boolean; readonly sliding: boolean; readonly groundHandle: number; readonly airTime: number;
  readonly stepOffset: number;       // visual-only eased height offset after a step up/down (the Player adds it when drawing)
  step(dt: number, wish: { x: number; z: number } /* m/s */, jump: boolean /* rising edge counts */, p: MoveParams): StepResult;  // reused result
  teleport(p: THREE.Vector3): void;  // exact feet; snaps to ground within 5 cm below
  launch(vy: number): void;
  cancelJump(): void;                // forgets a buffered jump press (the Player calls it when leaving 'play')
}
```
- World colliders are walkable on top except upright cylinders taller than 2.2 m (trunks, posts); added colliders
  default to not walkable. A walkable top within `stepUp` of the feet is a step, not a wall; in the air, within
  0.05 m of the feet or below where the feet were when the sub-step began (they crossed it: a landing).
- Steep ground (> slopeLimit) blocks walking and jumping into it and slides you down at 3 m/s. Ground snapping
  downhill, sub-steps of at most half a radius (no tunnelling), exact jump parabola (apex = jumpHeight), exact
  touchdown speed, map edge 0.5 m inside the terrain. Deterministic for a fixed dt; nothing allocates per step.

### Player — `src/player/Player.ts` (+ `player-anim/-move/-air/-ledge/-outfit/-debug.ts`, `Bonk.ts`, `Footsteps.ts`), service 'player'
```ts
export type PlayerMode = 'play' | 'locked' | 'cutscene';   // locked: no input, physics on; cutscene: scripts own the root
export class Player {
  constructor(o: { world: World; col: CollisionWorld; state: GameState; recipe: string; spawn: THREE.Vector3; facing: number });
  readonly character: Character;          // getter: setRecipe() replaces it ('player:recipe' {id})
  readonly controller: KinematicController; readonly bonks: Bonk;
  readonly renderPosition: THREE.Vector3; // interpolated feet; the camera follows it (stepOffset eases the drawn body only)
  readonly forward: THREE.Vector3; readonly facing: number /* yaw */; readonly speed: number;
  readonly isGrounded: boolean; readonly climbing: boolean; readonly animName: string;
  mode: PlayerMode;                       // leaving 'cutscene' takes the root's position as the new feet; leaving 'play' drops a buffered jump
  speedScale: number;                     // the Slough (0.5) and the Cross (slows to 0) write it
  walkOnly: boolean;                      // scripts slowing him to a stop (the Cross): the stick walks; jump, climbs and USE do nothing
  aim: { x: number; z: number } | null;   // unit XZ direction he turns to face instead of his motion (Combat: the foe)
  setRecipe(id: string): void;            // sparkle outfit swap, same clip and pose
  teleport(p: THREE.Vector3, facing?: number): void;   // no streak; safe spots restart here
  bonk(reason: BonkReason): boolean;
  update(dt: number): void; render(alpha: number): void; dispose(): void;
}
```
- Camera-relative movement from `engine.camera`; run only when the move params allow it (never burdened); jump on
  `pressed('jump')`. Speeds come from the 'burden' service × `speedScale`. Starts as `christian_burdened` while
  `GameState.burden`, else `christian_free`; dropping the Burden keeps the clothes but switches to the free walk
  style at once (`GaitStyle`); the Ch VI script calls `setRecipe('christian_free')` for the white clothes.
- Ledge climbs (`player-ledge.ts`): a 'Climb' interactable (`action: 'jump'`, priority -1) while facing a ledge
  0.6-1.8 m up (1.3 m burdened); Space / A / JUMP (or USE) climbs.
- Animation (`player-anim.ts`): idle/walk/run/burdenedWalk with hysteresis, jump clips time-warped to the physics,
  'land' on hard landings, held clips for bonks and climbs; clips other systems start (pray, kneel, sit) are left
  alone until they end or the player pushes the stick.
- `Bonk.ts` (GDD 2.7.3): safe spot every 0.5 s on the main Way's band outside hazards (8 kept; pop back to the
  newest ≥ 2.5 m away). `bonk(reason)`: dust, 0.2 s hidden, pop back + camera snap, sit dazed with stars ringing
  the top of his head (they follow it, `EmitOptions.follow`, `render()` per frame), Hope -5, toast
  `ui.toast.bonk`, input locked 1.2 s. Triggers: 'zone:hazard', standing in a hazard, falling 3 m under the
  terrain, leaving the map. `enabled = false` (god mode) keeps only 'fall'. `handOverLock(): boolean` gives the
  bonk's input lock to someone else (I SHALL ARISE when the bonk emptied Hope): the bonk then never unlocks.
- `Footsteps.ts`: `step_<surface>` sfx per animator foot plant from `CollisionWorld.surfaceAt`.
- Events: `player:landed {speed, hard}`, `player:jump {joy}`, `player:recipe {id}`, `player:bonk {reason: BonkReason}`.

### Follow camera — `src/player/Camera.ts` (+ `camera-*.ts`), implements CameraRig ('cameraRig')
```ts
export class FollowCamera implements CameraRig {
  constructor(camera: THREE.PerspectiveCamera, player: CameraTarget, col: CameraCollision);  // structural types (camera-types.ts)
  update(dt: number): void;                       // fixed step: steering, auto-camera, feel, spring arm
  render(alpha: number, frameDt: number): void;   // after Player.render, before the Engine draws
  snap(): void; dispose(): void;
  readonly suspended: boolean; suspend(): void; resume(blend?: number /* 0.6 */): void; focus(out: THREE.Vector3): THREE.Vector3;
  readonly yaw: number; bump(strength: number): void; debugLine(): string;
}
```
- GDD 2.5: 4.5 m behind, 2.2 m above the feet (2.0 burdened), looking at 1.05 m (1.4 burdened), orbit pivot at the
  head (1.3 m), pitch -0.3..0.9 rad, FOV from Settings (+4° running free). Burdened: the rig slides sideways
  (1.0 m × sack size, × clamp((aspect / 1.6)², 0, 1) on narrow screens) so the head shows beside the sack, a slow
  ±0.1 m sway and small heavy-step thuds (none with Reduce camera motion).
- Auto-camera ('default' = on for touch, and for keyboard/mouse until `input.mouseLooks`: keyboard-only players
  have no look keys): swings behind the heading while walking, pauses 1.5 s after look input, never while walking
  at the camera. Spring arm: rays from the pivot (centre, left, right, below, above) keep 0.3 m clear, pull in
  fast, ease out after 0.4 s; close in it rises and looks over the head. Teleports over 3 m snap. The camera
  follows `renderPosition` with its own height smoothing (steps up and down rise and fall with no dip or pop).
- `resume(blend)` snaps the rig behind the player and eases from the cutscene's camera by orbiting the player's
  head (angle, distance and height eased separately), kept in front of colliders: never through Christian.

### Burden and the Cross — `src/player/Burden.ts` ('burden'), `src/player/CrossDrop.ts` (+ `cross-*.ts`)
```ts
export const FREE_MOVE: Readonly<MoveParams>;      // 3.4 / 6 / 1.1 m, g 24, accel 30, air 0.5
export const BURDENED_MOVE: Readonly<MoveParams>;  // 2.0, no run, 0.3 m hop, g 28, accel 7, air 0.3
export const BURDEN_MAX = 1.6; export const BURDEN_SIZE_FLAG = 'burden.size'; export const JOY_JUMPS = 3;
export class BurdenSystem {
  constructor(player: BurdenPlayer, state: GameState, world?: World | null);   // BurdenPlayer: structural (cross-types.ts)
  params(): MoveParams;       // one reused object; bigger sack walks slower (1.6 m/s at 1.6)
  readonly size: number;      // 0 free, 1 normal, up to 1.6 (kept in GameState flag 'burden.size')
  grow(amount: number): void; // "boing": sfx, dust, sack spring, camera bump; ruts from size 1.1
  readonly joyJumpsLeft: number; consumeJoyJump(): boolean;   // the Player calls it on take-off
  readonly isDropping: boolean; beginDrop(): void; completeDrop(): void;   // CrossDrop only
  update(dt: number): void; dispose(): void;
}
export interface CrossDropContext { player: BurdenPlayer; world: World; burden: BurdenSystem; state: GameState;
  tomb: THREE.Vector3; skip?: () => boolean;
  signal?: AbortSignal }   // the owner going away: stop at once, NO end state (no music, events, state change, camera hand-back)
export function runCrossDrop(ctx: CrossDropContext): Promise<void>;   // no-op when not burdened
```
- The sequence (GDD 2.7.1, ~13 s, a loop system at `PLAY_ORDER.cameraOverride`, pauses with the game): input
  slows to a stop (`walkOnly`: no hops or climbs), 'music:silence', HUD hidden → 'locked' until his feet are on
  the ground, then 'cutscene' → kneel (side view with the cross he faces in frame) → look up → three rope snaps
  0.75 s apart (rising pitch) → the sack (the character's own sack triangles) falls, bounces twice down the terrain
  into the tomb's mouth → 'tomb_thoom' → 1.5 s of silence (the camera comes back to him inside it) →
  `music:play pilgrim joy`, `state.setBurden(false)`, 'burden:dropped' → big stretch → joy leap → control returns
  with three joy jumps. `skip()` (hold Space / A / JUMP 1 s) jumps to the end state; `signal` aborting (the
  PlaySession owns the run and aborts it on dispose) stops it with no end state.
- Camera (`cross-camera.ts`, `cross-shots.ts`, `cross-occlusion.ts`): `CrossCamera.to({ pos, look, fov }, s)` eases
  on a rail orbiting his chest (angle the short way, distance, height; at most ~65°/s on average, so a long swing
  takes longer than asked) with the view travelling from the old subject to the new one through him, and the FOV
  eased (widening leads the move). Shots: kneel → over his shoulder from the side away from the tomb (he and the
  tomb in depth; on portrait screens the swing starts during the rope snaps) while the view follows the sack and
  pushes in on the tomb's mouth (a narrower FOV) → return in front of him. A 2 m keep-out round his chest; the
  collider pull-in is kept as an amount short of the shot and reset per shot.
- Events: `burden:grew {size, amount}`, `burden:joyJump {n, left}`.

### Hope — `src/player/Hope.ts`, `src/gen/fx/WorldFX.ts`, `src/ui/Arise.ts`
```ts
export const HOPE_LOW = 30; export const HOPE_RECOVER = 40; export const ALONE_EXTRA = 0.5;
export function saturationForHope(hope: number): number;   // 1 from 30 up, 0.35 at 0
export class HopeSystem {
  constructor(state: GameState, world: World, opts?: { position?: (out: THREE.Vector3) => THREE.Vector3 | null });
  enabled: boolean; readonly drainPerSecond: number; readonly lowHope: boolean; readonly arisePending: boolean;
  update(dt: number): void; dispose(): void;
}
// WorldFX: shared uniforms for every world shader (lit materials patched once, sky, clouds, water, particles)
export const fxUniforms: { uDesaturation; uLanternPos; uLanternRadius; uLanternOn; uLanternColor };
export const WORLD_FX_PARS: string;   // GLSL worldFxGrade(c), worldFx(c, worldPos): after fog, on the final colour
export function patchWorldFx(m: THREE.Material): void; export function bindWorldFx(m: THREE.ShaderMaterial): boolean;
export function applyWorldFx(root: THREE.Object3D): number; export const SATURATION_LOW = 0.35;
export const worldFx: { saturation; targetSaturation; setSaturation(v, immediate?); setLantern(on, pos?, radius?, colorHex?); update(dt); reset() };
// Arise
export function runArise(opts: { respawn: () => void; parent?: HTMLElement }): Promise<void>;  // sets Hope >= 60 after respawn
export function cancelArise(): void; export function isArising(): boolean;
export const ARISE_TIMING = { fadeIn: 0.9, textIn: 0.8, hold: 3, fadeOut: 1 };
```
- Drain: the strongest overlapping zone with `hopeDrain` (Hope/s; optional `aloneDrain`, else half extra while
  flag `alone`; the Helmet halves 'shadow' zones), in 0.5 steps. None while the cameraRig is suspended, during an
  arise, with ?god=1 or `enabled = false`. Below 30: the world eases to grey (the 'glow' material keeps its warmth)
  and 'music:state' sad; above 40 back to calm. Hope 0: `player:arise` once (after any cutscene).
- Events: `player:arise` (void), `hope:low {low}`.

### Zones, the Slough, interactables, waystones, Promises
```ts
// src/world/Zones.ts — service 'zones'
export class Zones { constructor(world: ZoneWorld, target?: ZoneTarget | null);   // Player, controller or {position}
  enabled: boolean; setTarget(t): void; readonly active: readonly ActiveZone[]; inZone(type): boolean; inZoneId(id): boolean;
  zoneOf(type): ActiveZone | null; hopeDrain(): number; isTypeAt(type, x, z): boolean; update(dt): void; clear(): void; dispose(): void }
export const HAZARD_ZONE_TYPES = ['pit', 'ditch', 'bogHole', 'hazard'];
// src/world/Slough.ts (+ slough-steps.ts, slough-stone.ts) — service 'slough'
export class Slough { constructor(o: { world: SloughWorld; col: ColliderHost; player: PlayerLike; zones?: Zones });
  autoReveal: boolean; readonly depth: number; readonly sinking: boolean; readonly onStone: boolean;
  readonly stepSets: string[]; isRevealed(id): boolean; reveal(id?: string): void;
  update(dt): void; render(alpha, frameDt): void; dispose(): void }
export const SINK_MAX = 0.55; export function stepsFlag(id: string): string;   // GameState flag 'steps.<id>'
// src/world/Interactables.ts — service 'interactables'
export interface Interactable { id: string; pos: THREE.Vector3; radius: number; verb: string /* i18n key */; enabled: boolean;
  height?: number; holdSeconds?: number; priority?: number; action?: 'use' | 'jump' /* bubble button, default 'use' */; onUse(): void }
export class Interactables { constructor(player: PlayerLike, input?: UseInput | null);
  add(i: Interactable): () => void; readonly focused: Interactable | null; readonly holdProgress: number;
  get(id): Interactable | null; useFocused(): boolean; update(dt): void; dispose(): void }
// src/narrative/Waystones.ts — service 'waystones'
export class Waystones { constructor(o: { world; player: PlayerLike; interactables?; state?; save? });
  lastWaystone(): WaystoneSpot | null; spot(id): WaystoneSpot | null; readonly ids: string[]; read(id): void; update(dt): void; dispose(): void }
export interface WaystoneSpot { id: string; pos: THREE.Vector3 /* 1.4 m in front of the stone */; facing: number }
// src/narrative/Promises.ts
export class Promises { constructor(o: { world: PromiseWorld; player; state? }); collect(id): boolean; update(dt): void; dispose(): void }
```
- Zones: circle / box (rotY) / 'way' band, the terrain painter's geometry; entered at the outline, left 0.35 m past
  it. `zone:enter` / `zone:exit` {id, type}; `zone:hazard` {id, type} once per visit when grounded inside a hazard.
- Slough: in a 'slough' zone (not on a stone) speedScale eases to 0.5; walking sinks 0.09 m/s, running (or holding
  run) 0.3 m/s, to 0.55 m (the root bone is lowered); standing still 2 s or 'promise:read' raises the nearest
  hidden 'steps' set in a ripple; risen stones are walkable 'stone' colliders and give full speed back.
  `slough:steps {id}`. The player walks ON `level.water` mud surfaces: Slough adds a floor-only collider (no wall,
  no ledge; feet sunk into it come up onto it) and warns when the ground at a mud body's edge lies more than 0.3 m
  under its surface (content: the terrain is generated, so validate-levels cannot see it).
- Interactables: nearest enabled thing in reach and in front (priority first, hysteresis); press `use` (or hold
  `holdSeconds`); nothing while `player.mode !== 'play'`. Events `interact:focus {id|null}`, `interact:use {id}`,
  `interact:hold {id, progress}` (reused payload). Nothing either while `player.walkOnly`.
- Waystones: verb `ui.verb.read` before the Roll, `ui.verb.readRoll` after; read = overlay, sounds, sparkle,
  `setWaystone`, Hope ≥ 60, autosave, toast, `waystone:read`; while the Roll is lost only `ui.toast.needRoll`.
- Promises: walk within 1.1 m at about the scroll's height: collect, chime, sparkle, toast `ui.toast.promise`.

### Guide — `src/world/Guide.ts` (service 'guide'), `src/ui/hud-guide.ts`
```ts
export type GuideTarget = THREE.Vector3 | (() => THREE.Vector3 | null);
export class Guide { constructor(o: { way: Way; player: { renderPosition } }); set(t: GuideTarget | null): void; clear(): void;
  readonly custom: boolean; update(dt): void; sample(): GuideSample /* {target, player, custom, idle, offWay, distance}; reused */; dispose(): void }
export const GUIDE_AHEAD_M = 14; export const OFF_WAY_M = 4;   // event 'guide:changed' {custom}
```
- Default target: the main Way 14 m ahead of the player (4 m ahead of the nearest point when off the Way); none past
  the Way's end. Chapters aim it with `ctx.guide(...)`; the context clears it on dispose.
- The HUD draws it (`GuideMarker`, hud-guide.css): a bobbing golden chevron 1.9 m over the goal when on screen, an
  arrow on the safe-area edge turned towards it when not. A chapter goal always shows until within 2.5 m; the
  default shows the edge arrow whenever the Way ahead is off screen and the chevron only after 5 s standing still
  or off the Way.

### HUD — `src/ui/HUD.ts` (+ `hud-*.ts`, `hud.css`), service 'hud'
```ts
export class HUD { constructor(parent?: HTMLElement);   // default #ui
  readonly root: HTMLDivElement; readonly visible: boolean; readonly hope: number;
  update(dt: number): void;              // fixed step: timers, focus, hold, Hope sync
  render(camera: THREE.Camera): void;    // per frame: projects the interaction bubble
  setHearts(n: number | null, max?: number /* 5 */): void; previewHope(v: number): void; dispose(): void }
```
- Objective top-left (fades after 6 s; again for 3 s on `satchel:closed`), Hope lantern bottom-left (no numbers),
  hearts under it, interaction bubble over the focused interactable with the current device's glyph
  (`input.glyph(interactable.action ?? 'use')`), toasts top-centre one at a time, chapter card 3.5 s.
  `hud:visible {on}` hides all but the chapter card. Passive to pointer input (z-index under the touch controls);
  on touch the bubble dodges the round buttons and corner icons. No letterbox (Phase 3's Cutscene owns it).
- Declares `satchel:closed` (void). Reads the 'interactables' service through `hud-focus.ts` (type-only import).

### Play session — `src/world/PlaySession.ts` (+ `play-*.ts`)
```ts
export const PLAY_ORDER = { input: 100, zones: 110, interact: 120, camera: 130, cameraOverride: 135, world: 140 };
export interface PlaySessionOptions { state?: GameState; waystone?: string; onProgress?: (p: number) => void;
  camera?: THREE.PerspectiveCamera; loading?: LoadingInfo; signal?: AbortSignal }
export class PlaySession {
  static start(engine: Engine, levelId: string, opts?: PlaySessionOptions): Promise<PlaySession>;  // rejects on build failure / AbortError
  readonly world: World; readonly col: CollisionWorld; readonly player: Player; readonly camera: FollowCamera;
  readonly state: GameState; readonly view: THREE.PerspectiveCamera; readonly levelId: string;
  readonly burden: BurdenSystem; readonly hope: HopeSystem; readonly zones: Zones; readonly slough: Slough;
  readonly interactables: Interactables; readonly waystones: Waystones; readonly promises: Promises;
  readonly pits: PitMarks; readonly gifts: PlayGifts /* .combat, .prayer */; hud: HUD | null;
  god: boolean;                                   // no Hope drain, no bonks (?god=1, F1)
  respawn(waystone: string | null): void;         // in front of a waystone facing along the Way, else the Way's start
  setBurden(on: boolean): void; teleport(x: number, z: number, facing?: number): void;
  spawn(): { x: number; z: number; facing: number };
  goToCross(): boolean; crossDrop(): Promise<void>;   // debug / tests: the full Cross sequence at the level's tomb
  readonly isDisposed: boolean; dispose(): void;
}
```
- start(): loading screen → `buildWorld` (gameplay-only landmarks 'pit' / 'steps' are kept out of the prop build
  and put back, `play-pits.ts`) → state ('state' service or a new one) → CollisionWorld, PitMarks, Player,
  FollowCamera, BurdenSystem, HopeSystem, Zones, Slough, Interactables, PlayGifts (Combat + Prayer), Waystones,
  Promises → spawn at `opts.waystone` / the state's waystone / the Way's start → shader precompile → show: HUD,
  gameplay input, touch buttons (`gifts.show()`: jump, use; + pray with the Prayer gift; + sword / shield while
  combat is active), the level's ambience and music.
- Loop: player (100) → zones, Slough, Hope, Burden (110) → gifts (Prayer, Combat; the prayer ring per frame),
  interactables, waystones, Promises (120) → camera (130)
  → fly cameras / the Cross (135) → HUD timers, playtime, and per frame shadow focus + `world.update` + HUD bubble
  (140). `player:arise` → lock (taking over a running bonk's lock), `runArise`, respawn at the last waystone,
  unlock. dispose() frees newest-first (a running Cross is aborted first: nothing of it outlives the session) and
  leaves the engine on an empty scene.
- F1 (play-debug.ts): Burden, Go to the Cross, Cross drop now, God mode, Show colliders / Way, go to each waystone;
  the systems add their own (Grow, Hope slider, Hope 0, Alone, Reveal steps, Show zones, HUD tests, camera tuning).

### Combat, Prayer and Hearts (Phase 5) — `src/player/Combat.ts`, `src/player/Prayer.ts`, `src/player/Hearts.ts`, `src/world/play-gifts.ts`
```ts
export const COMBAT_ZONE_TYPES = ['arena', 'shadows'];   // level zone types where the Sword and Shield work
export interface CombatTarget { pos(out: THREE.Vector3): THREE.Vector3; radius: number; hittable(): boolean;
  onHit(from: THREE.Vector3): void }
export class Combat {                                  // service 'combat'; one per session (PlaySession.gifts.combat)
  engaged: boolean;                                    // scripts keep combat on anywhere (the Apollyon fight)
  readonly active: boolean; readonly shieldUp: boolean; readonly swinging: boolean;
  addTarget(t: CombatTarget): () => void;
  block(from: THREE.Vector3): 'none' | 'block' | 'perfect';   // attackers ask when a hit lands; plays clang / ring
  swing(): boolean; holdShield(on: boolean | null): void;     // scripts / tests (null = input decides)
  update(dt: number): void; dispose(): void;
}
export const PRAYER = { cooldown: 15, radius: 6, hope: 20, fleeSeconds: 8, lightAhead: 25, lightSeconds: 10 };
export class Prayer {                                  // service 'prayer'
  readonly ready: boolean; readonly cooldownLeft: number;
  pray(): boolean; resetCooldown(): void; update(dt): void; render(frameDt): void; dispose(): void;
}
export function hitCost(state, difficulty: 'easy' | 'normal'): number;   // 1, ×0.5 Breastplate, ×0.5 Easy
export class Hearts { constructor(view: () => { setHearts(n, max?) } | null, max = 5);
  readonly value: number; readonly visible: boolean; show(); hide(); fill(); damage(n): number; dispose() }
export class PlayGifts { readonly combat: Combat; readonly prayer: Prayer; show(): void; buttons(): TouchButton[];
  update(dt): void; render(frameDt): void; dispose(): void }
```
- Combat (GDD 2.6, 2.7.6 #1-#2): active with the gift in a combat zone or while `engaged` (`combat:active` {on}).
  Sword (LMB / RT / SWORD): the 'swing' overlay, whoosh, a sparkle trail; at 0.15 s every hittable target within
  1.9 m + its radius and ±80° in front gets `onHit` (`combat:swing` {hits}), one swing per 0.42 s. Shield (RMB /
  LT / SHIELD held): the 'block' overlay; `block(from)` stops anything within ±75° in front, perfect when raised
  within 0.3 s (0.5 s on Easy) of the hit (`combat:block` {perfect}). Shield up or mid-swing, he turns to the
  nearest target within 10 m (`Player.aim`).
- Prayer (GDD 2.7.6 #6, Q / Y / PRAY, any chapter once given): the 'pray' clip (moving cancels it), +20 Hope, a 6 m
  golden ring (one mesh, own material), motes along the next 25 m of the main Way for 10 s, `prayer:burst`
  {x, y, z, radius}; then 15 s of rest. Not while `player.mode !== 'play'`.
- Hearts (GDD 2.7.7): quarter-heart values, shown rounded up to the half heart on HUD.setHearts;
  `hearts:changed` {value, max}, `hearts:empty` once per emptying (re-armed by `fill()`).
- Touch buttons: PlayGifts owns `input.setTouchButtons` during play and re-applies it after story beats.
- F1 "Gifts": give all gifts, pray now, readout (prayer rest, combat on, shield).

### Apollyon and the Shadows (Phase 5) — `src/npc/Apollyon.ts` (+ `apollyon-*.ts`), `src/npc/Shadow.ts` (+ `shadow-mesh.ts`)
```ts
export type ApollyonPhase = 'paws' | 'darts' | 'fall' | 'done';
export class ApollyonFight {                           // service 'apollyon' (tests: probe(), skipTo())
  constructor(o: { engine; session: PlaySession; npc: NPC; combat: Combat; hearts: Hearts; arena: Arena });
  run(): Promise<void>;          // Phase 1 → 3; resolves when Christian reaches his sword
  flyAway(): Promise<void>;      // he flaps off in smoke and is hidden
  skipTo(phase: 'paws' | 'darts' | 'fall'): void;
  probe(): { phase; sub; hits; bounced; darts; dartDist };
  dispose(): void;
}
export class Arena { constructor(zone: LevelZone /* type 'arena', box */); start(out); home(out);
  landing(from, dist, out); readonly facing: number; contains(x, z, margin?); clamp(p, inset?) }
export class Shadows {                                 // service 'shadows' (tests: probe(), summon(i))
  constructor(o: { engine; session; combat: Combat | null; zones: LevelZone[] /* type 'shadows' */; seed });
  readonly count: number; setActive(on: boolean): void; dispose(): void;
}
```
- The fight (GDD 2.9) is a fixed-step state machine on its own loop systems (update at NPC_ORDER + 2, pose and glows
  after the World draws at PLAY_ORDER.world + 2). Phases in `apollyon-phases.ts` (paws: approach → telegraph (paw
  glow + red ground ring, 0.8 s / 1.6 s Easy) → slam → blocked: 'open' belly 2 s; darts: takeoff → hover (belly
  brightens) → volley of 3, 0.7 s apart, at 6 m/s (4.5 on Easy), from 6.5 m away → rest; 3 bounced darts → knocked → 'down' 4 s) and `apollyon-fall.ts` (swoop → throw
  in slow motion, the sword (`apollyon-sword.ts`) lands 4 m off → "[E] Reach for the sword", 5 s with Timed
  prompts). 3 hits per phase. Body language and glows: `apollyon-body.ts`; darts: `apollyon-darts.ts`; the sky
  darkens per phase: `apollyon-sky.ts`. Christian is held inside the arena and outside Apollyon's body. Events
  `apollyon:phase` {phase}, `apollyon:hit` {phase, hits}. `hearts:empty` → I SHALL ARISE → the same phase again.
- Shadows (GDD 2.9, Ch IX): placed along each 'shadows' way zone (`count`, default 4), 2 instanced meshes for the
  swarm. lurk → chase within 11 m; within 3.2 m drain 1.5 Hope/s (Helmet half), within 2.4 m push him toward the
  Way's edge while he walks; after a bonk, shadows within 12 m back off 4 s; `prayer:burst` → flee 8 s
  (`shadow:flee` {count}); a sword hit → scatter 3 s (`shadow:scatter`); never destroyed; `setActive(false)` at dawn.
- `LookShift` (src/gen/fx/LookShift.ts): `new LookShift(world, look, seconds)`, `update(dt)`, `snap()`, `dispose()`
  eases the sky dome colours, the scene fog (colour, near, far) and the sun / sky lights toward a `Look` and restores
  them on dispose. Ch IX's dawn uses it.

New events, all declared in their modules: `zone:enter/exit/hazard`, `player:bonk/landed/jump/recipe/arise`,
`hope:low`, `burden:grew/joyJump`, `slough:steps`, `interact:focus/use/hold`, `satchel:closed`; core ones used:
`waystone:read`, `burden:dropped`, `hope:changed`, `hud:toast/visible/chapterCard`, `sfx`, `music:*`.

## Story and UI (Phase 3) — `src/narrative/`, `src/ui/`, `src/game/`, `content/dialogue/`, `content/promises.json`, `content/friends.json`

Built in the story worktree (Phase 3a); companions and the ChapterManager follow on main. New services:
`dialogue` (DialogueRunner), `bubbles` (SpeechBubbles), `cutscene` (CutscenePlayer), `letterbox` (Letterbox),
`satchel` (SatchelUI), `flow` (GameFlow). Each declares itself by declaration merging and unregisters in `dispose()`
only while it still owns the key.

### Dialogue — `DialogueTypes.ts` (format + protocol), `Dialogue.ts` (runner, re-exports everything)
Helpers: `dialogue-rules.ts` (validateGraph, cond grammar, constants), `dialogue-parse.ts`, `dialogue-registry.ts`
(lazy files), `dialogue-effects.ts`, `dialogue-actors.ts` (faces, gestures, mouths; restored at the end),
`dialogue-voice.ts` (voices, moods, text speed). `tools/validate-dialogue.mjs` runs the same rules in Node (build
and test run it).
```ts
// content/dialogue/<file>.json: an array of graphs. Graph ids start with '<file>_' (play('ch01_x') loads ch01.json);
// the FIRST node is the start; every text is an i18n key that must exist in en.json AND ta.json.
interface DialogueGraph { id: string; nodes: DialogueNode[] }
interface DialogueNode { id; speaker /* NPC id or 'christian' */; text; anim?; expr?: Expression; mood?: Mood;
  bubble?: boolean /* world-space bubble */; next?; choices?: DialogueChoice[] /* max 3 */; effects?; cond? }
interface DialogueChoice { text; next? /* default: the node's next */; effects?; cond? }
interface DialogueEffects { hope?; give? /* 'roll' | 'gift:<id>' (key_promise quietly) | item */; take?; detour?;
  flag?: Record<string, FlagValue | null /* clears */>; anim? /* '<clip>' | '<speaker>:<clip>' */;
  cam? /* shot name; 'release' = back to the follow rig */; sfx?; music?; end? }
// cond: terms joined by '&', each optionally '!': flagKey, flagKey=value, hasRoll, burden, gift:<id>, item:<id>,
// detour:<id>, hope<30 / hope>=60 / chapter>=7. A node whose cond fails jumps to its next (effects skipped).
interface DialogueHost { actor(speaker: string): Character | null; camera?(shot: string, speaker: string): void;
  effect?(e: DialogueEffects, ctx: EffectContext /* {graph, node, speaker, from: 'node'|'choice'} */): void }
class DialogueRunner {                                  // registers 'dialogue' (opts.register !== false)
  constructor(host: DialogueHost, opts?: { register?: boolean; state?: () => GameState | undefined });
  readonly active: boolean; readonly busy: boolean; readonly graphId: string | null;
  readonly phase: 'idle' | 'loading' | 'typing' | 'shown' | 'choosing' | 'busy';
  readonly line: DialogueLine | null; readonly choices: DialogueChoiceView[];
  actor(speaker: string): Character | null;           // the host's lookup (DialoguePanel anchors bubble lines)
  play(graph: DialogueGraph | string): Promise<void>; // queued while another plays; resolves when it ends
  lineDone(): void; advance(): void; skipLine(): void /* Space */; skipScene(): void /* hold Space 1 s */;
  choose(index: number): void; stop(): void; dispose(): void;
}
```
UI protocol (full text in DialogueTypes.ts): `'dialogue:start' {id, speakers}` (+ `'audio:duck' {on: true, by: 'dialogue'}`) →
`'dialogue:line'` `{graph, node, speaker, recipe, key, mood, expr, bubble, voice, cps, hasChoices, index}` → the UI
reveals `t(key)` with `revealTimes(text, cps)` and babbles with `speakLine(line, text, at?)`, calls `lineDone()` when
the text is shown (`'dialogue:choices' {graph, node, speaker, choices: [{index, key}]}` fires inside it), then
`advance()` or `choose(index)`. Also `'dialogue:reveal'`, `'dialogue:lineEnd'`, `'dialogue:chose'`,
`'dialogue:cam'` (only without `host.camera`), then `'audio:duck' {on: false, by: 'dialogue'}` and core
`'dialogue:end' {id}`.
Node effects run on entering the node (a camera cut lands with its line); choice effects after `'dialogue:chose'`.
A skipped scene still applies effects and stops on the next question. The host (ChapterManager / PlaySession) locks
the player, hides the HUD and calls `GameState.meet()` on 'dialogue:start' / 'dialogue:end'.
`TEXT_SPEED_CPS` (dialogue-voice.ts) is the one text-speed table: slow 20, normal 40, instant 0 (whole line; babble
still at 40 cps, a short burst in bubbles and captions); cutscene captions read it through `textCps()` too.
`src/narrative/story-input.ts`: `dialogueHoldsInput()`, `cutsceneHoldsInput()`, `storyHoldsInput()`. A conversation
and a cutscene can overlap; each gives gameplay input back at its end only when the other is not still running.

### Bubbles, panel, portraits, typewriter
```ts
// src/ui/typewriter.ts — every text reveal (panel, bubbles, cutscene captions): grapheme-safe (Tamil), revealTimes clock
typewrite(el, text, opts?: { voice?; mood?; at?; speed?; cps? /* 0 = instant */; lang?; speak?; onProgress? })
  → { skip(); cancel(); done: Promise<void>; finished; duration };
// src/narrative/SpeechBubbles.ts — world-space bubbles over heads (barks, bubble lines); service 'bubbles'
class SpeechBubbles { constructor(camera?: THREE.Camera | null, parent = uiRoot());
  speak(c: Character, key: string, o?: BubbleOptions): BubbleHandle /* {skip(), dismiss(), revealed, closed} */;
  show(c, key, o?): () => void /* dismiss */; update(camera | frameDt | undefined): void /* every frame */;
  clear(); dispose(); readonly count }
// BubbleOptions: mood, durationSec (2 s after the text; Infinity = until dismissed), onDone, params, pile (stack a
// speaker's bubbles, max 6), voice (null = silent), cps, speak, talk (flap the mouth), onRevealed,
// announce (false: no screen-reader span; the DialoguePanel announces its bubble lines itself, with the name)
// src/ui/DialoguePanel.ts — the one conversation UI: bottom panel (portrait, name, text, 1-3 choices) + bubble lines
class DialoguePanel { constructor(runner?: DialogueRunner | null /* default: 'dialogue' service */,
  opts?: { parent?; actor?(speaker): Character | null /* default runner.actor */; restoreGameplay?; touchButtonsAfter? });
  readonly visible: boolean; dispose() }
// src/ui/Portraits.ts — generated portraits (PNG data URLs, LRU 48): portraitUrl(recipe | id, expr?), hasPortrait,
// preloadPortraits(ids), portraitColors(recipe), clearPortraits(), PORTRAIT_SIZE 160. Panel and Satchel share it.
```
Panel input (dialogue-input.ts, a loop System at order -50): Space / E / pad A / tap reveal then advance; hold 1 s
(or the skip ring) = skipScene; choices by 1-3, click / tap, arrows / d-pad + Enter / A (confirm keys arm after
0.45 s). Keyboard focus stays in the layer: Tab / Shift+Tab move the choice highlight (which also follows DOM
focus), Enter confirms the highlighted choice; an Enter remapped to Skip or Use is left to Input. The skip ring
skips at once on an activation without a hold (screen reader click, Enter on it). On touch it sits under GameFlow's
pause icon (top right) and the panel keeps clear of both. Phones on their side (height <= 520 px) put the answers
beside the question. While a conversation is up gameplay input is off (`setGameplayActive(false)`, no touch
buttons); it comes back only in a play session (the 'player' service) unless `restoreGameplay` says otherwise, and
not while a cutscene still plays. Speaker names are `name.<recipeId>` keys (`speakerName()` in dialogue-strings.ts
also tries the id without its outfit suffix).

### Cutscenes — `src/narrative/Cutscene.ts` (+ `cutscene-*.ts`), `src/ui/Letterbox.ts`
```ts
class CutscenePlayer {                                  // service 'cutscene'; adds itself to engine.loop at order 950
  constructor(engine: Engine); play(def: CutsceneDef, ctx?: CutsceneContext): Promise<'done' | 'skipped'>;
  skip(force?); readonly playing; readonly current: string | null; readonly time; dispose() }
interface CutsceneDef { id; skippable? /* true */; duration?; camera?: (CameraTrack | DeferredShot)[];
  actors?: ActorTrack[]; events?: TimedEvent[]; blendOut? /* 0.8 s back to the rig */ }
// CameraTrack {start, end, path: PointSource[], look: PointSource[], ease?, fov?: number | [from, to]}: centripetal
// Catmull-Rom rails by arc length. PointSource: [x,y,z] | Vector3 | () => Vector3 | {actor, at?: feet|chest|head,
// offset?, local?} | 'camera'. DeferredShot {start, end, shot: () => CameraTrack} frames actors where they are then.
// ActorTrack {actor, actions: [{at, do: play|overlay|expression|moveTo|lookAt|face|place|say|show|hide, ...}]}
// TimedEvent {at, essential?, run | sfx | music | emit}: essential events still fire on skip, last.
// CutsceneContext {actors?, ground?, animate?, say?, restoreGameplay? /* true */}
shots.closeUp(c, o?) / shots.overShoulder(listener, speaker, o?) / shots.two(a, b, o?) → CameraTrack  // ~4 s
// ShotOptions {duration, push, fov, side, keepSideOf (180° rule), lift (raise the subject above a bottom panel)};
// overShoulder steps clear of a burdened listener's sack (Character.burdenSize). retime(track, start, end?).
cutTo(engine | camera, track, { progress?, actors? }): void   // instant cut; the caller suspends the 'cameraRig'
class Letterbox { constructor(parent?); show(on, { instant? }); readonly shown; dispose() }  // service 'letterbox'
```
Hold Space / pad A 1 s (or the on-screen ring) skips; skipping puts every actor in its end state. Lines go to
`ctx.say`, else the 'bubbles' service, else letterbox captions (typewriter + babble, music ducked with
`by: 'caption'`). Gameplay input comes back at the end unless `restoreGameplay: false` or a conversation still runs. Reduce camera
motion holds each shot's final framing. Events: `'cutscene:start' {id}`, `'cutscene:end' {id, result}`, plus
`hud:visible` off / on. The HUD (main) should reuse the 'letterbox' service rather than draw a second one.

### Screens and flow — `src/game/GameFlow.ts` (+ `flow-*.ts`), `src/ui/{Title,TitleScene,Opening,Pause,ChapterSelect,Credits,DemoEnd,Menu}.ts`, `menu-*.ts`, `SettingsUI.ts` (+ `settings-*.ts`), `SatchelUI.ts` (+ `satchel-*.ts`)
```ts
class GameFlow {                                        // service 'flow'
  constructor(engine: Engine, opts?: { parent?: HTMLElement });
  start(): void;                                        // boot → title
  readonly state: 'boot'|'title'|'opening'|'loading'|'playing'|'paused'|'demoEnd'|'endCard'|'credits'|'disposed';
  readonly screen: string; readonly chapter: number | null; readonly ready: boolean;
  setChapterLauncher(fn: ChapterLauncher | null): void; // null = the default ChapterManager launcher
  setScreen(id: 'settings' | 'satchel', factory: ScreenFactory | null): void;
  showTitle(noticeKey?); newGame(); continueGame(latest?); startChapter(n, waystone?, state?): Promise<void>;
  completeChapter(n); pause(); resume(); quitToTitle(); showDemoEnd();
  showEndCard(variant?: 'dream' | 'sequel'); showCredits('menu' | 'end');
  probe(): FlowProbe /* {state, screen, chapter, loopPaused, titleReady, continueAvailable, focused, menuDepth} */;
  dispose(): void;
}
type ChapterLauncher = (chapter: number, waystone: string | null, state: GameState) => Promise<ChapterHandle>;
interface ChapterHandle { dispose(): void; readonly gameplay?: boolean /* true */; setPaused?(paused: boolean): void;
  satchelMap?(): SatchelMapContext | null /* level + player for MAP when the flow owns the Satchel */;
  satchelCanUse?(itemId: string): boolean /* ChapterContext.itemUse: the flow's Satchel asks it for "Use" */ }
type ScreenFactory = (ctx: { parent; from: 'title' | 'pause'; close(): void }) => { dispose(): void };
```
- Flow: title → START (new GameState; the opening narration while Chapter I loads behind it; click / tap to play,
  `?skipIntro=1` skips) | CONTINUE (latest save, its chapter and waystone) | CHAPTERS (any chapter reached;
  `?god=1` all; demo builds lock V+) → playing ⇄ paused. Escape / pad B / pad Menu on the opening go back to the
  title. `'chapter:complete' {chapter}` (ChapterManager) → next chapter, the demo end after IV (VITE_DEMO), or after
  XIII the end card ('dream') → Epilogue (14) → the sequel card ('sequel', "CHRISTIANA'S JOURNEY - coming soon",
  GDD 2.10) → end credits → title. Emits `'flow:state' {state, prev}`, `'game:pause' {reason: 'menu'}` /
  `'game:resume'` around the pause menu, and opens the pause menu when the tab is hidden mid-play (not under an open
  Satchel, which already holds the pause; a Satchel still loading when the game pauses does not open).
- During play (a loop System at order -1000): the pause action (Esc, pad Menu, touch icon) opens the pause menu; the
  satchel action (Tab, pad View, touch icon) opens the Satchel (`flow-satchel.ts`: the registered 'satchel'
  service, or one the flow makes whose MAP reads `ChapterHandle.satchelMap`). Neither opens within 250 ms of a menu
  handling input; the Satchel does not open during a conversation or cutscene, and closing either menu keeps
  gameplay input off while a conversation or cutscene still runs (`storyHoldsInput()`, story-input.ts). The pause
  menu gives the focus back to what had it (a dialogue choice) and ducks the music with `by: 'pause'`.
- Touch: while the flow is playing and gameplay input is off (a conversation, a cutscene, a chapter with
  `gameplay: false`), Input hides the touch controls and their pause icon; GameFlow then shows its own pause icon in
  the same place (`flow-touch.ts`, `.pg-flow-pause`, z-index 35).
- `Menu` (src/ui/Menu.ts + menu-pad/nav/stack/screen): one focus helper for every menu: arrows, Tab trap, Enter /
  Space / E, Escape / Backspace = back, Home / End, [ ] = tabs; the pad polled in its own frame (d-pad / stick, A,
  B, LB / RB, Menu); hover and tap; a visible `.is-focused` ring for keyboard, pad and mouse. Menus stack; a screen
  that is not a Menu (Settings, Satchel) covers one with `suspend()`. Items are `[data-menu-item]` (`menuButton()`),
  and `Texts` re-translates bound elements on 'lang:changed'.
- `TitleScene` builds `content/levels/title.json`: zone type `farLight` (where the far shining light stands) and a
  'way' band zone of type `cameraRail` (from, to, height, offset, seconds) for the camera glide.
- `SettingsUI` (GDD 2.14 Settings): `new SettingsUI(parent?)`, `open({ tab?: 'graphics' | 'gameplay' | 'audio' |
  'text' | 'controls' }): Promise<void>` (resolves on close), `close()`, `dispose()`, `isOpen`, `currentTab`. Bound
  live to Settings; Controls remaps through `Input.captureNextKey()` / `rebind()` / `resetBindings()`.
- `SatchelUI` (GDD 2.14 MY SATCHEL): `new SatchelUI({ parent?, map?, canUse?, resumeGameplay?, register? })`,
  `open(tab?, { level?, player?, canUse? }): Promise<void>`, `close()`, `showTab(tab)`, `isOpen`, `tab`, `dispose()`;
  `satchelScreen(get?)` (the pause-menu ScreenFactory), `openSatchel(tab?)`. Pauses the loop, closes itself on the
  Satchel / Pause action, B or a tap outside. Events `'satchel:opened' {tab}`, `'satchel:tab' {tab}`,
  `'satchel:closed'`, `'satchel:use' {id}` (after closing; the Key of Promise in Ch XI). Data:
  `content/promises.json` (24 Promises p01..p24 by chapter, KJV text in English, the game's own line in Tamil,
  GDD 2.16 rule 6) and `content/friends.json` (FRIENDS MET cards; `meet()` ids match an id, an alias, or the id
  without `_<n>`). `satchel-data.ts` exposes `PROMISES`, `promiseById`, `FRIENDS`, `friendFor`, `knownPromiseCount`.
- Layers in `#ui` (z-index): speech bubbles 25, dialogue layer 30, the flow's touch pause icon 35, title 50,
  pause / menus 400, Satchel 700, loading 800, settings 850, opening / end cards 860.
- Fit: the title's head scales with the window height and short laptop windows tighten the menu; when large text
  still runs past the bottom, a bobbing "more" arrow shows until the menu is scrolled to the end. Phone Settings
  tabs wrap (all five in sight); the opening narration follows Settings > Text size (opening.css).

### Dialogue demo — `?dialogue=test` (`src/narrative/DialogueTestScene.ts` + `dtest-*.ts`, `content/levels/dialogue_test.json`)
Christian and Evangelist on a dusk stage play `test_evangelist` (content/dialogue/test.json) through the real
runner, panel and bubbles, with a camera host that cuts with `shots.*` + `cutTo` (`<kind>_<actorId>` shot names:
over_shoulder / ots, close / closeup, two / wide, release) and a small Hope readout. Registers a GameState (Hope 50)
when none exists. `window.__pilgrim.dialogueTest` is the scene (`play()`, `camera`, `ready`, `active`).

### Chapters (Phase 3) — `src/world/ChapterManager.ts` (+ `chapter-prefetch.ts`, `chapter-devcam.ts`), `src/world/Triggers.ts`, `src/chapters/`
```ts
// src/chapters/types.ts
interface ChapterScript { id: string; level: string /* level file id */;
  start(ctx: ChapterContext): void | Promise<void>; update?(dt: number, ctx: ChapterContext): void; dispose?(): void }
interface ChapterContext {
  readonly chapter: number; readonly engine: Engine; readonly session: PlaySession; readonly state: GameState; readonly level: LevelData;
  npc(id: string): NPC | null;          // every level.npcs entry with a Character, wrapped (not 'christian': the player)
  addCompanion(npcId: string, barks?: BarkSet): Companion; removeCompanion(npcId: string): void; readonly companions: readonly Companion[];
  talk(graphId: string, opts?: { with?: string }): Promise<void>;     // queued; see below
  cutscene(def: CutsceneDef): Promise<'done' | 'skipped'>;            // actors: christian + every NPC; ground: session.col
  onTalk(npcId, graph: string | (() => Promise<void>), opts?: { verb?: string /* ui.verb.talk */; once?: boolean /* false */ }): () => void;
  onInteract(o: Omit<Interactable, 'onUse'> & { onUse(): void }): () => void;
  onTrigger(id: string, fn: () => void, opts?: { once?: boolean /* true */ }): () => void;
  onZone(type: string, enter?: (id: string) => void, exit?: (id: string) => void): () => void;
  objective(key: string | null): void; toast(key, params?): void; chapterCard(): void;
  guide(target: { npc: string } | { landmark: string } | THREE.Vector3 | (() => THREE.Vector3 | null) | null): void;  // where the HUD guide points; null = the Way ahead
  music(id: SongId, state?: MusicState): void; ambience(id: AmbienceId | null): void;
  wait(seconds: number): Promise<void>;                               // game time; never resolves after dispose
  waitFor<K extends EventName>(name: K, pred?: (p: EventMap[K]) => boolean): Promise<EventMap[K]>;
  landmark(id: string): THREE.Vector3 | null;                         // ground + lift; null for path landmarks
  complete(): void;                                                   // 'chapter:complete' {chapter}, once
  own(dispose: () => void): void;
  itemUse(canUse: ((itemId: string) => boolean) | null): void;        // Satchel > CARRIED "Use" buttons; a use is 'satchel:use' {id}
}
// src/chapters/index.ts
const CHAPTERS: Record<string, () => Promise<{ default: ChapterScript }>>;   // 'test' now; '1'..'13', 'epilogue' later
function chapterKey(n): string /* 14 → 'epilogue' */; function nextChapterKey(n): string | null; function hasChapter(key): boolean;
// src/world/Triggers.ts — level.triggers → 'trigger:enter' {id, script} / 'trigger:exit' {id}
class Triggers { constructor(level, target /* player */); enabled; readonly count; isInside(id); isSpent(id); update(); dispose() }
// src/world/ChapterManager.ts — service 'chapters' while a chapter is up
class ChapterManager {
  constructor(engine: Engine, opts?: { script?: string /* force a key: ?chapter=test */ });
  readonly launch: ChapterLauncher;          // the flow's launcher → ChapterHandle {gameplay: true, satchelMap, dispose}
  readonly session: PlaySession | null; readonly context: ChapterRuntime | null; readonly building: boolean;
  readonly scripts: ChapterScripts;          // load(key), prefetch(key), prefetched
  readonly progressLog: number[]; dev: ChapterDevProbe | null;   // ?chapter=test → window.__pilgrim.testWorld
  restart(): Promise<void>;                  // dispose + build the running chapter again (leak checks)
  end(): void; dispose(): void;
  probe(): { key, chapter, level, ready, building, builds, npcs, companions, talking, cuts, triggers, prefetched };
}
// src/game/flow-launcher.ts
function chapterLauncher(engine, opts?: { script?: string; onManager?(m: ChapterManager): void }): ChapterLauncher;  // GameFlow's default
```
- launch(chapter, waystone, state): `catchUp(state, chapter)` (src/game/chapter-progress.ts: from Ch VII no Burden,
  the Roll and the Key of Promise; from Ch VIII the six armoury gifts; only what is missing, quietly; not for the
  Epilogue or a forced script) → the script (`CHAPTERS[chapterKey(n)]`, or the forced key; a chapter with no
  script yet plays `test` with a `console.info`) → `PlaySession.start(engine, script.level, { state, waystone,
  loading: chapterLoadingInfo(chapter) })` → `state.setChapter(n)` if it differs → `ChapterRuntime` (the context)
  + `Triggers` → `'hud:chapterCard'` → `script.start(ctx)` on the next microtask, not awaited (errors logged).
- Loop: one System at `PLAY_ORDER.interact + 5` (= `NPC_ORDER`): triggers → waits → NPC wrappers (a Companion
  updates and renders its own NPC) → `script.update`; its render places the NPCs and walks a held talk shot;
  a System at 999 moves the bubbles after the camera.
- `talk()`: one DialogueRunner per chapter (registered 'dialogue', no listeners) with a TalkHost; a DialoguePanel
  is made per talk and freed after it, so no panel listens between talks. Around a talk: player 'locked',
  following companions stop, the partner stops, faces the player and looks at his head, the player turns to the
  partner, `state.meet(recipe)`, `'hud:visible'` off; `cam` effects cut `session.view` with `shots.*` + `cutTo`
  (shot names as the dialogue demo, `parseShot`), the FollowCamera suspended until 'release' / the end (blend
  0.8 s), cuts on the side the follow camera stood (180° rule), the face lifted over the panel. All restored after.
- Bubbles: the chapter owns a SpeechBubbles ('bubbles') for companion barks and bubble lines. Cutscenes: a
  CutscenePlayer made on first `ctx.cutscene()`; the player is in 'cutscene' mode while it plays.
- Background fetch: reading the level's LAST waystone fetches the next chapter's script chunk, level file and
  `content/dialogue/<levelFileId>.json` (ChapterScripts.prefetch). The World itself is not pre-built yet (needs a
  PlaySession option to adopt a built World, DECISIONS).
- dispose (handle / restart), newest first: loop systems, `script.dispose()`, the context (waits, the talk and
  panel, the cutscene player, interactables, listeners, `own()` disposers, companions, NPC wrappers, bubbles),
  triggers, the session. Building and disposing the test chapter 5 times keeps GPU geometries / textures and
  `events.count()` flat (tests/chapters.spec.ts).
- The test chapter (`src/chapters/test.ts`): Pliable is a companion, Evangelist has [E] Talk → `test_evangelist`,
  objective `ui.hud.objective.followLight`, trigger `test_cross_near` (content/levels/test.json) → toast.
- Chapter X (Phase 5, GDD 2.10) is split by beat: `ch10.ts` (stages road → fair → trial → sneak → free, flags
  'ch10.faithfulJoined', 'ch10.talkativeDone', 'ch10.arrested', 'ch10.escaped'), `ch10-pride.ts` (Faithful ahead;
  run past him = trip), `ch10-talkative.ts` (piled bubbles, the telling question), `ch10-fair.ts` (keepers, "Yes
  please" sacks: -10 % speed each, the chapter owns `player.speedScale`; crowds), `ch10-trial.ts` (cage, witnesses,
  jury pan with `ch10-jury.ts` name cards, night, `ch10-chariot.ts`), `ch10-night.ts` (night LookShift, watchmen
  patrols, lantern pools: caught = back to 'sneak_start'), `ch10-kit.ts` (zone lookups, instanced crowds). Level
  zones it reads: types 'crowd' (count, face; `day: "cage"` = the square), 'jury', 'spot' ('cage_inside',
  'sneak_start', 'chariot_spot'), 'patrol' (npc, phase).
- `tests/ch10.spec.ts`: the pride trip by running, Talkative's pile and questions, a "Yes please" sack slowing him
  (No thank you does not), and arrest → jury cards → chariot → night (a lantern catches him) → Hopeful → day.
- `tests/chapters-late.spec.ts`: Chapters V-XIII and the Epilogue played through by script (every trigger in Way
  order, every conversation answered, each chapter's key action; Ch VIII skips the fight to Phase 3 and reaches
  for the sword, Ch IX prays with Q at the smoking pit), each reaching 'chapter:complete' with a clean console.
- Chapters VIII and IX (Phase 5): Ch VIII builds the Arena,
  Hearts and ApollyonFight when 'apollyon_approach' fires and plays the claim, the fight, the Micah 7:8 line, his
  flight and the healing leaves; Ch IX builds the Shadows, clears the smoking pit on a `prayer:burst` inside
  'ember_pit_near' or near the smoke, and eases the valley to dawn at 'dawn_breaks' (LookShift).
- `tests/chapters.spec.ts`: the Evangelist talk by keyboard in English and Tamil (third answer: Hope +10, cuts,
  babble, Tamil panel text; screenshots `test-results/phase3/chapter-talk-<lang>.png`), 5 builds with flat
  memory and listeners, title → START → opening → Chapter I (the test chapter in its place), clean consoles.

## Audio (Phase 3) — `src/audio/`, `content/music/`

Contract types: `src/audio/types.ts`: `SfxId`, `AmbienceId`, `SongId`, `MusicState`, `InstrumentId`,
`VoiceParams`, `Mood`, `SongDef`/`TrackDef` (note-string format), `AudioEventMap`. Import `src/audio/events.ts`
once (side-effect free, types only) to get the audio events on the global bus.

Gameplay code never touches Web Audio. It emits:
`events.emit('sfx', { id: 'bonk', at: [x, y, z] })`, `'music:play' {id, fade?, state?}`, `'music:state' {state}`,
`'music:stop'`, `'music:silence'`, `'ambience:set' {id|null}`, `'audio:duck' {on, by?}`, or uses the service:
```ts
// src/audio/AudioEngine.ts — registers itself as services 'audio'; main.ts builds it right after the Engine
export class AudioEngine {
  constructor(opts?: { songs?: Partial<Record<SongId, SongDef>>; seed?: number; autoUnlock?: boolean /* true */;
                       audioSession?: 'playback' | 'ambient' /* iOS; default: left to the browser */ });
  readonly ready: boolean;                                   // false until the AudioContext runs
  unlock(): Promise<void>;                                   // auto-bound to the first real tap/click/key; never rejects
  playSfx(id: SfxId, opts?: { at?: Vec3; volume?: number; pitch?: number }): void;
  readonly music: { play(id: SongId, fade?: number, state?: MusicState): void; setState(s: MusicState, fade?: number): void;
                    stop(fade?: number): void; silence(fade?: number): void; readonly current: SongId | null; readonly state: MusicState };
  readonly ambience: { set(id: AmbienceId | null, fade?: number): void; addEmitter(id: AmbienceId, at: Vec3): () => void;
                       readonly current: AmbienceId | null };
  readonly babble: { speak(voice: VoiceParams, text: string, opts?: { mood?: Mood; cps?: number; at?: Vec3 }): { stop(): void; readonly done: Promise<void> } };
  setListener(camera: THREE.Camera): void;                   // every rendered frame (main.ts); allocation-free
  duck(on: boolean, by?: string): void;  // music bus and its reverb send -6 dB while any owner `by` holds it
  dispose(): void;
  readonly context: AudioContext | null;                     // dev / tests / test page, null before unlock
  readonly buses: AudioBuses | null;                         // master, music, voice, effects, ambience, musicSend, ambienceSend, out
  readonly musicPlayer: MusicPlayer | null;
}
// EventMap addition (declared in AudioEngine.ts): 'audio:ready': void — the context ran for the first time.
```
- **Unlock.** The AudioContext is created inside the first real user activation (`pointerdown`, `touchend`,
  `keydown`, `click`; capture, passive; `navigator.userActivation` checked) with `resume()` plus a one-sample
  silent buffer (iOS). Before that, `music.play/setState`, the ambience zone and emitters are remembered and
  applied on unlock; `sfx` are dropped and babble is silent, but a babble handle's `done` still resolves after the
  line's length (`Babble.silentLine`), so dialogue keeps its pace and never hangs. No Web Audio at all: the game
  runs silently at the same pace.
- **iOS audio session.** The game leaves `navigator.audioSession` alone, so on an iPhone Web Audio follows the
  Ring/Silent switch (as native games do) and the player's own music keeps playing. `audioSession: 'playback'`
  plays even in silent mode; the music test page uses it, and its tap overlay also says to turn silent mode off
  (iOS before 16.4 has no `audioSession`).
- **Mixer** (`amb-mixer.ts`; the `amb-` prefix is historical): music / voice / effects / ambience → master →
  DynamicsCompressor limiter (−6 dB, 16:1, 3 ms) → soft clipper (linear to 0.8, ceiling ~0.95) → `out`
  (hidden-tab mute) → destination. One shared ConvolverNode (`Synth.createReverbImpulse`, 2.4 s) fed by a music
  send (the MusicPlayer's per-track sends, taken after its faders) and an ambience send; each send follows its bus. Settings `volMaster/volMusic/
  volVoices/volEffects/volAmbience` apply live as gain v² with bus trims master 1.4, music 1, voice 1.25,
  effects 1, ambience 0.8.
- `'music:silence'` fades the songs, the ambience and the reverb return to 0 until the next `music:play` /
  `ambience:set`; effects and voices stay (the Cross's 1.5 s of silence is true silence).
- Hidden tab (`visibilitychange`): output ramps to 0 and the context is suspended after 0.4 s; it resumes on
  return (if iOS refuses, on the next tap). The music and ambience clocks freeze with it, so nothing piles up.

Modules (each file < 400 lines; everything seeded, every node disconnected when done):

| File | API (beyond the engine) |
|---|---|
| `Synth.ts` | `midiToHz`, `parsePitch` ('C4' = 60, NaN if not a pitch), `adsr(param, t, peak, a, d, s, r, dur)` → silent time, `adsrValueAt`, `noiseBuffer(ctx, s, color)` (seeded, cached per context, seamless loop), `createReverbImpulse(ctx, s, decay)` (stereo, unit energy: `normalize = false`), `harmonicWave` |
| `Instruments.ts` (+ `inst-*.ts`) | `new InstrumentBank(ctx, reverbSend)`; `play(id, {midi, time, dur, vel}, out, wet = true)` ('drums' maps GM notes), `playDrum('K'\|'S'\|'H'\|'O'\|'T'\|'R', time, vel, out, wet = true)`, `maxVoices` (24; the quietest voice is stolen with a ~50 ms fade, voices scheduled ahead are kept), `voiceCount`, `dispose()`. Level-matched at vel 0.8 (−24 LUFS per note). With `wet` each instrument's reverb send (`SEND`) is taken before `out`; the sequencer passes `wet = false` and sends each track itself, after its faders. |
| `Sequencer.ts` (+ `seq-*.ts`) | `parseTrack`, `validateSong` (readable problems), `pitchToMidi`; `new MusicPlayer(ctx, bank, out, songs, reverb?)`: `play(id, fade?, state?)` (a new song defaults to 'calm'; from silence it starts at once, over another song it crossfades 1.5 s), `setState(s, fade = 2)` (leaving tracks keep playing while they fade; tracks that join start on the next bar line, and a leaving track in the same layer fades until half a fade past it), `stop(fade = 1)`, `silence(fade = 0.4)`, `position {bar, beat, loop}`, `info(id)`, `problems(id)`, `scheduleUntil(t)` (offline renders), `dispose()`. 25 ms tick, 120 ms look-ahead on the context clock; late notes are dropped, never bunched. Each track's reverb send (instrument `SEND` ÷ track gain, into `reverb` = `Mixer.musicSend`) sits after the track and song faders, so stops, song crossfades and state changes fade the reverb too. Grammar extras: BEATS may be a fraction (`1/3`), missing BEATS = 1, drum chords `K+H`. validateSong problems are logged once per song in dev builds. |
| `sfx/index.ts` (+ `sfx/*.ts`) | `new SfxBank(ctx, out, {seed?, recipes?})`: `ready`, `progress`, `has(id)`, `buffer(id, variant?)`, `play(id, {at, volume, pitch})`, `stopAll(fade?)`, `dispose()`; `SFX_RECIPES`, `stepPitch(id, n)`, `pitchToSemitones`. Recipes are parameter objects rendered on load (OfflineAudioContext, time-sliced, UI and footsteps first), peak −6 dBFS, mixed by the recipe `level`. `pitch` is a playback-rate multiplier (1 = as designed, 0.25..4); recipes with a scale snap to it. One id never restarts within 25 ms; per-id polyphony, 24 voices in all; positional sounds beyond 60 m are skipped; nothing plays while the context is not running. |
| `Ambience.ts` (+ `amb-*.ts`) | `new Ambience(ctx, out, {reverb?, seed?, hrtf?})`: `set(id \| null, fade = 2.5)`, `addEmitter(id, at)` → remove function, `listenerAt(x, y, z)`, `current`, `emitterCount`, `liveShots`, `dispose()`. A bed per AmbienceId (`amb-beds.ts` `BEDS`): looping noise / texture layers plus seeded one-shots. Emitters run only within their bed's reach (15 % hysteresis), at most 8 at once; HRTF panning only with a fine pointer. |
| `Babble.ts` (+ `babblePlan.ts`, `babbleLevel.ts`, `voices.ts`) | `new Babble(ctx, out)`: `speak(voice, text, {mood, cps = 40, at})` → `{stop, done}`, at most 6 lines; `silentLine(voice, text, opts)` → a handle that only keeps the line's time. One blip per 2-3 letters of each word (never more; a one-letter word gets one), each starting when its first letter appears on the reveal clock `revealTimes(text, cps)` (`babblePlan.ts`): **the dialogue typewriter must use `revealTimes` to stay in sync.** Sad pitches down with longer, falling blips, excited pitches up with shorter ones; slow voices lean to 3 letters per blip and longer blips; every voice is level-matched. `VOICE_PRESETS` are reference values for `content/characters/recipes.json`. |
| `renderOffline.ts` | Dev only (test page, scripts): `renderSong(id, [{state, loops}])`, `renderSfxTour()`, `levels(buf)`, `encodeWav(buf)`, `downloadWav(buf, name)`; renders through the real Mixer at the current volume settings. |
| `MusicTestPage.ts` (+ `testpage/*`) | `?music=<songId>`: tap to start audio, every song / state / SFX / ambience, babble demo, volumes, "Download WAV". Builds its own AudioEngine (`audioSession: 'playback'`) when no 'audio' service exists. |
| `amb-context.ts` | AudioEngine helpers: `audioContextClass()`, `setAudioSession(type)`, `kickContext(ctx, onResumed)` (resume plus the iOS silent buffer). |

Songs: `content/music/themes.ts` exports `SONGS: Record<SongId, SongDef>` (note data in `songs-*.ts`, helpers in
`notation.ts`, notes per theme in `docs/MUSIC.md`). ORIGINAL melodies only (never transcribe any existing song,
hymn or film score). Every song's `calm` state is a complete arrangement; `pilgrim` in `joy` is the full theme
(the burden-falls moment).

Gameplay usage: the three joy jumps play `{ id: 'joy_note', pitch: stepPitch('joy_note', n) }` and the Cross's
ropes `stepPitch('rope_snap', i)`; dialogue emits `'audio:duck' {on}` around lines; the Cross emits
`'music:silence'`, waits 1.5 s, then `'music:play' { id: 'pilgrim', state: 'joy' }`.

## Tools and tests (Phase 0, Phase 1, Phase 3)

- `tools/check-assets.mjs` — GDD 2.3. Fails (exit 1, readable message) if:
  - `public/` contains any file that is not text-based (`.svg`, `.json`, `.webmanifest`, `.txt`, `.js`, `.css`, `.html`) **and**
    not listed in `public/.generated-icons.json` (the manifest our own `tools/gen-icons.mjs` writes);
    binary detection by extension *and* by sniffing for NUL bytes / known magic numbers (PNG, JPEG, GIF, WebP,
    OGG, MP3, WAV, GLB, KTX2, WOFF/WOFF2/TTF/OTF, HDR, EXR, FBX, ZIP).
  - `package.json` `dependencies` has anything other than `three`, or `devDependencies` has anything outside
    the allowlist (`vite`, `typescript`, `@playwright/test`, `eslint`, `prettier`, `@types/three`).
  - any `src/**` file imports from `three/examples/jsm/` something outside an allowlist of code modules (listed
    by name in `tools/lib/imports.mjs`), or references an asset path inside `three/examples` (`/textures/`,
    `/models/`, `/sounds/`, `/fonts/`). Each allowed module is read from `node_modules` with everything it
    imports; embedded binary data URIs, asset imports or imports off the list fail (e.g. SMAAPass).
  - code (`src/`, `content/`, `index.html` inline scripts, `public/` scripts) imports an npm package other than
    `three`, even one that is installed (dev tools bring their own dependencies).
  - any file under `src/` or `content/`, `index.html` or a `public/` text file contains a remote URL
    (`http(s)://...` or protocol-relative `//host/...`), except XML namespace URIs. Reference links go in `docs/`.
  - It also fails on: symlinks, binaries anywhere in `src/` or `content/`, asset imports (incl. `?url`), base64
    data URIs of binary types, web font services, CSS `url()` to asset files, glTF saved as `.json`, the whole
    `three/addons` bundle, a loosely pinned `three`, and non-empty optional/peer/bundle dependency fields.
    OS metadata (`.DS_Store`, `Thumbs.db`, `desktop.ini`) is ignored when its content matches the format, and a
    `vite.config.ts` plugin leaves files with those names out of `dist/`.
  - Helpers: `tools/lib/sniff.mjs` (magic numbers, OS metadata) and `tools/lib/imports.mjs` (import rules).
- `npm run dev`, `npm run build` and `npm test` run gen-icons and check-assets first (build and test also run
  validate-levels, validate-dialogue and `tsc`).
- `tools/validate-dialogue.mjs` (Phase 3) checks `content/dialogue/*.json` with the game's own rules
  (dialogue-parse.ts + dialogue-rules.ts through Node type stripping): shape, unknown fields, graph ids prefixed by
  their file, unknown `next` ids, max 3 choices, cond syntax, unreachable nodes, at most 5 lines in a row, every
  text key in en.json AND ta.json, anim / expr / mood / sfx / song / gift names read from the sources, at most 2
  sentences per line and no GDD 2.16 sectarian words. Speakers that are not NPCs of the matching level and very
  long lines are warnings.
- `playwright.config.ts` uses the installed Google Chrome (`channel: 'chrome'`) so no browser download is
  needed; `webServer` runs `gen-icons` then `vite` on the dedicated port 5317 (`reuseExistingServer: false`; the env var
  `PILGRIM_TEST_PORT` moves it).
  Headless, with `--use-angle=metal` / swiftshader fallback flags.
- `tools/gen-icons.mjs` writes the favicon, PWA icons and manifest into `public/` (git-ignored) before every
  dev/build/test run. It loads `src/ui/Emblem.ts` through Node's type stripping, so Node must be
  `^22.18.0 || >=23.6.0` (package.json `engines`). `tools/validate-levels.mjs` checks `content/levels/*.json` (build and test run it)
  against LevelData: only the shapes the runtime builds (zones circle | box | way, triggers and water circle | box),
  `water` entries (kind water|mud, `level`), `wayWidth` > 0, scatter rules need `density` (>= 0) and `scale` is a
  number or `[min, max]`, a 'way' zone's `path` must be "way" or a detour id; unknown top-level keys are warnings.
- `tests/smoke.spec.ts`: boots `/`, waits for `window.__pilgrim?.ready`, asserts a frame rendered
  (`stats.drawCalls > 0`), zero console errors and zero page errors; runs check-assets via `child_process` and
  expects exit 0; puts a fake `.png` in `public/`, expects exit 1, then removes it (in `finally`).
- `window.__pilgrim` (always present, read-only): `{ ready, engine, services, events, mode, modeReady, lab,
  testWorld, play, restartMode() }` for tests; `ready` turns true after the first rendered frame, `modeReady` once
  the mode is on screen; `lab` is the LabProbe (`?lab=1`), `testWorld` the TestWorld (`?chapter=test`) and `play`
  its PlaySession.
  testWorld, dialogueTest, restartMode() }` for tests; `ready` turns true after the first rendered frame, `modeReady` once the
  mode is on screen; `lab` is the LabProbe (`?lab=1`), `testWorld` the TestWorld (`?chapter=test`), `dialogueTest`
  the dialogue demo scene (`?dialogue=test`). GameFlow is `services.get('flow')` (`probe()` for tests).
- Phase 1 specs (`tests/support.ts` holds the shared console capture, frame waits and typings):
  - `tests/lab.spec.ts`: `?lab=1` boots with zero console errors/warnings; every recipe builds and its main mesh is
    exactly 1 draw call (2 only with a glow mesh), < 2500 triangles; every recipe runs all 24 clips and 8
    expressions (correct mouth bone shown), blinks at least twice in 12 s and keeps every bone finite and above
    ground, napping and praying close the eyes, and planted feet slide less than 25 % of the body speed at mid-stance
    (walk, run; burdened walk < 15 %) at the GDD 2.7.1 speeds; every clip and expression also plays live on burdened
    Christian; the lineup builds all recipes; a crowd
    of 100 costs < 10 draw calls with the shadow pass; restarting the Lab 3 times does not grow GPU geometries or
    textures.
  - `tests/world.spec.ts`: `?chapter=test` builds in < 2 s with a clean console, the loading bar received >= 10
    increasing updates before 100%; the gameplay view peaks under 150 draw calls and 300k triangles (GDD 2.15
    desktop); on Low the shadow map is off and characters still stand on blob shadows; building and disposing the
    world 5 times (Rebuild world and full mode restarts) keeps `renderer.info.memory` geometries and textures flat.
  - Both save the Phase 1 report screenshots to `test-results/phase1/` (lab-lineup, lab-lineup-wide, lab-closeup,
    lab-crowd, test-world, test-world-wide, test-world-low). Playwright clears `test-results/` at the start of each
    run.
- Phase 2 specs (`tests/play-support.ts` holds the session typings, the event log, waits on the simulated clock and
  movement helpers):
  - `tests/play.spec.ts`: keyboard, touch and gamepad each move, jump and read a waystone (autosave + toast), and
    the bubble shows that device's glyph (E keycap, USE picture, X badge); burdened walk 2.0 m/s with no running;
    the debug Cross drop plays 3 rope snaps, 2 bounces and the thoom (a Space tap in the slow-down never leaves him
    kneeling in the air; the camera stays > 2.5 m from him, < 8 m/s, with someone in view), then free walk 3.4 m/s,
    run 6 m/s and exactly three joy jumps; keyboard only, Tab keeps focus on "Click to play" and Enter starts play.
  - `tests/play-world.spec.ts`: walking through a Promise takes it; the pit bonks back onto the Way (Hope -5,
    toast); the low wall shows Climb with the jump keycap and climbing takes its Promise; the Slough slows and
    sinks Christian and standing still raises stones that hold him up, and the mud's edge is no wall; Hope 0 shows
    I SHALL ARISE and wakes him at the waystone with Hope 60, and a bonk that empties Hope keeps him locked under
    it; restarting the session 3 times (once mid-Cross: no joy theme or 'burden:dropped' afterwards) keeps GPU
    memory and `events.count()` flat.
  - `tests/play-physics.spec.ts`: with the real CollisionWorld and controller, free jumps in place and drops from
    40 heights land on a walkable box top; walking up a 0.22 m step the follow camera never dips.
  - Both save report screenshots to `test-results/phase2/` (burdened-walk, interaction-bubble-keyboard/-touch/-pad,
    touch-controls, cross-drop-ropes/-sack-rolling/-tomb/-stretch, joy-jump, free-run, bonk-stars,
    slough-steps, hud-lantern-low-hope, arise-screen). Every test runs with a clean console.
- Phase 5 combat spec `tests/combat.spec.ts` (screenshots `test-results/combat/`): an in-page bot beats Apollyon's
  three phases with shield blocks, at least 3 perfect blocks and sword hits, then reaches for the sword (hearts
  shown, then hidden; Apollyon gone; `ch08.fightDone`); 0 hearts shows I SHALL ARISE and restarts the same phase
  with 5 hearts; on touch SWORD / SHIELD show only inside the arena; in Ch IX, Q prays (+20 Hope, one burst, then
  rest), a close shadow drains Hope, prayer makes it flee and the sword scatters one for 3 s, and a prayer at the
  smoking pit clears it; restarting Ch VIII mid-fight and Ch IX keeps GPU memory and listeners flat.
- Phase 3 specs (`tests/story-support.ts`: flow probe, fake standard gamepad, dialogue drivers):
  - `tests/story.spec.ts`: `?dialogue=test` plays the sample in English (key 2) and Tamil (a click) with a clean
    console: every line shows, Hope moves by the chosen amount, the camera cuts between lines, babble is spoken for
    every line, the last line is a world bubble; the title screen keyboard-only and gamepad-only through CHAPTERS,
    SETTINGS (text size changes and persists after a reload) and START (the opening); `?chapter=test` opens MY
    SATCHEL with Tab (the five GDD tabs, "Promises: 0 of 24", "Detours: 0", the Key card reading exactly "A key
    called Promise.") and the pause menu with Esc (and its SATCHEL); the language toggle puts the title in Tamil
    with no overflow at 375 px.
  - `tests/story-shots.spec.ts`: report screenshots in `test-results/phase3a/` at 1280×720 and 412×915 (touch), in
    English and Tamil (`<screen>[-ta]-<desktop|phone>.png`): title, chapters, credits, settings (+ text tab),
    opening, demo end, pause, the five Satchel pages, the dialogue panel with choices and a world bubble.
  - `tests/story-fixes.spec.ts` (review fixes, behaviour): a hidden tab under the Satchel leaves no pause menu;
    the flow's touch pause icon during a fly-through and a conversation; pausing mid-conversation keeps the duck
    and the focus, Tab + Enter pick the highlighted choice, Enter remapped to Skip only reveals; the skip ring
    without a hold; bubble lines announced once; overlapping cutscene and conversation hand input back last;
    captions at the Slow text speed; Escape / pad B on the opening; the sequel card before the end credits.
  - `tests/story-layout.spec.ts` (review fixes, layout, screenshots `test-results/phase3a/fix-*.png`): the title
    menu fits 1280×720 with CONTINUE (or shows the "more" arrow until scrolled); CHAPTER label contrast >= 4.5:1;
    the opening narration follows the text size; phone Settings tabs all in sight at XL; demo-end heading capped;
    Satchel footer >= 20 px; on a phone on its side the question stays in view beside its answers and the Satchel
    tabs drop their labels at XL.
