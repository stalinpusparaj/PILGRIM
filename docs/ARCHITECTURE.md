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
| (none) | Title screen → opening narration → Chapter I |
| `?lab=1` | Character Lab (Phase 1) |
| `?music=<id>` | Music test page (Phase 3) |
| `?chapter=test` / `?chapter=1..13` / `?chapter=epilogue` | Load a chapter directly (debug) |
| `&waystone=ch08_w1&debug=1&god=1&skipIntro=1` | Debug params (GDD 2.15) |

Phase 0 has only the "test scene" mode: an empty sky + ground scene with a slowly orbiting camera
(`src/world/dev/DevScene.ts`). `main.ts` already parses the mode; until later phases add the others, every mode
shows the test scene, except `?music=<id>`, which opens the music test page (`src/audio/MusicTestPage.ts`, plain
DOM, loaded with a dynamic import before the Engine is created, so it needs no WebGL).
```ts
export type RuntimeMode =
  | { kind: 'title' } | { kind: 'lab' } | { kind: 'music'; id: string }
  | { kind: 'chapter'; id: string; waystone: string | null };
export function selectMode(params: UrlParams): RuntimeMode;  // lab > music > chapter > title
```
- `?chapter=` accepts `test`, `1`..`13`, `epilogue`; anything else falls back to the title. Demo builds
  (`VITE_DEMO=true`) also fall back to the title for chapters beyond IV and the epilogue.
- All URL params are ignored outside dev builds unless `?debug=1` (see Flags.ts).
- Boot order in `main.ts`: flags → settings → i18n → save (each registers itself on import) → `Engine` →
  `AudioEngine` (registers the 'audio' service; a loop System at order 1001, right after the Engine's render
  system, calls `audio.setListener(engine.camera)` every rendered frame) → `Quality` (resolved before
  `engine.start()`, so the benchmark has the GPU to itself) → `Input` (hooked into `loop.onBeforeStep` /
  `onAfterStep`) → scene → debug panel → `engine.start()`.
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
  skipIntro: boolean; lab: boolean; music: string | null;
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
export const DEFAULT_SETTINGS: SettingsData;     // difficulty 'easy', fov 55, autoCamera 'default' (on for touch)
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
export function lathe(profile: Array<[number, number]>, radial?: number): THREE.BufferGeometry;
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
export function mat(kind: 'lambert' | 'toon' | 'glow' | 'skinned' | 'path' | 'unlit' | 'unlitTransparent'): THREE.Material;
export function disposeSharedMaterials(): void;   // app shutdown / tests only
// flatShading: true, vertexColors: true; 'glow' adds emissive from vertex colour; 'skinned' is the character material.
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
  way: Vec3[]; wayWidth?: number;                         // default 3 m
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
```

### Terrain — `src/gen/Terrain.ts`, The Way — `src/gen/Way.ts`, Scatter — `src/gen/Scatter.ts`
```ts
export class Way {
  constructor(points: Vec3[], width: number, kind: 'way' | 'detour', id: string);
  readonly length: number;
  sample(t: number, out?: THREE.Vector3): THREE.Vector3;               // t in [0,1], arc-length parameterised
  tangent(t: number, out?: THREE.Vector3): THREE.Vector3;
  closest(x: number, z: number): { t: number; dist: number; point: THREE.Vector3 };  // fast (precomputed polyline)
  buildMesh(terrain: Terrain, pal: Palette, rng: Rng): THREE.Object3D;  // ribbon + instanced edge stones
}
export class Terrain {
  static build(level: LevelData, ways: Way[], pal: Palette, y: Yielder, onProgress?: (p: number) => void): Promise<Terrain>;
  heightAt(x: number, z: number): number;                              // bilinear on the grid
  normalAt(x: number, z: number, out?: THREE.Vector3): THREE.Vector3;
  slopeAt(x: number, z: number): number;                               // degrees
  readonly mesh: THREE.Mesh;  readonly size: number;
  dispose(): void;
}
export function scatter(level: LevelData, terrain: Terrain, ways: Way[], pal: Palette, rng: Rng, quality: QualityPreset,
                        y: Yielder): Promise<{ object: THREE.Object3D; colliders: Collider[]; dispose(): void }>;
