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

Phase 0 has only the "test scene" mode: an empty sky + ground scene with a slowly orbiting camera.

## Core (Phase 0) — `src/core/`

### Events.ts (written)
`events.on(name, fn) → unsubscribe`, `events.once`, `events.emit(name, payload?)`, `events.count()`.

### Services.ts (written)
`services.register(key, value)`, `services.get(key)`, `services.tryGet(key)`, `services.has(key)`.
Service keys registered in Phase 0: `engine`, `input`, `settings`, `save`, `i18n`, `quality`, `debug`, `flags`.

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
```

### Loop.ts
Fixed 60 Hz update with accumulator and interpolated render.
```ts
export const FIXED_DT = 1 / 60;
export interface System {
  /** Called at a fixed 60 Hz. dt is always FIXED_DT * timeScale. */
  update?(dt: number): void;
  /** Called once per rendered frame after all fixed steps; alpha in [0,1) for interpolation. */
  render?(alpha: number, frameDt: number): void;
}
export class Loop {
  timeScale: number;           // debug time scale, default 1
  paused: boolean;             // when true: no update(); render() still runs (so menus animate)
  frameCap: 30 | 60;
  add(system: System, order?: number): () => void;   // lower order runs first; returns remove fn
  start(): void; stop(): void;
  onBeforeStep?: () => void; onAfterStep?: () => void; // Input hooks (beginStep/endStep)
  readonly elapsed: number;    // seconds of unpaused simulated time
}
```
- Max 5 fixed steps per frame (drop the rest, no spiral of death).
- `frameCap: 30` skips rendering frames so the render rate stays ≤ 30 fps.
- When `document.hidden`, the loop stops scheduling frames and emits `game:pause {reason:'hidden'}`; on return it
  resets the accumulator (no catch-up burst) and emits `game:resume` only if it was the one that paused.

### Engine.ts
```ts
export class Engine {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;     // antialias, sRGB output, ACESFilmic tone mapping, exposure ~1
  readonly loop: Loop;
  scene: THREE.Scene;                          // active scene (set by whoever owns the current mode)
  camera: THREE.PerspectiveCamera;             // active camera
  readonly stats: { fps: number; frameMs: number; drawCalls: number; triangles: number;
                    geometries: number; textures: number };
  constructor(canvas: HTMLCanvasElement);
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
export class Quality {
  readonly preset: QualityPreset;
  /** 'auto' runs a short in-house GPU benchmark once (first launch), caches the result in localStorage. */
  resolve(setting: QualitySetting, renderer: THREE.WebGLRenderer): Promise<QualityPreset>;
  set(level: QualityLevel): void;              // emits 'quality:changed'
}
```
Benchmark: render an offscreen scene of ~200 instanced faceted spheres with a directional light for ~40 frames
(under 1 s, behind the loading screen), measure median frame time with `gl.finish` / timestamps, map to a level.
Mobile (coarse pointer + small screen) never auto-picks High. Shadows are off on Low (GDD 2.11).

### Input.ts (+ `src/ui/Touch.ts` for the on-screen controls)
```ts
export type Action =
  | 'moveForward' | 'moveBack' | 'moveLeft' | 'moveRight' | 'run' | 'jump' | 'use' | 'pray'
  | 'sword' | 'shield' | 'satchel' | 'pause' | 'skip' | 'choice1' | 'choice2' | 'choice3' | 'debug';
export type InputDevice = 'kbm' | 'pad' | 'touch';
export type TouchButton = 'jump' | 'use' | 'pray' | 'sword' | 'shield';
export class Input {
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
  setGameplayActive(active: boolean): void;    // false in menus: no pointer lock, touch controls hidden
  setTouchButtons(buttons: TouchButton[]): void; // which round buttons show (combat buttons only when needed)
  // Remapping (GDD 2.6: all keys remappable, saved)
  getBindings(a: Action): string[];            // KeyboardEvent.code values and 'Mouse0'/'Mouse2'
  rebind(a: Action, code: string): void;       // persists via Settings
  resetBindings(): void;
  captureNextKey(): Promise<string>;           // for the "Press a key..." UI
  beginStep(): void; endStep(): void;          // called by Loop around each fixed step
  dispose(): void;
}
export const DEFAULT_BINDINGS: Record<Action, string[]>;
```
- Default keyboard per GDD 2.6: WASD + arrows, Shift run, Space jump/skip, E use, Q pray, Mouse0 sword,
  Mouse2 shield, Tab satchel, Esc pause, Digit1-3 choices, F1 debug. Tab/Space must `preventDefault`.
- Gamepad (standard mapping): left stick move, right stick look, A(0) jump, X(2) use, B(1) run hold, Y(3) pray,
  RT(7) sword, LT(6) shield, View(8) satchel, Menu(9) pause. Deadzone 0.18.
- Touch: floating joystick on the left half (appears where the thumb lands; push to the edge = run),
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
export class Settings {
  readonly data: Readonly<SettingsData>;
  get<K extends keyof SettingsData>(k: K): SettingsData[K];
  set<K extends keyof SettingsData>(k: K, v: SettingsData[K]): void;   // persists + emits 'settings:changed'
  reset(): void;
}
```
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
```
`idb.ts`: tiny promise wrapper (`open`, `get`, `put`, `del`, `keys`) over one database `pilgrim`, store `saves`.
If IndexedDB is unavailable (private mode), fall back to an in-memory map and warn once.

### I18n.ts
```ts
export type Lang = 'en' | 'ta';
export function t(key: string, params?: Record<string, string | number>): string;  // "{n}" placeholders
export class I18n { lang: Lang; setLang(l: Lang): void; has(key: string): boolean; }
```
- Loads `content/i18n/en.json` and `ta.json` (flat `{ "key": "text" }` maps) by static import.
- Missing in Tamil → English fallback. Missing in English → returns the key and (dev only) `console.warn` once per key.
- Setting `lang` sets `document.documentElement.lang` and a `lang-ta` class on `<body>` so CSS can switch to
  the Tamil font stack (GDD 2.14). Emits `lang:changed`.

### Debug.ts (dev or `?debug=1` only)
```ts
export class Debug {
  toggle(): void;                       // F1
  addReadout(label: string, fn: () => string): () => void;
  addButton(group: string, label: string, fn: () => void): () => void;
  addToggle(group: string, label: string, get: () => boolean, set: (v: boolean) => void): () => void;
  addSlider(group: string, label: string, min: number, max: number, step: number,
            get: () => number, set: (v: number) => void): () => void;
}
```
Small plain-DOM panel, top-right, monospace system font. Phase 0 content: FPS, frame ms, draw calls, triangles,
geometries/textures, quality level, input device, time-scale slider, quality buttons. Later phases add their
controls (chapter jump, burden, hope, gifts, show triggers, free camera, place mode) through this API.
Debug strings are developer-only and may be plain English (not i18n).

### UI root
`#ui` is a full-screen DOM overlay above the canvas (`pointer-events: none` on the root; children opt in).
Global CSS: `src/ui/styles.css` (system font stacks from GDD 2.14, CSS variables for colours, Tamil class).
Body text ≥ 20 px on mobile.

## Tools and tests (Phase 0)

- `tools/check-assets.mjs` — GDD 2.3. Fails (exit 1, readable message) if:
  - `public/` contains any file that is not text-based (`.svg`, `.json`, `.webmanifest`, `.txt`, `.js`) **and**
    not listed in `public/.generated-icons.json` (the manifest our own `tools/gen-icons.mjs` writes);
    binary detection by extension *and* by sniffing for NUL bytes / known magic numbers (PNG, JPEG, GIF, WebP,
    OGG, MP3, WAV, GLB, KTX2, WOFF/WOFF2/TTF/OTF, HDR, EXR, FBX, ZIP).
  - `package.json` `dependencies` has anything other than `three`, or `devDependencies` has anything outside
    the allowlist (`vite`, `typescript`, `@playwright/test`, `eslint`, `prettier`, `@types/three`).
  - any `src/**` file imports from `three/examples/jsm/` something outside an allowlist of code modules, or
    references an asset path inside `three/examples` (`/textures/`, `/models/`, `/sounds/`, `/fonts/`).
  - any file under `src/` or `content/` contains a URL to fetch assets (`http(s)://...(png|jpg|glb|gltf|mp3|ogg|wav|woff2?|ttf|hdr)`).
- `npm run build` and `npm test` run check-assets first (already wired in package.json).
- `playwright.config.ts` uses the installed Google Chrome (`channel: 'chrome'`) so no browser download is
  needed; `webServer` runs `vite` on 5173. Headless, with `--use-angle=metal` / swiftshader fallback flags.
- `tests/smoke.spec.ts`: boots `/`, waits for `window.__pilgrim?.ready`, asserts a frame rendered
  (`stats.drawCalls > 0`), zero console errors and zero page errors; runs check-assets via `child_process` and
  expects exit 0; puts a fake `.png` in `public/`, expects exit 1, then removes it (in `finally`).
- `window.__pilgrim` (always present, read-only): `{ ready: boolean, engine, services, events }` for tests.
