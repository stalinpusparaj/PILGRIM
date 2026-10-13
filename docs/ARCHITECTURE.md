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
(`src/world/DevScene.ts`). `main.ts` already parses the mode; until later phases add the others, every mode
shows the test scene.
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
  `Quality` (resolved before `engine.start()`, so the benchmark has the GPU to itself) → `Input` (hooked into
  `loop.onBeforeStep` / `onAfterStep`) → scene → debug panel → `engine.start()`.
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

## Generation and world (Phase 0 parts)

- `src/gen/rng.ts`: `createRng(seed): Rng` (mulberry32: `next`, `range`, `int`, `pick`) and `hash3(x, y, z, seed)`.
- `src/gen/geom.ts`: `flatten`, `jitter` (position-keyed, no cracks), `paintFaces` (one colour per triangle),
  `mergeFlat` (one geometry, flat normals). Non-indexed geometry with `position` + `color`.
- `src/gen/Sky.ts`: `new Sky(colors, sunDirection, radius?)` gradient dome shader with sun disc;
  `follow(position)`, `dispose()`. Use the horizon colour for the scene fog.
- `src/world/DevScene.ts` (+ `devWorld.ts`): the Phase 0 test scene, a `System` with `scene`, `camera`,
  `setFov()`, `dispose()`. Built from a seed by placement rules (no level coordinates).

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