```
- Grid default 128×128 for 300 m (≈2.3 m cells); flat-shaded, vertex-coloured by height/slope/zone; the Way is
  flattened (half-width + 2 m smooth falloff) and painted warm (`ground.path`); detours painted `ground.detour`.
- Scatter types at least: trees (`tree_cone`, `tree_round`, `tree_dead`, `tree_fruit`), `bush`, `reeds`,
  `grass` (instanced tufts), `rock`, `flower`. One `InstancedMesh` per type, per-instance colour jitter, distance
  culling for small types (grass/flowers) by chunk, keep-clear distance from the Way.

### Props — `src/gen/props/*.ts`, registry `src/gen/props/index.ts`
```ts
export const PROPS: Record<string, PropBuilder>;   // 'tree_cone','tree_round','tree_dead','tree_fruit','bush','reeds',
// 'grass','rock','fence','wall','stile','house_a','house_b','house_c','gate','waystone','arbour','cross','tomb',
// 'stall','cage','well','lamp','candle','flag','bridge_bank','lily','flower','sign'
export function buildProp(type: string, rng: Rng, pal: Palette, params?: Record<string, number | string | boolean>): PropResult;
```
Static landmark props in an area are merged into one mesh per material (`placeProps()` in `src/world/LevelLoader.ts`).

### Sky, water, particles
```ts
// src/gen/Sky.ts
export class Sky { constructor(pal: Palette, q: QualityPreset); readonly object: THREE.Object3D;
  update(dt: number, camera: THREE.Camera): void; dispose(): void; }       // gradient dome shader + sun disc + instanced puffy clouds; follows camera
export function applyAtmosphere(scene: THREE.Scene, pal: Palette): { hemi: THREE.HemisphereLight; sun: THREE.DirectionalLight; dispose(): void };
// src/gen/Water.ts
export function createWater(o: { kind: 'water' | 'mud'; pal: Palette; shape: 'circle' | 'box'; r?: number; size?: [number, number] }):
  { mesh: THREE.Mesh; update(t: number): void; dispose(): void };          // vertex waves, faceted normals, depth colour; mud bubbles instanced
// src/gen/Particles.ts
export type ParticlePreset = 'dust' | 'sparkle' | 'smoke' | 'ember' | 'rain' | 'zzz' | 'fire' | 'motes' | 'stars' | 'splash';
export class Particles { constructor(max: number); readonly object: THREE.Object3D;
  emit(preset: ParticlePreset, pos: THREE.Vector3, count?: number, opts?: { dir?: THREE.Vector3; color?: string; spread?: number }): void;
  update(dt: number, camera: THREE.Camera): void; dispose(): void; }        // ONE InstancedMesh (camera-facing quads), 1 draw call
```

### Characters — `src/gen/CharacterFactory.ts`, `src/gen/rig.ts`, `src/gen/face.ts`, `content/characters/recipes.json`

**One draw call per character**, including the face: eyes, brows and every mouth shape are part of the same
SkinnedMesh, each bound rigidly to its own face bone. Blink = scale the eye bones on Y. Brows = rotate/offset the
brow bones. Mouth shapes swap by scaling the active mouth bone to 1 and the others to 0. (Logged as a decision:
the GDD's "separate tiny meshes" goal — swappable expressions — is met with zero extra draw calls.)

Bone names (`rig.ts`), rest pose = arms hanging down (A-pose ~8°), character faces +Z, feet on y = 0:
```ts
export const BODY_BONES = ['root','hips','spine','chest','neck','head','upperArmL','lowerArmL','handL','upperArmR',
  'lowerArmR','handR','thighL','shinL','footL','thighR','shinR','footR','propL','propR','back','sack','hat'] as const;
export const FACE_BONES = ['eyeL','eyeR','browL','browR','mouth_neutral','mouth_smile','mouth_open','mouth_frown',
  'mouth_o','mouth_flat','mouth_wavy','mouth_grin'] as const;
export const BEAST_BONES = ['wingL','wingR','tail1','tail2','tail3','jaw'] as const;   // optional per recipe
export type BoneName = typeof BODY_BONES[number] | typeof FACE_BONES[number] | typeof BEAST_BONES[number];
```
```ts
export type Expression = 'neutral' | 'happy' | 'sad' | 'scared' | 'surprised' | 'angry' | 'sleepy' | 'determined';
export interface CharacterRecipe {
  id: string; name?: string;
  body: 'adult' | 'adultF' | 'elder' | 'child' | 'youngAdult' | 'stocky' | 'thin' | 'big' | 'giant' | 'giantess' | 'tall' | 'beast';
  scale?: number;                                        // giants 3, Shining Ones 1.3
  build?: { height?: number; girth?: number; head?: number; legs?: number; arms?: number; belly?: number }; // multipliers ~0.7-1.4
  skin: string;                                          // one of the GDD 2.11 skin tones
  colors: { top: string; bottom: string; feet?: string; accent?: string; hair?: string; hat?: string; trim?: string; [k: string]: string | undefined };
  parts: { top?: 'tunic' | 'robe' | 'dress' | 'coat' | 'vest' | 'shirt' | 'judge';
           bottom?: 'trousers' | 'robe' | 'skirt';
           hair?: 'none' | 'short' | 'curls' | 'bun' | 'long' | 'tuft' | 'bald';
           beard?: 'none' | 'short' | 'full' | 'long';
           hat?: 'none' | 'cap' | 'hood' | 'tall' | 'wig' | 'scarf' | 'helmet' | 'droopy' | 'mirrorMask';
           extras?: string[] };                          // 'apron','ropeBelt','cape','buttons','plume','glowDot','trim','sleeves','chains'
  props?: Array<{ type: 'staff' | 'candle' | 'lantern' | 'keys' | 'book' | 'gavel' | 'crook' | 'sword' | 'shield' | 'cane' | 'letter' | 'toy' | 'club' | 'pole';
                  bone: 'propL' | 'propR' | 'back' }>;
  burden?: boolean;                                      // adds the sack on the 'sack' bone
  glow?: boolean;                                        // Shining Ones: emissive white + sparkle hook
  expression?: Expression;                               // default face
  voice: { pitch: number; speed: number; wave: 'sine' | 'triangle' | 'square' | 'sawtooth'; vowel: number }; // Phase 3 babble
  style?: { bounce?: number; stiffness?: number; swagger?: number; lean?: number };                       // walk personality
}
export interface Character {
  readonly recipe: CharacterRecipe;
  readonly root: THREE.Object3D;                         // position/rotate this
  readonly mesh: THREE.SkinnedMesh;
  readonly bones: Record<string, THREE.Bone>;
  readonly animator: Animator;
  readonly height: number;
  setExpression(e: Expression): void;
  setTalking(on: boolean): void;                         // mouth flap + head bob layer
  setBurdenSize(s: number): void;                        // 0 = none, 1 = normal, up to 1.6 (sack bone scale)
  attach(obj: THREE.Object3D, bone: 'propL' | 'propR' | 'back' | 'head'): void;   // runtime props (extra draw call)
  update(dt: number): void;                              // animator, blink, secondary motion (sack spring, hat bounce)
  dispose(): void;                                       // geometry (materials are shared)
}
export class CharacterFactory {
  static recipes(): Record<string, CharacterRecipe>;      // from content/characters/recipes.json
  static build(recipe: CharacterRecipe | string, rng?: Rng): Character;
}
```

### Procedural animation — `src/gen/anim/`
```ts
// src/gen/anim/types.ts
export interface BonePose { x: number; y: number; z: number }               // Euler offset (rad) from rest, order 'YXZ'
export interface Pose { bones: Map<BoneName, BonePose>; hips: { x: number; y: number; z: number } } // hips translation offset (m)
export interface AnimParams { speed: number; burden: number; time: number; style: Required<NonNullable<CharacterRecipe['style']>>; height: number }
export interface ProcClip {
  name: AnimName; loop: boolean; duration: number;                          // loop cycle length or one-shot length (s)
  layer: 'full' | 'upper';                                                  // 'upper' overlays arms/chest/head only
  sample(t: number, p: AnimParams, out: Pose): void;                        // write offsets; t = seconds into the clip
}
export type AnimName = 'idle' | 'walk' | 'run' | 'burdenedWalk' | 'hop' | 'joyJump' | 'talk' | 'wave' | 'point' | 'sit'
  | 'nap' | 'pray' | 'read' | 'trip' | 'coverEarsRun' | 'climb' | 'push' | 'kneel' | 'knock' | 'reach' | 'fall' | 'land';
// src/gen/anim/Animator.ts
export class Animator {
  constructor(bones: Record<string, THREE.Bone>, params: AnimParams);
  play(name: AnimName, opts?: { fade?: number; speed?: number; restart?: boolean }): void;   // full-body crossfade
  overlay(name: AnimName | null, opts?: { fade?: number }): void;                          // upper-body layer
  readonly current: AnimName; readonly params: AnimParams;
  onEnd?: (name: AnimName) => void;                                                          // one-shots
  update(dt: number): void;                                                                  // blend → write bone quaternions
}
export const CLIPS: Record<AnimName, ProcClip>;   // src/gen/anim/index.ts
```
Squash-and-stretch on jump/land is done on the `hips`/`root` scale. Secondary motion (sack spring, hat bounce) lives
in the Character, driven by root acceleration.

### Crowds — `src/gen/CrowdMesh.ts`
`InstancedMesh` per body type built from a recipe (static, no skeleton), per-instance colour applied only to
clothing (a `tint` vertex attribute masks skin/face), vertex-shader bob/sway driven by a `uTime` uniform and a
per-instance phase. 1 draw call per body type; 100 citizens < 10 draw calls.
```ts
export class CrowdMesh { constructor(recipe: CharacterRecipe, max: number); readonly mesh: THREE.InstancedMesh;
  set(i: number, pos: THREE.Vector3, rotY: number, tint: string, phase?: number): void; count: number;
  update(t: number): void; dispose(): void; }
```

### Lab — `src/gen/Lab.ts` (`?lab=1`)
Turntable scene; list of every recipe, every animation and every expression; sliders for colours and build
multipliers; "Copy recipe JSON"; lineup view (all characters side by side at gameplay camera distance);
a "crowd of 100" toggle; readouts for draw calls/triangles. Dev tool: plain English UI is fine.

## Audio (Phase 3) — `src/audio/`, `content/music/`

Contract types: `src/audio/types.ts`: `SfxId`, `AmbienceId`, `SongId`, `MusicState`, `InstrumentId`,
`VoiceParams`, `Mood`, `SongDef`/`TrackDef` (note-string format), `AudioEventMap`. Import `src/audio/events.ts`
once (side-effect free, types only) to get the audio events on the global bus.

Gameplay code never touches Web Audio. It emits:
`events.emit('sfx', { id: 'bonk', at: [x, y, z] })`, `'music:play' {id, fade?, state?}`, `'music:state' {state}`,
`'music:stop'`, `'music:silence'`, `'ambience:set' {id|null}`, `'audio:duck' {on}`, or uses the service:
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
  duck(on: boolean): void;                                    // music bus and its reverb send -6 dB
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

## Tools and tests (Phase 0)

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
  validate-levels and `tsc`).
- `playwright.config.ts` uses the installed Google Chrome (`channel: 'chrome'`) so no browser download is
  needed; `webServer` runs `gen-icons` then `vite` on the dedicated port 5317 (`reuseExistingServer: false`).
  Headless, with `--use-angle=metal` / swiftshader fallback flags.
- `tools/gen-icons.mjs` writes the favicon, PWA icons and manifest into `public/` (git-ignored) before every
  dev/build/test run. It loads `src/ui/Emblem.ts` through Node's type stripping, so Node must be
  `^22.18.0 || >=23.6.0` (package.json `engines`). `tools/validate-levels.mjs` checks `content/levels/*.json` (build and test run it).
- `tests/smoke.spec.ts`: boots `/`, waits for `window.__pilgrim?.ready`, asserts a frame rendered
  (`stats.drawCalls > 0`), zero console errors and zero page errors; runs check-assets via `child_process` and
  expects exit 0; puts a fake `.png` in `public/`, expects exit 1, then removes it (in `finally`).
- `window.__pilgrim` (always present, read-only): `{ ready: boolean, engine, services, events, mode }` for
  tests; `ready` turns true after the first rendered frame.
